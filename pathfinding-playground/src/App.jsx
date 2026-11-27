import { useEffect, useMemo, useRef, useState } from 'react';
import {
  makeGrid, cloneGrid, idx, EMPTY, WALL, MUD_COST,
} from './engine/grid.js';
import { runAlgorithm, ALGORITHMS } from './engine/algorithms.js';
import { narrate, compareVerdict } from './engine/narrate.js';
import { encodeState, decodeState } from './engine/share.js';
import { recursiveDivision, scatterMud, clearMap, mulberry32 } from './engine/maze.js';
import { buildRenderState, liveStats } from './engine/playback.js';
import GridCanvas from './ui/GridCanvas.jsx';
import LogPanel from './ui/LogPanel.jsx';

const SIZES = [
  { label: 'Small · 22×14', cols: 22, rows: 14 },
  { label: 'Medium · 34×21', cols: 34, rows: 21 },
  { label: 'Large · 46×27', cols: 46, rows: 27 },
];

const REPO_URL = 'https://github.com/pisanuw/pathfinding-playground';
const IDEA_URL = 'https://daily-project-ideas.netlify.app/';

function initFromHashOrDefault() {
  const h = window.location.hash.slice(1);
  if (h) {
    const d = decodeState(h);
    if (d) return d;
  }
  const grid = makeGrid(34, 21);
  recursiveDivision(grid, mulberry32(11));
  scatterMud(grid, 0.1, mulberry32(77));
  return { grid, algoA: 'astar', algoB: 'dijkstra', compare: false };
}

function StatsBar({ state, algoKey }) {
  const s = liveStats(state);
  const A = ALGORITHMS[algoKey];
  if (!s) {
    return (
      <div className="stats">
        <span className="stats__algo">{A.short}</span>
        <span className="stats__hint">frontier ordered by {A.orderedBy}</span>
      </div>
    );
  }
  return (
    <div className="stats">
      <span className="stats__algo">{A.short}</span>
      <span>expanded {s.expanded}</span>
      {s.finished ? (
        s.found ? (
          <>
            <span>peak frontier {s.peak}</span>
            <span>path {s.steps} steps</span>
            <span>cost {s.cost}</span>
            <span className={`badge ${A.guarantee ? 'badge--good' : 'badge--warn'}`}>
              {A.guarantee ? A.guarantee : 'no guarantee'}
            </span>
          </>
        ) : (
          <span className="badge badge--warn">no route</span>
        )
      ) : (
        <span>frontier {s.frontier}</span>
      )}
    </div>
  );
}

