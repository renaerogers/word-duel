/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");
const A = "token-aaaaaaaaaaaaaaaa";
const B = "token-bbbbbbbbbbbbbbbb";
const at = (r: number, c: number) => r * 15 + c;

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const w of ["CAT", "BAD", "CATS", "DOG"]) await ctx.db.insert("words", { w });
  });
  const gameId = await t.mutation(api.games.createGame, { token: A, name: "Alice" });
  await t.mutation(api.games.joinGame, { gameId, token: B, name: "Bob" });
  // Make racks and turn deterministic for the test.
  await t.run(async (ctx) => {
    const players = await ctx.db.query("players").collect();
    for (const p of players) {
      await ctx.db.patch(p._id, { rack: p.seat === 0 ? "CATSDOG" : "BDEXYZ?" });
    }
    await ctx.db.patch(gameId as Id<"games">, { turn: 0 });
  });
  return { t, gameId };
}

test("public game view never leaks bag, racks or tokens", async () => {
  const { t, gameId } = await setup();
  const g = await t.query(api.games.getGame, { gameId });
  const json = JSON.stringify(g);
  expect(json).not.toContain(A);
  expect(json).not.toContain("CATSDOG");
  expect(g).not.toHaveProperty("bag");
  expect(g!.bagCount).toBe(86);
  expect(g!.status).toBe("active");
  expect(await t.query(api.games.getMyRack, { gameId, token: B })).toEqual({ seat: 1, rack: "BDEXYZ?" });
  expect(await t.query(api.games.getMyRack, { gameId, token: "spectator-xxxxxxxxxx" })).toBeNull();
});

test("third player cannot join", async () => {
  const { t, gameId } = await setup();
  await expect(
    t.mutation(api.games.joinGame, { gameId, token: "token-cccccccccccccccc", name: "Cara" }),
  ).rejects.toThrow(/two players/);
});

test("server enforces turn, rack and dictionary", async () => {
  const { t, gameId } = await setup();
  const cat = [
    { index: at(7, 6), letter: "C", blank: false },
    { index: at(7, 7), letter: "A", blank: false },
    { index: at(7, 8), letter: "T", blank: false },
  ];
  await expect(t.mutation(api.games.playWord, { gameId, token: B, placements: cat })).rejects.toThrow(/not your turn/);

  const tac = [
    { index: at(7, 6), letter: "T", blank: false },
    { index: at(7, 7), letter: "A", blank: false },
    { index: at(7, 8), letter: "C", blank: false },
  ];
  await expect(t.mutation(api.games.playWord, { gameId, token: A, placements: tac })).rejects.toThrow(/Not in the word list: TAC/);

  const zap = [
    { index: at(7, 7), letter: "Z", blank: false },
    { index: at(7, 8), letter: "A", blank: false },
  ];
  await expect(t.mutation(api.games.playWord, { gameId, token: A, placements: zap })).rejects.toThrow(/aren't in your rack/);

  const score = await t.mutation(api.games.playWord, { gameId, token: A, placements: cat });
  expect(score).toBe(10);

  const g = await t.query(api.games.getGame, { gameId });
  expect(g!.turn).toBe(1);
  expect(g!.board.slice(at(7, 6), at(7, 9))).toBe("CAT");
  expect(g!.players.find((p) => p.seat === 0)!.score).toBe(10);
  expect(g!.bagCount).toBe(83);
  expect((await t.query(api.games.getMyRack, { gameId, token: A }))!.rack).toHaveLength(7);

  // Bob plays B_D through the A, using a blank as the D
  const bad = [
    { index: at(6, 7), letter: "B", blank: false },
    { index: at(8, 7), letter: "D", blank: true },
  ];
  const s2 = await t.mutation(api.games.playWord, { gameId, token: B, placements: bad });
  expect(s2).toBe(4); // B3 + A1 + d0
  const g2 = await t.query(api.games.getGame, { gameId });
  expect(g2!.board[at(8, 7)]).toBe("d");
  expect(g2!.recentMoves[0].words).toEqual([{ word: "BAD", score: 4 }]);
});

test("pass, swap and resign", async () => {
  const { t, gameId } = await setup();
  await t.mutation(api.games.passTurn, { gameId, token: A });
  await t.mutation(api.games.swapTiles, { gameId, token: B, tiles: ["X", "Z"] });
  const rack = (await t.query(api.games.getMyRack, { gameId, token: B }))!.rack;
  expect(rack).toHaveLength(7);
  let g = await t.query(api.games.getGame, { gameId });
  expect(g!.bagCount).toBe(86);
  expect(g!.turn).toBe(0);
  await t.mutation(api.games.resign, { gameId, token: A });
  g = await t.query(api.games.getGame, { gameId });
  expect(g!.status).toBe("finished");
  expect(g!.winner).toBe(1);
});

test("six scoreless turns end the game", async () => {
  const { t, gameId } = await setup();
  for (let i = 0; i < 6; i++) {
    await t.mutation(api.games.passTurn, { gameId, token: i % 2 === 0 ? A : B });
  }
  const g = await t.query(api.games.getGame, { gameId });
  expect(g!.status).toBe("finished");
  expect(g!.players.every((p) => p.score < 0)).toBe(true);
});

test("inactivity timer forfeits only if no one moved", async () => {
  const { t, gameId } = await setup();
  const id = gameId as Id<"games">;
  await t.mutation(internal.games.expire, { gameId: id, turnNumber: 999 });
  expect((await t.query(api.games.getGame, { gameId }))!.status).toBe("active");
  const g = await t.query(api.games.getGame, { gameId });
  await t.mutation(internal.games.expire, { gameId: id, turnNumber: g!.turnNumber });
  const g2 = await t.query(api.games.getGame, { gameId });
  expect(g2!.status).toBe("finished");
  expect(g2!.winner).toBe(1);
  expect(g2!.endReason).toMatch(/ran out of time/);
});

test("unjoined lobby is deleted", async () => {
  const t = convexTest(schema, modules);
  const gameId = await t.mutation(api.games.createGame, { token: A, name: "Alice" });
  await t.mutation(internal.games.expire, { gameId: gameId as Id<"games">, turnNumber: 0 });
  expect(await t.query(api.games.getGame, { gameId })).toBeNull();
});

test("bad game ids are handled gracefully", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.games.getGame, { gameId: "not-a-real-id" })).toBeNull();
});

