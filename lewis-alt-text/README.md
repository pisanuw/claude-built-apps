# Lewis Structure Alt Text

Live: [lewis-alt-text.hintwise.org](https://lewis-alt-text.hintwise.org) (not deployed yet).

For chemistry instructors, course designers and accessibility staff who need
alt text for Lewis structures and related figures (Lewis dot symbols,
resonance structures, bracketed ions, formal charges, dipole arrows,
molecular models). Give it an image; it writes alt text that tells a screen
reader user what is drawn (atoms, line segments, lone pairs, charges,
brackets) without naming bonds or answers that students are meant to work
out.

The rules are a chemistry accessibility skill written by the repository
owner's collaborator ([`skill/`](./skill/README.md)). The app sends it to
Claude unchanged, with the image and what you say about the figure:
question or answer key, the lesson's focus, and any context.

## Using it

1. Choose how to run the model: sign in and use the HintWise key (a free
   daily allowance), or paste your own Anthropic API key.
2. Drop, paste or choose an image (PNG, JPEG, GIF or WebP).
3. Optionally say whether it is a question or an answer key, the lesson
   focus, and any context such as the question text.
4. Copy the result. A "Check these" box lists any break of the skill's hard
   rules it can detect mechanically (a bond named "double", Unicode symbols,
   "Cl" written without a space, more than 20 sentences).

If the model needs more information it asks one question instead; add the
answer under Context and run it again.

## What is stored, and where

- **Nothing about your figures.** Images, options and alt text stay in your
  browser and go only to the model (through the HintWise gateway, or to
  api.anthropic.com with your own key). Nothing is saved on a server.
- **Your sign-in**, if you use the HintWise key: your email address and the
  HintWise account, in Supabase (US East). The gateway records each call's
  cost and when you first and last used the app, to enforce the allowance.
- **The command-line tool**, if you sign it in, keeps its HintWise session
  in `~/.config/lewis-alt-text/session.json` on your computer.
- **Your own key**, if you paste one, stays in this browser's local storage
  and is sent only to api.anthropic.com. "Forget key" removes it.

**Deleting your account:** sign in, then "Delete my account" under "Sign
out". It deletes your HintWise account and your data in every HintWise app.

## Command line

`cli/lewis-alt-text` writes alt text with the same prompt and checks. It
needs Node 22.18 or newer, which runs the app's TypeScript core directly; no
`npm install`. Run it from a clone of this repository (or put `cli/` on your
PATH through a symlink).

**Through the live app** (your HintWise allowance; no key, no Claude Code):

```sh
cli/lewis-alt-text login      # once per computer
cli/lewis-alt-text figure.png
cli/lewis-alt-text figure.png --purpose question --focus geometry --context "HW 3, question 2"
cli/lewis-alt-text *.png --json > alt-text.jsonl
cli/lewis-alt-text status     # who is signed in, how many alt texts are left
cli/lewis-alt-text logout
```

`login` signs the terminal in without a browser session of its own: open
[lewis-alt-text.hintwise.org/terminal/](https://lewis-alt-text.hintwise.org/terminal/),
enter your email, open the link HintWise emails you, and paste the code that
page shows (or the whole link) into the terminal. The page never uses the
code, so the terminal gets its own session. It is saved in
`~/.config/lewis-alt-text/session.json`, readable only by you, and refreshed
on each run. Treat that file like a password; `logout` ends the session and
deletes it. Images go up to about 680 kB, the gateway's limit; crop or shrink
larger ones.

**Through your local Claude Code** (your Claude subscription), add `--local`:

```sh
cli/lewis-alt-text figure.png --local
cli/lewis-alt-text figure.png --local --model sonnet
```

Other options: `--audit` prints the atom-by-atom inventory to stderr,
`--model` picks opus (default), sonnet or haiku. Exit status: 0 alt text
written, 2 the model asked a question (answer it with `--context`), 1 error.

## One honest limitation

The model can miscount line segments, dots or charges, especially in crowded
or low-resolution figures. Always compare the alt text with the image before
publishing it. The verification audit (a checkbox, or `--audit`) shows the
atom-by-atom count the alt text was built from, which makes a miscount easy
to spot.

## Development

```sh
npm install
npm run dev                       # Vite; sign-in needs a *.hintwise.org address, so use your own key locally
npm run lint && npm run typecheck && npm run coverage && npm run build
npm run e2e                       # Playwright walkthrough against vite preview, model faked
```

| Path | What |
|---|---|
| `skill/` | the skill (system prompt), with its source and credit |
| `src/core/` | prompt, request, reply parsing and checks, image resizing; shared with the CLI |
| `src/ui/` | the page and the allowance messages |
| `src/lib/` | the HintWise template: sign-in, account deletion, model calls |
| `cli/` | command-line tool: the live app (signed in) or the local `claude` CLI |
| `terminal/`, `src/terminal.ts` | the /terminal/ page that signs the command-line tool in |
| `test/fixtures/` | generated test figures, each with a `.truth.txt` of what is drawn |

Model: `claude-opus-5-5`, with the skill sent as one cached system block, so
calls within a few minutes of each other pay the cache-read price for it.
Measured: about 13,200 input tokens per call (12,300 of them the cached
skill) and 170 to 600 output tokens, or about 1,400 with the audit.
