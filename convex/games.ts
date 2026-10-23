import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  EMPTY_BOARD, MAX_SCORELESS_TURNS, RACK_SIZE, RuleError, draw, evaluateMove, newBag,
  rackValue, removeTiles, shuffle, tilesUsed,
} from "./lib/rules";

/** A turn left untouched this long forfeits the game (async play over days is fine). */
const TURN_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
/** A lobby nobody joins is deleted after this long. */
const LOBBY_TIMEOUT_MS = 3 * 24 * 60 * 60 * 1000;
/** Finished games (and their moves) are deleted after this long to keep storage small. */
const FINISHED_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const RECENT_MOVES = 8;
const MAX_PLACEMENTS = 7;

const placementValidator = v.object({ index: v.number(), letter: v.string(), blank: v.boolean() });

// ---------- helpers ----------

function fail(message: string): never {
  throw new ConvexError(message);
}

function cleanName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ").slice(0, 20);
  if (!n) fail("Please enter a name.");
  return n;
}

function checkToken(token: string) {
  if (token.length < 16 || token.length > 100) fail("Invalid player token.");
}

async function loadGame(ctx: QueryCtx, gameId: string) {
  const id = ctx.db.normalizeId("games", gameId);
  return id ? await ctx.db.get(id) : null;
}

async function loadPlayers(ctx: QueryCtx, gameId: Id<"games">) {
  return await ctx.db
    .query("players")
    .withIndex("by_game", (q) => q.eq("gameId", gameId))
    .collect();
}

/** Load game + the calling player, and require it to be their turn in an active game. */
async function loadTurn(ctx: MutationCtx, gameId: string, token: string) {
  checkToken(token);
  const game = await loadGame(ctx, gameId);
  if (!game) fail("Game not found.");
  if (game.status !== "active") fail("This game is not in progress.");
  const players = await loadPlayers(ctx, game._id);
  const me = players.find((p) => p.token === token);
  if (!me) fail("You are not a player in this game.");
  if (me.seat !== game.turn) fail("It's not your turn.");
  const opponent = players.find((p) => p.seat !== me.seat)!;
  return { game, players, me, opponent };
}

/** Replace the pending timeout job with a new one for the next turn. */
async function resetTimer(ctx: MutationCtx, game: Doc<"games">, turnNumber: number, delay: number) {
  if (game.timeoutJob) await cancelJob(ctx, game.timeoutJob);
  return await ctx.scheduler.runAfter(delay, internal.games.expire, { gameId: game._id, turnNumber });
}

async function cancelJob(ctx: MutationCtx, id: Id<"_scheduled_functions">) {
  const job = await ctx.db.system.get(id);
  if (job && job.state.kind === "pending") await ctx.scheduler.cancel(id);
}

/** Finish the game: apply end-of-game rack adjustments and pick a winner. */
async function finishGame(
  ctx: MutationCtx,
  game: Doc<"games">,
  players: Doc<"players">[],
  endReason: string,
  opts: { winner?: number; wentOut?: number; deductRacks?: boolean } = {},
) {
  const scores = new Map(players.map((p) => [p.seat, p.score]));
  if (opts.wentOut !== undefined) {
    // Player who used all tiles gains the opponent's remaining tile values.
    for (const p of players) {
      if (p.seat === opts.wentOut) continue;
      const left = rackValue(p.rack);
      scores.set(p.seat, p.score - left);
      scores.set(opts.wentOut, scores.get(opts.wentOut)! + left);
    }
  } else if (opts.deductRacks) {
    for (const p of players) scores.set(p.seat, p.score - rackValue(p.rack));
  }
  for (const p of players) {
    if (scores.get(p.seat) !== p.score) await ctx.db.patch(p._id, { score: scores.get(p.seat)! });
  }

  let winner = opts.winner;
  if (winner === undefined) {
    const [a, b] = [scores.get(0)!, scores.get(1)!];
    winner = a === b ? undefined : a > b ? 0 : 1;
  }
  if (game.timeoutJob) await cancelJob(ctx, game.timeoutJob);
  // Keep finished games around for a while so players can see the result, then delete them.
  const purgeJob = await ctx.scheduler.runAfter(FINISHED_RETENTION_MS, internal.games.purge, { gameId: game._id });
  await ctx.db.patch(game._id, { status: "finished", winner, endReason, timeoutJob: purgeJob });
}

/** Common end-of-turn bookkeeping for pass/swap. */
async function scorelessTurn(
  ctx: MutationCtx,
  game: Doc<"games">,
  players: Doc<"players">[],
  patch: Partial<Doc<"games">> = {},
) {
  const scorelessTurns = game.scorelessTurns + 1;
  if (scorelessTurns >= MAX_SCORELESS_TURNS) {
    await ctx.db.patch(game._id, { ...patch, scorelessTurns });
    await finishGame(ctx, { ...game, ...patch, scorelessTurns }, players, "Too many turns in a row without scoring", {
      deductRacks: true,
    });
    return;
  }
  const turnNumber = game.turnNumber + 1;
  const timeoutJob = await resetTimer(ctx, game, turnNumber, TURN_TIMEOUT_MS);
  await ctx.db.patch(game._id, { ...patch, scorelessTurns, turn: 1 - game.turn, turnNumber, timeoutJob });
}

