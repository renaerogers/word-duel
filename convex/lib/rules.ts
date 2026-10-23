/**
 * Word Duel game rules.
 *
 * Pure TypeScript with no imports, so the exact same code runs:
 *   - on the Convex server (the authority: validates and scores real moves)
 *   - in the browser (free, instant score preview while placing tiles)
 *
 * Compact encodings keep documents small and reads cheap:
 *   board: 225-char string, "." = empty, "A"-"Z" = tile, "a"-"z" = blank tile played as that letter
 *   rack / bag: strings of "A"-"Z" plus "?" for a blank
 */

export const SIZE = 15;
export const CELLS = SIZE * SIZE;
export const CENTER = 7 * SIZE + 7; // 112
export const RACK_SIZE = 7;
export const BINGO_BONUS = 50;
export const EMPTY = ".";
export const BLANK = "?";
export const MAX_SCORELESS_TURNS = 6;

export type Premium = "" | "DL" | "TL" | "DW" | "TW" | "START";

/**
 * Word Duel's own premium-square layout (one 8x8 quadrant, mirrored to fill the board).
 * T = triple word, D = double word, t = triple letter, d = double letter, * = start (double word)
 */
const QUADRANT = [
  "...T..t.",
  "..d..D..",
  ".d..t...",
  "T..D...d",
  "..t...d.",
  ".D...t..",
  "t...d...",
  "...d...*",
];

const PREMIUM_CODE: Record<string, Premium> = {
  ".": "",
  d: "DL",
  t: "TL",
  D: "DW",
  T: "TW",
  "*": "START",
};

export const PREMIUMS: Premium[] = Array.from({ length: CELLS }, (_, i) => {
  const r = Math.floor(i / SIZE);
  const c = i % SIZE;
  const qr = Math.min(r, SIZE - 1 - r);
  const qc = Math.min(c, SIZE - 1 - c);
  return PREMIUM_CODE[QUADRANT[qr][qc]];
});

export const LETTER_VALUES: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
  "?": 0,
};

/** 100 tiles, including 2 blanks. */
const TILE_COUNTS: Record<string, number> = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
  N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1,
  "?": 2,
};

export const EMPTY_BOARD = EMPTY.repeat(CELLS);

/** Points for a tile character (rack letter, "?" blank, or board char where lowercase = blank). */
export function tileValue(ch: string): number {
  if (ch >= "a" && ch <= "z") return 0;
  return LETTER_VALUES[ch] ?? 0;
}

export function rackValue(rack: string): number {
  let sum = 0;
  for (const ch of rack) sum += tileValue(ch);
  return sum;
}

export function shuffle(tiles: string, random: () => number = Math.random): string {
  const arr = tiles.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}

export function newBag(random: () => number = Math.random): string {
  let tiles = "";
  for (const [ch, n] of Object.entries(TILE_COUNTS)) tiles += ch.repeat(n);
  return shuffle(tiles, random);
}

/** Draw from the end of an already-shuffled bag. */
export function draw(bag: string, rack: string): { bag: string; rack: string } {
  const n = Math.min(RACK_SIZE - rack.length, bag.length);
  if (n <= 0) return { bag, rack };
  return { bag: bag.slice(0, bag.length - n), rack: rack + bag.slice(bag.length - n) };
}

/** Remove the given tile characters from a rack. Returns null if any are missing. */
export function removeTiles(rack: string, tiles: string[]): string | null {
  const arr = rack.split("");
  for (const t of tiles) {
    const i = arr.indexOf(t);
    if (i === -1) return null;
    arr.splice(i, 1);
  }
  return arr.join("");
}

export type Placement = {
  /** Board cell 0..224 */
  index: number;
  /** Letter shown on the board, "A"-"Z" */
  letter: string;
  /** True if a blank tile is being played as `letter` */
  blank: boolean;
};

/** The rack characters a set of placements uses up. */
export function tilesUsed(placements: Placement[]): string[] {
  return placements.map((p) => (p.blank ? BLANK : p.letter));
}

export type ScoredWord = { word: string; score: number };

export type MoveResult = {
  board: string;
  words: ScoredWord[];
  score: number;
  bingo: boolean;
};

export class RuleError extends Error {}

const H = 1; // step for horizontal
const V = SIZE; // step for vertical

function rowOf(i: number) {
  return Math.floor(i / SIZE);
}
function colOf(i: number) {
  return i % SIZE;
}

