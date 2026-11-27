import { verify, type Commitment } from '../core/commit';
import { KEY_FOR_BIT, MixturePredictor, replay, type Bit, type Mode } from '../core/predictor';
import { bitsToKeys, coinFlips, decodeShare, encodeShare, parseSequence, type SharedRun } from '../core/sequence';
import { Session, type Round } from '../core/session';
import { ngramTable, runHistogram, summarize, tableHits, type Summary } from '../core/stats';
import { accuracyChart, runChart } from './charts';

type Lengths = 50 | 100 | 200;

interface State {
  mode: Mode;
  length: Lengths;
  session: Session | null;
  lastRound: Round | null;
  lastVerified: boolean | null;
  /** A finished or loaded sequence being analysed. */
  analysed: (SharedRun & { correct: boolean[]; weights: number[] | null }) | null;
}

const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function modeLabel(mode: Mode): string {
  return mode === 'easy' ? '6-gram oracle (Aaronson)' : 'mixture of 1- to 6-gram experts';
}

function verdict(s: Summary): string {
  if (s.presses < 20) return 'Too few presses to say much yet.';
  if (s.pValue < 0.001) return `The oracle read you: a coin-flipping guesser would hit ${s.hits}/${s.presses} or better with probability ${s.pValue.toExponential(1)}.`;
  if (s.pValue < 0.05) return `The oracle beat chance (one-sided p = ${s.pValue.toFixed(3)}). Your presses carry a pattern it can use.`;
  if (s.accuracy <= 0.5) return 'The oracle did no better than a coin: it found no pattern it can use in this sequence.';
  return `Not distinguishable from a coin at this length (p = ${s.pValue.toFixed(2)}). Play longer to be sure.`;
}

