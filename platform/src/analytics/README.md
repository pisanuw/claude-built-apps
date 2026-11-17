# First-party analytics (app-events)

| File | What |
|---|---|
| `hw-events.js` | the browser script apps copy unchanged (`<script defer src="/hw-events.js" data-app="<slug>">`) |
| `events.ts` | what a browser may send: names, pathname-only paths, referrer hosts, values, props; bot and device detection |
| `service.ts` | the `app-events` function: validate, drop bots, call `platform.app_events_record` (shared/0014) |

Deploy: `apply-shared` (0014), then `deploy-function app-events`. Read: `ops/app-events-report.sql`.
See docs/platform.md, "First-party analytics (app-events)".
