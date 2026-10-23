# Word Duel

A two-player word game built on a shared 15×15 board. **Convex** stores the games and enforces every rule. **Vercel** hosts the static site.

- **Live updates:** when one player moves, the board, scores and turn update on the other player's screen within a moment, with no polling.
- **Server-enforced rules:** every move is checked in a Convex mutation: placement, connection, dictionary, rack and turn.
- **Hidden tiles:** the public game view never includes the tile bag, the opponent's rack, or player tokens.
- **Async play:** take turns over days. A turn left idle for 7 days forfeits. Unjoined lobbies are deleted after 3 days, and finished games after 14 days.
- **Invite link:** the creator copies or shares a link, and the second player opens it and joins.

## Run it locally

```bash
npm install
npx convex dev               # sign in, create a dev deployment, keep this running
npm run dictionary:import    # in a 2nd terminal: loads ~168k words into the `words` table
npm run dev                  # in a 3rd terminal: http://localhost:3000
```

To test two players, open the invite link in a second browser profile or a private window. Each browser counts as a separate player.

## Deploy to Vercel

1. Push this folder to a GitHub repo and import it in Vercel. The `vercel.json` file already sets the build command to
   `npx convex deploy --cmd 'npm run build'`, which deploys the Convex functions and then builds the site.
2. In the Convex dashboard, go to **Project Settings → Generate Production Deploy Key**. Add it in Vercel as the
   environment variable `CONVEX_DEPLOY_KEY`, scoped to Production.
3. Deploy. Then load the dictionary into production once:
   ```bash
   npm run dictionary:import:prod
   ```
4. **Optional preview deployments:** generate a Convex *Preview* deploy key and add it as `CONVEX_DEPLOY_KEY`, scoped to Vercel's Preview environment. Each pull request then gets its own backend. Preview backends start with an empty `words` table, so moves are rejected with a "dictionary hasn't been loaded" message until you import it.

## Project layout

| Path | What it does |
|---|---|
| `convex/lib/rules.ts` | Board layout, tile set, placement validation and scoring. It's pure TypeScript shared by the server and the browser. |
| `convex/games.ts` | Mutations (`createGame`, `joinGame`, `playWord`, `swapTiles`, `passTurn`, `resign`), queries (`getGame`, `getMyRack`) and scheduled jobs. |
| `convex/schema.ts` | Tables: `games`, `players`, `moves`, `words`. |
| `app/page.tsx` | Landing page: enter a name, start a game, see your recent games. |
| `app/game/page.tsx` | Invite panel, join form, and the game screen at `/game?id=…`. |
| `app/game/Board.tsx` | Board, rack, and click-to-place controls. |
| `app/identity.ts` | Per-browser player token (no accounts). |
| `tests/` | Rule tests and backend tests (`npm test`). |

## How the design keeps it efficient

- **No Vercel compute.** The site is a static export served from Vercel's CDN, with no server functions.
- **Two live subscriptions per player** (`getGame` and `getMyRack`). Convex pushes changes, so nothing polls.
- **No server calls while placing tiles.** Selecting and placing tiles is local. The score preview runs the same rules code in the browser, and the server is called only when you press Play, Swap, Pass or Resign.
- **Small documents.** The board is a 225-character string, and the rack and bag are short strings.
- **Cheap dictionary checks:** one indexed lookup per word formed, and only on Play.
- **Self-cleaning.** Each game has at most one pending scheduled job, which is replaced every turn. Old data is deleted automatically.

## Notes

- *Word Duel* uses its own name, board layout and colors. The word list is ENABLE, which is public domain.
  Rebuild it with `npm run dictionary`.
- Identity is per browser, so you can't continue a game on a different device. To add that, swap `app/identity.ts`
  for Clerk or Convex Auth, and check `ctx.auth` instead of a token.
- **Ideas to extend it:** turn-reminder emails (send them from the scheduled job using an email provider such as Resend), a full move history, and chat.