export function mountApp(root: HTMLElement): void {
  const state: State = { mode: 'easy', length: 50, session: null, lastRound: null, lastVerified: null, analysed: null };

  root.innerHTML = `
    <header class="top">
      <div class="title-row"><h1>Outguess Me</h1><hw-theme-toggle></hw-theme-toggle></div>
      <p class="lede">Press <kbd>F</kbd> or <kbd>J</kbd> as unpredictably as you can. Before every press the oracle
      seals its guess with a SHA-256 hash, then reveals it. A coin would be right half the time. It will do better.</p>
      <p class="lede muted">There is no clock: take as long as you like over each press. Speed does not count, only your choices do.</p>
    </header>
    <section class="card controls" aria-label="Game settings">
      <div class="seg" role="radiogroup" aria-label="Oracle">
        <button data-mode="easy" role="radio">Easy: 6-gram</button>
        <button data-mode="hard" role="radio">Hard: mixture</button>
      </div>
      <div class="seg" role="radiogroup" aria-label="Game length">
        <button data-len="50" role="radio">50</button>
        <button data-len="100" role="radio">100</button>
        <button data-len="200" role="radio">200</button>
      </div>
      <button id="start" class="primary">Start</button>
      <dl class="modes">
        <div data-mode-help="easy"><dt>Easy: 6-gram</dt><dd>One fixed memory. The oracle looks at your last five presses, finds every earlier time you made that same run of five, and guesses whatever you pressed next most often (falling back to the last four, three, ... presses when that run is new).</dd></div>
        <div data-mode-help="hard"><dt>Hard: mixture</dt><dd>Six of those tables at once, remembering your last 0 to 5 presses. Each gets a vote, and a table loses weight every time it guesses wrong, so the oracle shifts to whichever memory length is reading you best right now. Switching strategy mid-game buys you a few presses, not the game.</dd></div>
      </dl>
    </section>
    <section class="card play" aria-label="Play">
      <div class="score" id="score" aria-live="polite"></div>
      <div class="progress"><div id="bar"></div></div>
      <div class="keys">
        <button class="key" data-bit="0" aria-label="Press F">F</button>
        <button class="key" data-bit="1" aria-label="Press J">J</button>
      </div>
      <div class="seal">
        <div><span class="label">Sealed guess for your next press</span><code id="hash">press Start</code></div>
        <div id="reveal" class="reveal"></div>
      </div>
      <div id="strip" class="strip" role="group" aria-label="Recent presses, red where the oracle guessed right, green where you escaped"></div>
      <div class="chart" id="chart"></div>
      <p class="legend">Presses: <span class="sw hitsw"></span>oracle right <span class="sw misssw"></span>you escaped. Chart: <span class="sw run"></span>hit rate so far <span class="sw roll"></span>last 20 presses <span class="sw band"></span>where a coin-flipping oracle lands 95% of the time</p>
    </section>
    <section class="card" aria-label="Test a sequence">
      <h2>Test any sequence</h2>
      <p class="muted">Paste a string with two symbols (F/J, 0/1, H/T, or any pair) to see how predictable it is,
      for example a sequence you typed elsewhere or one a model generated. Or run the oracle against real coin flips.</p>
      <textarea id="paste" rows="3" spellcheck="false" placeholder="HTHHTHTTHTHHTHT..."></textarea>
      <div class="row">
        <button id="analyse">Analyse pasted</button>
        <button id="coin">200 real coin flips</button>
        <span id="paste-error" class="error" role="alert"></span>
      </div>
    </section>
    <section id="results" class="card results" aria-label="Breakdown" hidden></section>
    <footer class="muted">Everything runs in your browser: no server, no cookies; visits are counted anonymously. After Scott Aaronson's oracle demo.
      <a href="https://github.com/pisanuw/Claude-capstone/tree/main/outguess-me">Source</a></footer>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const score = $('#score');
  const bar = $('#bar');
  const hash = $('#hash');
  const reveal = $('#reveal');
  const strip = $('#strip');
  const chart = $('#chart');
  const results = $('#results');
  const pasteError = $('#paste-error');
  const startButton = $<HTMLButtonElement>('#start');

  function syncControls(): void {
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === state.mode)));
    root.querySelectorAll<HTMLButtonElement>('[data-len]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.len) === state.length)));
    root.querySelectorAll<HTMLElement>('[data-mode-help]').forEach((d) => d.classList.toggle('active', d.dataset.modeHelp === state.mode));
  }

  function renderPlay(): void {
    const s = state.session;
    const rounds = s?.rounds ?? [];
    const hits = rounds.filter((r) => r.correct).length;
    const target = s?.target ?? state.length;
    score.innerHTML = s
      ? `<strong>Oracle ${hits}</strong> / ${rounds.length} <span class="muted">(${rounds.length ? pct(hits / rounds.length) : '-'})</span> · You ${rounds.length - hits} · ${target - rounds.length} presses left`
      : `<span class="muted">${modeLabel(state.mode)}, ${state.length} presses. Press Start, then use the F and J keys (or tap). No time limit.</span>`;
    if (s?.done) score.innerHTML += ` <span class="muted">Game over: the breakdown is below. Press Start for a new game.</span>`;
    const playing = !!s && !s.done;
    root.querySelectorAll<HTMLButtonElement>('.key').forEach((k) => k.classList.toggle('idle', !playing));
    startButton.textContent = s ? 'New game' : 'Start';
    bar.style.width = pct(rounds.length / target, 1);
    const pending = s?.pendingCommitment;
    hash.textContent = s ? (s.done ? 'game over' : (pending?.hash ?? 'sealing...')) : 'press Start';
    const lr = state.lastRound;
    reveal.innerHTML = lr
      ? `Last press: oracle sealed <b>${KEY_FOR_BIT[lr.commitment.prediction]}</b>, you pressed <b>${KEY_FOR_BIT[lr.press]}</b>,
         <span class="${lr.correct ? 'bad' : 'good'}">${lr.correct ? 'it got you' : 'you escaped'}</span>.
         Nonce <code>${lr.commitment.nonce}</code> ${state.lastVerified === null ? '' : state.lastVerified ? '<span class="good">hash verified</span>' : '<span class="bad">HASH MISMATCH</span>'}
         <details><summary>check it yourself</summary><code class="wrap">sha256("outguess-me:${KEY_FOR_BIT[lr.commitment.prediction]}:${lr.commitment.nonce}")</code> should equal the hash shown before your press:
         <code class="wrap">${lr.commitment.hash}</code></details>`
      : '';
    strip.innerHTML = rounds
      .slice(-50)
      .map((r) => `<span class="${r.correct ? 'hit' : 'miss'}">${KEY_FOR_BIT[r.press]}</span>`)
      .join('');
    chart.innerHTML = accuracyChart(
      rounds.map((r) => r.correct),
      target,
    );
  }

  function renderResults(): void {
    const a = state.analysed;
    if (!a) {
      results.hidden = true;
      return;
    }
    results.hidden = false;
    const s = summarize(a.bits, a.correct);
    const table = ngramTable(a.bits, 5).slice(0, 16);
    const fullTable = ngramTable(a.bits, 5);
    const hist = runHistogram(a.bits, 8);
    const sourceText = { played: 'your game', pasted: 'the pasted sequence', coin: 'real coin flips (crypto.getRandomValues)' }[a.source];
    const share = `${location.origin}${location.pathname}#${encodeShare(a)}`;
    const altNote =
      a.bits.length < 10
        ? ''
        : s.alternation > 0.58
          ? 'You switch more often than a coin does, the classic human bias.'
          : s.alternation < 0.42
            ? 'You repeat more often than a coin does.'
            : 'About what a coin does.';
    results.innerHTML = `
      <h2>Breakdown: ${esc(sourceText)}</h2>
      <p class="verdict">${verdict(s)}</p>
      <div class="tiles">
        <div class="tile"><span class="big">${pct(s.accuracy)}</span><span>oracle hit rate (${s.hits}/${s.presses}), 95% CI ${pct(s.ci[0])} to ${pct(s.ci[1])}</span></div>
        <div class="tile"><span class="big">${s.entropy.best.bitsPerPress.toFixed(2)}</span><span>bits per press (ideal 1.00), best of order-0 to 5 context models</span></div>
        <div class="tile"><span class="big">${pct(s.alternation)}</span><span>alternation rate (coin 50%). ${altNote}</span></div>
        <div class="tile"><span class="big">${s.longestRun}</span><span>longest run (a coin usually reaches about ${s.expectedLongestRun.toFixed(1)} in ${s.presses})</span></div>
        <div class="tile"><span class="big">${pct(s.fShare)}</span><span>of presses were F</span></div>
      </div>
      <div class="grid2">
        <div>
          <h3>The 6-gram table that read you</h3>
          <p class="muted">What you pressed after each run of five. Majority-voting each row would have scored
          ${tableHits(fullTable)}/${Math.max(0, a.bits.length - 5)} with hindsight.</p>
          ${
            table.length
              ? `<table class="ngram"><thead><tr><th>after</th><th>then F</th><th>then J</th><th></th></tr></thead><tbody>${table
                  .map((r) => {
                    const t = r.f + r.j;
                    return `<tr><td><code>${r.context}</code></td><td>${r.f}</td><td>${r.j}</td><td><span class="lean" style="--f:${(r.f / t) * 100}%"></span></td></tr>`;
                  })
                  .join('')}</tbody></table>`
              : '<p class="muted">Needs at least six presses.</p>'
          }
        </div>
        <div>
          <h3>Run lengths</h3>
          <p class="muted"><span class="sw obs"></span>yours <span class="sw exp"></span>fair coin, same number of runs</p>
          ${runChart(hist)}
          <h3>Bits per press by context length</h3>
          <p class="muted">Adaptive Krichevsky-Trofimov code length: a real compressor, so below 1.00 means your sequence compresses.</p>
          <table class="ent"><tbody>${s.entropy.byOrder
            .map(
              (e) =>
                `<tr${e.order === s.entropy.best.order ? ' class="best"' : ''}><td>${e.order} previous</td><td>${e.bitsPerPress.toFixed(3)}</td><td><span class="meter" style="--v:${Math.min(1, e.bitsPerPress) * 100}%"></span></td></tr>`,
            )
            .join('')}</tbody></table>
          ${
            a.weights
              ? `<h3>Hard-mode expert weights at the end</h3><table class="ent"><tbody>${a.weights
                  .map((w, i) => `<tr><td>${i + 1}-gram</td><td>${pct(w, 1)}</td><td><span class="meter" style="--v:${w * 100}%"></span></td></tr>`)
                  .join('')}</tbody></table>`
              : ''
          }
        </div>
      </div>
      <div class="row share">
        <button id="copy">Copy share link</button>
        <span class="muted">The link holds the ${a.mode} mode and all ${a.bits.length} presses; the score is recomputed when it is opened.</span>
      </div>
      <details><summary>Sequence</summary><code class="wrap">${bitsToKeys(a.bits)}</code></details>`;
    $('#copy').addEventListener('click', () => {
      history.replaceState(null, '', `#${encodeShare(a)}`);
      void navigator.clipboard?.writeText(share).then(
        () => ($('#copy').textContent = 'Copied'),
        () => ($('#copy').textContent = 'Link is in the address bar'),
      );
    });
  }

  function analyse(run: SharedRun): void {
    if (run.mode === 'hard') {
      // Replay once with a live mixture to report its final weights.
      const m = new MixturePredictor();
      const correct: boolean[] = [];
      for (const b of run.bits) {
        correct.push(m.predict() === b);
        m.update(b);
      }
      state.analysed = { ...run, correct, weights: m.weightsSnapshot() };
    } else {
      state.analysed = { ...run, correct: replay(run.bits, run.mode).correct, weights: null };
    }
    renderResults();
  }

  async function seal(): Promise<void> {
    const s = state.session;
    if (!s || s.done) return;
    await s.next();
    if (s === state.session) renderPlay();
  }

  function start(): void {
    state.session = new Session(state.mode, state.length);
    state.lastRound = null;
    state.lastVerified = null;
    state.analysed = null;
    history.replaceState(null, '', location.pathname);
    renderResults();
    renderPlay();
    void seal();
  }

  function press(bit: Bit): void {
    const s = state.session;
    if (!s || s.done || !s.pendingCommitment) return;
    const round = s.press(bit);
    state.lastRound = round;
    state.lastVerified = null;
    flash(bit, round.correct);
    const c: Commitment = round.commitment;
    void verify(c.hash, c.prediction, c.nonce).then((ok) => {
      if (state.lastRound === round) {
        state.lastVerified = ok;
        renderPlay();
      }
    });
    if (s.done) {
      analyse({ mode: s.mode, bits: s.bits, source: 'played' });
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    renderPlay();
    void seal();
  }

  /** A key press with no game running: point at Start instead of starting one. */
  function nudge(): void {
    startButton.classList.remove('nudge');
    void startButton.offsetWidth;
    startButton.classList.add('nudge');
  }

  function flash(bit: Bit, caught: boolean): void {
    const key = root.querySelector<HTMLElement>(`.key[data-bit="${bit}"]`);
    if (!key) return;
    key.classList.remove('caught', 'escaped');
    void key.offsetWidth;
    key.classList.add(caught ? 'caught' : 'escaped');
  }

  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      state.mode = b.dataset.mode as Mode;
      syncControls();
      if (!state.session || state.session.done || state.session.rounds.length === 0) {
        state.session = null;
        renderPlay();
      }
    }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-len]').forEach((b) =>
    b.addEventListener('click', () => {
      state.length = Number(b.dataset.len) as Lengths;
      syncControls();
      if (!state.session || state.session.done || state.session.rounds.length === 0) {
        state.session = null;
        renderPlay();
      }
    }),
  );
  $('#start').addEventListener('click', start);
  root.querySelectorAll<HTMLButtonElement>('.key').forEach((b) =>
    b.addEventListener('click', () => {
      if (!state.session || state.session.done) nudge();
      else press(Number(b.dataset.bit) as Bit);
    }),
  );
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement | null)?.closest('textarea, input')) return;
    const k = e.key.toLowerCase();
    if (k === 'f' || k === 'j') {
      e.preventDefault();
      if (!state.session || state.session.done) nudge();
      else press(k === 'f' ? 0 : 1);
    }
  });
  $('#analyse').addEventListener('click', () => {
    const r = parseSequence(($('#paste') as HTMLTextAreaElement).value);
    pasteError.textContent = r.ok ? (r.bits.length < 20 ? 'Short sequence: the statistics will be noisy.' : '') : r.error;
    if (r.ok) {
      analyse({ mode: state.mode, bits: r.bits, source: 'pasted' });
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  $('#coin').addEventListener('click', () => {
    pasteError.textContent = '';
    analyse({ mode: state.mode, bits: coinFlips(200), source: 'coin' });
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const shared = decodeShare(location.hash);
  if (shared) {
    state.mode = shared.mode;
    analyse(shared);
  }
  syncControls();
  renderPlay();
}
