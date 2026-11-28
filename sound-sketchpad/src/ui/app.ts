/**
 * DOM shell around the pure core: text in, parse -> tweak -> render, then
 * playback (Web Audio), oscilloscope drawing, signal-chain view, WAV export.
 */

import { parseDescription, type ParseResult } from '../core/parse.js';
import { renderSpec } from '../core/synth.js';
import { applyTweaks, tweaksForSpec, type Tweaks } from '../core/tweaks.js';
import { encodeWav, type BitDepth } from '../core/wav.js';
import type { SoundSpec } from '../core/spec.js';

const PRESETS = [
  'muffled explosion heard from underground',
  'coin flicked across a marble table',
  'tiny retro laser',
  'huge metallic door slam in a cave',
  'gentle rain on a distant street',
  'deep underwater heartbeat',
  'harsh alarm in a big hall',
  'glass wind chime, soft and slow',
];

interface AppState {
  parsed: ParseResult;
  tweaks: Tweaks;
  tweakedSpec: SoundSpec;
  samples: Float32Array;
  seedOffset: number;
}

let audioCtx: AudioContext | null = null;
let playing: { src: AudioBufferSourceNode; startedAt: number; duration: number } | null = null;
let animFrame = 0;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountApp(root: HTMLElement): void {
  const state: AppState = recompute('muffled explosion heard from underground', null, 0);

  root.innerHTML = '';
  const shell = el('div', 'shell');
  root.append(shell);

  // ----- header
  const header = el('header', 'header');
  const titleRow = el('div', 'title-row');
  titleRow.append(el('h1', 'title', 'Sound Sketchpad'), el('hw-theme-toggle'));
  header.append(
    titleRow,
    el(
      'p',
      'tagline',
      'Describe a sound effect in plain words. A deterministic synthesis engine sketches it instantly: no samples, no server, no AI calls. Tune it, then export a WAV.',
    ),
  );
  shell.append(header);

  // ----- input card
  const inputCard = el('section', 'card');
  const input = el('textarea', 'desc-input') as HTMLTextAreaElement;
  input.rows = 2;
  input.value = state.parsed.spec.name;
  input.placeholder = 'e.g. muffled explosion heard from underground';
  input.setAttribute('aria-label', 'Sound description');

  const btnRow = el('div', 'btn-row');
  const generateBtn = el('button', 'btn primary', 'Sketch it');
  const variationBtn = el('button', 'btn', 'Variation');
  variationBtn.title = 'Re-roll the noise seed without changing the recipe';
  const playBtn = el('button', 'btn play', '▶ Play');
  btnRow.append(generateBtn, variationBtn, playBtn);

  const chips = el('div', 'chips');
  for (const p of PRESETS) {
    const chip = el('button', 'chip', p);
    chip.addEventListener('click', () => {
      input.value = p;
      regenerate();
    });
    chips.append(chip);
  }
  inputCard.append(input, btnRow, chips);
  shell.append(inputCard);

  // ----- explanation
  const explain = el('section', 'card explain');
  shell.append(explain);

  // ----- waveform
  const scopeCard = el('section', 'card');
  scopeCard.append(el('h2', 'card-title', 'Oscilloscope'));
  const canvas = el('canvas', 'scope') as HTMLCanvasElement;
  canvas.height = 160;
  scopeCard.append(canvas);
  shell.append(scopeCard);

  // ----- tuning sliders
  const tuneCard = el('section', 'card');
  tuneCard.append(el('h2', 'card-title', 'Tune'));
  const sliderGrid = el('div', 'sliders');
  tuneCard.append(sliderGrid);
  shell.append(tuneCard);

  interface SliderDef {
    key: keyof Tweaks;
    label: string;
    min: number;
    max: number;
    step: number;
    fmt: (v: number) => string;
  }
  const times = (v: number) => `×${v.toFixed(2)}`;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const sliderDefs: SliderDef[] = [
    { key: 'pitch', label: 'Pitch', min: 0.25, max: 4, step: 0.05, fmt: times },
    { key: 'length', label: 'Length', min: 0.25, max: 4, step: 0.05, fmt: times },
    { key: 'brightness', label: 'Brightness', min: 0.25, max: 4, step: 0.05, fmt: times },
    { key: 'echoMix', label: 'Echo', min: 0, max: 1, step: 0.01, fmt: pct },
    { key: 'gain', label: 'Volume', min: 0, max: 1, step: 0.01, fmt: pct },
  ];
  const sliderInputs = new Map<keyof Tweaks, { range: HTMLInputElement; value: HTMLElement }>();
  for (const def of sliderDefs) {
    const wrap = el('label', 'slider');
    const top = el('div', 'slider-top');
    const valueEl = el('span', 'slider-value');
    top.append(el('span', 'slider-label', def.label), valueEl);
    const range = el('input') as HTMLInputElement;
    range.type = 'range';
    range.min = String(def.min);
    range.max = String(def.max);
    range.step = String(def.step);
    wrap.append(top, range);
    sliderGrid.append(wrap);
    sliderInputs.set(def.key, { range, value: valueEl });
    range.addEventListener('input', () => {
      state.tweaks = { ...state.tweaks, [def.key]: Number(range.value) };
      valueEl.textContent = def.fmt(Number(range.value));
      retweak();
    });
  }

  // ----- signal chain
  const chainCard = el('section', 'card');
  chainCard.append(el('h2', 'card-title', 'Signal chain'));
  const chain = el('div', 'chain');
  chainCard.append(chain);
  shell.append(chainCard);

  // ----- export
  const exportCard = el('section', 'card export-card');
  exportCard.append(el('h2', 'card-title', 'Export WAV'));
  const exportRow = el('div', 'btn-row');
  const rateSel = el('select', 'select') as HTMLSelectElement;
  rateSel.setAttribute('aria-label', 'Sample rate');
  for (const r of [22050, 44100, 48000]) {
    const o = el('option', '', `${r} Hz`) as HTMLOptionElement;
    o.value = String(r);
    if (r === 44100) o.selected = true;
    rateSel.append(o);
  }
  const depthSel = el('select', 'select') as HTMLSelectElement;
  depthSel.setAttribute('aria-label', 'Bit depth');
  for (const d of [16, 24]) {
    const o = el('option', '', `${d}-bit`) as HTMLOptionElement;
    o.value = String(d);
    depthSel.append(o);
  }
  const exportBtn = el('button', 'btn primary', 'Download .wav');
  exportRow.append(rateSel, depthSel, exportBtn);
  exportCard.append(exportRow);
  shell.append(exportCard);

  // ----- footer
  const footer = el('footer', 'footer');
  const repoLink = el('a', '', 'source') as HTMLAnchorElement;
  repoLink.href = 'https://github.com/pisanuw/Claude-capstone/tree/main/sound-sketchpad';
  repoLink.target = '_blank';
  repoLink.rel = 'noopener';
  footer.append(
    document.createTextNode('Every sound is synthesized in your browser from a word-to-DSP recipe book. '),
    repoLink,
  );
  shell.append(footer);

  // ----- behavior
  function regenerate(seedOffset = 0): void {
    stopPlayback();
    const next = recompute(input.value, null, seedOffset);
    state.parsed = next.parsed;
    state.tweaks = next.tweaks;
    state.tweakedSpec = next.tweakedSpec;
    state.samples = next.samples;
    state.seedOffset = seedOffset;
    syncSliders();
    renderExplain();
    drawScope();
    renderChain();
  }

  function retweak(): void {
    stopPlayback();
    state.tweakedSpec = applyTweaks(state.parsed.spec, state.tweaks);
    state.samples = renderSpec(state.tweakedSpec, {
      sampleRate: 44100,
      seed: state.parsed.seed + state.seedOffset,
    });
    drawScope();
    renderChain();
  }

  function syncSliders(): void {
    for (const def of sliderDefs) {
      const s = sliderInputs.get(def.key);
      if (!s) continue;
      s.range.value = String(state.tweaks[def.key]);
      s.value.textContent = def.fmt(state.tweaks[def.key]);
    }
  }

  function renderExplain(): void {
    explain.innerHTML = '';
    const r = state.parsed;
    const line = el('div', 'explain-line');
    if (r.fallback) {
      line.append(
        el('span', 'tag tag-warn', 'no match'),
        el(
          'span',
          '',
          ' No known sound word found, so this is a generic whoosh. Try words like explosion, coin, laser, rain, bell, footsteps, engine…',
        ),
      );
    } else {
      line.append(el('span', 'tag tag-base', r.baseWord ?? r.baseId), el('span', '', ` recognized as the base sound (${r.baseId}).`));
    }
    explain.append(line);
    if (r.modifiers.length > 0) {
      const mods = el('div', 'explain-line');
      mods.append(el('span', '', 'Modifiers: '));
      for (const m of r.modifiers) {
        const t = el('span', 'tag tag-mod', m.word);
        t.title = m.describe;
        mods.append(t, el('span', 'mod-desc', ` ${m.describe}. `));
      }
      explain.append(mods);
    }
    if (r.ignoredBases.length > 0) {
      explain.append(
        el('div', 'explain-line dim', `Also heard "${r.ignoredBases.join('", "')}" but one base sound at a time: first word wins.`),
      );
    }
    explain.append(
      el(
        'div',
        'explain-line dim',
        `Deterministic: these exact words always produce this exact sound (seed ${(r.seed + state.seedOffset) >>> 0}).`,
      ),
    );
  }

  function drawScope(playheadT?: number): void {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.parentElement!.clientWidth || 600;
    canvas.width = w * dpr;
    canvas.height = 160 * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    // The colours are the stylesheet's tokens, read as it draws, so the scope follows the light and dark mode (the
    // light values stand in where no stylesheet is loaded).
    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
    ctx.clearRect(0, 0, w, 160);
    ctx.fillStyle = token('--scope-bg', '#f8fafc');
    ctx.fillRect(0, 0, w, 160);
    ctx.strokeStyle = token('--scope-axis', '#cbd5e1');
    ctx.beginPath();
    ctx.moveTo(0, 80);
    ctx.lineTo(w, 80);
    ctx.stroke();

    const samples = state.samples;
    const step = Math.max(1, Math.floor(samples.length / w));
    ctx.strokeStyle = token('--scope-wave', '#047857');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      let lo = 1;
      let hi = -1;
      const start = x * step;
      for (let i = start; i < Math.min(start + step, samples.length); i++) {
        const s = samples[i];
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
      if (lo > hi) {
        lo = 0;
        hi = 0;
      }
      ctx.moveTo(x + 0.5, 80 - hi * 75);
      ctx.lineTo(x + 0.5, 80 - lo * 75 + 0.5);
    }
    ctx.stroke();

    if (playheadT !== undefined) {
      const x = playheadT * w;
      ctx.strokeStyle = token('--scope-head', '#be185d');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 160);
      ctx.stroke();
    }
  }

  function renderChain(): void {
    chain.innerHTML = '';
    const spec = state.tweakedSpec;
    for (const layer of spec.layers) {
      const row = el('div', 'chain-row');
      row.append(el('span', 'chain-name', layer.name));
      const parts: string[] = [];
      if (layer.source.kind === 'osc') {
        const f = layer.source.freq;
        const freqTxt =
          Math.round(f.start) === Math.round(f.end)
            ? `${Math.round(f.start)} Hz`
            : `${Math.round(f.start)}→${Math.round(f.end)} Hz`;
        parts.push(`${layer.source.shape} osc ${freqTxt}`);
        if (layer.source.vibrato) parts.push(`vibrato ${layer.source.vibrato.rate} Hz`);
      } else {
        parts.push(`${layer.source.color} noise`);
      }
      if (layer.filter) {
        const f = layer.filter.freq;
        const freqTxt =
          Math.round(f.start) === Math.round(f.end)
            ? `${Math.round(f.start)} Hz`
            : `${Math.round(f.start)}→${Math.round(f.end)} Hz`;
        parts.push(`${layer.filter.type} ${freqTxt} (Q ${layer.filter.q})`);
      }
      const e = layer.env;
      parts.push(`ADSR ${ms(e.attack)}/${ms(e.decay)}/${e.sustain.toFixed(2)}/${ms(e.release)}`);
      if (layer.repeat && layer.repeat.times > 1) {
        parts.push(`×${layer.repeat.times} every ${ms(layer.repeat.interval)}`);
      }
      parts.push(`gain ${layer.gain.toFixed(2)}`);
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) row.append(el('span', 'chain-arrow', '→'));
        row.append(el('span', 'chain-node', parts[i]));
      }
      chain.append(row);
    }
    const master = el('div', 'chain-row master');
    master.append(el('span', 'chain-name', 'master'));
    const mparts = [`mix ${spec.layers.length} layer${spec.layers.length === 1 ? '' : 's'}`];
    if (spec.echo) mparts.push(`echo ${ms(spec.echo.time)} fb ${spec.echo.feedback.toFixed(2)} mix ${spec.echo.mix.toFixed(2)}`);
    if (spec.drive > 1) mparts.push(`drive ${spec.drive.toFixed(1)}`);
    if (spec.crushBits > 0) mparts.push(`${spec.crushBits}-bit crush`);
    mparts.push(`normalize → ${Math.round(spec.masterGain * 100)}%`, `${spec.duration.toFixed(2)} s`);
    for (let i = 0; i < mparts.length; i++) {
      if (i > 0) master.append(el('span', 'chain-arrow', '→'));
      master.append(el('span', 'chain-node', mparts[i]));
    }
    chain.append(master);
  }

  function stopPlayback(): void {
    if (playing) {
      try {
        playing.src.stop();
      } catch {
        // already stopped
      }
      playing = null;
    }
    cancelAnimationFrame(animFrame);
    playBtn.textContent = '▶ Play';
    drawScope();
  }

  function play(): void {
    if (playing) {
      stopPlayback();
      return;
    }
    audioCtx ??= new AudioContext();
    void audioCtx.resume();
    const buffer = audioCtx.createBuffer(1, state.samples.length, 44100);
    buffer.copyToChannel(new Float32Array(state.samples), 0);
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(audioCtx.destination);
    src.start();
    playing = { src, startedAt: audioCtx.currentTime, duration: buffer.duration };
    playBtn.textContent = '■ Stop';
    const tick = () => {
      if (!playing || !audioCtx) return;
      const t = (audioCtx.currentTime - playing.startedAt) / playing.duration;
      if (t >= 1) {
        stopPlayback();
        return;
      }
      drawScope(t);
      animFrame = requestAnimationFrame(tick);
    };
    animFrame = requestAnimationFrame(tick);
    src.onended = () => {
      if (playing?.src === src) stopPlayback();
    };
  }

  function exportWav(): void {
    const sampleRate = Number(rateSel.value);
    const bitDepth = Number(depthSel.value) as BitDepth;
    const samples = renderSpec(state.tweakedSpec, {
      sampleRate,
      seed: state.parsed.seed + state.seedOffset,
    });
    const blob = new Blob([encodeWav(samples, sampleRate, bitDepth)], { type: 'audio/wav' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slugify(state.parsed.spec.name)}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  generateBtn.addEventListener('click', () => regenerate());
  variationBtn.addEventListener('click', () => regenerate(state.seedOffset + 1));
  playBtn.addEventListener('click', play);
  exportBtn.addEventListener('click', exportWav);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      regenerate();
    }
  });
  window.addEventListener('resize', () => drawScope());
  // A change of theme (the switch, or the device setting with nothing stored) draws the scope again; while it
  // plays, the next frame does. Print takes the light set, but a canvas keeps what it drew, so draw it again at
  // once on the way into print and back.
  document.addEventListener('hw-themechange', () => {
    if (!playing) drawScope();
  });
  if (typeof window.matchMedia === 'function') window.matchMedia('print').addEventListener?.('change', () => drawScope());

  syncSliders();
  renderExplain();
  drawScope();
  renderChain();
}

function recompute(description: string, tweaks: Tweaks | null, seedOffset: number) {
  const parsed = parseDescription(description);
  const t = tweaks ?? tweaksForSpec(parsed.spec);
  const tweakedSpec = applyTweaks(parsed.spec, t);
  const samples = renderSpec(tweakedSpec, { sampleRate: 44100, seed: parsed.seed + seedOffset });
  return { parsed, tweaks: t, tweakedSpec, samples, seedOffset };
}

function ms(seconds: number): string {
  return seconds >= 1 ? `${seconds.toFixed(2)} s` : `${Math.round(seconds * 1000)} ms`;
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'sound'
  );
}
