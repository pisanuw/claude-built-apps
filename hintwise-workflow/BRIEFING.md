# Briefing

## Scope

The HintWise workflow covers:
- the roles that find, choose, specify, build, review, release, market and monitor HintWise apps;
- the rules they follow;
- the records they keep;
- the knowledge they accumulate across projects.

## Key decisions

- 2026-11-18, proposed:
  - Roles and vehicles are kept separate.
  - Most roles run as subagents of a daily build-day routine.
  - PManager is the relay session.
  - Finder, Marketer and Monitor are routines.
- 2026-11-18, proposed:
  - Tiers, not model names, appear in the repository.
  - Rules change only by owner-merged pull requests; knowledge is appended freely.

## Non-goals

- Replacing the platform documentation in claude-built-apps (`docs/platform.md`, `docs/new-app-guide.md`). Roles link to it.
- Letting any role post or publish on the owner's behalf without a standing authorization.
