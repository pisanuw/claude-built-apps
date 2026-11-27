// The light and dark mode switch (platform/src/theme), defined before the header is drawn.
import './lib/hw-theme.js';
// The stylesheet as a file, so Vite links it in the head after the theme snippet: the first paint already has
// the stored theme. Added by the script (?inline) it came after a first paint in the device's colours.
import './ui/styles.css';
import { column, icByPeriod, kasiski, letterFrequencies, symbolFrequencies, topNgrams, ENGLISH_BIGRAMS } from './core/analysis.js';
import {
  CIPHER_LABEL,
  CIPHER_ORDER,
  emptyStudentKey,
  homophonicSymbols,
  keywordOrder,
  onlyLettersOrQuery,
  partialDecrypt,
  type CipherType,
  type StudentKey,
} from './core/ciphers.js';
import { escapeHtml } from './core/html.js';
import {
  DEFAULT_LADDER,
  MAX_HINTS,
  decodeLadder,
  encodeLadder,
  isSolved,
  ladderId,
  materialize,
  nextHint,
  normalizeLadder,
  solution,
  type LadderDef,
  type Rung,
  type RungDef,
} from './core/ladder.js';
import {
  currentRung,
  dashboardRows,
  formatDuration,
  markSolved,
  newProgress,
  noteTool,
  parseProgress,
  rungSummary,
  secondsOnRung,
  type Progress,
  type ToolName,
} from './core/progress.js';
import { accuracy, solve, type SolverResult } from './core/solvers.js';
import { ALPHABET, AFFINE_MULTIPLIERS, ENGLISH_IC, group5, indexOfCoincidence } from './core/text.js';
import { barChart } from './ui/charts.js';

const app = document.getElementById('app');
if (!app) throw new Error('missing #app');

// ------------------------------------------------------------------ state

type View = 'climb' | 'build' | 'dashboard';

const ladder: LadderDef = decodeLadder(location.hash) ?? DEFAULT_LADDER;
const lid = ladderId(ladder);
const STORAGE_KEY = `cipher-ladder:progress:${lid}`;
const NAME_KEY = 'cipher-ladder:student';

let progress = loadProgress();
let view: View = 'climb';
let current = Math.min(currentRung(progress), ladder.rungs.length - 1);
let rung: Rung = materialize(ladder, current);
let key: StudentKey = progress.rungs[current].key ?? emptyStudentKey(rung.def.cipher);
let tool: ToolName = 'frequency';
/** Chosen period for the per-column frequency view (Vigenere helper). */
let period = 1;
let columnIndex = 0;
let hintLog: string[] = [];
let debrief: SolverResult | null = null;
let statusMsg = '';
let statusKind: 'good' | 'bad' | '' = '';
const builder: LadderDef = structuredClone(ladder);
let dashboardRecords: Progress[] = [];
let dashboardError = '';

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = parseProgress(JSON.parse(raw));
      if (p && p.rungs.length === ladder.rungs.length) return p;
    }
  } catch {
    // Corrupt or unavailable storage: start fresh.
  }
  let student = '';
  try {
    student = localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    // ignore
  }
  return newProgress(lid, ladder.title, ladder.rungs.length, student);
}

function save(): void {
  progress.rungs[current].key = key;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    localStorage.setItem(NAME_KEY, progress.student);
  } catch {
    // Storage may be blocked; the page still works for the session.
  }
}

function selectRung(i: number): void {
  if (progress.rungs[i].status === 'locked') return;
  save();
  current = i;
  rung = materialize(ladder, i);
  key = progress.rungs[i].key ?? emptyStudentKey(rung.def.cipher);
  if (key.type !== rung.def.cipher) key = emptyStudentKey(rung.def.cipher);
  tool = rung.def.cipher === 'homophonic' ? 'symbols' : 'frequency';
  period = 1;
  columnIndex = 0;
  hintLog = [];
  debrief = null;
  statusMsg = '';
  statusKind = '';
  render();
}

// ----------------------------------------------------------------- render

function render(): void {
  const views: { id: View; label: string }[] = [
    { id: 'climb', label: 'Climb' },
    { id: 'build', label: 'Build a ladder' },
    { id: 'dashboard', label: 'Instructor dashboard' },
  ];
  app!.innerHTML = `
    <div class="wrap">
      <header class="site">
        <div class="title-row"><h1>Cipher Ladder</h1><hw-theme-toggle></hw-theme-toggle></div>
        <p class="tagline">Break six classical ciphers, one rung at a time, then see how a solver did it.</p>
      </header>
      <nav class="views" aria-label="Views">
        ${views.map((v) => `<button data-view="${v.id}" ${view === v.id ? 'aria-current="page"' : ''}>${v.label}</button>`).join('')}
      </nav>
      <main id="main">${view === 'climb' ? climbHtml() : view === 'build' ? buildHtml() : dashboardHtml()}</main>
      <p class="sr-only" aria-live="polite" id="live"></p>
      <footer>
        Everything runs in this tab: keys, plaintexts and the solver's attempt are computed locally and progress lives in your browser's storage.
        Passages are public domain. Built from idea 2026-09-25 #2 of
        <a href="https://github.com/pisanuw/daily-project-ideas">daily-project-ideas</a>;
        source in <a href="https://github.com/pisanuw/Claude-capstone/tree/main/cipher-ladder">Claude-capstone</a>.
      </footer>
    </div>`;
  wire();
}

