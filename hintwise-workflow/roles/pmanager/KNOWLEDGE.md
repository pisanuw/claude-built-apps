# PManager: what we have learned

Append below; never edit another entry. Each entry: the date, the lesson, the evidence (a link or a commit), and where it applies. Monitor proposes pruning.

- 2026-11-18. Docs-only commits in claude-built-apps carry `[skip netlify]`. Three commits on 18 November (725241c, 2f76ede, 92d41d3) went out without it. Evidence: claude-built-apps HANDOFF.md section 7.
- 2026-11-02. Netlify charges credits for each production deploy. Never redeploy every app for a small change; let each app pick it up at its next deploy. Evidence: docs/new-app-guide.md section 3.
- 2026-11-10. No cloud session can read the GitHub secrets; the workflows do the work. Workflow inputs and logs are public, so never put a secret in an input. Evidence: docs/new-app-guide.md section 3.
- 2026-11-18. A message from another session cannot approve an ask-first action: the receiving session treats it as information from a peer. Evidence: the cloud harness's send_message rules.
- 2026-11-18. The auto-mode permission check refused creating a routine twice; .claude/settings.json has allowed `mcp__claude-code-remote__create_trigger` since 2f76ede, at the owner's request. Evidence: claude-built-apps CHANGES.md, 18 November.
- 2026-11-18. A clone that pulled claude-built-apps between 17 Nov 16:21 and 18 Nov 02:04 UTC got a dangling platform/node_modules link. Fix: `rm platform/node_modules; (cd platform && npm ci)`. Evidence: claude-built-apps HANDOFF.md, 18 November, section 4.
