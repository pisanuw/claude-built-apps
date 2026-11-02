# Agent Blast Radius

**Live:** https://agent-blast-radius.pisan.me

![Clicking Try a sample scans twelve bundled AI tool configs, then scrolls through cards scoring each tool's reach across filesystem, shell, network, credentials and browser data, with the config line behind every capability](demo.gif)

What can your AI tools actually touch? Drop in the config files for your MCP
servers, coding agents, and browser or VS Code extensions, and get a one-page
report scoring each tool's reach across five dimensions: **filesystem**,
**shell / code execution**, **network egress**, **credentials**, and
**browser data**. Each capability comes with a plain-English "what could go
wrong" sentence and the exact config fragment that triggered it.

Everything runs in the browser tab. Files are read with the File API and never
uploaded; secrets are masked in both the page and the downloadable report.

Built from idea [2026-09-23 #1](https://github.com/pisanuw/daily-project-ideas)
in `pisanuw/daily-project-ideas`.

## What it reads

| File | Where it usually lives | What is scored |
|---|---|---|
| Claude Desktop config | `~/Library/Application Support/Claude/claude_desktop_config.json` | every `mcpServers` entry |
| Cursor / Windsurf / Cline / `.mcp.json` | `~/.cursor/mcp.json`, `<project>/.mcp.json`, ... | every `mcpServers` entry |
| VS Code MCP | `<project>/.vscode/mcp.json`, user `settings.json` (`mcp.servers`) | every `servers` entry |
| Claude Code | `~/.claude.json` (incl. per-project servers), `.claude/settings.json` | MCP servers, `permissions.allow`, `defaultMode`, hooks, env |
| Browser extension | `.../Extensions/<id>/<version>/manifest.json` | host permissions, API permissions, OAuth scopes, CSP |
| VS Code extension | `~/.vscode/extensions/<id>/package.json` | entry point, activation, contributions |

JSONC (comments, trailing commas) is accepted. The app's "Where do I find these
files?" panel lists the paths per OS.

## How scoring works

Each analyzer turns config into **capabilities** (dimension + weight 0-100 +
evidence) and **findings** (hygiene issues with a severity).

- **MCP servers**: well-known servers are matched on their launch command
  (filesystem, desktop-commander and other shell servers, git, GitHub/GitLab,
  fetch, Playwright/Puppeteer, databases, SaaS connectors, cloud/Kubernetes,
  memory). Filesystem path arguments are classified as root, home, sensitive
  (`.ssh`, `.aws`, `/etc`, ...), or scoped. Docker launches are scored from
  their mounts, `--privileged`, the Docker socket, and host networking.
  Remote servers are scored by host, with plain HTTP flagged. An
  **unrecognized local program is scored as "runs as you"** (shell 50), not
  as safe.
- **Secrets**: secret-named env vars and auth headers count as credentials
  held; literal values (rather than `${VAR}` references), known token
  prefixes, and connection strings with inline passwords are flagged as
  plaintext secrets.
- **Hygiene**: unpinned `npx`/`uvx` packages and `:latest` images,
  auto-approved tools (`autoApprove`/`alwaysAllow`), `bypassPermissions`,
  `enableAllProjectMcpServers`, Manifest V2, `unsafe-eval` CSP, off-store
  update URLs.
- **Score**: per dimension, the strongest capability sets the value and each
  extra one closes a quarter of the gap to 100. The overall score is the worst
  weighted dimension (shell 1.0, filesystem 0.85, credentials/browser 0.8,
  network 0.6), plus 4 per other significant dimension, plus up to 20 for
  findings. Levels: low < 30 ≤ medium < 60 ≤ high < 85 ≤ critical.

The idea suggested a Node/Python CLI that finds the files itself. This version
is a static web app instead, so it can be hosted and used with zero install;
the trade-off is that you pick the files.

## Limitations

- It scores what a config **declares**. It does not read a server's source or
  its runtime tool list, so a server that does more than its name suggests is
  only caught if it is unrecognized (and then scored as fully trusted code).
- Known-server matching is a hand-maintained list of name patterns; a fork
  with a new name falls into "unrecognized".
- Browsers cannot read your disk, so you have to locate and drop in the files;
  there is no auto-discovery.
- Weights are judgment calls, not a standard. Treat the ranking as a
  checklist of what to look at first.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run lint
npm run typecheck
npm run coverage   # vitest + v8 coverage, thresholds 85%
npm run build      # dist/
```

Layout: `src/core/` is pure, DOM-free logic (parsers, analyzers, scoring,
HTML report rendering) with full unit tests in `test/`; `src/main.ts` is the
thin DOM layer (file picker, drag and drop, paste, download).

## Deploy

Static site on Netlify, configured by [`deploy/target.yml`](./deploy/target.yml)
and deployed by the monorepo's deploy workflow. No environment variables.
