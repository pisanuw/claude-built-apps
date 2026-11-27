import type { AnalyzeResult, Step } from '../core/types';
import { segment } from '../core/segments';
import { examples, findExample } from '../core/examples';
import { encodeShare, decodeShare } from '../core/share';

const STORAGE_KEY = 'type-witness:code';

/** Step kinds worth stopping on when "major steps only" is checked. */
const MAJOR_KINDS = new Set([
  'call',
  'narrow',
  'widen',
  'var-infer',
  'var-declared',
  'return-infer',
  'param',
  'function',
  'error',
]);

const KIND_LABELS: Record<string, string> = {
  literal: 'literal',
  identifier: 'reference',
  narrow: 'narrowing',
  member: 'member',
  call: 'call',
  function: 'function',
  param: 'context',
  expression: 'expression',
  'var-infer': 'inference',
  widen: 'widening',
  'var-declared': 'annotation',
  'return-infer': 'return',
  error: 'error',
};

interface WorkerResponse {
  id: number;
  result: AnalyzeResult;
  elapsedMs: number;
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = `
    <header class="top">
      <div class="title-row"><h1>🔎 Type Witness</h1><hw-theme-toggle></hw-theme-toggle></div>
      <p class="tagline">Paste TypeScript. Watch the compiler think, one expression at a time.</p>
      <div class="toolbar">
        <label class="picker">Example
          <select id="example-picker">
            <option value="">Choose…</option>
            ${examples.map((e) => `<option value="${e.id}">${e.title}</option>`).join('')}
          </select>
        </label>
        <button id="share-btn" title="Copy a link that carries this snippet in the URL">Share link</button>
      </div>
    </header>
    <p id="example-blurb" class="blurb" hidden></p>
    <main class="grid">
      <section class="pane code-pane">
        <div class="pane-head">
          <h2>Your snippet</h2>
          <span id="status" class="status" role="status"></span>
        </div>
        <textarea id="editor" spellcheck="false" aria-label="TypeScript source"></textarea>
        <div class="pane-head">
          <h2>Witness view</h2>
          <span class="hint">hover any expression for its type · click to jump to its step</span>
        </div>
        <pre id="witness" class="witness" tabindex="0" role="region" aria-label="Witness view"></pre>
      </section>
      <section class="pane story-pane">
        <div class="pane-head">
          <h2>Inference story</h2>
          <label class="filter"><input type="checkbox" id="major-only" /> major steps only</label>
        </div>
        <div class="controls">
          <button id="prev-btn" title="Previous step (←)">◀</button>
          <button id="play-btn" title="Play through the story">▶ Play</button>
          <button id="next-btn" title="Next step (→)">▶</button>
          <input type="range" id="step-slider" min="0" max="0" value="0" aria-label="Step" />
          <span id="step-counter" class="counter"></span>
        </div>
        <div id="current-card" class="card" hidden></div>
        <div class="steps-scroll" tabindex="0" role="region" aria-label="All inference steps"><ol id="step-list" class="steps"></ol></div>
      </section>
    </main>
    <div id="tooltip" class="tooltip" hidden></div>
    <footer class="foot">
      <p>
        The real TypeScript compiler (5.6) runs in a Web Worker in your browser.
        Nothing you paste leaves your machine.
        <a href="https://github.com/pisanuw/Claude-capstone/tree/main/type-witness">Source</a>
      </p>
    </footer>
  `;

  const editor = root.querySelector<HTMLTextAreaElement>('#editor')!;
  const witness = root.querySelector<HTMLPreElement>('#witness')!;
  const statusEl = root.querySelector<HTMLElement>('#status')!;
  const stepList = root.querySelector<HTMLOListElement>('#step-list')!;
  const currentCard = root.querySelector<HTMLElement>('#current-card')!;
  const slider = root.querySelector<HTMLInputElement>('#step-slider')!;
  const counter = root.querySelector<HTMLElement>('#step-counter')!;
  const majorOnly = root.querySelector<HTMLInputElement>('#major-only')!;
  const prevBtn = root.querySelector<HTMLButtonElement>('#prev-btn')!;
  const nextBtn = root.querySelector<HTMLButtonElement>('#next-btn')!;
  const playBtn = root.querySelector<HTMLButtonElement>('#play-btn')!;
  const picker = root.querySelector<HTMLSelectElement>('#example-picker')!;
  const blurb = root.querySelector<HTMLElement>('#example-blurb')!;
  const shareBtn = root.querySelector<HTMLButtonElement>('#share-btn')!;
  const tooltip = root.querySelector<HTMLElement>('#tooltip')!;

