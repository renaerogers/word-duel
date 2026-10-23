import { test, expect } from "vitest";

const assert = {
  equal: (a: unknown, b: unknown) => expect(a).toBe(b),
  deepEqual: (a: unknown, b: unknown) => expect(a).toEqual(b),
  ok: (a: unknown) => expect(a).toBeTruthy(),
  throws: (fn: () => unknown, m: RegExp | (new (...a: any[]) => Error)) => expect(fn).toThrow(m),
};
import {
  CENTER, EMPTY_BOARD, PREMIUMS, SIZE, evaluateMove, newBag, draw, removeTiles,
  rackValue, RuleError, type Placement,
} from "../convex/lib/rules.ts";

const at = (r: number, c: number) => r * SIZE + c;
const word = (r: number, c: number, s: string, vertical = false): Placement[] =>
  s.split("").map((letter, k) => ({
    index: vertical ? at(r + k, c) : at(r, c + k),
    letter,
    blank: false,
  }));

test("bag has 100 tiles with 2 blanks", () => {
  const bag = newBag();
  assert.equal(bag.length, 100);
  assert.equal(bag.split("?").length - 1, 2);
});

test("premium layout is symmetric and center is start", () => {
  assert.equal(PREMIUMS[CENTER], "START");
  for (let i = 0; i < 225; i++) {
    const r = Math.floor(i / 15), c = i % 15;
    assert.equal(PREMIUMS[i], PREMIUMS[c * 15 + r]);
    assert.equal(PREMIUMS[i], PREMIUMS[(14 - r) * 15 + c]);
  }
});

test("first move must cover center", () => {
  assert.throws(() => evaluateMove(EMPTY_BOARD, word(0, 0, "CAT")), RuleError);
  const res = evaluateMove(EMPTY_BOARD, word(7, 6, "CAT"));
  // C3 + A1 + T1 = 5, center doubles => 10
  assert.equal(res.score, 10);
  assert.deepEqual(res.words.map((w) => w.word), ["CAT"]);
});

test("first move needs 2+ letters", () => {
  assert.throws(() => evaluateMove(EMPTY_BOARD, word(7, 7, "A")), /2 letters/);
});

test("tiles must be in one line with no gaps", () => {
  const diag: Placement[] = [
    { index: at(7, 7), letter: "A", blank: false },
    { index: at(8, 8), letter: "B", blank: false },
  ];
  assert.throws(() => evaluateMove(EMPTY_BOARD, diag), /single row or column/);
  const gap: Placement[] = [
    { index: at(7, 7), letter: "A", blank: false },
    { index: at(7, 9), letter: "B", blank: false },
  ];
  assert.throws(() => evaluateMove(EMPTY_BOARD, gap), /gaps/);
});

test("later moves must connect, and existing tiles fill gaps", () => {
  const b1 = evaluateMove(EMPTY_BOARD, word(7, 6, "CAT")).board;
  assert.throws(() => evaluateMove(b1, word(0, 0, "DOG")), /connect/);
  // Play S after CAT -> CATS (single tile, horizontal word)
  const r = evaluateMove(b1, [{ index: at(7, 9), letter: "S", blank: false }]);
  assert.deepEqual(r.words.map((w) => w.word), ["CATS"]);
  // Play "C_T" across row 7 using existing A: place C at col 6? taken. Use vertical through A.
  const v = evaluateMove(b1, [
    { index: at(6, 7), letter: "B", blank: false },
    { index: at(8, 7), letter: "D", blank: false },
  ]);
  assert.deepEqual(v.words.map((w) => w.word), ["BAD"]);
});

test("cross words are found and scored; blanks score 0", () => {
  const b1 = evaluateMove(EMPTY_BOARD, word(7, 6, "CAT")).board;
  // Place "AT" vertically under C at (8,6),(9,6) => CAT vertical; also check blank
  const r = evaluateMove(b1, [
    { index: at(8, 6), letter: "A", blank: true },
    { index: at(9, 6), letter: "T", blank: false },
  ]);
  assert.equal(r.words[0].word, "CAT");
  assert.equal(r.board[at(8, 6)], "a");
  assert.ok(r.score >= 4);
});

test("bingo adds 50", () => {
  const r = evaluateMove(EMPTY_BOARD, word(7, 4, "RETAINS"));
  assert.equal(r.bingo, true);
  assert.ok(r.score > 50);
});

test("cannot place on occupied square", () => {
  const b1 = evaluateMove(EMPTY_BOARD, word(7, 6, "CAT")).board;
  assert.throws(() => evaluateMove(b1, word(7, 7, "AT")), /taken/);
});

test("rack helpers", () => {
  assert.equal(removeTiles("ABC?", ["?", "A"]), "BC");
  assert.equal(removeTiles("ABC", ["Z"]), null);
  const d = draw("XYZQ", "ABCDE");
  assert.equal(d.rack, "ABCDEZQ");
  assert.equal(d.bag, "XY");
  assert.equal(rackValue("QZ?"), 20);
});
