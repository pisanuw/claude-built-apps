# Knowledge for every role

Lessons that more than one role needs. Append below; never edit another entry. Each entry: the date, the lesson, the evidence, and where it applies. The platform's own documentation stays in claude-built-apps (`docs/platform.md`, `docs/new-app-guide.md`, BUILD_ROUTINE.md); link to it rather than copying it.

- 2026-11-10. Every app lives at `https://<slug>.hintwise.org`. In `deploy/target.yml`, still write `netlify.customDomain: <slug>.pisan.me`: the runner swaps in hintwise.org. Evidence: claude-built-apps CLAUDE.md.
- 2026-11-10. The shared Supabase project serves every live app. Never touch `public` or another app's schema. Evidence: BUILD_ROUTINE.md, architecture table.
- 2026-11-10. No live app calls Claude or any paid API on the owner's key except through the LLM gateway; bring-your-own-key is always offered. Evidence: claude-built-apps CLAUDE.md; docs/platform.md section 3.
- 2026-11-17. Reports to the owner use Barcelona time (Europe/Madrid), until the owner says otherwise. Evidence: claude-built-apps HANDOFF.md, standing instructions.