// ---------- lobby ----------

export const createGame = mutation({
  args: { token: v.string(), name: v.string() },
  handler: async (ctx, { token, name }) => {
    checkToken(token);
    const { bag, rack } = draw(newBag(), "");
    const gameId = await ctx.db.insert("games", {
      board: EMPTY_BOARD,
      bag,
      status: "waiting",
      turn: 0,
      turnNumber: 0,
      scorelessTurns: 0,
      lastTiles: [],
    });
    await ctx.db.insert("players", { gameId, seat: 0, name: cleanName(name), token, score: 0, rack });
    const timeoutJob = await ctx.scheduler.runAfter(LOBBY_TIMEOUT_MS, internal.games.expire, {
      gameId,
      turnNumber: 0,
    });
    await ctx.db.patch(gameId, { timeoutJob });
    return gameId;
  },
});

export const joinGame = mutation({
  args: { gameId: v.string(), token: v.string(), name: v.string() },
  handler: async (ctx, { gameId, token, name }) => {
    checkToken(token);
    const game = await loadGame(ctx, gameId);
    if (!game) fail("Game not found. The invite may have expired.");
    const players = await loadPlayers(ctx, game._id);
    if (players.some((p) => p.token === token)) return; // already in this game
    if (game.status !== "waiting" || players.length >= 2) fail("This game already has two players.");

    const { bag, rack } = draw(game.bag, "");
    await ctx.db.insert("players", { gameId: game._id, seat: 1, name: cleanName(name), token, score: 0, rack });
    const turn = Math.random() < 0.5 ? 0 : 1; // coin flip for who goes first
    const timeoutJob = await resetTimer(ctx, game, 1, TURN_TIMEOUT_MS);
    await ctx.db.patch(game._id, { bag, status: "active", turn, turnNumber: 1, timeoutJob });
  },
});

// ---------- turns ----------

export const playWord = mutation({
  args: { gameId: v.string(), token: v.string(), placements: v.array(placementValidator) },
  handler: async (ctx, { gameId, token, placements }) => {
    if (placements.length > MAX_PLACEMENTS) fail("Too many tiles.");
    const { game, players, me, opponent } = await loadTurn(ctx, gameId, token);

    // 1. Placement rules + scoring (shared with the client preview)
    let result;
    try {
      result = evaluateMove(game.board, placements);
    } catch (e) {
      if (e instanceof RuleError) fail(e.message);
      throw e;
    }

    // 2. Tiles must come from this player's rack
    const rackAfter = removeTiles(me.rack, tilesUsed(placements));
    if (rackAfter === null) fail("Those tiles aren't in your rack.");

    // 3. Dictionary: one indexed point lookup per distinct word
    const distinct = [...new Set(result.words.map((w) => w.word))];
    const invalid: string[] = [];
    for (const w of distinct) {
      const hit = await ctx.db.query("words").withIndex("by_w", (q) => q.eq("w", w)).first();
      if (!hit) invalid.push(w);
    }
    if (invalid.length) {
      const loaded = await ctx.db.query("words").first();
      if (!loaded) fail("The dictionary hasn't been loaded yet. Run `npm run dictionary:import`.");
      fail(`Not in the word list: ${invalid.join(", ")}`);
    }

    // 4. Apply the move atomically (Convex mutations are transactions)
    const { bag, rack } = draw(game.bag, rackAfter);
    const score = me.score + result.score;
    await ctx.db.patch(me._id, { rack, score });
    await ctx.db.insert("moves", {
      gameId: game._id,
      seat: me.seat,
      kind: "play",
      words: result.words,
      tiles: placements.map((p) => p.index),
      score: result.score,
    });

    const patch = { board: result.board, bag, lastTiles: placements.map((p) => p.index) };
    if (rack.length === 0 && bag.length === 0) {
      await ctx.db.patch(game._id, patch);
      const updated = players.map((p) => (p._id === me._id ? { ...p, rack, score } : p));
      await finishGame(ctx, { ...game, ...patch }, updated, "A player used all their tiles", {
        wentOut: me.seat,
      });
      return result.score;
    }

    if (result.score === 0) {
      // e.g. a word made only of blanks: counts toward the scoreless-turn limit
      const updated = players.map((p) => (p._id === me._id ? { ...p, rack, score } : p));
      await scorelessTurn(ctx, game, updated, patch);
      return 0;
    }

    const turnNumber = game.turnNumber + 1;
    const timeoutJob = await resetTimer(ctx, game, turnNumber, TURN_TIMEOUT_MS);
    await ctx.db.patch(game._id, {
      ...patch,
      turn: opponent.seat,
      turnNumber,
      scorelessTurns: 0,
      timeoutJob,
    });
    return result.score;
  },
});

