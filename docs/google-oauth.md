# Google sign-in: moving every app to the HintWise Google Cloud project

Compiled 8 Nov 2026 from:
- GitHub code search across pisanuw, pisanorg and pisan-labs (`GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_ID`, callback routes);
- the Netlify site list and Render service list (the List hosts workflow).

The new client's ID and secret are in the owner's local `.env` as `HINTWISE_AUTH_GOOGLE_ID` and `HINTWISE_AUTH_GOOGLE_SECRET`.

## Two kinds of sign-in
- **Server redirect (OAuth code flow):** the server sends the user to Google, and Google comes back to a callback URL. Needs **Authorized redirect URIs**.
- **"Sign in with Google" button (Google Identity Services, in the browser):** no callback URL. Needs **Authorized JavaScript origins**.

Keep each old URI or origin until that app has moved and its old address redirects. Adding extras does no harm.

## Authorized redirect URIs

| App | Repo | Host | Redirect URIs |
|---|---|---|---|
| Chess TD (API) | pisan-labs/chess-tournament-director | Render chess-td-server | `https://td.hintwise.org/api/auth/google/callback`, `https://td.pisan.me/api/auth/google/callback` |
| MeetMe | pisanuw/meetme | Netlify meetme-2 | `https://meetme.hintwise.org/api/auth/google/callback`, `https://meetme.hintwise.org/api/auth/google/calendar-callback`, `https://meetme.pisan.me/api/auth/google/callback`, `https://meetme.pisan.me/api/auth/google/calendar-callback` |
| Digital Student Assistant | pisanuw/dsa-instructor | Render dsa-instructor | `https://digital-student-assistant.com/auth/google/callback`, `https://ypdsa.pisan.me/auth/google/callback`, `https://dsa-instructor-zpmc.onrender.com/auth/google/callback` (www has no callback, by design) |
| Chess analyzer (MyChessMaster) | pisanuw/chess-analyzer | Netlify chess-analyzer-app | `https://mychessmaster.net/api/auth/google/callback` (the netlify.app host 301s before the callback runs) |
| PasteMD | pisanuw/pastemd | Netlify paste-md | `https://paste-md.hintwise.org/api/auth/google/callback`, `https://paste-md.netlify.app/api/auth/google/callback` (the app sends the address in its plain `APP_URL` variable, hintwise.org since 9 Nov; since 9 Nov 19:47 CET PasteMD signs in through Supabase (pisanuw/pastemd#2; owner confirmed sign-in works 10 Nov), so both URIs can be removed from the client) |
| Upvote | pisanuw/upvote | Netlify upvoteme | `https://upvoteme.hintwise.org/api/auth/callback/google`, `https://upvoteme.netlify.app/api/auth/callback/google` (Auth.js; since 10 Nov 2026 UpvoteMe signs in to Google through Supabase (pisanuw/upvote#4, provider `supabase`), and the owner confirmed it works the same day, so both URIs can be removed; they are needed again only for the `NEXT_PUBLIC_GOOGLE_AUTH_VIA=direct` rollback) |

## Authorized JavaScript origins

| App | Repo | Host | Origins |
|---|---|---|---|
| Digital Yusuf (ypai) | pisanuw/digitalme | Netlify chatwithdigitalme (frontend), Render chatwithdigitalme (API) | `https://ypai.hintwise.org`, `https://ypai.pisan.me`, `https://chatwithdigitalme.netlify.app` |
| MyUni | pisanuw/myuni | Netlify myuniforever | `https://myuni.top` (add `https://www.myuni.top` if www is used) |
| NotStockfish / StockReptile | pisanuw/notstockfish | Netlify stockreptile (frontend), Render notreptile-backend | `https://stockreptile.netlify.app` |
| Chess TD (optional) | | | `https://chesstd.hintwise.org`, `https://td.hintwise.org` (its sign-in runs on the server, so these aren't needed) |

## OAuth consent screen
- **App name:** HintWise.
- **Support email:** builder@hintwise.org.
- **Authorized domains:**
  - hintwise.org
  - pisan.me (until the old addresses retire)
  - digital-student-assistant.com
  - mychessmaster.net
  - myuni.top
- **netlify.app and onrender.com hosts:** I am not sure Google accepts them as authorized domains. They are public-suffix hosts, so each `<site>.netlify.app` counts as its own domain and may need verifying.
- **MeetMe's calendar access:** MeetMe asks for Google Calendar access, a sensitive scope. A new project in Testing mode allows only listed test users, and their sign-ins expire after 7 days. In Production it needs Google's verification for that scope. The sign-in-only apps use non-sensitive scopes (openid, email, profile).

## Found but not deployed (nothing to register)
- **llm-tutor:** no Netlify site or Render service.
- **virtualme:** no host found.
- **notes.virtualme:** no host found.
- **claude-built-apps `.env.example`:** its Google entries are unused templates.
- **agent-blast-radius:** only mentions accounts.google.com in its analysis rules.

## After the console: point each app at the new client
Each app reads its own variable names, mostly `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, from its host's environment:

| Host | Where to set it |
|---|---|
| Render | chess-td-server, dsa-instructor, chatwithdigitalme, notreptile-backend: dashboard, Environment, then redeploy |
| Netlify | meetme-2, chess-analyzer-app, paste-md, upvoteme, myuniforever, chatwithdigitalme, stockreptile: Site configuration, Environment variables, then redeploy |

- Browser-side IDs (Vite `VITE_GOOGLE_CLIENT_ID` and similar) are baked in at build time, so those sites need a rebuild.
- If the owner adds `HINTWISE_AUTH_GOOGLE_ID` and `HINTWISE_AUTH_GOOGLE_SECRET` as GitHub secrets here, a workflow could set these through the Netlify and Render APIs. The redeploys would still cost Netlify credits.