// ------------------------------------------------------------- climb view

function climbHtml(): string {
  const rp = progress.rungs[current];
  const solved = rp.status === 'solved';
  const decrypted = partialDecrypt(rung.ciphertext, key);
  const hintsLeft = rung.def.hints - rp.hintsUsed;
  return `
    <section class="panel">
      <div class="controls" style="justify-content: space-between">
        <h2 style="margin:0">${escapeHtml(ladder.title)}</h2>
        <label>Your name (for the exported progress)
          <input id="student" value="${escapeHtml(progress.student)}" placeholder="optional" />
        </label>
      </div>
      <div class="rungs" role="list" aria-label="Rungs">
        ${ladder.rungs
          .map((r, i) => {
            const st = progress.rungs[i].status;
            const t = r.title ?? CIPHER_LABEL[r.cipher];
            return `<button class="rung ${st}" role="listitem" data-rung="${i}" ${st === 'locked' ? 'disabled' : ''} ${i === current ? 'aria-current="true"' : ''} aria-label="Rung ${i + 1}, ${escapeHtml(t)}, ${st}">
              <span class="num">Rung ${i + 1} ${st === 'solved' ? '&#10003;' : st === 'locked' ? '&#128274;' : ''}</span><span>${escapeHtml(t)}</span></button>`;
          })
          .join('')}
      </div>
      <div class="controls">
        <button id="export" class="small">Download my progress (JSON)</button>
        <button id="reset" class="small">Reset this ladder</button>
        ${location.hash ? '' : '<span class="muted">This is the built-in ladder; instructors can build their own under "Build a ladder".</span>'}
      </div>
    </section>

    <section class="panel" aria-labelledby="rung-title">
      <h2 id="rung-title">${escapeHtml(rung.title)} <span class="pill">${escapeHtml(CIPHER_LABEL[rung.def.cipher])}</span> ${solved ? '<span class="pill good">solved</span>' : ''}</h2>
      ${rung.def.note ? `<p class="note">${escapeHtml(rung.def.note)}</p>` : ''}
      <div class="grid2">
        <div>
          <h3>Ciphertext <span class="muted">(${rung.def.cipher === 'homophonic' ? `${homophonicSymbols(rung.ciphertext).length} symbols` : `${rung.plainLetters.length} letters`})</span></h3>
          <div class="cipher mono" id="ciphertext">${escapeHtml(rung.ciphertext)}</div>
        </div>
        <div>
          <h3>Your decryption</h3>
          <div class="cipher plain mono" aria-live="off">${solved ? escapeHtml(rung.plaintext) : renderDecrypted(decrypted)}</div>
        </div>
      </div>
      ${solved ? '' : keyPanelHtml()}
      <div class="controls">
        ${solved ? `<button id="next" class="primary" ${current + 1 < ladder.rungs.length ? '' : 'disabled'}>Next rung</button>` : '<button id="check" class="primary">Check my solution</button>'}
        ${solved ? '' : `<button id="hint" ${hintsLeft > 0 ? '' : 'disabled'}>Hint (${Math.max(0, hintsLeft)} of ${rung.def.hints} left)</button>`}
        <button id="clear" class="small" ${solved ? 'disabled' : ''}>Clear key</button>
        <span class="muted">Time on rung: ${formatDuration(secondsOnRung(rp))} &middot; hints ${rp.hintsUsed} &middot; failed checks ${rp.attempts}</span>
      </div>
      <p class="status ${statusKind}" role="status">${escapeHtml(statusMsg)}</p>
      ${hintLog.length ? `<ul class="hints">${hintLog.map((h) => `<li>${escapeHtml(h)}</li>`).join('')}</ul>` : ''}
    </section>

    ${solved ? solvedHtml() : ''}

    <section class="panel" aria-labelledby="tools-title">
      <h2 id="tools-title">Analysis workbench</h2>
      <div class="tabs" role="tablist">
        ${toolTabs()
          .map((t) => `<button role="tab" data-tool="${t.id}" aria-selected="${tool === t.id}">${t.label}</button>`)
          .join('')}
      </div>
      <div role="tabpanel">${toolHtml()}</div>
    </section>`;
}

function renderDecrypted(letters: string): string {
  const grouped = rung.def.cipher === 'homophonic' ? letters.replace(/(.{5})/g, '$1 ') : group5(letters);
  return escapeHtml(grouped).replace(/_/g, '<span class="u">_</span>');
}