export default function App() {
  const initial = useMemo(initFromHashOrDefault, []);
  const [grid, setGrid] = useState(initial.grid);
  const [algoA, setAlgoA] = useState(initial.algoA);
  const [algoB, setAlgoB] = useState(initial.algoB);
  const [compare, setCompare] = useState(initial.compare);
  const [tool, setTool] = useState('wall');
  const [traces, setTraces] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(18);
  const [showCosts, setShowCosts] = useState(false);
  const [toast, setToast] = useState(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const maxLen = useMemo(
    () => (traces ? Math.max(traces.a.length, traces.b ? traces.b.length : 0) : 0),
    [traces],
  );

  // Playback loop: advance the playhead by `speed` expansions per second.
  useEffect(() => {
    if (!playing || !traces) return undefined;
    let raf;
    let last = performance.now();
    let acc = 0;
    const tick = (t) => {
      acc += ((t - last) / 1000) * speedRef.current;
      last = t;
      const n = Math.floor(acc);
      if (n > 0) {
        acc -= n;
        setCursor((c) => Math.min(maxLen, c + n));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, traces, maxLen]);

  useEffect(() => {
    if (playing && cursor >= maxLen) setPlaying(false);
  }, [cursor, maxLen, playing]);

  const linesA = useMemo(() => (traces ? traces.a.map(narrate) : []), [traces]);
  const linesB = useMemo(() => (traces?.b ? traces.b.map(narrate) : []), [traces]);
  const viewA = useMemo(
    () => (traces ? buildRenderState(grid, traces.a, cursor) : null),
    [traces, cursor, grid],
  );
  const viewB = useMemo(
    () => (traces?.b ? buildRenderState(grid, traces.b, cursor) : null),
    [traces, cursor, grid],
  );

  const verdict = useMemo(() => {
    if (!compare || !viewA?.done || !viewB?.done) return '';
    return compareVerdict(viewA.done, viewB.done);
  }, [compare, viewA, viewB]);

  const invalidate = () => {
    setTraces(null);
    setCursor(0);
    setPlaying(false);
  };

  const mutateGrid = (fn) => {
    setGrid((g) => {
      const ng = cloneGrid(g);
      fn(ng);
      return ng;
    });
    invalidate();
  };

  const onSetCell = (r, c, v) => mutateGrid((g) => { g.cells[idx(g, r, c)] = v; });
  const onSetStart = (r, c) => mutateGrid((g) => {
    g.start = { r, c };
    if (g.cells[idx(g, r, c)] === WALL) g.cells[idx(g, r, c)] = EMPTY;
  });
  const onSetGoal = (r, c) => mutateGrid((g) => {
    g.goal = { r, c };
    if (g.cells[idx(g, r, c)] === WALL) g.cells[idx(g, r, c)] = EMPTY;
  });

  const run = () => {
    const a = runAlgorithm(algoA, grid);
    const b = compare ? runAlgorithm(algoB, grid) : null;
    setTraces({ a, b });
    setCursor(0);
    setPlaying(true);
  };

  const primaryAction = () => {
    if (!traces) return run();
    if (playing) return setPlaying(false);
    if (cursor < maxLen) return setPlaying(true);
    return run();
  };

  const primaryLabel = !traces
    ? 'Run search'
    : playing
      ? 'Pause'
      : cursor < maxLen
        ? 'Resume'
        : 'Run again';

  const step = (d) => {
    setPlaying(false);
    setCursor((c) => Math.max(0, Math.min(maxLen, c + d)));
  };

  const setSize = (i) => {
    const s = SIZES[i];
    const g = makeGrid(s.cols, s.rows);
    setGrid(g);
    invalidate();
  };

  const sizeIndex = SIZES.findIndex((s) => s.cols === grid.cols && s.rows === grid.rows);

  const showToast = (msg) => {
    setToast(msg);
    window.clearTimeout(showToast.t);
    showToast.t = window.setTimeout(() => setToast(null), 3200);
  };

  const share = async () => {
    const payload = encodeState({ grid, algoA, algoB, compare });
    const url = `${window.location.origin}${window.location.pathname}#${payload}`;
    window.history.replaceState(null, '', `#${payload}`);
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied. Anyone who opens it gets this exact map and setup.');
    } catch {
      showToast('Link placed in the address bar; copy it from there.');
    }
  };

  const seed = () => (Math.random() * 2 ** 31) >>> 0;

  return (
    <div className="app">
      <header className="masthead">
        <div className="title-row">
          <h1 className="masthead__title">Pathfinding Playground</h1>
          <hw-theme-toggle></hw-theme-toggle>
        </div>
        <p className="masthead__sub">
          Draw a map. Watch five search algorithms think, one expansion at a time.
        </p>
        <div className="masthead__actions">
          <button type="button" className="btn" onClick={share}>Copy share link</button>
          <a className="btn btn--ghost" href={REPO_URL} target="_blank" rel="noreferrer">Source</a>
        </div>
      </header>

      <div className="deck">
        <aside className="rail" aria-label="Controls">
          <div className="rail__group">
            <h2 className="eyebrow">Map</h2>
            <div className="seg" role="group" aria-label="Drawing tool">
              {[['wall', 'Walls'], ['mud', `Mud ·${MUD_COST}`], ['erase', 'Erase']].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className="seg__btn"
                  aria-pressed={tool === k}
                  onClick={() => setTool(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="rail__hint">
              Or by keyboard: on the map, the arrows move a cursor, Space draws, and S and G place the start and goal.
            </p>
            <div className="row">
              <button type="button" className="btn btn--small" onClick={() => mutateGrid((g) => recursiveDivision(g, mulberry32(seed())))}>Maze</button>
              <button type="button" className="btn btn--small" onClick={() => mutateGrid((g) => scatterMud(g, 0.12, mulberry32(seed())))}>Sprinkle mud</button>
              <button type="button" className="btn btn--small" onClick={() => mutateGrid((g) => clearMap(g))}>Clear</button>
            </div>
            <label className="field">
              <span className="field__label">Grid size (resets map)</span>
              <select
                value={sizeIndex === -1 ? '' : sizeIndex}
                onChange={(e) => setSize(Number(e.target.value))}
              >
                {sizeIndex === -1 && <option value="">Custom · {grid.cols}×{grid.rows}</option>}
                {SIZES.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
              </select>
            </label>
          </div>

          <div className="rail__group">
            <h2 className="eyebrow">Search</h2>
            <label className="field">
              <span className="field__label">Algorithm</span>
              <select value={algoA} onChange={(e) => { setAlgoA(e.target.value); invalidate(); }}>
                {Object.values(ALGORITHMS).map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={compare}
                onChange={(e) => { setCompare(e.target.checked); invalidate(); }}
              />
              <span>Compare side by side</span>
            </label>
            {compare && (
              <label className="field">
                <span className="field__label">Versus</span>
                <select value={algoB} onChange={(e) => { setAlgoB(e.target.value); invalidate(); }}>
                  {Object.values(ALGORITHMS).map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
                </select>
              </label>
            )}
          </div>

          <div className="rail__group">
            <h2 className="eyebrow">Run</h2>
            <button type="button" className="btn btn--primary" onClick={primaryAction}>{primaryLabel}</button>
            <div className="row">
              <button type="button" className="btn btn--small" disabled={!traces} onClick={() => { setCursor(0); setPlaying(true); }}>Replay</button>
              <button type="button" className="btn btn--small" disabled={!traces} onClick={() => step(-1)}>− step</button>
              <button type="button" className="btn btn--small" disabled={!traces} onClick={() => step(1)}>+ step</button>
              <button type="button" className="btn btn--small" disabled={!traces} onClick={() => { setPlaying(false); setCursor(maxLen); }}>End</button>
            </div>
            <label className="field">
              <span className="field__label">Speed · {speed} expansions/s</span>
              <input type="range" min="2" max="60" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
            </label>
            <label className="field">
              <span className="field__label">Playhead · {cursor}/{maxLen || '–'}</span>
              <input
                type="range"
                min="0"
                max={Math.max(1, maxLen)}
                value={cursor}
                disabled={!traces}
                onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={showCosts} onChange={(e) => setShowCosts(e.target.checked)} />
              <span>Show cell costs (f, else g)</span>
            </label>
          </div>

          <div className="rail__group rail__group--legend">
            <h2 className="eyebrow">Legend</h2>
            <ul className="legend">
              <li><i className="swatch swatch--start" /> start (drag it)</li>
              <li><i className="swatch swatch--goal" /> goal (drag it)</li>
              <li><i className="swatch swatch--wall" /> wall</li>
              <li><i className="swatch swatch--mud" /> mud, costs {MUD_COST} to enter</li>
              <li><i className="swatch swatch--frontier" /> frontier</li>
              <li><i className="swatch swatch--visited" /> visited</li>
              <li><i className="swatch swatch--path" /> final path</li>
            </ul>
          </div>
        </aside>

        <main className="stage">
          <div className={compare ? 'panels panels--compare' : 'panels'}>
            <div className="panel">
              <GridCanvas
                grid={grid}
                view={viewA}
                tool={tool}
                showCosts={showCosts}
                onSetCell={onSetCell}
                onSetStart={onSetStart}
                onSetGoal={onSetGoal}
                label={compare ? ALGORITHMS[algoA].name : null}
              />
              <StatsBar state={viewA} algoKey={algoA} />
              {compare && <LogPanel title={ALGORITHMS[algoA].short} lines={linesA} cursor={Math.min(cursor, linesA.length)} compact />}
            </div>
            {compare && (
              <div className="panel">
                <GridCanvas
                  grid={grid}
                  view={viewB}
                  tool={tool}
                  showCosts={showCosts}
                  onSetCell={onSetCell}
                  onSetStart={onSetStart}
                  onSetGoal={onSetGoal}
                  label={ALGORITHMS[algoB].name}
                />
                <StatsBar state={viewB} algoKey={algoB} />
                <LogPanel title={ALGORITHMS[algoB].short} lines={linesB} cursor={Math.min(cursor, linesB.length)} compact />
              </div>
            )}
          </div>

          {verdict && <p className="verdict" role="status">{verdict}</p>}

          {!compare && (
            <LogPanel title={`${ALGORITHMS[algoA].name} · agent log`} lines={linesA} cursor={Math.min(cursor, linesA.length)} />
          )}

          <details className="guide">
            <summary>Field guide: how to read the numbers</summary>
            <div className="guide__body">
              <p>
                <strong>g</strong> is the cost paid so far from the start. <strong>h</strong> is the
                Manhattan-distance guess of what is left. <strong>f = g + h</strong> is the total
                estimate A* sorts by. Plain cells cost 1 to enter, mud costs {MUD_COST}, walls are
                impassable. The heuristic never overestimates here, which is why A* keeps
                Dijkstra&apos;s optimality while usually doing less work.
              </p>
              <table className="guide__table">
                <thead>
                  <tr><th>Algorithm</th><th>Frontier order</th><th>Guarantee</th></tr>
                </thead>
                <tbody>
                  {Object.values(ALGORITHMS).map((a) => (
                    <tr key={a.key}>
                      <td>{a.name}</td>
                      <td>{a.orderedBy}</td>
                      <td>{a.guarantee ?? 'none'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                Classic demo: sprinkle mud, then compare BFS against Dijkstra. BFS marches straight
                through (fewest steps) while Dijkstra detours around the expensive terrain (lowest
                cost). Then swap Dijkstra for A* and watch the visited wash shrink.
              </p>
            </div>
          </details>
        </main>
      </div>

      <footer className="foot">
        <p className="foot__credit">
          Weekend idea 2026-07-26 from <a href={IDEA_URL} target="_blank" rel="noreferrer">Daily Project Ideas</a>.
          Narration is rule-based and computed in your browser.
        </p>
        <div className="stamp" aria-hidden="true">
          <span>PATHFINDING PLAYGROUND</span>
          <span>SHEET 01 · SCALE: 1 CELL = 1 STEP</span>
          <span>DRAWN 2026 · MIT LICENSE</span>
        </div>
      </footer>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
