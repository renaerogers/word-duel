"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import {
  BLANK, CELLS, CENTER, EMPTY, PREMIUMS, RuleError, SIZE, evaluateMove, tileValue,
  type Placement, type Premium,
} from "@/convex/lib/rules";
import { errorText } from "../errors";

type Game = NonNullable<FunctionReturnType<typeof api.games.getGame>>;
type Mine = { seat: number; rack: string } | null;
type Pending = Placement & { rackIdx: number };

const PREMIUM_LABEL: Record<Premium, string> = { "": "", DL: "2L", TL: "3L", DW: "2W", TW: "3W", START: "★" };
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function Board({ game, mine, token }: { game: Game; mine: Mine; token: string }) {
  const playWord = useMutation(api.games.playWord);
  const swapTiles = useMutation(api.games.swapTiles);
  const passTurn = useMutation(api.games.passTurn);
  const resign = useMutation(api.games.resign);

  const rack = mine?.rack ?? "";
  const myTurn = game.status === "active" && mine !== null && game.turn === mine.seat;

  // ---- local-only UI state (no server calls until a move is submitted) ----
  const [order, setOrder] = useState<number[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [blankFor, setBlankFor] = useState<{ rackIdx: number; index: number } | null>(null);
  const [swapMode, setSwapMode] = useState(false);
  const [swapSel, setSwapSel] = useState<number[]>([]);
  const [confirmResign, setConfirmResign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // Reset local state whenever the rack or turn changes on the server.
  useEffect(() => {
    setOrder(rack.split("").map((_, i) => i));
    setPending([]);
    setSelected(null);
    setSwapMode(false);
    setSwapSel([]);
    setBlankFor(null);
  }, [rack, game.turnNumber]);

  const pendingAt = useMemo(() => new Map(pending.map((p) => [p.index, p])), [pending]);
  const usedRack = new Set(pending.map((p) => p.rackIdx));
  const rackShown = order.filter((i) => !usedRack.has(i) && i < rack.length);

  // Free, instant preview using the same rules code the server runs.
  const preview = useMemo(() => {
    if (!pending.length) return null;
    try {
      const r = evaluateMove(game.board, pending);
      return { ok: true as const, text: `${r.words.map((w) => w.word).join(", ")} for ${r.score} pts${r.bingo ? " (bingo!)" : ""}` };
    } catch (e) {
      return { ok: false as const, text: e instanceof RuleError ? e.message : "Invalid placement" };
    }
  }, [game.board, pending]);

  const targets = useMemo(
    () => (myTurn && selected !== null ? suggestTargets(game.board, pending) : new Set<number>()),
    [myTurn, selected, game.board, pending],
  );

  const lastTiles = new Set(game.lastTiles);
  // Players see themselves first; spectators see both players in seat order.
  const shown = mine ? [...game.players].sort((a) => (a.seat === mine.seat ? -1 : 1)) : game.players;
  const opp = mine ? game.players.find((p) => p.seat !== mine.seat) : undefined;

  // ---- interactions ----
  function clickRack(rackIdx: number) {
    if (busy) return;
    setMessage("");
    if (swapMode) {
      setSwapSel((s) => (s.includes(rackIdx) ? s.filter((x) => x !== rackIdx) : [...s, rackIdx]));
      return;
    }
    setSelected((s) => (s === rackIdx ? null : rackIdx));
  }

  function clickCell(index: number) {
    if (!myTurn || swapMode || busy) return;
    setMessage("");
    const p = pendingAt.get(index);
    if (p) {
      setPending((list) => list.filter((x) => x.index !== index)); // take it back
      return;
    }
    if (selected === null || game.board[index] !== EMPTY) return;
    if (rack[selected] === BLANK) {
      setBlankFor({ rackIdx: selected, index });
      return;
    }
    place({ rackIdx: selected, index, letter: rack[selected], blank: false });
  }

  function place(p: Pending) {
    setPending((list) => [...list, p]);
    setBlankFor(null);
    // Auto-select the next tile so placing a word is quick.
    const next = order.find((i) => i !== p.rackIdx && !usedRack.has(i) && i < rack.length);
    setSelected(next ?? null);
  }

  async function run(action: () => Promise<unknown>, success = "") {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const submit = () =>
    run(() =>
      playWord({
        gameId: game._id,
        token,
        placements: pending.map(({ index, letter, blank }) => ({ index, letter, blank })),
      }),
    );

  const doSwap = () =>
    run(async () => {
      await swapTiles({ gameId: game._id, token, tiles: swapSel.map((i) => rack[i]) });
      setSwapMode(false);
    });

  function shuffleRack() {
    setOrder((o) => {
      const a = [...o];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    });
  }

  // ---- render ----
  return (
    <main className="page game">
      <header className="topbar">
        <Link href="/" className="brand">Word Duel</Link>
        <span className="muted small">{game.bagCount} tiles in bag</span>
      </header>

      <section className="scores">
        {shown.map((p) => (
          <div key={p.seat} className={`score ${game.status === "active" && game.turn === p.seat ? "turn" : ""}`}>
            <span className="pname">{p.name}{p.seat === mine?.seat ? " (you)" : ""}</span>
            <span className="pts">{p.score}</span>
          </div>
        ))}
      </section>

      {game.status === "finished" ? (
        <div className="banner done">
          <strong>
            {game.winner === undefined
              ? "It's a tie!"
              : game.winner === mine?.seat
                ? "You win!"
                : `${game.players.find((p) => p.seat === game.winner)?.name} wins!`}
          </strong>{" "}
          <span>{game.endReason}</span> <Link href="/">New game</Link>
        </div>
      ) : mine === null ? (
        <div className="banner">You&apos;re watching this game.</div>
      ) : myTurn ? (
        <div className="banner yours">Your turn</div>
      ) : (
        <div className="banner">Waiting for {opp?.name}… you can close this page and come back later.</div>
      )}

      <div className="board" role="grid" aria-label="Game board">
        {Array.from({ length: CELLS }, (_, i) => {
          const ch = game.board[i];
          const p = pendingAt.get(i);
          const prem = PREMIUMS[i];
          const cls = [
            "cell",
            prem && `p-${prem}`,
            targets.has(i) && "target",
          ].filter(Boolean).join(" ");
          return (
            <button key={i} className={cls} onClick={() => clickCell(i)} aria-label={cellLabel(i, ch, p)}>
              {p ? (
                <Tile letter={p.letter} blank={p.blank} className="pending" />
              ) : ch !== EMPTY ? (
                <Tile letter={ch.toUpperCase()} blank={ch !== ch.toUpperCase()} className={lastTiles.has(i) ? "recent" : ""} />
              ) : (
                <span className="prem">{PREMIUM_LABEL[prem]}</span>
              )}
            </button>
          );
        })}
      </div>

      {mine && game.status === "active" && (
        <>
          <div className={`preview ${preview && !preview.ok ? "bad" : ""}`} aria-live="polite">
            {message ||
              (swapMode
                ? "Pick the tiles to swap, then press Swap."
                : preview?.text ??
                  (myTurn
                    ? selected === null
                      ? "Select a tile from your rack."
                      : "Now click a highlighted square."
                    : ""))}
          </div>

          <div className="rack" aria-label="Your tiles">
            {rackShown.map((i) => (
              <button
                key={i}
                className={`rack-slot ${selected === i && !swapMode ? "selected" : ""} ${swapSel.includes(i) ? "swap" : ""}`}
                onClick={() => clickRack(i)}
                aria-pressed={selected === i}
              >
                <Tile letter={rack[i] === BLANK ? "" : rack[i]} blank={rack[i] === BLANK} />
              </button>
            ))}
          </div>

          <div className="controls">
            {swapMode ? (
              <>
                <button className="primary" disabled={busy || !swapSel.length} onClick={doSwap}>
                  Swap {swapSel.length || ""}
                </button>
                <button onClick={() => { setSwapMode(false); setSwapSel([]); }}>Cancel</button>
              </>
            ) : (
              <>
                <button
                  className="primary"
                  disabled={!myTurn || busy || !pending.length || (preview !== null && !preview.ok)}
                  onClick={submit}
                >
                  {busy ? "Checking…" : "Play"}
                </button>
                <button disabled={busy || !pending.length} onClick={() => setPending([])}>Recall</button>
                <button onClick={shuffleRack}>Shuffle</button>
                <button
                  disabled={!myTurn || busy || game.bagCount < 7}
                  onClick={() => { setPending([]); setSelected(null); setSwapMode(true); }}
                >
                  Swap
                </button>
                <button disabled={!myTurn || busy} onClick={() => run(() => passTurn({ gameId: game._id, token }))}>
                  Pass
                </button>
                <button
                  className={confirmResign ? "danger" : ""}
                  disabled={busy}
                  onClick={() => {
                    if (!confirmResign) {
                      setConfirmResign(true);
                      setTimeout(() => setConfirmResign(false), 3000);
                    } else run(() => resign({ gameId: game._id, token }));
                  }}
                >
                  {confirmResign ? "Really resign?" : "Resign"}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {game.recentMoves.length > 0 && (
        <section className="history">
          <h2>Recent moves</h2>
          <ol>
            {game.recentMoves.map((m) => (
              <li key={m._id}>
                <strong>{game.players.find((p) => p.seat === m.seat)?.name}</strong>{" "}
                {m.kind === "play"
                  ? `played ${m.words.map((w) => w.word).join(", ")} for ${m.score}`
                  : m.kind === "swap"
                    ? "swapped tiles"
                    : m.kind === "pass"
                      ? "passed"
                      : m.kind === "resign"
                        ? "resigned"
                        : "timed out"}
              </li>
            ))}
          </ol>
        </section>
      )}

      {blankFor && (
        <div className="modal" role="dialog" aria-label="Choose a letter for the blank tile">
          <div className="card">
            <h2>Blank tile: choose a letter</h2>
            <div className="letters">
              {LETTERS.map((l) => (
                <button key={l} onClick={() => place({ ...blankFor, letter: l, blank: true })}>{l}</button>
              ))}
            </div>
            <button onClick={() => setBlankFor(null)}>Cancel</button>
          </div>
        </div>
      )}
    </main>
  );
}

function Tile({ letter, blank, className = "" }: { letter: string; blank: boolean; className?: string }) {
  return (
    <span className={`tile ${blank ? "blank" : ""} ${className}`}>
      {letter}
      {!blank && letter && <sub>{tileValue(letter)}</sub>}
    </span>
  );
}

function cellLabel(i: number, ch: string, p?: Pending) {
  const pos = `Row ${Math.floor(i / SIZE) + 1}, column ${(i % SIZE) + 1}`;
  if (p) return `${pos}: ${p.letter}, not yet played`;
  if (ch !== EMPTY) return `${pos}: ${ch.toUpperCase()}`;
  return `${pos}: empty${PREMIUMS[i] ? ` ${PREMIUM_LABEL[PREMIUMS[i]]}` : ""}`;
}

/** Squares worth highlighting for the selected tile, based on what's already placed. */
function suggestTargets(board: string, pending: Pending[]): Set<number> {
  const filled = (i: number) => board[i] !== EMPTY || pending.some((p) => p.index === i);
  const out = new Set<number>();
  const inBoard = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

  if (pending.length === 0) {
    if (!/[A-Za-z]/.test(board)) return new Set([CENTER]);
    for (let i = 0; i < CELLS; i++) {
      if (board[i] !== EMPTY) continue;
      const r = Math.floor(i / SIZE), c = i % SIZE;
      const near = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(
        ([rr, cc]) => inBoard(rr, cc) && board[rr * SIZE + cc] !== EMPTY,
      );
      if (near) out.add(i);
    }
    return out;
  }

  const rows = new Set(pending.map((p) => Math.floor(p.index / SIZE)));
  const cols = new Set(pending.map((p) => p.index % SIZE));
  const dirs: [number, number][] = [];
  if (rows.size === 1) dirs.push([0, 1]);
  if (cols.size === 1) dirs.push([1, 0]);

  for (const [dr, dc] of dirs) {
    const cells = pending.map((p) => [Math.floor(p.index / SIZE), p.index % SIZE]);
    const key = (rc: number[]) => (dr ? rc[0] : rc[1]);
    const fixed = dr ? cells[0][1] : cells[0][0];
    const lo = Math.min(...cells.map(key));
    const hi = Math.max(...cells.map(key));
    const idx = (k: number) => (dr ? k * SIZE + fixed : fixed * SIZE + k);
    for (let k = lo; k <= hi; k++) if (!filled(idx(k))) out.add(idx(k)); // fill gaps
    let k = lo - 1;
    while (k >= 0 && filled(idx(k))) k--;
    if (k >= 0) out.add(idx(k));
    k = hi + 1;
    while (k < SIZE && filled(idx(k))) k++;
    if (k < SIZE) out.add(idx(k));
  }
  return out;
}