function toolTabs(): { id: ToolName; label: string }[] {
  const tabs: { id: ToolName; label: string }[] = [];
  if (rung.def.cipher === 'homophonic') tabs.push({ id: 'symbols', label: 'Symbol frequencies' });
  else {
    tabs.push({ id: 'frequency', label: 'Letter frequencies' });
    tabs.push({ id: 'bigrams', label: 'Bigrams and trigrams' });
    tabs.push({ id: 'period', label: 'Period: IC and Kasiski' });
  }
  tabs.push({ id: 'notes', label: 'Notes' });
  return tabs;
}

function keyPanelHtml(): string {
  switch (key.type) {
    case 'caesar':
      return `<div class="controls"><label>Shift (ciphertext = plaintext + shift)
        <input id="shift" type="range" min="0" max="25" value="${key.shift ?? 0}" aria-valuetext="shift ${key.shift ?? 'not set'}" /></label>
        <label>Shift value<input id="shift-num" type="number" min="0" max="25" value="${key.shift ?? ''}" style="width:80px" /></label>
        <span class="muted">Ciphertext A stands for plaintext ${key.shift === null ? '?' : ALPHABET[(26 - key.shift) % 26]}.</span></div>`;
    case 'affine':
      return `<div class="controls"><label>a (multiplier, must be coprime with 26)
        <select id="affine-a"><option value="">?</option>${AFFINE_MULTIPLIERS.map((m) => `<option value="${m}" ${key.type === 'affine' && key.a === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        <label>b (shift, 0 to 25)<input id="affine-b" type="number" min="0" max="25" value="${key.b ?? ''}" style="width:80px" /></label>
        <span class="muted">cipher = a &times; plain + b (mod 26), with A = 0.</span></div>`;
    case 'substitution': {
      const freq = letterFrequencies(rung.ciphertext);
      const used = new Map<string, number>();
      for (const v of Object.values(key.map)) used.set(v, (used.get(v) ?? 0) + 1);
      return `<h3>Substitution board <span class="muted">(type the plaintext letter under each ciphertext letter; the count is how often it appears)</span></h3>
        <div class="board" role="group" aria-label="Substitution board">${freq
          .map((r) => {
            const v = key.type === 'substitution' ? (key.map[r.letter] ?? '') : '';
            const dup = v && (used.get(v) ?? 0) > 1;
            return `<div class="cell ${dup ? 'dup' : ''}"><span class="c" aria-hidden="true">${r.letter}</span><input data-sub="${r.letter}" maxlength="1" value="${v}" aria-label="ciphertext ${r.letter}, appears ${r.count} times${dup ? ', plaintext letter used twice' : ''}" autocomplete="off" /><span class="n">${r.count}</span></div>`;
          })
          .join('')}</div>`;
    }
    case 'vigenere':
      return `<div class="controls"><label>Keyword (use ? for a letter you do not know yet)
        <input id="keyword" value="${escapeHtml(key.keyword)}" placeholder="e.g. ??M??" autocomplete="off" spellcheck="false" style="text-transform:uppercase" /></label>
        <span class="muted">Set the period on the "Period" tab to see each column's own frequency chart.</span></div>`;
    case 'columnar': {
      const n = key.order.length;
      return `<div class="controls">
        <label>Number of columns<input id="cols" type="number" min="0" max="12" value="${n || ''}" style="width:80px" /></label>
        <label>Or a keyword (fills the order)<input id="col-keyword" placeholder="e.g. ZEBRA" autocomplete="off" spellcheck="false" style="text-transform:uppercase" /></label></div>
        ${n
          ? `<p class="muted">The ciphertext was read out column by column. For each chunk in reading order, enter which column (1 to ${n}) it came from.</p>
        <div class="order" role="group" aria-label="Column read order">${key.order
          .map((v, i) => `<label>chunk ${i + 1}<input data-slot="${i}" type="number" min="1" max="${n}" value="${v === null ? '' : v + 1}" /></label>`)
          .join('')}</div>`
          : ''}`;
    }
    case 'homophonic': {
      const freq = symbolFrequencies(rung.ciphertext);
      return `<h3>Symbol board <span class="muted">(${freq.length} distinct symbols, most common first; several symbols can share a letter)</span></h3>
        <div class="board" role="group" aria-label="Symbol board">${freq
          .map((r) => `<div class="cell"><span class="c" aria-hidden="true">${r.gram}</span><input data-sym="${r.gram}" maxlength="1" value="${key.type === 'homophonic' ? (key.map[r.gram] ?? '') : ''}" aria-label="symbol ${r.gram}, appears ${r.count} times" autocomplete="off" /><span class="n">${r.count}</span></div>`)
          .join('')}</div>`;
    }
  }
}

function toolHtml(): string {
  const text = rung.ciphertext;
  switch (tool) {
    case 'frequency': {
      const showColumn = period > 1;
      const src = showColumn ? column(text, period, columnIndex) : text;
      const rows = letterFrequencies(src).map((r) => ({ label: r.letter, value: r.pct, baseline: r.english }));
      const picker =
        rung.def.cipher === 'vigenere'
          ? `<div class="controls"><label>Period<input id="period" type="number" min="1" max="12" value="${period}" style="width:70px" /></label>
             ${showColumn ? `<label>Column<select id="column">${Array.from({ length: period }, (_, i) => `<option value="${i}" ${i === columnIndex ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
             <span class="muted">Column ${columnIndex + 1} of ${period}: every ${period}th letter starting at position ${columnIndex + 1} (${src.length} letters, IC ${indexOfCoincidence(src).toFixed(3)}).</span>` : '<span class="muted">Set the period to at least 2 to chart one column at a time.</span>'}</div>`
          : '';
      return `${picker}${barChart(rows, {
        title: showColumn ? `Letter frequencies of column ${columnIndex + 1}` : 'Letter frequencies of the ciphertext',
        description: 'Purple bars are the ciphertext, grey bars the English baseline. In a shift cipher the whole English silhouette slides sideways.',
        valueLabel: 'Ciphertext %',
        baselineLabel: 'English %',
      })}<p class="muted">Index of coincidence ${indexOfCoincidence(src).toFixed(3)} (English ${ENGLISH_IC}, random 0.038). Chart values are percentages.</p>`;
    }
    case 'bigrams': {
      const bi = topNgrams(text, 2, 12);
      const tri = topNgrams(text, 3, 10);
      return `<div class="grid2"><div><h3>Most common bigrams</h3><table><thead><tr><th>Ciphertext</th><th class="num">Count</th><th>English rank</th></tr></thead><tbody>${bi
        .map((r, i) => `<tr><td class="mono">${r.gram}</td><td class="num">${r.count}</td><td class="mono">${ENGLISH_BIGRAMS[i]}</td></tr>`)
        .join('')}</tbody></table></div>
        <div><h3>Most common trigrams</h3><table><thead><tr><th>Ciphertext</th><th class="num">Count</th></tr></thead><tbody>${tri
          .map((r) => `<tr><td class="mono">${r.gram}</td><td class="num">${r.count}</td></tr>`)
          .join('')}</tbody></table><p class="muted">In English the top trigrams are THE, AND, ING, ENT, ION. A repeated ciphertext trigram in a substitution cipher is very often THE.</p></div></div>`;
    }
    case 'period': {
      const ic = icByPeriod(text, 12);
      const k = kasiski(text, 3, 12);
      // Highlight the smallest period that looks English, as the solver does;
      // its multiples score just as well but are not the key length.
      const bestPeriod = (ic.find((r) => r.period > 1 && r.ic >= ENGLISH_IC - 0.008) ?? ic.slice(1).sort((a, b) => b.ic - a.ic)[0])?.period;
      return `<h3>Index of coincidence by candidate key length</h3>${barChart(
        ic.map((r) => ({ label: String(r.period), value: r.ic, emphasis: r.period === bestPeriod })),
        {
          title: 'Mean index of coincidence of the columns for each period',
          description: 'For a Vigenere cipher the true key length, and its multiples, rise toward the English line; the rest sit near random.',
          valueLabel: 'Mean IC',
          references: [
            { value: ENGLISH_IC, label: 'English 0.067' },
            { value: 1 / 26, label: 'random 0.038' },
          ],
          digits: 3,
          max: 0.09,
        },
      )}
      <h3>Kasiski examination</h3>
      ${
        k.repeats.length === 0
          ? '<p class="muted">No repeated trigram in this ciphertext.</p>'
          : `<div class="grid2"><div><table><thead><tr><th>Repeated trigram</th><th>Positions</th><th>Distances</th></tr></thead><tbody>${k.repeats
              .slice(0, 10)
              .map((r) => `<tr><td class="mono">${r.gram}</td><td>${r.positions.join(', ')}</td><td>${r.distances.join(', ')}</td></tr>`)
              .join('')}</tbody></table></div>
            <div><table><thead><tr><th class="num">Period</th><th class="num">Distances it divides</th></tr></thead><tbody>${k.factorCounts
              .map((f) => `<tr><td class="num">${f.period}</td><td class="num">${f.count}</td></tr>`)
              .join('')}</tbody></table><p class="muted">The key length usually divides most of the distances; so do its factors, so prefer the largest period with a high count.</p></div></div>`
      }`;
    }
    case 'symbols': {
      const rows = symbolFrequencies(text);
      const n = homophonicSymbols(text).length;
      return `${barChart(
        rows.slice(0, 45).map((r) => ({ label: r.gram, value: (100 * r.count) / n })),
        {
          title: 'Symbol frequencies of the ciphertext',
          description: 'Homophonic ciphers spread the common letters over several symbols, so the histogram is much flatter than English letter frequencies.',
          valueLabel: 'Percent',
        },
      )}<p class="muted">${rows.length} distinct symbols over ${n} positions. Compare with English: E alone is 12.7% of letters. A symbol near 1 to 3% could be one of E's homophones or a whole rare letter; context has to decide.</p>
      <h3>Symbol pairs that repeat</h3><p class="muted">Pairs of consecutive symbols that occur more than once; in English the pairs are usually TH, HE, IN, ER, AN.</p>
      <table><thead><tr><th>Pair</th><th class="num">Count</th></tr></thead><tbody>${symbolPairs(text)
        .slice(0, 12)
        .map((r) => `<tr><td class="mono">${r.gram}</td><td class="num">${r.count}</td></tr>`)
        .join('')}</tbody></table>`;
    }
    case 'notes':
      return `<label class="wide">Scratchpad for this rung (saved in your browser)<textarea id="notes">${escapeHtml(progress.rungs[current].notes ?? '')}</textarea></label>`;
  }
}

function symbolPairs(cipher: string): { gram: string; count: number }[] {
  const syms = homophonicSymbols(cipher);
  const counts = new Map<string, number>();
  for (let i = 0; i + 1 < syms.length; i++) {
    const g = `${syms[i]} ${syms[i + 1]}`;
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c > 1)
    .map(([gram, count]) => ({ gram, count }))
    .sort((a, b) => b.count - a.count || (a.gram < b.gram ? -1 : 1));
}

function solvedHtml(): string {
  const rp = progress.rungs[current];
  const sol = solution(rung);
  let debriefHtml: string;
  if (!debrief) {
    debriefHtml = '<p class="muted" id="debrief-wait">Running the solver on this ciphertext...</p>';
  } else {
    const acc = accuracy(debrief.plaintext, rung.plainLetters);
    const wrong: string[] = [];
    for (let i = 0; i < rung.plainLetters.length && wrong.length < 12; i++) {
      if (debrief.plaintext[i] !== rung.plainLetters[i]) wrong.push(`${rung.plainLetters[i]} read as ${debrief.plaintext[i]} at position ${i + 1}`);
    }
    debriefHtml = `
      <ol class="steps">${debrief.steps.map((s) => `<li><b>${escapeHtml(s.title)}</b>${escapeHtml(s.detail)}</li>`).join('')}</ol>
      <p><b>Outcome:</b> ${acc === 1 ? 'the solver recovered the plaintext exactly.' : `the solver got ${(acc * 100).toFixed(1)}% of the letters right.`}
        Its own confidence was ${(debrief.confidence * 100).toFixed(0)}%${acc < 1 && debrief.confidence > 0.8 ? ', so it was more confident than it should have been' : ''}.
        ${acc < 1 ? `Where it went wrong: ${escapeHtml(wrong.join('; '))}${wrong.length === 12 ? '; and more' : ''}.` : ''}</p>
      <p class="muted">Solver's reading: <span class="mono">${escapeHtml(debrief.plaintext.slice(0, 120))}${debrief.plaintext.length > 120 ? '...' : ''}</span></p>`;
  }
  return `<section class="panel" aria-labelledby="debrief-title">
    <h2 id="debrief-title">Debrief</h2>
    <div class="grid2">
      <div>
        <h3>Your path</h3>
        <p>Solved in ${formatDuration(secondsOnRung(rp))} with ${rp.hintsUsed} hint${rp.hintsUsed === 1 ? '' : 's'} and ${rp.attempts} failed check${rp.attempts === 1 ? '' : 's'}.
        Tools opened: ${rp.toolsUsed.length ? escapeHtml(rp.toolsUsed.join(', ')) : 'none'}.</p>
        <p><b>Key:</b> <span class="mono">${escapeHtml(sol.text)}</span></p>
        <p><b>Plaintext source:</b> ${escapeHtml(rung.source)}</p>
      </div>
      <div>
        <h3>The solver's path</h3>
        <p class="muted">A deterministic program attacked the same ciphertext with the same tools you had. Read it critically: it is only as good as its statistics.</p>
      </div>
    </div>
    ${debriefHtml}
  </section>`;
}

// ------------------------------------------------------------- build view

function buildHtml(): string {
  const keyHint: Record<CipherType, string> = {
    caesar: 'shift 1-25, or blank for random',
    affine: 'a,b such as 5,8, or blank',
    substitution: '26-letter cipher alphabet, or blank',
    vigenere: 'keyword, or blank',
    columnar: 'keyword, or blank',
    homophonic: 'always generated from the seed',
  };
  return `<section class="panel builder">
    <h2>Build a ladder</h2>
    <p class="muted">Pick the rungs, keys, texts and hint budgets. The link encodes the whole ladder, so nothing is stored anywhere; the seed makes generated keys and passages reproducible. Leave a plaintext blank to use a bundled public-domain passage.</p>
    <div class="row">
      <label>Ladder title<input id="b-title" value="${escapeHtml(builder.title)}" /></label>
      <label>Seed<input id="b-seed" value="${escapeHtml(builder.seed)}" /></label>
    </div>
    ${builder.rungs
      .map(
        (r, i) => `<div class="rungdef">
      <div class="row">
        <label>Rung ${i + 1} cipher<select data-b="cipher" data-i="${i}">${CIPHER_ORDER.map((c) => `<option value="${c}" ${c === r.cipher ? 'selected' : ''}>${CIPHER_LABEL[c]}</option>`).join('')}</select></label>
        <label>Title (optional)<input data-b="title" data-i="${i}" value="${escapeHtml(r.title ?? '')}" /></label>
        <label>Key (${keyHint[r.cipher]})<input data-b="key" data-i="${i}" value="${escapeHtml(r.key ?? '')}" ${r.cipher === 'homophonic' ? 'disabled' : ''} /></label>
        <label>Hints<input data-b="hints" data-i="${i}" type="number" min="0" max="${MAX_HINTS}" value="${r.hints}" style="width:80px" /></label>
      </div>
      <div class="row">
        <label class="wide">Plaintext (optional, at least 20 letters; columnar rungs are trimmed to whole rows)<textarea data-b="plaintext" data-i="${i}" rows="3">${escapeHtml(r.plaintext ?? '')}</textarea></label>
        <label class="wide">Note to the student (optional)<input data-b="note" data-i="${i}" value="${escapeHtml(r.note ?? '')}" /></label>
      </div>
      <div class="controls">
        <button class="small" data-b="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>Move up</button>
        <button class="small" data-b="down" data-i="${i}" ${i === builder.rungs.length - 1 ? 'disabled' : ''}>Move down</button>
        <button class="small" data-b="remove" data-i="${i}" ${builder.rungs.length === 1 ? 'disabled' : ''}>Remove</button>
        <span class="muted">${escapeHtml(previewRung(i))}</span>
      </div>
    </div>`,
      )
      .join('')}
    <div class="controls">
      <button id="b-add" ${builder.rungs.length >= 20 ? 'disabled' : ''}>Add a rung</button>
      <button id="b-open" class="primary">Open this ladder</button>
      <button id="b-copy">Copy share link</button>
    </div>
    <label class="wide">Share link<input class="linkbox mono" id="b-link" readonly value="${escapeHtml(shareLink())}" /></label>
    <p class="status" id="b-status" role="status"></p>
  </section>`;
}

function previewRung(i: number): string {
  try {
    const ladderDef = normalizeLadder(builder);
    if (!ladderDef) return 'invalid';
    const r = materialize(ladderDef, i);
    return `Preview: ${solution(r).text.slice(0, 60)}; ${r.def.cipher === 'homophonic' ? homophonicSymbols(r.ciphertext).length + ' symbols' : r.plainLetters.length + ' letters'} from ${r.source}.`;
  } catch {
    return 'invalid rung';
  }
}

function shareLink(): string {
  const def = normalizeLadder(builder);
  if (!def) return '';
  return `${location.origin}${location.pathname}#${encodeLadder(def)}`;
}

// --------------------------------------------------------- dashboard view

function dashboardHtml(): string {
  const rows = dashboardRows(dashboardRecords);
  const rungCount = Math.max(0, ...dashboardRecords.map((p) => p.rungs.length));
  const summary = rungSummary(dashboardRecords, rungCount);
  return `<section class="panel">
    <h2>Instructor dashboard</h2>
    <p class="muted">Students download their progress as JSON from the Climb view (or you collect the files however you like). Drop any number of those files here; nothing is uploaded.</p>
    <div class="drop" id="drop" role="group" aria-labelledby="drop-title">
      <p id="drop-title">Drop progress files here</p>
      <label class="filepick">or choose progress files (JSON) <input type="file" id="files" accept="application/json,.json" multiple /></label>
    </div>
    ${dashboardError ? `<p class="status bad">${escapeHtml(dashboardError)}</p>` : ''}
    ${
      rows.length === 0
        ? ''
        : `<h3>Students</h3><table><thead><tr><th>Student</th><th>Ladder</th><th>On</th><th class="num">Solved</th><th class="num">Hints</th><th class="num">Total time</th><th>Time per rung</th><th>Tools used</th></tr></thead><tbody>${rows
            .map(
              (r) => `<tr><td>${escapeHtml(r.student)}</td><td>${escapeHtml(r.ladderTitle)}</td><td>${r.stuckOn}</td><td class="num">${r.solved}/${r.total}</td><td class="num">${r.hints}</td><td class="num">${formatDuration(r.totalSeconds)}</td><td>${r.perRung.map((s) => formatDuration(s)).join(' / ')}</td><td>${escapeHtml(r.tools)}</td></tr>`,
            )
            .join('')}</tbody></table>
        <h3>Per rung</h3><table><thead><tr><th class="num">Rung</th><th class="num">Solved by</th><th class="num">Currently on it</th><th class="num">Median time to solve</th></tr></thead><tbody>${summary
          .map((s) => `<tr><td class="num">${s.rung}</td><td class="num">${s.solved}</td><td class="num">${s.stuck}</td><td class="num">${s.medianSeconds ? formatDuration(s.medianSeconds) : '-'}</td></tr>`)
          .join('')}</tbody></table>`
    }
  </section>`;
}

// ------------------------------------------------------------------ wiring

function $<T extends HTMLElement>(sel: string): T | null {
  return app!.querySelector<T>(sel);
}

function announce(text: string): void {
  const live = $('#live');
  if (live) live.textContent = text;
}

function wire(): void {
  app!.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      view = b.dataset.view as View;
      render();
    }),
  );
  if (view === 'climb') wireClimb();
  else if (view === 'build') wireBuild();
  else wireDashboard();
}

