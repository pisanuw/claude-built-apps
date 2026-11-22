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

**Deleting your account:** sign in, open your name at the top right (next
to "Sign out"), then "Delete my account". It deletes your HintWise account and your data in every HintWise app.

## Command line

The command-line tool writes alt text with the same prompt and checks, for
many images at once. **People who use it** download one self-contained file,
`lewis-alt-text.mjs`, from
[lewis-alt-text.hintwise.org/terminal/](https://lewis-alt-text.hintwise.org/terminal/)
and run it with Node.js (20.16 or newer; no `npm install`). Step-by-step
instructions for someone who has never used a terminal:
[cli/INSTRUCTIONS.md](./cli/INSTRUCTIONS.md).

```sh
node lewis-alt-text.mjs login        # once per computer
node lewis-alt-text.mjs figure.png
node lewis-alt-text.mjs figure.png --purpose question --focus geometry --context "HW 3, question 2"
node lewis-alt-text.mjs my-figures --json > alt-text.jsonl
node lewis-alt-text.mjs status       # who is signed in, how many alt texts are left
node lewis-alt-text.mjs figure.png --local   # your Claude Code instead of the HintWise allowance
```

`login` signs the terminal in without a browser session of its own: the
/terminal/ page asks for an email, the link HintWise emails returns there with
a code, and the page shows the code (never using it) for the person to paste
into the terminal. The terminal's session is saved in
`~/.config/lewis-alt-text/session.json`, readable only by its owner, and
refreshed on each run; `logout` ends it and deletes the file.

What the file does for a newcomer: it runs under any name a download ends up
with (`.mjs`, `(1).mjs`, `.js`, `.txt`, none), since it has no import
statements and takes Node's built-in modules from `process.getBuiltinModule`;
it says what to install on a Node too old for that; help and messages show
the command as the person typed it; it reads folders and expands `*.png`
itself (the Windows shells do not); it signs in on the way when someone at a
terminal gives it an image first; it re-asks for a mistyped sign-in code; on
a Mac it shrinks large images and converts HEIC, TIFF and BMP with the
built-in `sips`; and each likely mistake (a typo in a command, an unquoted
`--context`, a file macOS will not let the terminal read) has a message that
says what to do.

**From a clone**, `cli/lewis-alt-text` runs the TypeScript source in
`src/cli/` directly (Node 22.18 or newer). `npm run build` also builds the
single file into `dist/cli/lewis-alt-text.mjs` (`npm run build:cli` builds
only that), and `test/cli/bundle.test.ts` runs the built file under several
names.

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
| `src/cli/` | command-line tool: the live app (signed in) or the local `claude` CLI |
| `cli/` | `lewis-alt-text` (runs `src/cli/` from a clone) and `INSTRUCTIONS.md` (for people who download the single file) |
| `scripts/build-cli.mjs` | bundles `src/cli/` into the downloadable `dist/cli/lewis-alt-text.mjs` |
| `terminal/`, `src/terminal.ts` | the /terminal/ page that signs the command-line tool in |
| `test/fixtures/` | generated test figures, each with a `.truth.txt` of what is drawn |

Model: `claude-opus-5-5`, with the skill sent as one cached system block, so
calls within a few minutes of each other pay the cache-read price for it.
Measured: about 13,200 input tokens per call (12,300 of them the cached
skill) and 170 to 600 output tokens, or about 1,400 with the audit.