  const worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });

  let requestId = 0;
  let result: AnalyzeResult | null = null;
  let currentIndex = -1;
  let playTimer: number | null = null;
  let debounceTimer: number | null = null;

  const visibleSteps = (): Step[] => {
    if (!result) return [];
    return majorOnly.checked
      ? result.steps.filter((s) => MAJOR_KINDS.has(s.kind))
      : result.steps;
  };

  const requestAnalysis = (code: string) => {
    requestId += 1;
    statusEl.textContent = 'analyzing…';
    worker.postMessage({ id: requestId, code });
  };

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    if (event.data.id !== requestId) return; // stale response
    result = event.data.result;
    const errs = result.diagnostics.length;
    statusEl.textContent = `${result.steps.length} steps · ${errs} ${errs === 1 ? 'error' : 'errors'} · ${event.data.elapsedMs} ms`;
    const steps = visibleSteps();
    currentIndex = steps.length > 0 ? 0 : -1;
    renderStory();
  };

  const scheduleAnalysis = () => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, editor.value);
      } catch {
        // storage may be unavailable; analysis still works
      }
      requestAnalysis(editor.value);
    }, 600);
  };

  const stopPlaying = () => {
    if (playTimer !== null) {
      window.clearInterval(playTimer);
      playTimer = null;
      playBtn.textContent = '▶ Play';
    }
  };

  const renderWitness = () => {
    if (!result) {
      witness.textContent = editor.value;
      return;
    }
    const steps = visibleSteps();
    const current = currentIndex >= 0 && currentIndex < steps.length ? steps[currentIndex] : null;
    const segs = segment(editor.value, result.hover, current, result.diagnostics);
    witness.textContent = '';
    for (const seg of segs) {
      const span = document.createElement('span');
      span.textContent = seg.text;
      if (seg.hoverIndex !== null) {
        span.dataset.hover = String(seg.hoverIndex);
        span.classList.add('tok');
      }
      if (seg.current) span.classList.add('current');
      if (seg.error) span.classList.add('squiggle');
      witness.appendChild(span);
    }
    const mark = witness.querySelector('.current');
    if (mark) mark.scrollIntoView({ block: 'nearest' });
  };

  const renderCard = (step: Step | null) => {
    if (!step) {
      currentCard.hidden = true;
      return;
    }
    currentCard.hidden = false;
    currentCard.innerHTML = '';
    const badge = document.createElement('span');
    badge.className = `badge kind-${step.kind}`;
    badge.textContent = KIND_LABELS[step.kind] ?? step.kind;
    const narration = document.createElement('p');
    narration.className = 'narration';
    narration.textContent = step.narration;
    currentCard.append(badge, narration);
    if (step.details.length > 0) {
      const list = document.createElement('ul');
      list.className = 'details';
      for (const d of step.details) {
        const li = document.createElement('li');
        li.textContent = d;
        list.appendChild(li);
      }
      currentCard.appendChild(list);
    }
  };

  const renderStory = () => {
    const steps = visibleSteps();
    slider.max = String(Math.max(0, steps.length - 1));
    slider.value = String(Math.max(0, currentIndex));
    slider.disabled = steps.length === 0;
    prevBtn.disabled = currentIndex <= 0;
    nextBtn.disabled = currentIndex >= steps.length - 1;
    playBtn.disabled = steps.length === 0;
    counter.textContent = steps.length === 0 ? 'no steps' : `${currentIndex + 1} / ${steps.length}`;

    stepList.textContent = '';
    steps.forEach((step, i) => {
      const li = document.createElement('li');
      li.className = i === currentIndex ? 'step active' : 'step';
      const badge = document.createElement('span');
      badge.className = `badge kind-${step.kind}`;
      badge.textContent = KIND_LABELS[step.kind] ?? step.kind;
      const text = document.createElement('span');
      text.className = 'step-snippet';
      text.textContent = step.snippet;
      const type = document.createElement('code');
      type.className = 'step-type';
      type.textContent = step.kind === 'error' ? `TS error` : step.type;
      li.append(badge, text, type);
      li.addEventListener('click', () => {
        stopPlaying();
        setCurrent(i);
      });
      stepList.appendChild(li);
    });

    renderCard(currentIndex >= 0 ? (steps[currentIndex] ?? null) : null);
    renderWitness();
    const active = stepList.querySelector('.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  };

  const setCurrent = (i: number) => {
    const steps = visibleSteps();
    if (steps.length === 0) {
      currentIndex = -1;
    } else {
      currentIndex = Math.max(0, Math.min(steps.length - 1, i));
    }
    renderStory();
  };

  prevBtn.addEventListener('click', () => {
    stopPlaying();
    setCurrent(currentIndex - 1);
  });
  nextBtn.addEventListener('click', () => {
    stopPlaying();
    setCurrent(currentIndex + 1);
  });
  slider.addEventListener('input', () => {
    stopPlaying();
    setCurrent(Number(slider.value));
  });
  playBtn.addEventListener('click', () => {
    if (playTimer !== null) {
      stopPlaying();
      return;
    }
    const steps = visibleSteps();
    if (steps.length === 0) return;
    if (currentIndex >= steps.length - 1) setCurrent(0);
    playBtn.textContent = '⏸ Pause';
    playTimer = window.setInterval(() => {
      if (currentIndex >= visibleSteps().length - 1) {
        stopPlaying();
        return;
      }
      setCurrent(currentIndex + 1);
    }, 1100);
  });
  majorOnly.addEventListener('change', () => {
    stopPlaying();
    setCurrent(0);
  });

  document.addEventListener('keydown', (e) => {
    // The element the key was pressed on: a key in a shadow root (the light and dark mode switch's button)
    // reaches the document retargeted to its host (platform/src/theme/README.md, "Key shortcuts"). Fields (the
    // editor, the step slider, the example list) and the scroll regions keep their arrow keys.
    const t = (e.composedPath()[0] ?? e.target) as HTMLElement | null;
    if (t?.closest?.('textarea, input, select, [role="region"]')) return;
    if (e.key === 'ArrowLeft') {
      stopPlaying();
      setCurrent(currentIndex - 1);
    } else if (e.key === 'ArrowRight') {
      stopPlaying();
      setCurrent(currentIndex + 1);
    }
  });

  witness.addEventListener('mousemove', (e) => {
    const target = e.target as HTMLElement;
    const idx = target.dataset?.hover;
    if (idx === undefined || !result) {
      tooltip.hidden = true;
      return;
    }
    const entry = result.hover[Number(idx)];
    if (!entry) {
      tooltip.hidden = true;
      return;
    }
    tooltip.textContent = entry.type;
    tooltip.hidden = false;
    tooltip.style.left = `${e.clientX + 12}px`;
    tooltip.style.top = `${e.clientY + 14}px`;
  });
  witness.addEventListener('mouseleave', () => {
    tooltip.hidden = true;
  });
  witness.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const idx = target.dataset?.hover;
    if (idx === undefined || !result) return;
    const entry = result.hover[Number(idx)];
    if (!entry) return;
    // Jump to the last step whose span matches this hover span, if any.
    const steps = visibleSteps();
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].start === entry.start && steps[i].end === entry.end) {
        stopPlaying();
        setCurrent(i);
        return;
      }
    }
  });

  editor.addEventListener('input', () => {
    stopPlaying();
    picker.value = '';
    blurb.hidden = true;
    scheduleAnalysis();
  });

  picker.addEventListener('change', () => {
    const ex = findExample(picker.value);
    if (!ex) return;
    stopPlaying();
    editor.value = ex.code;
    blurb.textContent = ex.blurb;
    blurb.hidden = false;
    try {
      localStorage.setItem(STORAGE_KEY, ex.code);
    } catch {
      // ignore
    }
    requestAnalysis(ex.code);
  });

  shareBtn.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.hash = `code=${encodeShare(editor.value)}`;
    history.replaceState(null, '', url.toString());
    navigator.clipboard
      ?.writeText(url.toString())
      .then(() => {
        shareBtn.textContent = 'Copied!';
        window.setTimeout(() => (shareBtn.textContent = 'Share link'), 1500);
      })
      .catch(() => {
        shareBtn.textContent = 'Link in URL bar';
        window.setTimeout(() => (shareBtn.textContent = 'Share link'), 2000);
      });
  });

  // Initial code: shared link > last session > first example.
  let initial = decodeShare(window.location.hash);
  if (initial === null) {
    try {
      initial = localStorage.getItem(STORAGE_KEY);
    } catch {
      initial = null;
    }
  }
  if (initial === null || initial.trim() === '') {
    const ex = examples[0];
    initial = ex.code;
    picker.value = ex.id;
    blurb.textContent = ex.blurb;
    blurb.hidden = false;
  }
  editor.value = initial;
  requestAnalysis(initial);
}