/** Step from cell i by `step`, or -1 if that leaves the board. */
function stepFrom(i: number, step: number, dir: 1 | -1): number {
  const j = i + step * dir;
  if (j < 0 || j >= CELLS) return -1;
  if (step === H && rowOf(j) !== rowOf(i)) return -1;
  return j;
}

/** All cells of the word running through cell i in the given direction. */
function wordCells(board: string[], i: number, step: number): number[] {
  let start = i;
  for (let j = stepFrom(start, step, -1); j !== -1 && board[j] !== EMPTY; j = stepFrom(j, step, -1)) {
    start = j;
  }
  const cells: number[] = [];
  for (let j = start; j !== -1 && board[j] !== EMPTY; j = stepFrom(j, step, 1)) cells.push(j);
  return cells;
}

/**
 * Validate tile placement and score the move.
 * Does NOT check the dictionary or the player's rack; the server does those separately.
 * Throws RuleError with a player-friendly message if the placement is illegal.
 */
export function evaluateMove(boardStr: string, placements: Placement[]): MoveResult {
  if (boardStr.length !== CELLS) throw new RuleError("Corrupt board.");
  if (placements.length === 0) throw new RuleError("Place at least one tile.");
  if (placements.length > RACK_SIZE) throw new RuleError("Too many tiles.");

  const board = boardStr.split("");
  const isFirstMove = !/[A-Za-z]/.test(boardStr);
  const placed = new Set<number>();

  for (const p of placements) {
    if (!Number.isInteger(p.index) || p.index < 0 || p.index >= CELLS) throw new RuleError("Tile is off the board.");
    if (typeof p.letter !== "string" || !/^[A-Z]$/.test(p.letter)) throw new RuleError("Invalid letter.");
    if (placed.has(p.index)) throw new RuleError("Two tiles on one square.");
    if (board[p.index] !== EMPTY) throw new RuleError("That square is already taken.");
    placed.add(p.index);
  }

  const indices = placements.map((p) => p.index).sort((a, b) => a - b);
  const sameRow = indices.every((i) => rowOf(i) === rowOf(indices[0]));
  const sameCol = indices.every((i) => colOf(i) === colOf(indices[0]));
  if (!sameRow && !sameCol) throw new RuleError("Tiles must be in a single row or column.");

  for (const p of placements) board[p.index] = p.blank ? p.letter.toLowerCase() : p.letter;

  // No gaps between the first and last new tile (existing tiles may fill gaps).
  const step = indices.length === 1 ? H : sameRow ? H : V;
  for (let i = indices[0]; i <= indices[indices.length - 1]; i += step) {
    if (board[i] === EMPTY) throw new RuleError("Tiles must form one connected word with no gaps.");
  }

  if (isFirstMove) {
    if (!placed.has(CENTER)) throw new RuleError("The first word must cover the center star.");
    if (placements.length < 2) throw new RuleError("The first word needs at least 2 letters.");
  } else {
    const touches = indices.some((i) =>
      [stepFrom(i, H, -1), stepFrom(i, H, 1), stepFrom(i, V, -1), stepFrom(i, V, 1)].some(
        (j) => j !== -1 && boardStr[j] !== EMPTY,
      ),
    );
    if (!touches) throw new RuleError("Your word must connect to tiles already on the board.");
  }

  // Collect every word formed (length >= 2).
  const wordList: number[][] = [];
  if (indices.length === 1) {
    for (const s of [H, V]) {
      const cells = wordCells(board, indices[0], s);
      if (cells.length >= 2) wordList.push(cells);
    }
  } else {
    const cross = step === H ? V : H;
    wordList.push(wordCells(board, indices[0], step));
    for (const i of indices) {
      const cells = wordCells(board, i, cross);
      if (cells.length >= 2) wordList.push(cells);
    }
  }
  if (wordList.length === 0) throw new RuleError("A word needs at least 2 letters.");

  const words: ScoredWord[] = wordList.map((cells) => {
    let sum = 0;
    let mult = 1;
    for (const c of cells) {
      let v = tileValue(board[c]);
      if (placed.has(c)) {
        const prem = PREMIUMS[c];
        if (prem === "DL") v *= 2;
        else if (prem === "TL") v *= 3;
        else if (prem === "DW" || prem === "START") mult *= 2;
        else if (prem === "TW") mult *= 3;
      }
      sum += v;
    }
    return { word: cells.map((c) => board[c].toUpperCase()).join(""), score: sum * mult };
  });

  const bingo = placements.length === RACK_SIZE;
  const score = words.reduce((s, w) => s + w.score, 0) + (bingo ? BINGO_BONUS : 0);
  return { board: board.join(""), words, score, bingo };
}