test("a zero-point play counts toward the scoreless limit", async () => {
  const { t, gameId } = await setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("words", { w: "AA" });
    const p0 = (await ctx.db.query("players").collect()).find((p) => p.seat === 0)!;
    await ctx.db.patch(p0._id, { rack: "??CATSD" });
    await ctx.db.patch(gameId as Id<"games">, { scorelessTurns: 5 });
  });
  const s = await t.mutation(api.games.playWord, {
    gameId,
    token: A,
    placements: [
      { index: at(7, 7), letter: "A", blank: true },
      { index: at(7, 8), letter: "A", blank: true },
    ],
  });
  expect(s).toBe(0);
  const g = await t.query(api.games.getGame, { gameId });
  expect(g!.status).toBe("finished");
  expect(g!.board[at(7, 7)]).toBe("a");
});

test("creator can cancel an unjoined lobby; finished games are purged", async () => {
  const t = convexTest(schema, modules);
  const lobby = await t.mutation(api.games.createGame, { token: A, name: "Alice" });
  await t.mutation(api.games.resign, { gameId: lobby, token: A });
  expect(await t.query(api.games.getGame, { gameId: lobby })).toBeNull();

  const { t: t2, gameId } = await setup();
  await t2.mutation(api.games.resign, { gameId, token: B });
  await t2.mutation(internal.games.purge, { gameId: gameId as Id<"games"> });
  expect(await t2.query(api.games.getGame, { gameId })).toBeNull();
  const leftovers = await t2.run(async (ctx) => (await ctx.db.query("players").collect()).length);
  expect(leftovers).toBe(0);
});

test("oversized placement arrays are rejected", async () => {
  const { t, gameId } = await setup();
  const placements = Array.from({ length: 50 }, (_, i) => ({ index: i, letter: "A", blank: false }));
  await expect(t.mutation(api.games.playWord, { gameId, token: A, placements })).rejects.toThrow(/Too many/);
});
