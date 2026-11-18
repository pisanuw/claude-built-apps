# hintwise-workflow: instructions for sessions working here

This folder holds the rules and the memory of the HintWise workflow. Read README.md first, then CHARTER.md.

- **Rules:** CHARTER.md, PIPELINE.md, `roles/*/ROLE.md`, checklists, templates and `routines/`.
  - Change them only on a branch, with a pull request for the owner.
  - Never push a rule change to main.
- **Records:** `projects/`, `inbox/`, `runs/`, `reports/`, `marketing/`, every `KNOWLEDGE.md` and `knowledge/`.
  - Append on main, and fetch before every push.
  - Never rewrite another run's record.
  - `decisions/` is PManager's alone.
- **No model names** in any file. Use the tiers: top, strong, fast, light.
- **Commits:** Conventional Commits. While this folder lives in claude-built-apps, use that repository's rules: `docs:` with no scope, and `[skip netlify]`. In its own repository, the scope is the role or area, for example `docs(builder): ...` or `chore(runs): ...`.
- **CHANGES.md:** append-only, one line per entry, `YYYY-MM-DD [type] description`.
- **Times:** Barcelona (Europe/Madrid) for the owner; UTC in ISO 8601 for machine records.
