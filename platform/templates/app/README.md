# App template

The baseline for a weekly HintWise app (design: `docs/platform.md`): Vite,
TypeScript, vitest with 85% coverage thresholds, ESLint, Playwright, and the
three platform pieces as small modules under `src/lib/`.

## Copying it

From the repo root, with the new app's slug (lowercase, dashes):

```bash
slug=my-new-app
cp -r platform/templates/app "$slug"
cd "$slug"
# SLUG -> the slug everywhere (APP_SLUG stays a constant name); app_SLUG -> app_ plus the slug with underscores
grep -rl SLUG . | xargs perl -pi -e "s/app_SLUG/app_${slug//-/_}/g; s/(?<!APP_)SLUG/$slug/g"
mv supabase/migrations/0001_init.sql.example supabase/migrations/0001_init.sql
mv deploy/target.yml.example deploy/target.yml
npm install
git add -f package-lock.json   # the root .gitignore excludes lockfiles; npm ci needs it
```

Then edit:

- `package.json` description, `index.html` title, `src/main.ts` (the
  placeholder shell), the `README.md` for the business owner.
- `supabase/migrations/0001_init.sql`: the app's tables (keep `user_id ...
  default auth.uid()`, the RLS policies and the grants on every table).
  Uncomment the `platform.llm_apps` insert if the app uses the gateway.
  Delete the `supabase/` folder and set `supabase: false` (or drop the key)
  in `target.yml` if the app stores nothing server-side.
- `deploy/target.yml`: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from
  `platform/supabase.json` (if that file does not exist yet, build behind the
  in-memory repository and list the dependency in HANDOFF.md).
- `.env.example` stays; a local `.env` with the same two values is git-ignored.

## What is in `src/lib/`

| File | What it gives the app |
|---|---|
| `supabase.ts` | `getSupabase()` (one client, `db.schema` = the app's schema), `hasSupabase()`, `APP_SLUG`, `APP_SCHEMA` |
| `auth.ts` | `signInWithGoogle`, `sendMagicLink`, `signOut`, `onAuth`, `currentToken`, and `mountSignIn(el)`: a plain-DOM panel with a Google button, an email field and the signed-in state |
| `llm.ts` | `ask({system, messages, model?})` in the visitor's mode: `byok` (their key in localStorage `hintwise.anthropicKey`, browser SDK), `gateway` (the owner's key through `llm-gateway` with the session token), `off`; `CapReached` carries the scope and reset time |
| `repository.ts` | `Repository<T>` (list/get/put/remove), `InMemoryRepository` for tests and `vite preview`, `SupabaseRepository` over one table (the database fills `user_id`) |

## Rules

- Tests never touch the network: pass fakes (`AuthClient`, `AskDeps`, a fake
  `SupabaseClient`) as the modules' last arguments, as `test/` does. The
  Playwright walkthrough (`npm run e2e`) runs against `vite preview` built
  without Supabase env, so the app must work with the in-memory repository.
- Bring-your-own-key is always offered; the owner's key only through the
  gateway and its caps; deterministic code wherever it does the job.
- Do not add the "built by" footer; the deploy injects it. Keep `body` a block
  or column layout.
- Quality gates before every push: `npm run lint && npm run typecheck &&
  npm run coverage && npm run build`.

## Checking the template itself

The template is not a package in CI. To check it, copy it somewhere outside
the repo, install, and run the gates:

```bash
cp -r platform/templates/app /tmp/tmpl-check && cd /tmp/tmpl-check
npm install && npm run lint && npm run typecheck && npm run coverage && npm run build
```

## Profiles

The platform keeps one `platform.profiles` row per user, but it has no trigger
on Supabase's `auth.users` (the shared project does not allow one). The
sign-in panel (`mountSignIn`) calls `ensureProfile()` from `src/lib/auth.ts`
once per signed-in user; an app with its own sign-in UI calls it itself. It
never throws; a missing profile row does not stop the app.
