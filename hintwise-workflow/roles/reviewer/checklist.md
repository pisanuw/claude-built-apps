# Reviewer: code review checklist

## Correctness
- [ ] Each of the milestone's acceptance criteria has a test that would fail without the code.
- [ ] Edge cases are handled:
  - empty input;
  - duplicates;
  - dates and time zones;
  - two tabs at once;
  - a slow or lost connection.
- [ ] Errors are handled where they occur, and the user sees what went wrong in plain words.

## Security
- [ ] Every new table has row level security, and its policies match SPEC.md section 5.
- [ ] No service-role key in the app.
- [ ] Server functions act with the user's token, validate their inputs, and never send a secret to the browser.
- [ ] Sign-in goes through the platform: `sendMagicLink`, never `signInWithOtp`, and redirects only to hintwise.org.
- [ ] Email is opt-in, carries an unsubscribe link, and has per-user and per-day caps.
- [ ] Analytics mask ids and share codes (`data-mask`).

## Maintainability
- [ ] The code follows the template's structure; no dead code; names say what things are.
- [ ] Every new dependency is needed, maintained and licence-compatible, and none is a paid service.

## Decisions
- [ ] Every real choice in the diff has a D-<n> entry with its options and a reason.
- [ ] Every departure from the spec is marked DEVIATION and justified.

## Basics
- [ ] Every control can be reached by keyboard; inputs have labels; contrast is sufficient; the phone layout holds.
- [ ] Coverage is at least 85%, and lint, typecheck and build pass.
