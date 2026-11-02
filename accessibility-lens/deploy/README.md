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

## Custom domain

Set `netlify.customDomain: <app>.pisan.me` in `target.yml` to serve an app
from pisan.me. The deploy makes it the site's primary domain (Netlify then
redirects `<siteName>.netlify.app` to it with a `_redirects` rule the
deploy writes first in the publish directory), asks Netlify for the Let's Encrypt
certificate, and checks the page for up to five minutes while the certificate
arrives. The DNS side is a CNAME `<app>` -> `<siteName>.netlify.app` in
Cloudflare, set to DNS only (grey cloud); every app already has one.

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
