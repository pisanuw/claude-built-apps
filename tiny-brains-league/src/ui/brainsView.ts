import { checkMilestones, RANDOM_TARGET, SCRIPTED_TARGET } from '../core/milestones';
import { parseBrain } from '../core/net';
import type { EvalResult } from '../core/train';
import { clear, h } from './dom';
import { addBrain, download, notify, removeBrain, slug, state, subscribe, uniqueName, type BrainEntry } from './state';

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function brainsView(): HTMLElement {
  const root = h('section', { class: 'view' });
  const upload = h('div', { class: 'panel' });
  const list = h('div', { class: 'panel' });
  const messages = h('div', { 'aria-live': 'polite' });
  const evaluating = new Set<string>();

  function importText(text: string, label: string): void {
    try {
      const { file, params } = parseBrain(text);
      file.name = uniqueName(file.name);
      const entry = addBrain(file, 'uploaded', params);
      messages.append(h('p', { class: 'good' }, `${label}: accepted "${file.name}" (${params.toLocaleString()} parameters).`));
      evaluate(entry);
    } catch (e) {
      messages.append(h('p', { class: 'bad' }, `${label}: rejected. ${(e as Error).message}`));
    }
  }

  const fileInput = h('input', { type: 'file', accept: '.json,application/json', multiple: true, id: 'brain-files' });
  fileInput.addEventListener('change', async () => {
    clear(messages);
    for (const f of Array.from(fileInput.files ?? [])) importText(await f.text(), f.name);
    fileInput.value = '';
  });
  const paste = h('textarea', { rows: 4, placeholder: '{"format": "tiny-brains/v1", "name": "...", "activation": "relu", "layers": [...]}', 'aria-label': 'Paste a weight file' });
  upload.append(
    h('h2', {}, 'Submit weights'),
    h('p', { class: 'muted' }, 'A submission is a JSON weight file, never code: it is checked against the interface and the 5,000-parameter budget, then run by the built-in runtime. Train in Python with the reference runtime (see Guide) or in the Train tab.'),
    h('div', { class: 'actions' }, h('label', { class: 'button', for: 'brain-files' }, 'Choose JSON files…'), fileInput),
    paste,
    h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => { clear(messages); if (paste.value.trim()) importText(paste.value, 'Pasted file'); } }, 'Submit pasted JSON')),
    messages,
  );

  function evaluate(entry: BrainEntry): void {
    evaluating.add(entry.id);
    draw();
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<{ type: string; eval?: EvalResult }>) => {
      w.terminate();
      evaluating.delete(entry.id);
      if (ev.data.eval) entry.eval = ev.data.eval;
      notify();
    };
    w.postMessage({ type: 'eval', id: entry.id, file: entry.file });
  }

  function badge(ok: boolean | null, text: string): HTMLElement {
    return h('span', { class: `badge ${ok === null ? 'pending' : ok ? 'ok' : 'no'}` }, `${ok === null ? '○' : ok ? '✓' : '✗'} ${text}`);
  }

  function draw(): void {
    clear(list);
    list.append(h('h2', {}, `Brains (${state.brains.length})`));
    const standings = state.ladder?.standings ?? null;
    for (const b of state.brains) {
      const m = b.eval ? checkMilestones(b.eval, standings, b.id) : null;
      const meta = b.file.meta ? Object.entries(b.file.meta).map(([k, v]) => `${k}: ${v}`).join(' · ') : '';
      list.append(
        h(
          'article',
          { class: 'brain' },
          h('div', { class: 'brain-head' }, h('h3', {}, b.file.name), h('span', { class: 'tag' }, b.source), h('span', { class: 'num' }, `${b.params.toLocaleString()} params · ${b.file.activation} · ${[84, ...b.file.layers.map((l) => l.bias.length)].join('→')}`)),
          meta ? h('p', { class: 'muted small' }, meta) : null,
          h(
            'div',
            { class: 'badges' },
            badge(m ? m.beatRandom : null, `Beat Random (${b.eval ? pct(b.eval.vsRandom) : '…'} / ${pct(RANDOM_TARGET)})`),
            badge(m ? m.beatScripted : null, `Beat Scripted (${b.eval ? pct(b.eval.vsScripted) : '…'} / >${pct(SCRIPTED_TARGET)})`),
            badge(m?.ladder ? m.ladder.aboveScripted : null, m?.ladder ? `Ladder: #${m.ladder.rank} of ${m.ladder.brains} brains` : 'Ladder: not entered yet'),
          ),
          h(
            'div',
            { class: 'actions' },
            h('button', { type: 'button', disabled: evaluating.has(b.id), onclick: () => evaluate(b) }, evaluating.has(b.id) ? 'Evaluating…' : b.eval ? 'Re-check milestones' : 'Check milestones'),
            h('button', { type: 'button', onclick: () => download(`${slug(b.file.name)}.json`, JSON.stringify(b.file)) }, 'Download'),
            b.source !== 'sample' ? h('button', { type: 'button', class: 'danger', onclick: () => { if (confirm(`Delete ${b.file.name}?`)) removeBrain(b.id); } }, 'Delete') : null,
          ),
        ),
      );
    }
  }

  subscribe(draw);
  draw();
  root.append(upload, list);
  return root;
}
