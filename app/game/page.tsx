"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { errorText } from "../errors";
import { rememberGame, useIdentity } from "../identity";
import { Board } from "./Board";

export default function GamePage() {
  return (
    <Suspense fallback={<main className="page"><p className="muted">Loading…</p></main>}>
      <GameScreen />
    </Suspense>
  );
}

function GameScreen() {
  const id = useSearchParams().get("id") ?? "";
  const { token, name, setName } = useIdentity();
  // Two live subscriptions. Convex pushes updates when data changes, so there's no polling.
  const game = useQuery(api.games.getGame, id ? { gameId: id } : "skip");
  const mine = useQuery(api.games.getMyRack, id && token ? { gameId: id, token } : "skip");

  const opponentName =
    game && mine ? game.players.find((p) => p.seat !== mine.seat)?.name : undefined;
  useEffect(() => {
    if (game && mine) rememberGame(id, opponentName);
  }, [id, !!game, !!mine, opponentName]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!id || game === null) {
    return (
      <main className="page narrow">
        <div className="card">
          <h1>Game not found</h1>
          <p className="muted">The link may be wrong, or the invite expired.</p>
          <Link className="button primary" href="/">Start a new game</Link>
        </div>
      </main>
    );
  }
  if (game === undefined || !token || (mine === undefined && !!token)) {
    return <main className="page"><p className="muted">Loading game…</p></main>;
  }

  if (game.status === "waiting") {
    if (mine?.seat === 0) return <InvitePanel gameId={id} token={token} host={game.players[0]?.name ?? ""} />;
    return (
      <JoinForm
        gameId={id}
        token={token}
        name={name}
        setName={setName}
        host={game.players[0]?.name ?? "Someone"}
      />
    );
  }

  return <Board game={game} mine={mine ?? null} token={token} />;
}

function InvitePanel({ gameId, token, host }: { gameId: string; token: string; host: string }) {
  const cancel = useMutation(api.games.resign);
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState("");
  useEffect(() => setLink(`${window.location.origin}/game?id=${gameId}`), [gameId]);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the link is still selectable */
    }
  }

  return (
    <main className="page narrow">
      <div className="card">
        <h1>Invite a friend</h1>
        <p className="muted">
          Send this link to the other player. The game starts as soon as they open it and join.
          This page updates on its own.
        </p>
        <div className="invite">
          <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
          <button className="primary" onClick={copy}>{copied ? "Copied!" : "Copy link"}</button>
        </div>
        {canShare && (
          <button
            className="secondary"
            onClick={() =>
              navigator.share({ title: "Word Duel", text: `${host} challenged you to Word Duel!`, url: link }).catch(() => {})
            }
          >
            Share…
          </button>
        )}
        <p className="waiting"><span className="dot" /> Waiting for your opponent to join…</p>
        <button className="link" onClick={() => cancel({ gameId, token }).catch(() => {})}>
          Cancel this game
        </button>
      </div>
    </main>
  );
}

function JoinForm(props: {
  gameId: string;
  token: string;
  name: string;
  setName: (n: string) => void;
  host: string;
}) {
  const join = useMutation(api.games.joinGame);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await join({ gameId: props.gameId, token: props.token, name: props.name });
      // No navigation needed: the live query flips this page to the board.
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <form className="card" onSubmit={submit}>
        <h1>{props.host} challenged you!</h1>
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          value={props.name}
          maxLength={20}
          onChange={(e) => props.setName(e.target.value)}
          required
        />
        <button className="primary" disabled={busy || !props.name.trim()}>
          {busy ? "Joining…" : "Join game"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