function updateKey(next: StudentKey, rerender = true): void {
  key = next;
  save();
  if (rerender) render();
}

function wireClimb(): void {
  $('#student')?.addEventListener('change', (e) => {
    progress.student = (e.target as HTMLInputElement).value.trim();
    save();
  });
  app!.querySelectorAll<HTMLButtonElement>('[data-rung]').forEach((b) => b.addEventListener('click', () => selectRung(Number(b.dataset.rung))));
  $('#export')?.addEventListener('click', () => {
    save();
    const blob = new Blob([JSON.stringify(progress, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cipher-ladder-${(progress.student || 'progress').replace(/[^\w-]+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#reset')?.addEventListener('click', () => {
    if (!confirm('Reset all progress on this ladder?')) return;
    progress = newProgress(lid, ladder.title, ladder.rungs.length, progress.student);
    save();
    selectRung(0);
  });
  app!.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) =>
    b.addEventListener('click', () => {
      tool = b.dataset.tool as ToolName;
      noteTool(progress, current, tool);
      save();
      render();
    }),
  );
  $('#notes')?.addEventListener('input', (e) => {
    progress.rungs[current].notes = (e.target as HTMLTextAreaElement).value;
    save();
  });
  $('#period')?.addEventListener('change', (e) => {
    period = Math.max(1, Math.min(12, Number((e.target as HTMLInputElement).value) || 1));
    columnIndex = 0;
    render();
  });
  $('#column')?.addEventListener('change', (e) => {
    columnIndex = Number((e.target as HTMLSelectElement).value) || 0;
    render();
  });
  $('#clear')?.addEventListener('click', () => {
    hintLog = [];
    updateKey(emptyStudentKey(rung.def.cipher));
  });
  $('#hint')?.addEventListener('click', () => {
    const rp = progress.rungs[current];
    if (rp.hintsUsed >= rung.def.hints) return;
    const h = nextHint(rung, key);
    if (!h) {
      statusMsg = 'Nothing left to reveal: your key already matches on every part a hint could give.';
      statusKind = '';
      render();
      return;
    }
    rp.hintsUsed++;
    hintLog.push(`Hint ${rp.hintsUsed}: ${h.text}`);
    statusMsg = '';
    announce(h.text);
    updateKey(h.key);
  });
  $('#check')?.addEventListener('click', () => {
    const rp = progress.rungs[current];
    if (isSolved(rung, key)) {
      markSolved(progress, current);
      statusMsg = 'Correct. The rung is solved and the next one is unlocked.';
      statusKind = 'good';
      save();
      announce(statusMsg);
      render();
      // Let the solved view paint before the solver runs (up to a second for the harder rungs).
      setTimeout(() => {
        debrief = solve(rung.def.cipher, rung.ciphertext);
        render();
      }, 30);
    } else {
      rp.attempts++;
      const decrypted = partialDecrypt(rung.ciphertext, key);
      const unknown = (decrypted.match(/_/g) ?? []).length;
      statusMsg = unknown > 0 ? `Not yet: ${unknown} position${unknown === 1 ? ' is' : 's are'} still undetermined.` : 'Not yet: the key decrypts to something, but not the plaintext.';
      statusKind = 'bad';
      save();
      announce(statusMsg);
      render();
    }
  });
  $('#next')?.addEventListener('click', () => selectRung(current + 1));

  // Key panel controls.
  const setShift = (v: string): void => {
    const n = v === '' ? null : Math.max(0, Math.min(25, Math.floor(Number(v))));
    updateKey({ type: 'caesar', shift: n === null || Number.isNaN(n) ? null : n });
  };
  $('#shift')?.addEventListener('input', (e) => setShift((e.target as HTMLInputElement).value));
  $('#shift-num')?.addEventListener('change', (e) => setShift((e.target as HTMLInputElement).value));
  const setAffine = (): void => {
    const a = ($('#affine-a') as HTMLSelectElement | null)?.value ?? '';
    const b = ($('#affine-b') as HTMLInputElement | null)?.value ?? '';
    updateKey({ type: 'affine', a: a === '' ? null : Number(a), b: b === '' ? null : Math.max(0, Math.min(25, Math.floor(Number(b)))) });
  };
  $('#affine-a')?.addEventListener('change', setAffine);
  $('#affine-b')?.addEventListener('change', setAffine);
  $('#keyword')?.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const pos = el.selectionStart;
    updateKey({ type: 'vigenere', keyword: onlyLettersOrQuery(el.value) });
    const again = $<HTMLInputElement>('#keyword');
    if (again) {
      again.focus();
      if (pos !== null) again.setSelectionRange(pos, pos);
    }
  });
  $('#cols')?.addEventListener('change', (e) => {
    const n = Math.max(0, Math.min(12, Math.floor(Number((e.target as HTMLInputElement).value)) || 0));
    if (key.type !== 'columnar') return;
    const old = key.order;
    const order = Array.from({ length: n }, (_, i) => (i < old.length ? old[i] : null));
    updateKey({ type: 'columnar', order });
  });
  $('#col-keyword')?.addEventListener('change', (e) => {
    const order = keywordOrder((e.target as HTMLInputElement).value);
    if (order.length >= 2) updateKey({ type: 'columnar', order });
  });
  app!.querySelectorAll<HTMLInputElement>('[data-slot]').forEach((inp) =>
    inp.addEventListener('change', () => {
      if (key.type !== 'columnar') return;
      const order = key.order.slice();
      const v = Number(inp.value);
      order[Number(inp.dataset.slot)] = inp.value === '' || !Number.isInteger(v) || v < 1 || v > order.length ? null : v - 1;
      updateKey({ type: 'columnar', order });
    }),
  );
  wireBoard('[data-sub]', 'sub', 'substitution');
  wireBoard('[data-sym]', 'sym', 'homophonic');
}

/** Letter boards: type a letter to map it and move on; Backspace clears and moves back. */
function wireBoard(selector: string, attr: string, type: 'substitution' | 'homophonic'): void {
  const inputs = [...app!.querySelectorAll<HTMLInputElement>(selector)];
  inputs.forEach((inp, idx) => {
    inp.addEventListener('input', () => {
      if (key.type !== type) return;
      const v = inp.value.toUpperCase().replace(/[^A-Z]/g, '').slice(-1);
      const map = { ...key.map };
      const id = inp.dataset[attr] as string;
      if (v) map[id] = v;
      else delete map[id];
      updateKey({ type, map } as StudentKey, false);
      // Re-render the decryption and duplicates without losing keyboard focus.
      render();
      const next = [...app!.querySelectorAll<HTMLInputElement>(selector)][v ? Math.min(idx + 1, inputs.length - 1) : idx];
      next?.focus();
      next?.select();
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && inp.value === '' && idx > 0) {
        e.preventDefault();
        const prev = inputs[idx - 1];
        prev.focus();
        prev.select();
      }
    });
  });
}

