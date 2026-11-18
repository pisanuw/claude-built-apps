# Builder: what we have learned

Append below; never edit another entry. Each entry: the date, the lesson, the evidence (a link or a commit), and where it applies. Monitor proposes pruning.

- 2026-11-10. Sign-in returns only to https://*.hintwise.org/**, so it cannot finish on localhost or on a deploy preview. Tests and the Playwright walkthrough mock it. Evidence: BUILD_ROUTINE.md, 'The usual architecture'.
- 2026-11-10. Never call `signInWithOtp`. The template's `sendMagicLink` goes through the platform's sign-in-link function. Evidence: BUILD_ROUTINE.md; docs/platform.md, 'Sign-in links'.
- 2026-11-10. CI's platform job fails while platform/src/signin/app-hosts.ts is out of date. Run `npm run app-hosts` in platform/ in the push that adds the app's first deploy/target.yml. Evidence: BUILD_ROUTINE.md Step 4.
- 2026-11-10. The Deploy workflow's check-schema step fails a deploy when a table has row level security off, the anon role can reach a table, a security definer function has no fixed search_path, or a signed-in stranger can see any real row. Share rows with visitors through a security definer function, as StepWise does. Evidence: BUILD_ROUTINE.md Step 4.
- 2026-11-10. App email: Resend from a Netlify Function only, sender `<slug>@hintwise.org`, no sending subdomains; recurring mail opt-in with an unsubscribe link and per-user and per-day caps. Evidence: BUILD_ROUTINE.md, architecture table.