export const swapTiles = mutation({
  args: { gameId: v.string(), token: v.string(), tiles: v.array(v.string()) },
  handler: async (ctx, { gameId, token, tiles }) => {
    const { game, players, me } = await loadTurn(ctx, gameId, token);
    if (tiles.length === 0 || tiles.length > RACK_SIZE) fail("Choose 1 to 7 tiles to swap.");
    if (game.bag.length < RACK_SIZE) fail("You can only swap while 7 or more tiles are left in the bag.");
    const kept = removeTiles(me.rack, tiles);
    if (kept === null) fail("Those tiles aren't in your rack.");

    const drawn = draw(game.bag, kept);
    const bag = shuffle(drawn.bag + tiles.join(""));
    await ctx.db.patch(me._id, { rack: drawn.rack });
    await ctx.db.insert("moves", {
      gameId: game._id, seat: me.seat, kind: "swap", words: [], tiles: [], score: 0,
    });
    await scorelessTurn(ctx, game, players, { bag });
  },
});

export const passTurn = mutation({
  args: { gameId: v.string(), token: v.string() },
  handler: async (ctx, { gameId, token }) => {
    const { game, players, me } = await loadTurn(ctx, gameId, token);
    await ctx.db.insert("moves", {
      gameId: game._id, seat: me.seat, kind: "pass", words: [], tiles: [], score: 0,
    });
    await scorelessTurn(ctx, game, players);
  },
});

export const resign = mutation({
  args: { gameId: v.string(), token: v.string() },
  handler: async (ctx, { gameId, token }) => {
    checkToken(token);
    const game = await loadGame(ctx, gameId);
    if (!game || game.status === "finished") fail("This game is not in progress.");
    const players = await loadPlayers(ctx, game._id);
    const me = players.find((p) => p.token === token);
    if (!me) fail("You are not a player in this game.");
    if (game.status === "waiting") {
      // Creator cancels an unjoined lobby: just delete it.
      if (game.timeoutJob) await cancelJob(ctx, game.timeoutJob);
      for (const p of players) await ctx.db.delete(p._id);
      await ctx.db.delete(game._id);
      return;
    }
    await ctx.db.insert("moves", {
      gameId: game._id, seat: me.seat, kind: "resign", words: [], tiles: [], score: 0,
    });
    await finishGame(ctx, game, players, `${me.name} resigned`, { winner: 1 - me.seat });
  },
});

/** Scheduled: delete an unjoined lobby, or forfeit a player who stopped taking turns. */
export const expire = internalMutation({
  args: { gameId: v.id("games"), turnNumber: v.number() },
  handler: async (ctx, { gameId, turnNumber }) => {
    const game = await ctx.db.get(gameId);
    if (!game || game.turnNumber !== turnNumber) return; // someone moved; nothing to do
    const players = await loadPlayers(ctx, gameId);
    if (game.status === "waiting") {
      for (const p of players) await ctx.db.delete(p._id);
      await ctx.db.delete(gameId);
    } else if (game.status === "active") {
      const idle = players.find((p) => p.seat === game.turn)!;
      await ctx.db.insert("moves", {
        gameId, seat: idle.seat, kind: "timeout", words: [], tiles: [], score: 0,
      });
      await finishGame(ctx, { ...game, timeoutJob: undefined }, players, `${idle.name} ran out of time`, {
        winner: 1 - idle.seat,
      });
    }
  },
});

/** Scheduled: delete a long-finished game and everything that belongs to it. */
export const purge = internalMutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "finished") return;
    const moves = await ctx.db.query("moves").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect();
    for (const m of moves) await ctx.db.delete(m._id);
    for (const p of await loadPlayers(ctx, gameId)) await ctx.db.delete(p._id);
    await ctx.db.delete(gameId);
  },
});

// ---------- queries (what clients can see) ----------

/** Public game view. Excludes the tile bag, racks and player tokens. */
export const getGame = query({
  args: { gameId: v.string() },
  handler: async (ctx, { gameId }) => {
    const game = await loadGame(ctx, gameId);
    if (!game) return null;
    const players = await loadPlayers(ctx, game._id);
    const recent = await ctx.db
      .query("moves")
      .withIndex("by_game", (q) => q.eq("gameId", game._id))
      .order("desc")
      .take(RECENT_MOVES);
    return {
      _id: game._id,
      board: game.board,
      status: game.status,
      turn: game.turn,
      turnNumber: game.turnNumber,
      bagCount: game.bag.length,
      lastTiles: game.lastTiles,
      winner: game.winner,
      endReason: game.endReason,
      players: players.map((p) => ({ seat: p.seat, name: p.name, score: p.score, rackCount: p.rack.length })),
      recentMoves: recent.map((m) => ({
        _id: m._id, seat: m.seat, kind: m.kind, words: m.words, score: m.score,
      })),
    };
  },
});

/** The caller's own seat and rack. Returns null for spectators. */
export const getMyRack = query({
  args: { gameId: v.string(), token: v.string() },
  handler: async (ctx, { gameId, token }) => {
    const id = ctx.db.normalizeId("games", gameId);
    if (!id || token.length < 16) return null;
    const me = await ctx.db
      .query("players")
      .withIndex("by_game_token", (q) => q.eq("gameId", id).eq("token", token))
      .unique();
    return me ? { seat: me.seat, rack: me.rack } : null;
  },
});