function wireBuild(): void {
  const setStatus = (msg: string): void => {
    const el = $('#b-status');
    if (el) el.textContent = msg;
  };
  $('#b-title')?.addEventListener('change', (e) => {
    builder.title = (e.target as HTMLInputElement).value;
    render();
  });
  $('#b-seed')?.addEventListener('change', (e) => {
    builder.seed = (e.target as HTMLInputElement).value;
    render();
  });
  app!.querySelectorAll<HTMLElement>('[data-b]').forEach((el) => {
    const i = Number(el.dataset.i);
    const what = el.dataset.b as string;
    if (el instanceof HTMLButtonElement) {
      el.addEventListener('click', () => {
        const rungs = builder.rungs;
        if (what === 'remove') rungs.splice(i, 1);
        else if (what === 'up' && i > 0) [rungs[i - 1], rungs[i]] = [rungs[i], rungs[i - 1]];
        else if (what === 'down' && i < rungs.length - 1) [rungs[i + 1], rungs[i]] = [rungs[i], rungs[i + 1]];
        render();
      });
      return;
    }
    el.addEventListener('change', () => {
      const r: RungDef = builder.rungs[i];
      const value = (el as HTMLInputElement).value;
      if (what === 'cipher') {
        r.cipher = value as CipherType;
        r.key = undefined;
      } else if (what === 'hints') r.hints = Math.max(0, Math.min(MAX_HINTS, Math.floor(Number(value)) || 0));
      else if (what === 'title' || what === 'key' || what === 'plaintext' || what === 'note') r[what] = value.trim() || undefined;
      render();
    });
  });
  $('#b-add')?.addEventListener('click', () => {
    builder.rungs.push({ cipher: 'caesar', hints: 1 });
    render();
  });
  $('#b-open')?.addEventListener('click', () => {
    const def = normalizeLadder(builder);
    if (!def) {
      setStatus('The ladder is not valid.');
      return;
    }
    location.hash = encodeLadder(def);
    location.reload();
  });
  $('#b-copy')?.addEventListener('click', async () => {
    const link = shareLink();
    try {
      await navigator.clipboard.writeText(link);
      setStatus('Link copied.');
    } catch {
      setStatus('Could not copy automatically; select the link box and copy it.');
    }
  });
}

function wireDashboard(): void {
  const drop = $('#drop');
  const read = async (files: FileList | File[]): Promise<void> => {
    dashboardError = '';
    for (const f of files) {
      try {
        const p = parseProgress(JSON.parse(await f.text()));
        if (!p) throw new Error('not a progress file');
        // Replace an earlier upload from the same student on the same ladder.
        dashboardRecords = dashboardRecords.filter((q) => !(q.student === p.student && q.ladderId === p.ladderId));
        dashboardRecords.push(p);
      } catch {
        dashboardError += `${f.name} is not a Cipher Ladder progress file. `;
      }
    }
    render();
  };
  $('#files')?.addEventListener('change', (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files) void read(files);
  });
  drop?.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop?.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop?.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer?.files) void read(e.dataTransfer.files);
  });
}

render();
