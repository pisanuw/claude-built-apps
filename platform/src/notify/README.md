# App-notify

**Status: not applied, not deployed. It waits for the owner's yes.** Built
on branch `feat/app-notify` (13 Nov 2026) from the owner's approval of
10 and 11 Nov. Design summary: `docs/platform.md`, "App-notify".

Once a day, the `app-notify` Supabase Edge Function does this for each
registered app:

1. It reads the app's public releases feed.
2. It reads the app's opt-in rows.
3. It emails each opted-in person the feed items they have not been sent
   yet.

The email comes from `<App name> <<slug>@hintwise.org>` with Reply-To
`support@hintwise.org`, and has the usual HintWise header and footer. It is
transactional: it only covers what the person asked that app to tell them
about. It contains no promotion and no postal address.

| Module | What it does |
|---|---|
| `feed.ts` | `fetchFeed`: 10 s timeout, 256 KB cap, manual redirects (followed only on the app's own host, at most 3), no credentials. `parseFeed`: checks each item. `cleanText`: one-line text, no control, bidi or zero-width characters |
| `message.ts` | `notifyEmail`: the email, through `src/signin/email.ts` `renderEmail`. `notifyFrom`, `notifySubject`, `chooseItems` (feed order, at most 10 items), `unsubscribeHeaders` (RFC 8058) |
| `run.ts` | `runNotify`: the run loop. The database, fetch, send, clock and sleep are all injected. It returns a report with no addresses in it |
| `service.ts` | `handleAppNotify`: the HTTP handler (shared-secret check, body, wiring) |

The Deno entry point is `platform/supabase/functions/app-notify/index.ts`.
The SQL is `platform/supabase/shared/0011_app_notify.sql`. The tests are
`platform/test/notify-*.test.ts` and `signin-optout-app.test.ts`.

## The feed

Each app publishes a JSON file at `https://<slug>.hintwise.org/<path>`, for
example `https://stepwise.hintwise.org/releases.json`:

```json
{
  "app": "stepwise",
  "items": [
    {
      "id": "fractions-2026-11-12",
      "title": "Fractions, step by step",
      "url": "https://stepwise.hintwise.org/topics/fractions",
      "date": "2026-11-12",
      "summary": "A new page that walks through adding fractions."
    }
  ]
}
```

- `app` must be the app's slug. If it is anything else, the whole feed is
  refused.
- `items` lists the newest first. Only the first 100 items are read, and the
  file may be at most 256 KB.
- `id` is required and must be stable forever. It matches
  `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`. The id is what makes an item
  "new", so if you change an id, the item gets sent again.
- `title` is required. It is plain text, cut to 200 characters. Line breaks
  and control characters become spaces.
- `url` is required. It must be `https://<slug>.hintwise.org/...`, with no
  port and no user info.
- `date` is optional. When present it must be `YYYY-MM-DD`; a bad value is
  dropped.
- `summary` is optional. It is plain text, cut to 500 characters.
- An item with a bad `id`, `title` or `url`, or with an id the feed has
  already used, is skipped. The run counts skipped items in its report.
- Put HTML in neither `title` nor `summary`. Everything is escaped, so
  markup shows up as literal text.

## The registry

Rows in `platform.notify_apps` say which apps take part. Only the Supabase
admin can write them: the `sql` command of the "Supabase admin" workflow,
which runs as `postgres`. The service role can read the table and set
`seeded_at`, nothing else. So no app can register itself, and no holder of
the service-role key can redirect a feed or the opt-in query.

| Column | Rule (check constraint) |
|---|---|
| `slug` | `^[a-z0-9][a-z0-9-]{0,62}$`. It is the From address's local part and the scope `app:<slug>` |
| `display_name` | `^[A-Za-z0-9][A-Za-z0-9 &+'-]{0,39}$`. It is the From name, so it allows no quotes, angle brackets, commas or dots |
| `feed_url` | `https://<slug>.hintwise.org/<plain path>`, with no query |
| `opt_in_schema` | must be `app_<slug with - as _>`, the app's own schema |
| `opt_in_table`, `opt_in_user_column`, `opt_in_flag_column` | `^[a-z_][a-z0-9_]{0,62}$`. They name a table or view with one row per user: a uuid user column (`auth.users.id`) and a boolean flag (`true` means send) |
| `enabled` | default `false` |
| `seeded_at` | null until the first run |

`platform.notify_opted_in(slug)` reads the opt-in rows with dynamic SQL,
built with `format('%I')`. It returns `(user_id, email)` for every account
whose flag is `true` and whose address is confirmed, not deleted and not
banned. It runs as the service role, which is why the app has to grant that
role `select` on its table. If the flag is not a boolean, the user column is
not a uuid, or the grant is missing, the query fails and nothing is sent.

### Registering an app (example: StepWise)

1. The app's own migration
   (`<app repo>/supabase/migrations/<n>_notify_grant.sql`):

   ```sql
   grant usage on schema app_stepwise to service_role;
   grant select on app_stepwise.preferences to service_role;
   ```

2. The app publishes its feed.
3. The admin runs a file through `node platform/supabase-admin.mjs sql
   <file>` (the workflow's `sql` command), only after the owner says yes:

   ```sql
   insert into platform.notify_apps (slug, display_name, feed_url,
     opt_in_schema, opt_in_table, opt_in_user_column, opt_in_flag_column)
   values ('stepwise', 'StepWise', 'https://stepwise.hintwise.org/releases.json',
     'app_stepwise', 'preferences', 'user_id', 'notify_new_pages');
   update platform.notify_apps set enabled = true where slug = 'stepwise';
   ```

4. The first run after `enabled` seeds the app. Every item already in the
   feed is marked seen, and nobody is emailed. From then on, only items
   first seen on a later run are sent.

To stop an app, set `enabled = false`. To restart an app cleanly after a
long pause, set `seeded_at = null` as well: the next run seeds again, so a
backlog is not emailed.

## A run

`POST https://<ref>.supabase.co/functions/v1/app-notify` with the header
`x-app-notify-secret: <APP_NOTIFY_SECRET>`. The body is optional:
`{ "app": "<slug>" }` runs one app, and `{ "dryRun": true }` checks the
feeds and counts who is due, but records and sends nothing.

For each enabled app (`notify_apps_enabled`), a run does this:

1. Fetch and check the feed. A refused feed is reported, and the run moves
   on to the next app.
2. Record the item ids (`notify_observe`). On the app's first run they all
   become seed items, and the run moves on.
3. Find who is due (`notify_due`): opted-in people with no row for this app
   today (UTC) and at least one item they have not been sent. An item
   counts if it is in the current feed, was first seen after the seed, and
   was first seen within the last 14 days. A pending or sent row's items
   count as sent; a failed row's items do not.
4. For each person:
   - Hash the address (`SIGN_IN_HASH_KEY`, as the sign-in log does).
   - Skip the person if `email_optout_check(hash, ['app:<slug>'])` is true.
     That covers both `all` and this app.
   - Claim today's one email (`notify_claim`). A second run on the same day
     gets null and skips.
   - Send the email, with up to 10 items bundled.
   - Record `sent` with Resend's id, or `failed` with the error
     (`notify_finish`).
5. Brakes:
   - At most 200 emails per run, across all apps.
   - 600 ms between sends.
   - No new send after 240 s.
   - A Resend 429 stops the run.
   - Anything left over goes out the next day.

If a send succeeds but the run crashes before `notify_finish`, the row
stays `pending` and its items count as sent. That can lose one email, but it
never sends the same item twice.

## The email

| Part | Value |
|---|---|
| From | `StepWise <stepwise@hintwise.org>` (the display name and slug from the registry) |
| Reply-To | `support@hintwise.org` |
| Subject | `New in StepWise: <title>` for one item, `New in StepWise: 3 updates` for more, on one line |
| Body | "What is new in StepWise (stepwise.hintwise.org):", then each item as a linked title, date and summary, in text and HTML, all escaped |
| Footer | why the person got it, "Questions? support@hintwise.org (or just reply).", the HintWise line, **Turn off StepWise emails** (the `a1` link), **Stop all email from HintWise** (sign-in links too) (the `v1` link) |
| Headers | `List-Unsubscribe: <https://auth.hintwise.org/functions/v1/email-optout?t=a1....>, <mailto:support@hintwise.org?subject=unsubscribe%20stepwise>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` |

Without `EMAIL_OPTOUT_SECRET` or `SIGN_IN_HASH_KEY`, the run refuses to
start, because it will not send an email that has no working opt-out.

## The per-app opt-out

The `a1` and `w1` tokens are described in `src/signin/README.md` under
"Email footer, logo and opt-out". `email-optout` handles them:

- A GET asks the question.
- A POST of the form stops the app's emails, and the Undo button turns them
  back on for an hour.
- The RFC 8058 one-click POST (`List-Unsubscribe=One-Click`) stops them at
  once.

The opt-out writes `platform.email_optouts` with scope `app:<slug>`.
Support's `email-optout remove` clears every scope.

## Authentication of the caller

The function has `verify_jwt = false`, and checks a shared secret instead.
The anon key is public, so the platform's JWT check alone would let anyone
start a run. Requiring the service-role key would put the project's
strongest key into the scheduler.

The secret is `APP_NOTIFY_SECRET`, a function secret of at least 32
characters, compared in constant time. Without it, every call is refused.
A stolen secret could only start a run, and a run sends nothing beyond each
person's one email a day.

## Deploy order (owner's yes 13 Nov: platform prepared, sending off)

1. `apply-shared`, which runs `0011_app_notify.sql` and
   `0012_notify_opted_in_definer.sql`. Then `check-schema platform`. Expect
   warnings saying "RLS on, no policy", as for the other service-role
   tables. **Done 13 Nov** (0011; 0012 after it). Check with `sql`
   `platform/supabase/ops/notify-ready.sql`.
2. `notify-schedule on` (Supabase admin): enables pg_cron and pg_net,
   generates `APP_NOTIFY_SECRET` (64 hex characters, rotated on every "on"),
   sets it as the function secret and in Vault (`app_notify_secret`), and
   schedules job `app-notify-daily` at 15:17 UTC. `notify-schedule status`
   shows the job, its last runs and the last HTTP answers; `off` removes
   the job and the function secret. The other secrets the function needs
   (`RESEND_API`, `SIGN_IN_HASH_KEY`, `EMAIL_OPTOUT_SECRET`,
   `EMAIL_LOGO_URL`) are project-wide and already set.
3. `deploy-function app-notify`.
4. `deploy-function email-optout`, which adds the per-app pages and
   one-click. The `v1` behaviour is unchanged.
5. Register the app (see above), then call the function once with
   `{"dryRun": true}`, then once for real. The real call only seeds.
6. The daily run is step 2's cron job. With no enabled app it does nothing.

## Not verified yet

(Settled 13 Nov: the live service role cannot read `auth.users`, so 0012 makes `notify_opted_in` alone security definer.)

- Resend accepting the `headers` field with `List-Unsubscribe`, and the
  `<slug>@hintwise.org` From addresses. The domain is verified for
  `sign-in@`.
- Whether Gmail and Yahoo show the one-click button. That depends on the
  domain's reputation and on DKIM alignment as well.
- Deno's `fetch` with `redirect: 'manual'` returning the 3xx response with
  its `Location` header (Node's does; the tests use a stub).
