"use client";

import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { recentGames, rememberGame, useIdentity, type RecentGame } from "./identity";

export default function Home() {
  const router = useRouter();
  const { token, name, setName } = useIdentity();
  const createGame = useMutation(api.games.createGame);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<RecentGame[]>([]);

  useEffect(() => setRecent(recentGames()), []);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const id = await createGame({ token, name });
      rememberGame(id);
      router.push(`/game?id=${id}`);
    } catch (err) {
      setError(err instanceof ConvexError ? String(err.data) : "Could not create a game. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <header className="hero">
        <div className="logo" aria-hidden>
          {"WORD".split("").map((l, i) => (
            <span key={i} className="tile small">{l}</span>
          ))}
        </div>
        <h1>Word Duel</h1>
        <p className="muted">
          Build words on a shared board, take turns at your own pace, and send a link to challenge a friend.
        </p>
      </header>

      <form className="card" onSubmit={start}>
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          value={name}
          maxLength={20}
          placeholder="e.g. Renae"
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="primary" disabled={busy || !token || !name.trim()}>
          {busy ? "Creating…" : "Start a new game"}
        </button>
        <p className="muted small">You&apos;ll get an invite link to send to the other player.</p>
        {error && <p className="error">{error}</p>}
      </form>

      {recent.length > 0 && (
        <section className="card">
          <h2>Your games</h2>
          <ul className="recent">
            {recent.map((g) => (
              <li key={g.id}>
                <Link href={`/game?id=${g.id}`}>
                  {g.opponent ? `vs ${g.opponent}` : "Game"} · {new Date(g.at).toLocaleDateString()}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card rules">
        <h2>How to play</h2>
        <ul>
          <li>Click a tile in your rack, then click a square to place it. Click a placed tile to take it back.</li>
          <li>All new tiles go in one row or column and must connect to tiles on the board.</li>
          <li>The first word covers the center star. Using all 7 tiles earns a 50-point bonus.</li>
          <li>Colored squares multiply letters (2L, 3L) or whole words (2W, 3W).</li>
          <li>The game ends when the bag is empty and someone uses all their tiles.</li>
        </ul>
      </section>
    </main>
  );
}
