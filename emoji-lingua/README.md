# emoji-lingua

Translate English into emoji, and emoji back into English.

- **Live site:** https://emoji-lingua.hintwise.org  *(Netlify; confirmed after first deploy)*
- **Source:** https://github.com/pisanuw/Claude-capstone/tree/main/emoji-lingua
- **Host:** Netlify (static page on the CDN + the API as a serverless function).

## What it does

- **English → Emoji.** `I love pizza on a rainy night` → `👤 ❤️ 🍕 🔛 🌧️ 🌙`.
  Known words become emoji; unknown words are left in place (which reads better
  than dropping them) and are counted in a small hint under the result.
- **Emoji → English.** Two modes:
  - *Literal gloss:* `🐱🍕🌧️😢` → `cat pizza rain sad`
  - *Interpret meaning* (AI only): a natural sentence describing what the
    sequence most likely means.
- **Direction auto-detects** if the client does not specify one: input
  containing pictographs is treated as emoji.

## The dictionary

**18,474 word→emoji entries** (including 1,535 multi-word phrases) and **4,218
emoji→word glosses**, generated from the Unicode CLDR emoji annotations and
layered with hand-authored vocabulary. It is built to make the *dictionary-only*
path good enough for ordinary prose: on a sample of common English, 100% of
words resolve.

Layers, lowest priority first (later wins):

| Layer | Source | Purpose |
| --- | --- | --- |
| CLDR keywords | `unicode-org/cldr` annotations | broad coverage, 4,011 emoji |
| CLDR names | annotation `tts` names | precise: the emoji's actual name |
| Morphology | derived | plurals and verb forms of everything above |
| Composed | hand-authored | abstract words approximated with 1-2 emoji: `democracy` → 🗳️, `forecast` → 🔮📊, `justice` → ⚖️ |
| Common | hand-authored | high-frequency English CLDR lacks: pronouns, irregular verbs (`gave` → 🎁), prepositions |
| Function words | hand-authored | glue words; articles map to `""` and are **dropped** so output reads cleanly |
| Curated | hand-authored | the obvious choice for everyday words wins (`cat` → 🐱, not 🐈) |

At runtime a suffix-rule fallback resolves forms the generator did not
materialize (`-ing`, `-ed`, `-ly`, `-ness`, `-tion`, `-ic`, `-ful`, `-able`, …),
and phrases are matched greedily longest-first, so `good morning` → 🌅 rather
than 👍 🌅.

Regenerate with `npm run build:dictionary` (it downloads the CLDR source files
on first run). The generated file is committed, so a normal build needs no
network.

## The hybrid engine

Two engines behind one interface:

1. **Dictionary (always available).** The 18k-entry dictionary above. Pure,
   deterministic, fully unit-tested, no network.
2. **Claude (when `ANTHROPIC_API_KEY` is set).** Understands context, so it can
   render ideas that have no one-to-one emoji and interpret an emoji sequence as
   a sentence.

The AI path **always degrades to the dictionary** on any error, so a model
outage or a missing key can never break the app. The UI labels which engine
produced each result.

## Run locally

Node 20+.

```bash
cd emoji-lingua
npm install
npm run dev        # http://localhost:3000
npm test           # 44 tests
npm run coverage   # ~94% statements
```

No configuration is required; see [`.env.example`](./.env.example) for the
optional AI key.

## API

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | | reports the active engine |
| POST | `/api/translate` | `{ text, direction?, mode? }` | `direction`: `to-emoji` \| `to-english` \| `auto`; `mode`: `literal` \| `interpretive`; 500-char cap |

## Architecture on Netlify

`npm run build` compiles the server and copies the static page to `dist/public`,
which Netlify serves from its CDN. `netlify/functions/api.mjs` wraps the same
Express app with `serverless-http`; [`netlify.toml`](./netlify.toml) routes
`/api/*` to it. Deployment is config-driven: edit
[`deploy/target.yml`](./deploy/target.yml) and push, and GitHub Actions
provisions and deploys the site.

## Limitations

Emoji → English is a **gloss, not grammar**: `🐱🍕` becomes `cat pizza`, not
`the cat ate pizza`. Round-tripping is lossy, since many words share an emoji
(`night` and `moon` are both 🌙). Rare, technical, and proper-noun vocabulary
still passes through untranslated, and the UI tells you how many words that was.
Turn on the AI key for grammatical, context-aware translation.
