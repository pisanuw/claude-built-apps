# Shortcut Sprint

A Duolingo-style trainer for keyboard shortcuts. Pick a tool, get a task
prompt ("Go to definition"), press the shortcut, and an SM-2 spaced-repetition
scheduler decides when you see each one again. Live at
**<https://shortcut-sprint.pisan.me>**.

Everything runs in the browser: no account, no server, no API keys. Progress
lives in `localStorage`.

## Bundled libraries

| Set | Shortcuts |
|---|---|
| VS Code essentials | 22 |
| Chrome DevTools | 14 |
| Figma basics | 18 |
| Vim survival kit | 21 |
| Emacs essentials | 20 |
| Excel essentials | 22 |
| Visio essentials | 22 |
| Word essentials | 22 |
| Acrobat Reader essentials | 20 |

Combos are the Windows/Linux defaults. macOS mode (auto-detected, toggleable
in **Sets**) translates Ctrl→⌘ and uses explicit per-shortcut overrides where
the real macOS binding differs (e.g. clear console is `⌘K`, not `⌃L`).
Excel and Word follow Microsoft's Mac tables, which use Control in several
places (Currency format is `⌃⇧4`; `⌘⇧4` would take a screenshot). Visio has
no macOS app, so its set keeps the Windows `Ctrl` bindings, as Emacs does.
Acrobat's single-letter tool keys (H, V, Z, S, U) only work in Acrobat once
*Preferences > General > Use single-key accelerators to access tools* is on;
those cards say so in their hint.

## Custom sets

Upload or paste a JSON set in the **Sets** tab:

```json
{
  "version": 1,
  "id": "my-tool",
  "name": "My tool shortcuts",
  "tool": "My Tool",
  "shortcuts": [
    { "id": "do-thing", "task": "Do the thing", "combo": "Ctrl+Shift+K" },
    { "id": "chord", "task": "A two-chord shortcut", "combo": "Ctrl+K Ctrl+S" },
    { "id": "mac-differs", "task": "Different on macOS", "combo": "Ctrl+L", "mac": "Meta+K" }
  ]
}
```

Chords are space-separated, keys joined with `+`; sequences up to 4 chords
(`"C I W"` for Vim's `ciw`). `notation: "vim"` displays bare letters
lowercase. Validation is strict about structure and drops browser-reserved
combos (see limitations) with a warning instead of rejecting the set.
Bundled set ids are reserved: an upload that uses one is rejected, and a
saved custom set whose id a later release bundles is hidden.

## How it works

- **SM-2 scheduling** ([src/core/sm2.ts](src/core/sm2.ts)): classic
  SuperMemo-2. Instant recall grades 5, hesitation 4–3, a retry 2, a reveal 0;
  grades under 3 reset the interval and re-queue the card within the session.
- **Key capture** ([src/core/keys.ts](src/core/keys.ts)): each keydown
  produces up to two candidate chords: a physical reading from `event.code`
  (so `Ctrl+Shift+[` works) and a produced-character reading from `event.key`
  (so Vim's `$` matches Shift+4 on any layout). A stateful matcher walks
  multi-chord sequences.
- **Stats** ([src/core/stats.ts](src/core/stats.ts)): per-tool mastery is
  half coverage (cards started) and half maturity (cards at a 21-day
  interval), drawn as an SVG radar chart, plus a daily streak.

## Limitations

- Browser-reserved combos (`Ctrl+W`, `Ctrl+T`, `Ctrl+N`, bare `⌘M`/`⌘H`, and
  their tab-level equivalents) cannot be captured by a web page. Bundled sets
  avoid them; custom uploads drop them with a warning.
- Some well-known shortcuts are left out because no capturable binding
  exists: switching sheets or pages with `Ctrl+Page Down` (Excel, Visio),
  Excel's AutoSum on macOS (`⌘⇧T`), Word's Normal style (`Ctrl+Shift+N`),
  Visio's fit to window (`Ctrl+Shift+W`), and Acrobat's Go to Page
  (`Ctrl+Shift+N`).
- macOS assigns `⌃Space` to input-source switching by default. To practice
  Excel's select-column or Emacs's set-mark, free it in System Settings >
  Keyboard > Keyboard Shortcuts > Input Sources (Excel itself needs the
  same change).
- Punctuation matching uses the produced character, so exotic layouts may
  need the character-style combo (`"$"`) rather than the physical one.
- Progress is per-browser (localStorage): no sync between machines.

## Development

```bash
npm install
npm run dev        # local dev server
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run coverage   # vitest, 85 tests, thresholds 85% (currently ~98% stmts)
npm run build      # typecheck + vite build → dist/
```

No environment variables are needed (see [.env.example](.env.example)).
Deployed to Netlify by the repo's self-discovering deploy workflow via
[deploy/target.yml](deploy/target.yml).
