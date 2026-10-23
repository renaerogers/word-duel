// Builds dictionary/words.jsonl from the public-domain ENABLE word list.
// Usage: npm run dictionary   (only needed if you want to rebuild the file)
// Then load it into Convex:   npm run dictionary:import   (dev)
//                             npm run dictionary:import:prod   (production)
import { writeFileSync, mkdirSync } from "node:fs";

const SOURCE = "https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt";

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`Download failed: ${res.status}`);
const text = await res.text();

const words = [
  ...new Set(
    text
      .split(/\r?\n/)
      .map((w) => w.trim().toUpperCase())
      .filter((w) => /^[A-Z]{2,15}$/.test(w)),
  ),
].sort();

mkdirSync("dictionary", { recursive: true });
writeFileSync("dictionary/words.jsonl", words.map((w) => JSON.stringify({ w })).join("\n") + "\n");
console.log(`Wrote ${words.length} words to dictionary/words.jsonl`);
