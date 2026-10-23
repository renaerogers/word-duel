import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  games: defineTable({
    /** 225-char board, see convex/lib/rules.ts */
    board: v.string(),
    /** Shuffled tile bag. NEVER returned to clients. */
    bag: v.string(),
    status: v.union(v.literal("waiting"), v.literal("active"), v.literal("finished")),
    /** Seat (0 or 1) whose turn it is */
    turn: v.number(),
    /** Increments every turn; used by the inactivity timer */
    turnNumber: v.number(),
    /** Consecutive passes/swaps/zero-score turns; game ends at 6 */
    scorelessTurns: v.number(),
    /** Board cells from the most recent word, for highlighting */
    lastTiles: v.array(v.number()),
    winner: v.optional(v.number()), // seat, or undefined for a tie
    endReason: v.optional(v.string()),
    /** Pending scheduled job: ends an abandoned game/lobby, or purges a finished game */
    timeoutJob: v.optional(v.id("_scheduled_functions")),
  }),

  players: defineTable({
    gameId: v.id("games"),
    seat: v.number(),
    name: v.string(),
    /** Random secret kept in the player's browser. NEVER returned to clients. */
    token: v.string(),
    score: v.number(),
    /** Private rack. Only returned to its owner via getMyRack. */
    rack: v.string(),
  })
    .index("by_game", ["gameId", "seat"])
    .index("by_game_token", ["gameId", "token"]),

  moves: defineTable({
    gameId: v.id("games"),
    seat: v.number(),
    kind: v.union(
      v.literal("play"),
      v.literal("swap"),
      v.literal("pass"),
      v.literal("resign"),
      v.literal("timeout"),
    ),
    words: v.array(v.object({ word: v.string(), score: v.number() })),
    tiles: v.array(v.number()),
    score: v.number(),
  }).index("by_game", ["gameId"]),

  /** One row per valid word (uppercase). Loaded with `npm run dictionary:import`. */
  words: defineTable({ w: v.string() }).index("by_w", ["w"]),
});
