# First-party analytics (app-events)

| File | What |
|---|---|
| `hw-events.js` | the browser script apps copy unchanged (`<script defer src="/hw-events.js" data-app="<slug>">`) |
| `events.ts` | what a browser may send: names, pathname-only paths, referrer hosts, values, props; bot and device detection |
| `service.ts` | the `app-events` function: validate, drop bots, call `platform.app_events_record` (shared/0014) |
| `report.ts` | the `app-events-report` function: totals for pisan-analytics from `platform.app_events_summary` (shared/0015), behind the shared secret `APP_EVENTS_REPORT_SECRET` |

Every app in this repo gets the script at deploy time from `scripts/site-analytics.mjs` (opt out with `analytics: false` in `target.yml`), and the runner registers its origin with `supabase-admin.mjs analytics-register`. Apps in their own repositories copy `hw-events.js` unchanged.

Deploy: `apply-shared` (0014, 0015), `deploy-function app-events` and `deploy-function app-events-report`, then `report-secret on` and a deploy of pisan-analytics (Actions, "Deploy dashboards", `.github/workflows/deploy-dashboards.yml`). Read: `ops/app-events-report.sql`.
See docs/platform.md, "First-party analytics (app-events)".
