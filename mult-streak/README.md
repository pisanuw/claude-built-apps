# mult-streak

A tiny multiplication-streak game. You get a problem (two factors, each 2-3
digits, i.e. 10-999). Type the product. Right answers grow your streak; a wrong
answer resets it to zero. Reach **10 in a row** and you win a crown and are
**locked out for 24 hours**.

- **Live site:** served by the shared [`backend-hub`](../backend-hub) Render service
  at its `/mult-streak/` mount (the standalone `mult-streak.onrender.com` service
  is superseded).
- **Source:** https://github.com/pisanuw/Claude-capstone/tree/main/mult-streak
- **Host:** Render (persistent Node web service). A Netlify variant lives in
  [`../mult-streak-edge`](../mult-streak-edge).

## How it works

- **Identity is the browser, no login.** Each browser gets an anonymous id in a
  cookie. Streak and the 24h lockout are keyed to that cookie.
- **Game state lives in a signed cookie.** Streak, lockout, and the current
  problem are stored in the cookie, HMAC-signed with `COOKIE_SECRET` so a player
  cannot forge a streak or clear a lockout by editing it. (Clearing cookies
  starts a fresh anonymous player; that is inherent to cookie identity.)
- **"Player stopped" email.** The one piece of server-side state is a small JSON
  file tracking each player's last activity. When a player has been idle past a
  threshold (`IDLE_MINUTES`, default 5 here), the server emails `ADMIN_EMAIL`
  from `mult-streak@hintwise.org` via Resend. The email fires from a 60-second
  background sweep and also opportunistically whenever any request comes in, so
  you get a note shortly after someone stops (or when the next person plays).
  The email reports the anonymous id prefix and the streak they stopped at.

## Run locally

Node 20+.

```bash
cd mult-streak
npm install
npm run dev      # http://localhost:3000
```

The app runs fully without any configuration; email is simply disabled until
`RESEND_API` and `ADMIN_EMAIL` are set. See [`.env.example`](./.env.example).

```bash
npm test         # 42 tests
npm run coverage # ~94% statements
npm run build && npm start   # production build + run
```

## Configuration

All via environment variables (see [`.env.example`](./.env.example)). Notable
ones: `COOKIE_SECRET` (sign the state cookie; set a long random value in prod),
`IDLE_MINUTES` (idle threshold), `RESEND_API` + `ADMIN_EMAIL` (enable email),
`FROM_EMAIL` (defaults to `mult-streak@hintwise.org`, domain verified in Resend).

## Deploy

Deployed through the repo's config-driven pipeline as part of
[`backend-hub`](../backend-hub): the hub consumes this package as a
`file:../mult-streak` dependency and its `deploy/target.yml` deploys the
combined Render service. Secrets (`RENDER_API_KEY`, `RESEND_API`,
`ADMIN_EMAIL`, `COOKIE_SECRET`) are GitHub repo secrets injected at run time;
none live in the repo.

## Note on the file store

The activity file persists only while Render keeps the instance warm; a redeploy
or free-tier spin-down resets it. `IDLE_MINUTES` is set to 5 so the email fires
within the warm window. This is the documented trade of choosing a file store
over a database. The game and lockout are unaffected (their state is in the
cookie).
