"use client";

import { useEffect, useState } from "react";

/**
 * No accounts: each browser gets a random secret token that identifies it as a player.
 * The server never sends tokens back, so nobody can impersonate another player.
 * (Swap in Clerk / Convex Auth later if you want logins across devices.)
 */
const TOKEN_KEY = "wordduel.token";
const NAME_KEY = "wordduel.name";
const GAMES_KEY = "wordduel.games";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: fine for this session */
  }
}

let memoryToken: string | null = null;

export function useIdentity() {
  const [token, setToken] = useState<string | null>(null);
  const [name, setNameState] = useState("");

  useEffect(() => {
    let t = read(TOKEN_KEY) ?? memoryToken;
    if (!t) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      t = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      write(TOKEN_KEY, t);
    }
    memoryToken = t;
    setToken(t);
    setNameState(read(NAME_KEY) ?? "");
  }, []);

  const setName = (n: string) => {
    setNameState(n);
    write(NAME_KEY, n);
  };

  return { token, name, setName };
}

export type RecentGame = { id: string; opponent?: string; at: number };

export function recentGames(): RecentGame[] {
  try {
    return JSON.parse(read(GAMES_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function rememberGame(id: string, opponent?: string) {
  const list = recentGames().filter((g) => g.id !== id);
  const prev = recentGames().find((g) => g.id === id);
  list.unshift({ id, opponent: opponent ?? prev?.opponent, at: Date.now() });
  write(GAMES_KEY, JSON.stringify(list.slice(0, 10)));
}
