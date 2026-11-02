# mult-streak-edge

The Netlify deployment of [mult-streak](../mult-streak): the same
multiplication-streak game (two 2-3 digit factors, type the product, 10 correct
in a row wins a 24-hour crown), packaged for Netlify's serverless platform.

- **Live site:** https://mult-streak.pisan.me  *(Netlify, live)*
- **Source:** https://github.com/pisanuw/Claude-capstone/tree/main/mult-streak-edge
- **Host:** Netlify (static page on the CDN + the API as a serverless function).

## What is the same, and what differs from the Render version

The game logic is identical and shared verbatim: factors 10-999, streak grows on
correct answers and resets to 0 on a wrong one, 10 in a row wins and locks the
player out for 24 hours. Players are anonymous, identified by a signed cookie,
and **all game state (streak, lockout) lives in that cookie**, so the game and
the lockout work exactly as on Render.

The one real difference is the **"player stopped" email**. That feature needs
the server to remember each player's last activity, which means persistent
server-side storage. Netlify Functions have no shared disk between invocations,
so the file-based store cannot reliably retain that data here. As a result:

- The game and 24h lockout: **fully working** on Netlify.
- The idle-notification email: **not dependable** on Netlify. For the email,
  use the Render deployment ([`../mult-streak`](../mult-streak)), which has a
  warm instance and a background sweep.

This split is a direct consequence of choosing a file store over a database;
both deployments are otherwise the same code.

## Architecture on Netlify

- `npm run build` compiles the server and copies the static game page to
  `dist/public`, which Netlify serves from its CDN.
- `netlify/functions/api.mjs` wraps the same Express app with `serverless-http`;
  [`netlify.toml`](./netlify.toml) routes `/api/*` to it and serves the SPA
  otherwise.

## Run locally

It runs as a normal Node server locally (the Netlify wrapper is only used in
production):

```bash
cd mult-streak-edge
npm install
npm run dev      # http://localhost:3000
npm test         # 42 tests
```

## Deploy

Config-driven, like the rest of the repo: editing
[`deploy/target.yml`](./deploy/target.yml) and pushing triggers a Netlify deploy
via GitHub Actions, using the `NETLIFY_AUTH_TOKEN` repo secret. The site name is
`mult-streak-edge-pisan` (Netlify subdomains are globally unique).
