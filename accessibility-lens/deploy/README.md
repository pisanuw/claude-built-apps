# Config-driven deploy

Edit one file, push, and GitHub Actions provisions and deploys the app to the
host you chose. No secrets live in the repo: the provider tokens are GitHub repo
secrets injected into the workflow at run time, and the assistant editing
`target.yml` never sees them.

## How it works

```
deploy/target.yml          <- the control file you (or the assistant) edit
deploy/deploy.mjs          <- reads the control file, calls the provider
deploy/deploy.workflow.yml <- the GitHub Actions workflow (copy to repo root)
```

1. `target.yml` says which provider (`render` or `netlify`), the project name,
   the app directory, the build command, and which env var **names** to forward.
2. On push to `target.yml` (or a manual run), the workflow runs
   `node accessibility-lens/deploy/deploy.mjs` from the repo root.
3. The runner creates the project if it does not exist, then deploys. It is
   idempotent: re-running deploys to the same project instead of duplicating it.

## One-time setup

1. **Add repo secrets** in GitHub: Settings -> Secrets and variables -> Actions.
   - `RENDER_API_KEY` (only for `provider: render`)
   - `NETLIFY_AUTH_TOKEN` (only for `provider: netlify`)
   - `ANTHROPIC_API_KEY` (optional; forwarded to the app)
2. **Install the workflow.** Copy `deploy/deploy.workflow.yml` to
   `.github/workflows/deploy.yml` at the repository root and commit it. (This
   step needs the GitHub `workflow` token scope, which is why the file ships
   here rather than pre-installed.)

## Daily use

Change `provider`, `projectName`, or any setting in `target.yml`, commit, and
push. The workflow does the rest. To deploy without changing the file, trigger
"Deploy (config-driven)" manually from the Actions tab.

## Site footer

Every Netlify deploy adds the shared "built by" footer from
[`scripts/site-footer.mjs`](../../scripts/site-footer.mjs) to the built
`index.html`, right after the build and before the upload. The footer is not in
any app's source, so local dev servers do not show it. Set `footer: false` at the
top level of an app's `target.yml` to opt that app out. Render apps cannot be
injected here (Render builds server-side), so `mult-streak` runs the same script
from its own build. Changing `scripts/site-footer.mjs` deploys nothing by
itself; run the Deploy workflow manually with `all` to ship it to every app.
Each Netlify production deploy costs account credits, so prefer naming the
apps you need.

## Analytics

Every Netlify deploy also adds the platform's first-party analytics from
[`scripts/site-analytics.mjs`](../../scripts/site-analytics.mjs): it copies
`platform/src/analytics/hw-events.js` to `/hw-events.js` in the publish dir and
adds `<script defer src="/hw-events.js" data-app="<projectName>">` before
`</head>` of every full page. Before the upload the runner registers the app's
origin (`https://<app>.hintwise.org`, or the `.netlify.app` address when the
custom domain is not used) in `platform.analytics_apps` with
`platform/supabase-admin.mjs analytics-register`, using
`SUPABASE_ACCESS_TOKEN` and `SUPABASE_URL`; a failure there is a warning, not a
failed deploy. Set `analytics: false` at the top level of `target.yml` to opt an
app out. Like the footer, changing the script deploys nothing by itself.

## Removing a secret

Taking a name out of `envPassthrough` only stops the deploy sending it; the
host keeps the last value. List the name under `envRemove` in `target.yml` and
the next deploy deletes it from the Netlify site before deploying (and stops if
the delete fails).

## Custom domain

Set `netlify.customDomain: <app>.pisan.me` in `target.yml`. The runner maps
it through `scripts/domains.mjs` (APP_DOMAIN) and serves the app at
`<app>.hintwise.org` (exceptions such as daily-project-ideas -> studio live in
`HOST_RENAMES`), so no target.yml needs editing. The deploy creates the
hintwise CNAME `<app>` -> `<siteName>.netlify.app` in Cloudflare, DNS only
(grey cloud), makes it the site's primary domain (Netlify then redirects
`<siteName>.netlify.app` to it with a `_redirects` rule the deploy writes first
in the publish directory), asks Netlify for the Let's Encrypt certificate, and
checks the page for up to five minutes while the certificate arrives. The old
`<app>.pisan.me` name is answered by Cloudflare: its record is proxied and a
Single Redirect rule (redirect-rule.mjs) sends it to the hintwise address.

## Try it safely first

The runner has a dry-run mode that prints exactly what it would do and makes no
API calls:

```bash
cd accessibility-lens/deploy
npm install
node deploy.mjs --dry-run                       # uses target.yml
node deploy.mjs --dry-run --config target.yml    # explicit
```

## Provider notes

**Render.** Uses the Render REST API. Creates a `web_service` from this repo with
`autoDeploy` on, so subsequent pushes also redeploy via Render's own git
integration. The runner resolves your workspace automatically; set
`render.ownerId` to pin it. Render runs the build itself, server-side.

A Docker service sets `render.runtime: docker` and, when its Dockerfile is not
`./Dockerfile` in its root directory, `render.dockerfilePath` and
`render.dockerContext` (both relative to the service's root directory, which
is `render.rootDir` when set, else `directory`; defaults `./Dockerfile` and
`.`). The runner then sends those two in `envSpecificDetails` in place of the
build and start commands, and the image's `CMD` starts the service
(`render-service.mjs`; first used by `tagging-doctor-worker`).

`render.rootDir` (`''` is the repository's root) and `render.buildFilter`
(`paths`, `ignoredPaths`, from the repository's root) are optional. For a
service that exists, the runner compares what target.yml states (the runtime
when `render.runtime` is set, the Docker paths, `rootDir`, `buildFilter`) with
what Render reports, sends one update when they differ, reads the service
back, and stops before the env vars and the deploy if anything is left; the
stop says what Render now reports. Paths compare without a leading `./`.
backend-hub's move to Docker (Tagging Doctor D-123, D-133) is its first use.

**Netlify.** Uses the Netlify CLI. Because this app is not static (it has a
server-side API), the deploy publishes `client/dist` to the CDN and ships the API
as a serverless function (`netlify/functions/api.mjs`), wired up by
`netlify.toml`. The runner builds locally, then uploads.

For the simplest Netlify "automagic" path you can instead connect the repo in the
Netlify UI and set the base directory to `accessibility-lens`; Netlify then reads
`netlify.toml` and autodeploys on every push with no workflow at all.

## Security

- Tokens are never written to `target.yml` or any committed file. Only env var
  **names** appear in config; values come from secrets at run time.
- The derived repo URL is stripped of any embedded credentials before use.
- Treat anyone with push access as able to trigger a deploy; scope the provider
  tokens to the minimum needed.
