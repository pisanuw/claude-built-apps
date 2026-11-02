# Sound Sketchpad

Describe a sound effect in plain words — *"muffled explosion heard from
underground"*, *"coin flicked across a marble table"*, *"tiny retro laser"* —
and hear it synthesized instantly in your browser. Tune pitch, length,
brightness, echo, and volume with sliders, watch the waveform and the full
signal chain, then export a WAV at your chosen sample rate and bit depth.

**Live:** <https://sound-sketchpad.pisan.me>

![Typing tiny retro laser, echoing and seeing which words matched and the waveform, playing it with a moving playhead, switching to the metallic door slam preset and dragging the pitch slider](demo.gif)

Built from idea **2026-08-09 #1** in
[pisanuw/daily-project-ideas](https://github.com/pisanuw/daily-project-ideas).

## How it replaces the LLM

The original idea called for the Claude API to translate natural language into
Web Audio synthesis code. This implementation swaps that for a **deterministic
word-to-DSP recipe book** ([src/core/lexicon.ts](src/core/lexicon.ts)):

- **20 base sounds** (explosion, laser, coin, jump, powerup, hit, footsteps,
  knock, bell, rain, wind, thunder, drip, bubble, whoosh, click, alarm,
  engine, heartbeat, static), each a hand-tuned recipe of oscillator/noise
  layers, envelopes, filters, and repeats.
- **18 modifiers** (muffled, underwater, distant, close, huge, tiny, metallic,
  wooden, glassy, echoing, soft, harsh, deep, high, slow, fast, retro, wobbly)
  that transform the recipe: re-filtering, re-pitching, adding ringing
  partials, bit-crushing, echo tails.

The parser reports exactly which words matched, so the result is never a
black box. The same description always produces the identical sound (noise
seeds are hashed from the words); a **Variation** button re-rolls only the
seed. Everything is free, offline, reproducible, and license-free — no
samples, no server, no API key.

## Architecture

All audio is rendered by a pure sample-by-sample DSP engine
([src/core/synth.ts](src/core/synth.ts)) with no Web Audio dependency:
phase-accumulated oscillators with exponential sweeps and vibrato,
white/pink/brown noise from a seeded PRNG, ADSR envelopes, RBJ biquad filters
with block-rate coefficient sweeps, feedback echo, tanh drive, bit crush, and
peak normalization. The browser only plays back the finished buffer, which
means:

- the tests assert on the **exact samples** the user hears,
- the WAV export is a byte-for-byte re-render at the requested rate/depth,
- the oscilloscope draws the true output, not an approximation.

```
description ──parse──▶ SoundSpec ──sliders──▶ tweaked SoundSpec ──render──▶ Float32Array
                                                                    ├─▶ AudioBuffer (play)
                                                                    ├─▶ canvas oscilloscope
                                                                    └─▶ WAV encoder (16/24-bit)
```

The DOM layer ([src/ui/app.ts](src/ui/app.ts)) is a thin shell over the core.

## Develop

```bash
npm install
npm run dev        # local dev server
npm test           # 59 vitest cases
npm run coverage   # enforced ≥85% on src/core (currently 100% stmts)
npm run lint && npm run typecheck && npm run build
```

## Limitations

- The vocabulary is fixed: a description using none of the known words falls
  back to a generic whoosh (the UI says so and suggests words that work).
- Mono output only, and the synthesis targets sketch-quality game-jam sounds,
  not production sound design.
