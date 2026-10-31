/** Experiment log for the required ablation: every finished training run, exportable as Markdown or CSV. */
export interface RunRecord {
  id: string;
  name: string;
  hidden: string;
  activation: string;
  params: number;
  method: string;
  teacher: string;
  games: number;
  epochs: number;
  generations: number;
  seed: number;
  vsRandom: number;
  vsScripted: number;
  seconds: number;
  at: string;
}

const COLS: (keyof RunRecord)[] = ['name', 'hidden', 'activation', 'params', 'method', 'teacher', 'games', 'epochs', 'generations', 'seed', 'vsRandom', 'vsScripted', 'seconds'];

function fmt(v: RunRecord[keyof RunRecord]): string {
  return typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(3) : String(v);
}

export function toCsv(runs: readonly RunRecord[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [COLS.join(','), ...runs.map((r) => COLS.map((c) => esc(fmt(r[c]))).join(','))].join('\n') + '\n';
}

export function toMarkdown(runs: readonly RunRecord[]): string {
  const head = `| ${COLS.join(' | ')} |\n|${COLS.map(() => '---').join('|')}|`;
  const rows = runs.map((r) => `| ${COLS.map((c) => fmt(r[c]).replace(/\|/g, '\\|')).join(' | ')} |`);
  return [
    '## Ablation',
    '',
    head,
    ...rows,
    '',
    'Scores are the fraction of points over 16 fixed openings played with both colours (32 games per opponent).',
    '',
    '### What the budget forced me to give up',
    '',
    '_Write two or three sentences comparing the runs above._',
    '',
  ].join('\n');
}

/** Groups runs that differ only in parameter count or method, for a quick side-by-side. */
export function summarize(runs: readonly RunRecord[]): { bestRandom: RunRecord | null; bestScripted: RunRecord | null; smallestAbove: RunRecord | null } {
  const by = (k: 'vsRandom' | 'vsScripted') => runs.reduce<RunRecord | null>((b, r) => (!b || r[k] > b[k] || (r[k] === b[k] && r.params < b.params) ? r : b), null);
  const smallestAbove = runs.filter((r) => r.vsScripted > 0.5).reduce<RunRecord | null>((b, r) => (!b || r.params < b.params ? r : b), null);
  return { bestRandom: by('vsRandom'), bestScripted: by('vsScripted'), smallestAbove };
}
