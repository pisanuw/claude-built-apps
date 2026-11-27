import { useEffect, useReducer, useState } from 'react';
import PaletteBench, { PRESETS, MAX_COLORS } from './components/PaletteBench.jsx';
import VisionLab from './components/VisionLab.jsx';
import ContrastMatrix from './components/ContrastMatrix.jsx';
import ConfusionPanel from './components/ConfusionPanel.jsx';
import FixPanel from './components/FixPanel.jsx';
import { parseHex, toHex } from './color/color.js';
import { simulateColor } from './color/cvd.js';
import { exportPngReport } from './report/exportPng.js';

let uid = 0;
const nextId = () => `c${++uid}`;
const withIds = (hexes) => hexes.map((hex) => ({ id: nextId(), hex }));

function readHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const p = params.get('p');
  if (!p) return null;
  const hexes = p
    .split('.')
    .map((h) => parseHex(h))
    .filter(Boolean)
    .map(toHex)
    .slice(0, MAX_COLORS);
  if (hexes.length < 2) return null;
  const bg = Math.min(Math.max(parseInt(params.get('bg') ?? '0', 10) || 0, 0), hexes.length - 1);
  const t = Number(params.get('t'));
  return { hexes, bg, target: [3, 4.5, 7].includes(t) ? t : 4.5 };
}

function writeHash(colors, bgIndex, target) {
  const p = colors.map((c) => c.hex.slice(1)).join('.');
  history.replaceState(null, '', `#p=${p}&bg=${bgIndex}&t=${target}`);
}

function init() {
  const fromHash = readHash();
  if (fromHash) {
    return {
      colors: withIds(fromHash.hexes),
      bgIndex: fromHash.bg,
      target: fromHash.target,
      image: null,
    };
  }
  return {
    colors: withIds(PRESETS[0].hexes),
    bgIndex: PRESETS[0].bg,
    target: 4.5,
    image: null,
  };
}

function reducer(state, action) {
  switch (action.type) {
    case 'add':
      if (state.colors.length >= MAX_COLORS) return state;
      return { ...state, colors: [...state.colors, { id: nextId(), hex: action.hex }] };
    case 'edit': {
      const rgb = parseHex(action.hex);
      if (!rgb) return state;
      return {
        ...state,
        colors: state.colors.map((c) => (c.id === action.id ? { ...c, hex: toHex(rgb) } : c)),
      };
    }
    case 'remove': {
      if (state.colors.length <= 2) return state;
      const idx = state.colors.findIndex((c) => c.id === action.id);
      const colors = state.colors.filter((c) => c.id !== action.id);
      let bgIndex = state.bgIndex;
      if (idx === bgIndex) bgIndex = 0;
      else if (idx < bgIndex) bgIndex -= 1;
      return { ...state, colors, bgIndex };
    }
    case 'setBg':
      return { ...state, bgIndex: action.index };
    case 'target':
      return { ...state, target: action.target };
    case 'preset':
      return {
        ...state,
        colors: withIds(action.preset.hexes),
        bgIndex: action.preset.bg,
        image: null,
      };
    case 'loadImage':
      return {
        ...state,
        image: action.image,
        colors: withIds(action.hexes),
        bgIndex: 0,
      };
    case 'clearImage':
      return { ...state, image: null };
    default:
      return state;
  }
}

function VisionUnderline({ colors }) {
  const hexes = colors.map((c) => c.hex);
  const deutan = colors.map((c) => toHex(simulateColor(parseHex(c.hex), 'deuteranopia')));
  return (
    <div className="vision-underline" aria-hidden="true">
      <div className="vision-underline__row">
        <span className="vision-underline__label">your vision</span>
        <span className="vision-underline__strip">
          {hexes.map((h, i) => (
            <span key={i} style={{ background: h }} />
          ))}
        </span>
      </div>
      <div className="vision-underline__row">
        <span className="vision-underline__label">deuteranopia</span>
        <span className="vision-underline__strip">
          {deutan.map((h, i) => (
            <span key={i} style={{ background: h }} />
          ))}
        </span>
      </div>
    </div>
  );
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, init);
  const [copied, setCopied] = useState(false);
  const { colors, bgIndex, target, image } = state;

  useEffect(() => {
    writeHash(colors, bgIndex, target);
  }, [colors, bgIndex, target]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be unavailable (permissions, http); the URL bar still works.
    }
  }

  return (
    <>
      <header className="masthead">
        <div className="wrap">
          <p className="eyebrow">8 vision types · WCAG contrast · OKLab · runs entirely in your browser</p>
          <div className="title-row">
            <h1>Game Palette Inspector</h1>
            <hw-theme-toggle></hw-theme-toggle>
          </div>
          <div className="masthead__top">
            <p className="masthead__tagline">
              Around 1 in 12 male players sees your palette differently. Load your colors or a
              screenshot, see where they collapse, and fix them without losing your art style.
            </p>
            <div className="masthead__actions no-print">
              <button className="btn" onClick={copyLink}>
                {copied ? '✓ Link copied' : 'Copy share link'}
              </button>
              <button className="btn" onClick={() => window.print()}>
                Print / PDF
              </button>
              <button
                className="btn btn--primary"
                onClick={() => exportPngReport({ colors, bgIndex, target })}
              >
                Export PNG report
              </button>
            </div>
          </div>
          <VisionUnderline colors={colors} />
        </div>
      </header>

      <main className="wrap">
        <PaletteBench colors={colors} bgIndex={bgIndex} image={image} dispatch={dispatch} />
        <VisionLab colors={colors} image={image} />
        <ContrastMatrix
          colors={colors}
          bgIndex={bgIndex}
          target={target}
          onTarget={(t) => dispatch({ type: 'target', target: t })}
        />
        <ConfusionPanel colors={colors} />
        <FixPanel colors={colors} bgIndex={bgIndex} target={target} dispatch={dispatch} />
      </main>

      <footer className="footer">
        <div className="wrap">
          <p>
            <strong style={{ color: 'var(--muted)' }}>Method.</strong> Contrast uses WCAG 2.x
            relative luminance. Color vision deficiency is simulated with the physiologically-based
            matrices of Machado, Oliveira &amp; Fernandes (2009), applied in linear sRGB.
            Perceptual distance is Euclidean in OKLab (Ottosson 2020), where black to white is 1.00.
            Simulations are good approximations, not ground truth; individual perception varies.
          </p>
          <p>
            This interface takes its own advice: the accent is a protan/deutan-safe cyan, and no
            pass/fail state is communicated by color alone. Everything runs locally: no uploads,
            no accounts, and no cookies (visits are counted anonymously).
          </p>
        </div>
      </footer>
    </>
  );
}
