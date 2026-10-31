import { LEVELS } from '../core/levels';
import { STAR_THRESHOLDS, parFor } from '../core/grade';
import { h } from './dom';
import { type Progress, download, loadName, loadProgress, saveName, saveProgress } from './store';

interface StudentExport {
  app: 'gpu-parallel-puzzler';
  version: 1;
  student: string;
  exportedAt: string;
  levels: { id: string; title: string; stars: number; bestCycles: number | null; par: number; attempts: number; code: string; launch: { grid: number; block: number } }[];
}

export function exportProgress(name: string, progress: Progress): StudentExport {
  return {
    app: 'gpu-parallel-puzzler',
    version: 1,
    student: name,
    exportedAt: new Date().toISOString(),
    levels: LEVELS.map((l) => {
      const p = progress[l.id];
      return {
        id: l.id,
        title: l.title,
        stars: p?.stars ?? 0,
        bestCycles: p?.bestCycles ?? null,
        par: parFor(l),
        attempts: p?.attempts ?? 0,
        code: p?.code ?? '',
        launch: p?.launch ?? l.starterLaunch,
      };
    }),
  };
}

export function rubricMarkdown(): string {
  const lines = [
    '# GPU Parallel Puzzler: grading rubric',
    '',
    `Each level is worth up to 3 points. 1 point: output correct and no data race. 2 points: within ${STAR_THRESHOLDS.two}× of par. 3 points: within ${STAR_THRESHOLDS.three}× of par (or faster). Par is the simulated GPU time of the reference solution.`,
    '',
    '| # | Level | Concept | Par (cycles) |',
    '|---|---|---|---|',
    ...LEVELS.map((l, i) => `| ${i + 1} | ${l.title} | ${l.concept} | ${parFor(l)} |`),
    '',
    `Total: ${LEVELS.length * 3} points.`,
    '',
  ];
  return lines.join('\n');
}

export function instructorView(): HTMLElement {
  const nameInput = h('input', { type: 'text', value: loadName(), placeholder: 'Your name or student ID', 'aria-label': 'Name for the export', oninput: () => saveName(nameInput.value) });
  const status = h('p', { class: 'muted small', role: 'status' });
  const classTable = h('div', { class: 'table-scroll' });

  function exportJson(): void {
    const name = nameInput.value.trim();
    if (!name) {
      status.textContent = 'Enter a name first, so your instructor can tell exports apart.';
      return;
    }
    const data = exportProgress(name, loadProgress());
    download(`gpu-puzzler-${name.replace(/[^A-Za-z0-9_-]+/g, '_')}.json`, JSON.stringify(data, null, 2));
    status.textContent = `Exported ${data.levels.reduce((a, l) => a + l.stars, 0)} stars.`;
  }

  async function loadClass(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    const students: StudentExport[] = [];
    const bad: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const d = JSON.parse(await f.text()) as StudentExport;
        if (d.app !== 'gpu-parallel-puzzler' || !Array.isArray(d.levels)) throw new Error('not an export');
        students.push(d);
      } catch {
        bad.push(f.name);
      }
    }
    students.sort((a, b) => a.student.localeCompare(b.student));
    const head = h('tr', {}, h('th', {}, 'Student'), ...LEVELS.map((_, i) => h('th', { class: 'num' }, String(i + 1))), h('th', { class: 'num' }, 'Total'));
    const rows = students.map((s) => {
      const by = new Map(s.levels.map((l) => [l.id, l]));
      const total = s.levels.reduce((a, l) => a + (Number(l.stars) || 0), 0);
      return h('tr', {}, h('th', { scope: 'row' }, s.student), ...LEVELS.map((l) => h('td', { class: 'num' }, String(by.get(l.id)?.stars ?? 0))), h('td', { class: 'num' }, String(total)));
    });
    const csv = ['student,' + LEVELS.map((l) => l.id).join(',') + ',total', ...students.map((s) => {
      const by = new Map(s.levels.map((l) => [l.id, l]));
      return [JSON.stringify(s.student), ...LEVELS.map((l) => by.get(l.id)?.stars ?? 0), s.levels.reduce((a, l) => a + (Number(l.stars) || 0), 0)].join(',');
    })].join('\n');
    classTable.replaceChildren(
      h('table', {}, h('thead', {}, head), h('tbody', {}, ...rows)),
      h('div', { class: 'button-row' }, h('button', { type: 'button', class: 'secondary', onclick: () => download('gpu-puzzler-class.csv', csv, 'text/csv') }, 'Download as CSV')),
      bad.length ? h('p', { class: 'muted small' }, `Skipped (not a puzzler export): ${bad.join(', ')}`) : '',
    );
  }

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', multiple: true, 'aria-label': 'Student export files' });
  fileInput.addEventListener('change', () => void loadClass(fileInput.files));

  return h(
    'section',
    { class: 'prose' },
    h('h2', {}, 'Grading'),
    h(
      'p',
      { class: 'lede' },
      'There is no server. Progress lives in this browser. Students export a file; instructors load the files here and get a class table and a CSV. Grading uses the same simulator, so the stars in a file can be re-checked by pasting its code back into the level.',
    ),
    h('div', { class: 'card' }, h('h3', {}, 'Students: export your work'), h('div', { class: 'button-row' }, nameInput, h('button', { type: 'button', onclick: exportJson }, 'Export progress (JSON)')), status),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Instructors'),
      h('div', { class: 'button-row' }, h('button', { type: 'button', class: 'secondary', onclick: () => download('gpu-puzzler-rubric.md', rubricMarkdown(), 'text/markdown') }, 'Download rubric (Markdown)')),
      h('p', {}, 'Load student exports:'),
      fileInput,
      classTable,
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Rubric'),
      h(
        'div',
        { class: 'table-scroll' },
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Level'), h('th', {}, 'Concept'), h('th', { class: 'num' }, 'Par (cycles)'))),
          h('tbody', {}, ...LEVELS.map((l, i) => h('tr', {}, h('td', {}, String(i + 1)), h('td', {}, l.title), h('td', {}, l.concept), h('td', { class: 'num' }, parFor(l).toLocaleString())))),
        ),
      ),
      h('p', { class: 'muted small' }, `1 star: correct and race-free. 2 stars: within ${STAR_THRESHOLDS.two}× par. 3 stars: within ${STAR_THRESHOLDS.three}× par.`),
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Start over'),
      h('button', { type: 'button', class: 'secondary', onclick: () => { if (window.confirm('Erase all progress in this browser?')) { saveProgress({}); status.textContent = 'Progress erased. Reload to start fresh.'; } } }, 'Erase my progress'),
    ),
  );
}
