// @vitest-environment jsdom
/**
 * Milestone 3b: Compile and check. The pure parts (src/core/compile.ts), the
 * checker client (src/lib/checker.ts) against a stub of the worker's API, and
 * the page's flow (src/ui/compile.ts in src/ui/app.ts): the upload notice and
 * the wake line (AC-27), the result (AC-29, AC-30) and the job row (AC-35).
 */
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkerTakes,
  CLAUSE_WORDS,
  CLAUSES_SEEN_IN_FIXTURES,
  clauseRows,
  compiledLine,
  errorWhere,
  failuresLine,
  jobLine,
  jobRecord,
  leftOutOfUpload,
  leftOutOfUploadLine,
  MAPPED_SPECIFICATION,
  plainTexError,
  profileName,
  TEX_ERRORS,
  validationVerdict,
  type CheckerClause,
  type CheckerJob,
  type CheckerValidation,
} from '../src/core/compile';
import { openProject } from '../src/core/project';
import {
  checkerUrl,
  DID_NOT_WAKE,
  follow,
  forget,
  health,
  job as getJob,
  LOST,
  NOT_AVAILABLE,
  pdf,
  submit,
  UNREACHABLE,
  NotAChecker,
  PDF_GONE,
  PDF_SIGN_IN,
  RECORDED_COLD_START_MS,
  SIGN_IN_AGAIN,
  WAKE_LIMIT_MS,
  WAKE_POLL_MS,
  wake,
  WAKING,
  CheckerError,
  type CheckerDeps,
} from '../src/lib/checker';
import { CourseStore, MemoryDb, type JobRow } from '../src/lib/store';
import { mountApp, type Account, type AppDeps, type DroppedFile } from '../src/ui/app';
import { KEPT, NOTICE_KEY, SAVE_TO_KEEP, UPLOAD_NOTICE, jobResult, notTexMessage } from '../src/ui/compile';
import { statusIndex, zipFixture } from './helpers';
import { strToU8, zipSync } from 'fflate';

const NOW = new Date('2026-11-22T12:00:00Z');
const BASE = 'https://checker.test';
const UA2 = 'ISO 14289-2:2024';
const WORKER_REPORT = path.resolve(__dirname, '../../tagging-doctor-worker/test/fixtures/verapdf-math-notes.json');

const clause = (c: string, n: number, testNumber = 1, spec = UA2, description = `veraPDF says ${c}`): CheckerClause => ({ specification: spec, clause: c, testNumber, failedChecks: n, description });
const validation = (over: Partial<CheckerValidation> = {}): CheckerValidation => ({
  profile: 'PDF/UA-2 + Tagged PDF validation profile',
  verapdfVersion: 'veraPDF 1.30.4',
  compliant: false,
  failedRules: 3,
  failedChecks: 4785,
  clauses: [clause('8.2.2', 4668), clause('8.8', 89, 2), clause('8.8', 3, 1), clause('9.9.9', 1)],
  ...over,
});
const doneJob = (over: Partial<CheckerJob> = {}): CheckerJob => ({
  id: 'a'.repeat(32),
  status: 'done',
  mainFile: 'main.tex',
  createdAt: '2026-11-22T12:00:00.000Z',
  startedAt: '2026-11-22T12:00:01.000Z',
  finishedAt: '2026-11-22T12:00:09.000Z',
  result: { pages: 22, seconds: 7.7, warnings: 3, runs: 2, bibliography: null, validation: validation(), validationError: null },
  failure: null,
  logTail: ['(./main.tex', 'Output written on main.pdf (22 pages, 341758 bytes).'],
  pdf: true,
  expiresAt: '2026-11-22T12:30:09.000Z',
  note: 'The PDF and this result are deleted 30 minutes after the check ends, or sooner if the checker restarts or goes to sleep.',
  ...over,
});
const failedJob = (over: Partial<CheckerJob> = {}): CheckerJob =>
  doneJob({
    status: 'failed',
    result: null,
    failure: { kind: 'compile-error', message: 'LuaLaTeX stopped with an error.', error: { file: 'chapters/ch1.tex', line: 12, message: 'Undefined control sequence.' } },
    logTail: Array.from({ length: 50 }, (_, i) => `log line ${i + 1}`),
    pdf: false,
    ...over,
  });

describe('what goes to the checker (AC-32, S2-9)', () => {
  it('takes the checker\'s file types only, and names the files left out', () => {
    for (const p of ['main.tex', 'sub/a.STY', 'figs/x.png', 'refs.bib', 'notes.txt', 'f.pdf']) expect(checkerTakes(p), p).toBe(true);
    for (const p of ['notes.docx', 'data.csv', 'run.sh', '.tex', 'figs/.png', 'Makefile']) expect(checkerTakes(p), p).toBe(false);
    const files = Object.fromEntries(['main.tex', 'a.csv', 'b.docx', 'c.sh', 'd.xlsx', 'e.py', 'f.R', 'fig.png'].map((n) => [n, strToU8('x')]));
    const project = openProject('p.zip', zipSync(files));
    expect(leftOutOfUpload(project)).toEqual(['a.csv', 'b.docx', 'c.sh', 'd.xlsx', 'e.py', 'f.R']);
    expect(leftOutOfUploadLine(leftOutOfUpload(project))).toBe('6 files are not sent, because the checker does not use their type: a.csv, b.docx, c.sh, d.xlsx, e.py, and 1 more.');
    expect(leftOutOfUploadLine(['a.csv'])).toBe('1 file is not sent, because the checker does not use their type: a.csv.');
    expect(leftOutOfUploadLine([])).toBe('');
  });
});

describe('AC-30: veraPDF\'s failures by clause, in plain words', () => {
  it('groups rules by clause with their counts added, most frequent first, and at most 20', () => {
    const rows = clauseRows(validation().clauses);
    expect(rows.map((r) => [r.clause, r.failedChecks, r.plain])).toEqual([
      ['8.2.2', 4668, true],
      ['8.8', 92, true],
      ['9.9.9', 1, false],
    ]);
    expect(rows[2].words).toBe('veraPDF says 9.9.9');
    const many = Array.from({ length: 30 }, (_, i) => clause(`7.${i}`, 100 - i));
    expect(clauseRows(many)).toHaveLength(20);
    expect(clauseRows(many)[0].clause).toBe('7.0');
  });

  it('uses the map only for clauses of PDF/UA-2; another specification\'s clause keeps veraPDF\'s words', () => {
    const rows = clauseRows([clause('8.2.2', 5, 1, 'ISO 32005:2023', 'tagged PDF words')]);
    expect(rows[0]).toMatchObject({ plain: false, words: 'tagged PDF words' });
    expect(clauseRows([clause('constructor', 1)])[0].plain).toBe(false);
  });

  it('maps at least 10 clauses, every clause seen in the fixtures among them, and every clause of the real math-notes report', () => {
    expect(MAPPED_SPECIFICATION).toBe(UA2);
    expect(Object.keys(CLAUSE_WORDS).length).toBeGreaterThanOrEqual(10);
    for (const c of CLAUSES_SEEN_IN_FIXTURES) expect(CLAUSE_WORDS[c], c).toBeTruthy();
    const report = JSON.parse(fs.readFileSync(WORKER_REPORT, 'utf8')) as {
      report: { jobs: { validationResult: { details: { ruleSummaries: { specification: string; clause: string }[] } }[] }[] };
    };
    const seen = report.report.jobs[0].validationResult[0].details.ruleSummaries;
    expect(seen.length).toBeGreaterThan(0);
    for (const r of seen) expect(clauseRows([clause(r.clause, 1, 1, r.specification)])[0].plain, r.clause).toBe(true);
    // Plain words: no "shall", which is the standard's voice.
    for (const [c, w] of Object.entries(CLAUSE_WORDS)) expect(w, c).not.toMatch(/\bshall\b/);
  });

  it('R3b.1-6: the words of each mapped clause fit every test veraPDF\'s profile has for it', () => {
    const profile = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/verapdf-ua2-mapped-rules.json'), 'utf8')) as { rules: { clause: string; test: number; description: string }[] };
    // For each test of the profile, what the words must say (checked by hand against its description).
    const fits: Record<string, Record<number, RegExp>> = {
      '5': { 1: /metadata/, 2: /pdfuaid:part 2/, 3: /wrong form/, 4: /wrong form/, 5: /pdfuaid:rev 2024/ },
      '6.1': { 1: /PDF 2\.0/ },
      '6.2': { 1: /Marked true/ },
      '8.2.1': { 1: /no structure tree/, 2: /does not name its parent/ },
      '8.2.2': { 1: /neither tagged nor marked as decoration/ },
      '8.2.4': { 1: /not mapped to one it knows/, 2: /goes in a circle/, 3: /within its own namespace/, 4: /not mapped to one it knows/ },
      '8.2.5.2': { 1: /single Document element/, 2: /PDF 2\.0 namespace/ },
      '8.2.5.20': { 1: /not inside a Link or Reference tag/, 2: /different places share one tag/ },
      '8.2.5.26': { 1: /cells overlap/, 2: /columns have different lengths/, 3: /rows/, 4: /rows/, 5: /which header cells belong/, 6: /which header cells belong/ },
      '8.2.5.28.2': { 1: /alternate text/ },
      '8.4.3': { 1: /need an ActualText or alternate text/, 2: /must not use the private use area itself/, 3: /must not use the private use area itself/ },
      '8.4.4': { 1: /language is not set/, 2: /not a language tag/ },
      '8.8': { 1: /page position instead of at the tagged element/, 2: /page position instead of at the tagged element/ },
      '8.9.3.3': { 1: /Tabs entry/ },
      '8.11.1': { 1: /no title/, 2: /metadata is missing/ },
      '8.11.2': { 1: /DisplayDocTitle/ },
    };
    expect(Object.keys(fits).sort()).toEqual(Object.keys(CLAUSE_WORDS).sort());
    for (const [clause, words] of Object.entries(CLAUSE_WORDS)) {
      const tests = profile.rules.filter((r) => r.clause === clause).map((r) => r.test);
      expect(tests.length, clause).toBeGreaterThan(0);
      // Every test of the clause has its words, and no other.
      expect(Object.keys(fits[clause]).map(Number), clause).toEqual(tests);
      for (const t of tests) expect(words, `${clause} test ${t}`).toMatch(fits[clause][t]);
    }
  });

  it('says passed or did not pass, names the profile and the version, and never claims conformance', () => {
    expect(validationVerdict(validation())).toBe('Did not pass the PDF/UA-2 + Tagged PDF check');
    expect(validationVerdict(validation({ compliant: true }))).toBe('Passed the PDF/UA-2 + Tagged PDF check');
    expect(profileName('')).toBe('PDF/UA');
    expect(failuresLine(validation())).toBe('3 rules failed, 4,785 checks in all.');
    expect(failuresLine(validation({ failedRules: 1, failedChecks: 1 }))).toBe('1 rule failed, 1 check in all.');
    expect(failuresLine(validation({ failedRules: 0, failedChecks: 0 }))).toBe('No rule failed.');
    const shown = jobResult(doneJob()).map((e) => e.textContent).join(' ');
    expect(shown).toContain('Checked against PDF/UA-2 + Tagged PDF validation profile by veraPDF 1.30.4.');
    expect(shown).not.toMatch(/is compliant|is accessible|fully accessible|ADA compliant/i);
  });
});

describe('AC-29: the compile in plain words', () => {
  it('shows the page count, the time and the warnings', () => {
    expect(compiledLine({ pages: 22, seconds: 7.66, warnings: 3 })).toBe('22 pages, compiled in 7.7 s, 3 LaTeX warnings.');
    expect(compiledLine({ pages: 1, seconds: 1, warnings: 1 })).toBe('1 page, compiled in 1.0 s, 1 LaTeX warning.');
    expect(compiledLine({ pages: null, seconds: 1, warnings: 0 })).toBe('The page count was not found in the log, compiled in 1.0 s, 0 LaTeX warnings.');
  });

  it('puts at least 10 common TeX errors in plain words, and leaves others in TeX\'s', () => {
    expect(TEX_ERRORS.length).toBeGreaterThanOrEqual(10);
    expect(plainTexError('Undefined control sequence.')).toMatch(/^A command is not defined/);
    expect(plainTexError("LaTeX Error: File `tabu.sty' not found.")).toMatch(/^The file tabu\.sty was not found/);
    expect(plainTexError('Missing $ inserted.')).toMatch(/math/);
    expect(plainTexError('LaTeX Error: Environment foo undefined.')).toBe('The environment foo is not defined. Load the package that defines it, or check its name.');
    expect(plainTexError('LaTeX Error: \\begin{itemize} on input line 4 ended by \\end{enumerate}.')).toMatch(/opened on line 4 is closed by \\end\{enumerate\}/);
    expect(plainTexError('Package minted Error: You must invoke LaTeX with the -shell-escape flag.')).toMatch(/outside programs/);
    expect(plainTexError('Something new')).toBeNull();
    expect(errorWhere({ file: 'a.tex', line: 3, message: '' })).toBe('In a.tex, line 3');
    expect(errorWhere({ file: 'a.tex', line: null, message: '' })).toBe('In a.tex');
    expect(errorWhere({ file: null, line: 4, message: '' })).toBe('On line 4');
    expect(errorWhere({ file: null, line: null, message: '' })).toBe('');
  });

  it('R3b.1-5: a missing file of a type the page does not send is not called missing from the zip; one it sends still is', () => {
    expect(plainTexError("! Package pgfplots Error: Could not read table file 'data/marks.csv'. File `data/marks.csv' not found.")).toBe(
      'The checker does not take .csv files, so data/marks.csv was not sent; the compile needs it.',
    );
    expect(plainTexError("LaTeX Error: File `helpers.lua' not found.")).toBe('The checker does not take .lua files, so helpers.lua was not sent; the compile needs it.');
    expect(plainTexError("LaTeX Error: File `Fig.DAT' not found.")).toBe('The checker does not take .dat files, so Fig.DAT was not sent; the compile needs it.');
    // Types the page sends, and a name with no type: "add it" is right.
    expect(plainTexError("LaTeX Error: File `tabu.sty' not found.")).toBe('The file tabu.sty was not found. Add it to the zip, or check its name; packages outside TeX Live are not installed on the checker.');
    expect(plainTexError("! I can't find file `ch2.tex'. File `ch2.tex' not found.")).toBe('The file ch2.tex was not found. Add it to the zip, or check its name.');
    expect(plainTexError("File `figs/plot.png' not found.")).toBe('The file figs/plot.png was not found. Add it to the zip, or check its name.');
    expect(plainTexError("File `README' not found.")).toBe('The file README was not found. Add it to the zip, or check its name.');
    // Fonts are never sent: the words do not ask for one in the zip.
    const font = plainTexError('luaotfload | db : Reload initiated (formats: otf,ttf,ttc); reason: Font "Foo" not found.');
    expect(font).toBe('A font was not found. Use a font installed with TeX Live: the checker does not take font files.');
    expect(font).not.toMatch(/zip/);
  });

  it('has a sample for each entry of the error map, each read by its own entry', () => {
    const samples = [
      'Undefined control sequence.',
      "LaTeX Error: File `tabu.sty' not found.",
      "! I can't find file `x.tex'. File `x.tex' not found.",
      'Missing $ inserted.',
      'LaTeX Error: Missing \\begin{document}.',
      'LaTeX Error: Environment foo undefined.',
      'LaTeX Error: \\begin{a} on input line 3 ended by \\end{b}.',
      'Extra }, or forgotten $.',
      'Missing } inserted.',
      "Too many }'s.",
      'Runaway argument?',
      'Paragraph ended before \\textbf was complete.',
      'LaTeX Error: Option clash for package xcolor.',
      'LaTeX Error: Can be used only in preamble.',
      'Missing number, treated as zero.',
      'Illegal unit of measure (pt inserted).',
      'LaTeX Error: Unknown graphics extension: .eps.',
      'Emergency stop.',
      'luaotfload | db : Reload initiated (formats: otf,ttf,ttc); reason: Font "Foo" not found.',
      'Package pdftex.def Error: run with -shell-escape.',
      'Package pythontex Error: missing output.',
    ];
    expect(samples).toHaveLength(TEX_ERRORS.length);
    TEX_ERRORS.forEach(([re], i) => {
      const first = TEX_ERRORS.findIndex(([r]) => r.test(samples[i]));
      expect(first, samples[i]).toBe(i);
      expect(re.test(samples[i])).toBe(true);
      expect(plainTexError(samples[i]), samples[i]).toBeTruthy();
    });
  });

  it('shows the first error with its file and line in plain words, TeX\'s own words, and the last 50 log lines', () => {
    const els = jobResult(failedJob());
    const text = els.map((e) => e.textContent).join('\n');
    expect(text).toContain('Did not compile');
    expect(text).toContain('In chapters/ch1.tex, line 12: A command is not defined.');
    expect(text).toContain('TeX said: “Undefined control sequence.”');
    const log = els.find((e) => e.classList.contains('log-tail')) as HTMLElement;
    expect(log.querySelector('summary')?.textContent).toBe('The last 50 lines of the log');
    expect(log.querySelector('pre')?.textContent?.split('\n')).toHaveLength(50);
    // An error that is not in the map is shown in TeX's words.
    const other = jobResult(failedJob({ failure: { kind: 'compile-error', message: 'LuaLaTeX stopped with an error.', error: { file: null, line: null, message: 'Something new' } } }));
    expect(other.map((e) => e.textContent).join(' ')).toContain('Something new');
    // A timeout has no error, only the checker's message.
    const timeout = jobResult(failedJob({ failure: { kind: 'timeout', message: 'The compile took longer than 2 minutes, so it was stopped.', error: null }, logTail: [] }));
    expect(timeout.map((e) => e.textContent).join(' ')).toContain('took longer than 2 minutes');
  });

  it('says so when veraPDF could not check the PDF', () => {
    const els = jobResult(doneJob({ result: { pages: 1, seconds: 1, warnings: 0, runs: 1, bibliography: 'biber', validation: null, validationError: 'veraPDF could not check this PDF.' } }));
    const text = els.map((e) => e.textContent).join(' ');
    expect(text).toContain('veraPDF could not check this PDF.');
    expect(text).toContain('The bibliography was made with biber; LuaLaTeX ran 1 times.');
  });
});

describe('AC-35: the job row holds a summary, no PDF and no source', () => {
  it('keeps the kind, status, timings, counts and failures by clause, and no log line', () => {
    const r = jobRecord(doneJob());
    expect(r).toEqual({
      kind: 'check',
      status: 'done',
      started_at: '2026-11-22T12:00:01.000Z',
      finished_at: '2026-11-22T12:00:09.000Z',
      result: {
        pages: 22,
        seconds: 7.7,
        warnings: 3,
        runs: 2,
        bibliography: null,
        profile: 'PDF/UA-2 + Tagged PDF validation profile',
        verapdfVersion: 'veraPDF 1.30.4',
        passed: false,
        failedRules: 3,
        failedChecks: 4785,
        failures: [
          { clause: '8.2.2', failedChecks: 4668 },
          { clause: '8.8', failedChecks: 92 },
          { clause: '9.9.9', failedChecks: 1 },
        ],
      },
      error: null,
    });
    expect(JSON.stringify(r)).not.toContain('Output written');
    const f = jobRecord(failedJob(), 'patched-check');
    expect(f).toMatchObject({ kind: 'patched-check', status: 'failed', result: null });
    expect(f?.error).toBe('compile-error: LuaLaTeX stopped with an error. In chapters/ch1.tex, line 12: Undefined control sequence.');
    expect(JSON.stringify(f)).not.toContain('log line');
    expect(jobRecord(doneJob({ status: 'running' }))).toBeNull();
    const long = jobRecord(failedJob({ failure: { kind: 'compile-error', message: 'x'.repeat(5000), error: null } }));
    expect(long?.error?.length).toBe(4000);
  });

  it('reads as one line in the history', () => {
    expect(jobLine(jobRecord(doneJob()) as NonNullable<ReturnType<typeof jobRecord>>)).toBe('22 pages, compiled in 7.7 s, 3 LaTeX warnings. Did not pass the PDF/UA-2 + Tagged PDF check (3 rules failed).');
    expect(jobLine(jobRecord(failedJob()) as NonNullable<ReturnType<typeof jobRecord>>)).toBe('Did not compile. LuaLaTeX stopped with an error. In chapters/ch1.tex, line 12: Undefined control sequence.');
    const noCheck = jobRecord(doneJob({ result: { pages: 1, seconds: 1, warnings: 0, runs: 1, bibliography: null, validation: null, validationError: 'x' } }));
    expect(jobLine(noCheck as NonNullable<typeof noCheck>)).toBe('1 page, compiled in 1.0 s, 0 LaTeX warnings. The PDF could not be checked.');
    const pass = jobRecord(doneJob({ result: { ...doneJob().result!, validation: validation({ compliant: true, failedRules: 0, failedChecks: 0, clauses: [] }) } }));
    expect(jobLine(pass as NonNullable<typeof pass>)).toBe('22 pages, compiled in 7.7 s, 3 LaTeX warnings. Passed the PDF/UA-2 + Tagged PDF check.');
    expect(jobLine({ status: 'done', result: null, error: null })).toBe('Compiled.');
    expect(jobLine({ status: 'queued', result: null, error: null })).toBe('Status: queued.');
    expect(jobLine({ status: 'failed', result: null, error: null })).toBe('Did not compile.');
  });
});

// ---- The checker client, against a stub of the worker's API --------------------

interface Stub {
  deps: CheckerDeps;
  calls: { method: string; url: string; auth: string | null; body: Uint8Array | null }[];
  /** How the health route answers: 'ok', 'off' (compile false), 'asleep' (no answer), or a function of the call number. */
  health: 'ok' | 'off' | 'asleep' | ((n: number) => 'ok' | 'asleep');
  /** The job's statuses, one per GET, then the last one forever. */
  sequence: CheckerJob[];
  submitAnswer: { status: number; body: unknown; headers?: Record<string, string> } | null;
  clock: number;
}

function stub(over: Partial<Pick<Stub, 'health' | 'sequence' | 'submitAnswer'>> = {}): Stub {
  const s: Stub = { calls: [], health: 'ok', sequence: [doneJob({ status: 'queued', result: null }), doneJob({ status: 'running', result: null }), doneJob()], submitAnswer: null, clock: 0, ...over, deps: undefined as unknown as CheckerDeps };
  let healthCalls = 0;
  let gets = 0;
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const fetchStub = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const auth = (init.headers as Record<string, string> | undefined)?.authorization ?? null;
    s.calls.push({ method, url, auth, body: init.body instanceof Uint8Array ? init.body : null });
    if (url === `${BASE}/api/health`) {
      const n = healthCalls++;
      const mode = typeof s.health === 'function' ? s.health(n) : s.health;
      if (mode === 'asleep') throw new TypeError('Failed to fetch');
      return json(200, { status: 'ok', compile: mode !== 'off', texlive: 'TeX Live 2026', verapdf: 'veraPDF 1.30.4' });
    }
    if (url.startsWith(`${BASE}/api/jobs?`) && method === 'POST') {
      if (s.submitAnswer) return json(s.submitAnswer.status, s.submitAnswer.body, s.submitAnswer.headers);
      return json(202, s.sequence[0]);
    }
    if (url.endsWith('/pdf')) return new Response('%PDF-1.7', { status: 200 });
    if (url.startsWith(`${BASE}/api/jobs/`) && method === 'GET') {
      const j = s.sequence[Math.min(++gets, s.sequence.length - 1)];
      return json(200, j);
    }
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return json(404, { error: 'Not found.' });
  };
  s.deps = {
    base: BASE,
    fetch: fetchStub as typeof fetch,
    sleep: async (ms) => {
      s.clock += ms;
    },
    now: () => s.clock,
    healthTimeoutMs: 20,
  };
  return s;
}

describe('the checker\'s address and build flag', () => {
  it('is one value, and only with the flag on', () => {
    expect(checkerUrl({ VITE_COMPILE_CHECK: 'on', VITE_CHECKER_URL: 'https://tagging-doctor-worker.onrender.com/' })).toBe('https://tagging-doctor-worker.onrender.com');
    expect(checkerUrl({ VITE_COMPILE_CHECK: 'on', VITE_CHECKER_URL: 'https://hub.example.org/tagging-doctor' })).toBe('https://hub.example.org/tagging-doctor');
    expect(checkerUrl({ VITE_COMPILE_CHECK: 'on', VITE_CHECKER_URL: 'http://localhost:10000' })).toBe('http://localhost:10000');
    expect(checkerUrl({ VITE_COMPILE_CHECK: 'off', VITE_CHECKER_URL: 'https://x.org' })).toBeNull();
    expect(checkerUrl({ VITE_CHECKER_URL: 'https://x.org' })).toBeNull();
    for (const bad of ['', ' ', 'not a url', 'http://x.org', 'ftp://x.org', 'https://x.org/?a=1', 'https://u:p@x.org', 'https://x.org/#h']) {
      expect(checkerUrl({ VITE_COMPILE_CHECK: 'on', VITE_CHECKER_URL: bad }), bad).toBeNull();
    }
    expect(checkerUrl({ VITE_COMPILE_CHECK: 'on', VITE_CHECKER_URL: 42 })).toBeNull();
  });
});

describe('AC-27: waking the checker', () => {
  it('starts at once when the checker answers', async () => {
    const s = stub();
    const ticks: number[] = [];
    await expect(wake(s.deps, (t) => ticks.push(t))).resolves.toMatchObject({ compile: true });
    expect(ticks).toEqual([]);
  });

  it('shows the elapsed seconds and asks every 3 seconds until it answers', async () => {
    const s = stub({ health: (n) => (n < 5 ? 'asleep' : 'ok') });
    const ticks: number[] = [];
    await wake(s.deps, (t) => ticks.push(t));
    expect(ticks).toEqual([0, 3, 6, 9, 12]);
    expect(s.calls.filter((c) => c.url.endsWith('/api/health'))).toHaveLength(6);
    expect(WAKE_POLL_MS).toBe(3000);
  });

  it('gives up after the longer of 120 s and twice the recorded cold start', async () => {
    expect(WAKE_LIMIT_MS).toBe(Math.max(120_000, 2 * (RECORDED_COLD_START_MS ?? 0)));
    // AC-68's cold start on the live worker (D-96): 12.6 s, so the wait stays 120 s.
    expect(RECORDED_COLD_START_MS).toBe(12_633);
    expect(WAKE_LIMIT_MS).toBe(120_000);
    const s = stub({ health: 'asleep' });
    const ticks: number[] = [];
    await expect(wake(s.deps, (t) => ticks.push(t))).rejects.toThrow(DID_NOT_WAKE);
    expect(ticks.at(-1)).toBe(117);
    expect(s.clock).toBe(120_000);
  });

  it('treats an answer slower than the timeout as asleep', async () => {
    const s = stub();
    s.deps.fetch = (() => new Promise(() => {})) as typeof fetch;
    await expect(health(s.deps)).resolves.toBeNull();
    s.deps.fetch = (async () => new Response('no', { status: 502 })) as typeof fetch;
    await expect(health(s.deps)).resolves.toBeNull();
  });

  it('says the checker is not available when it cannot compile', async () => {
    const s = stub({ health: 'off' });
    await expect(wake(s.deps, () => {})).rejects.toThrow(NOT_AVAILABLE);
  });

  it('stops when the page no longer wants it', async () => {
    const s = stub({ health: 'asleep' });
    await expect(wake(s.deps, () => {}, 120_000, () => true)).rejects.toThrow('stale');
  });
});

describe('sending a project and following its job', () => {
  it('sends the zip with the token and the main file, and follows the job to the end', async () => {
    const s = stub();
    const first = await submit(s.deps, new Uint8Array([1, 2, 3]), 'sub dir/main.tex', 'tok');
    const post = s.calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe(`${BASE}/api/jobs?mainFile=sub%20dir%2Fmain.tex&mode=check`);
    expect(post?.auth).toBe('Bearer tok');
    const seen: string[] = [];
    const end = await follow(s.deps, first, async () => 'tok', (j) => seen.push(j.status));
    expect(seen).toEqual(['queued', 'running', 'done']);
    expect(end.status).toBe('done');
    expect(s.calls.filter((c) => c.method === 'GET' && c.url.includes('/api/jobs/')).every((c) => c.auth === 'Bearer tok')).toBe(true);
  });

  it('gives the checker\'s own message and Retry-After for a refusal', async () => {
    const s = stub({ submitAnswer: { status: 429, body: { error: 'You have used your 5 checks for this hour. Try again in 12 minutes.' }, headers: { 'retry-after': '700' } } });
    const e = (await submit(s.deps, new Uint8Array(1), 'main.tex', 't').catch((x: unknown) => x)) as CheckerError;
    expect(e).toBeInstanceOf(CheckerError);
    expect(e.message).toBe('You have used your 5 checks for this hour. Try again in 12 minutes.');
    expect(e.retryAfter).toBe(700);
    const s2 = stub({ submitAnswer: { status: 500, body: 'not json' } });
    s2.deps.fetch = (async () => new Response('oops', { status: 500 })) as typeof fetch;
    await expect(submit(s2.deps, new Uint8Array(1), 'main.tex', 't')).rejects.toThrow('The checker answered 500.');
    s2.deps.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(submit(s2.deps, new Uint8Array(1), 'main.tex', 't')).rejects.toThrow(UNREACHABLE);
    await expect(getJob(s2.deps, 'x', 't')).rejects.toThrow(UNREACHABLE);
  });

  it('says a job the checker lost is lost, and rides out a short loss of connection', async () => {
    const s = stub();
    s.deps.fetch = (async () => new Response(JSON.stringify({ error: 'There is no such check.' }), { status: 404 })) as typeof fetch;
    await expect(getJob(s.deps, 'x', 't')).rejects.toThrow(LOST);
    s.deps.fetch = (async () => new Response(JSON.stringify({ error: 'Sign in to use the checker.' }), { status: 401 })) as typeof fetch;
    await expect(getJob(s.deps, 'x', 't')).rejects.toThrow('Sign in to use the checker.');
    // Two lost polls, then the answer.
    const t = stub();
    const real = t.deps.fetch;
    let n = 0;
    t.deps.fetch = (async (i: RequestInfo | URL, init?: RequestInit) => {
      if (String(i).includes('/api/jobs/') && n++ < 2) throw new TypeError('Failed to fetch');
      return real(i, init);
    }) as typeof fetch;
    const seen: string[] = [];
    const end = await follow(t.deps, doneJob({ status: 'queued', result: null }), async () => 't', (j) => seen.push(j.status));
    expect(seen).toEqual(['queued', 'running', 'done']);
    expect(end.status).toBe('done');
    // Lost for more than a minute: an error.
    const u = stub();
    u.deps.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(follow(u.deps, doneJob({ status: 'queued', result: null }), async () => 't', () => {})).rejects.toThrow(UNREACHABLE);
    await expect(follow(u.deps, doneJob({ status: 'queued', result: null }), async () => 't', () => {}, () => true)).rejects.toThrow('stale');
  });

  it('fetches the PDF and deletes a job', async () => {
    const s = stub();
    const t = async () => 't';
    // Its size, not its text: jsdom's Blob has no text() on every Node the CI runs.
    const got = await pdf(s.deps, 'x', t);
    expect('blob' in got && got.blob.size).toBe('%PDF-1.7'.length);
    await forget(s.deps, 'x', t);
    expect(s.calls.at(-1)).toMatchObject({ method: 'DELETE', url: `${BASE}/api/jobs/x`, auth: 'Bearer t' });
    const before = s.calls.length;
    await forget(s.deps, 'x', async () => null);
    expect(s.calls.length).toBe(before);
    s.deps.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await pdf(s.deps, 'x', t)).toEqual({ error: UNREACHABLE });
    await expect(forget(s.deps, 'x', t)).resolves.toBeUndefined();
  });

  it('R3b.1-2: asks for the token before each poll and each download, and tells a PDF that is gone from a sign-in that ended', async () => {
    const s = stub();
    let n = 0;
    const token = async () => `tok${++n}`;
    await follow(s.deps, doneJob({ status: 'queued', result: null }), token, () => {});
    const polls = s.calls.filter((c) => c.method === 'GET' && c.url.includes('/api/jobs/')).map((c) => c.auth);
    expect(polls).toEqual(['Bearer tok1', 'Bearer tok2']);
    // The sign-in ended mid-check.
    await expect(follow(s.deps, doneJob({ status: 'queued', result: null }), async () => null, () => {})).rejects.toThrow(SIGN_IN_AGAIN);
    // The PDF: 200, 404 (gone), 401 (sign in), no token, another answer.
    const got = await pdf(s.deps, 'x', token);
    expect('blob' in got).toBe(true);
    expect(s.calls.at(-1)?.auth).toBe('Bearer tok3');
    const answer = (status: number, body: unknown = {}) => {
      s.deps.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    };
    answer(404);
    expect(await pdf(s.deps, 'x', token)).toEqual({ error: PDF_GONE });
    answer(401);
    expect(await pdf(s.deps, 'x', token)).toEqual({ error: PDF_SIGN_IN });
    expect(await pdf(s.deps, 'x', async () => null)).toEqual({ error: PDF_SIGN_IN });
    answer(500, { error: 'The checker had an internal error.' });
    expect(await pdf(s.deps, 'x', token)).toEqual({ error: 'The checker had an internal error.' });
  });

  it('R3b.1-8: a 502, 503 or 504 while polling is ridden out like a lost connection; other answers are not', async () => {
    for (const status of [502, 503, 504]) {
      const t = stub();
      const real = t.deps.fetch;
      let k = 0;
      t.deps.fetch = (async (i: RequestInfo | URL, init?: RequestInit) => {
        if (String(i).includes('/api/jobs/') && k++ < 2) return new Response('Bad gateway', { status });
        return real(i, init);
      }) as typeof fetch;
      const end = await follow(t.deps, doneJob({ status: 'queued', result: null }), async () => 't', () => {});
      expect(end.status, String(status)).toBe('done');
    }
    // Past a minute of them, an error; and a 500 ends the check at once, as before.
    const u = stub();
    u.deps.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
    await expect(follow(u.deps, doneJob({ status: 'queued', result: null }), async () => 't', () => {})).rejects.toThrow('The checker answered 503.');
    u.deps.fetch = (async () => new Response(JSON.stringify({ error: 'The checker had an internal error.' }), { status: 500 })) as typeof fetch;
    const at = u.clock;
    await expect(follow(u.deps, doneJob({ status: 'queued', result: null }), async () => 't', () => {})).rejects.toThrow('The checker had an internal error.');
    expect(u.clock - at).toBe(2000);
  });
});

describe('R3b.1-3: the wake asks every 3 seconds, and only sleep reads as asleep', () => {
  it('starts a request every 3 s also when each one waits for its timeout', async () => {
    const s = stub();
    let n = 0;
    const starts: number[] = [];
    // Render holds the request: each takes the whole 3 s timeout, on the test's clock.
    s.deps.healthTimeoutMs = 3000;
    s.deps.fetch = ((_: RequestInfo | URL, init?: RequestInit) => {
      starts.push(s.clock);
      if (n++ >= 3) return Promise.resolve(new Response(JSON.stringify({ status: 'ok', compile: true }), { status: 200 }));
      return new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }) as typeof fetch;
    const realSetTimeout = globalThis.setTimeout;
    // The 3 s timeout passes on the test's clock at once.
    globalThis.setTimeout = ((fn: () => void, ms?: number) =>
      realSetTimeout(() => {
        s.clock += ms ?? 0;
        fn();
      }, 0)) as typeof setTimeout;
    try {
      const ticks: number[] = [];
      await wake(s.deps, (t) => ticks.push(t));
      expect(starts).toEqual([0, 3000, 6000, 9000]);
      expect(ticks).toEqual([3, 6, 9]);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  it('reads 502, 503, 504, no connection and no answer as asleep, and any other answer as not the checker', async () => {
    for (const status of [502, 503, 504]) {
      const s = stub();
      s.deps.fetch = (async () => new Response('', { status })) as typeof fetch;
      await expect(health(s.deps), String(status)).resolves.toBeNull();
    }
    for (const [status, body] of [[404, 'Not Found'], [200, '<html>not the checker</html>'], [200, '{"status":"ok"}'], [403, '{}']] as const) {
      const s = stub();
      s.deps.fetch = (async () => new Response(body, { status })) as typeof fetch;
      await expect(health(s.deps), `${status} ${body}`).rejects.toBeInstanceOf(NotAChecker);
      // The wake says so at once, not after two minutes.
      await expect(wake(s.deps, () => {})).rejects.toThrow(NOT_AVAILABLE);
      expect(s.clock).toBe(0);
    }
  });
});

// ---- The page ---------------------------------------------------------------------

const idx = statusIndex();

function file(name: string, bytes: Uint8Array): DroppedFile {
  return { name, arrayBuffer: async () => bytes.slice().buffer };
}

async function settle(n = 12) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

function account(store: CourseStore, signedIn = true, token: string | null = 'tok') {
  const cbs: ((u: { id: string } | null) => void)[] = [];
  let user = signedIn ? { id: 'u1' } : null;
  const a: Account = {
    mountSignIn: (el) => {
      el.replaceChildren();
      return () => el.replaceChildren();
    },
    onUser: (cb) => {
      cbs.push(cb);
      cb(user);
    },
    store: () => store,
    token: async () => token,
  };
  return {
    account: a,
    set(u: { id: string } | null) {
      user = u;
      for (const cb of cbs) cb(u);
    },
  };
}

function page(s: Stub, opts: { signedIn?: boolean; token?: string | null; session?: Map<string, string>; compile?: boolean } = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app') as HTMLElement;
  const session = opts.session ?? new Map<string, string>();
  const db = new MemoryDb('u1', () => NOW);
  const store = new CourseStore(db);
  const acc = account(store, opts.signedIn ?? true, opts.token === undefined ? 'tok' : opts.token);
  const blobs: { name: string; blob: Blob }[] = [];
  const deps: AppDeps = {
    loadStatus: async () => idx,
    now: () => NOW,
    session: { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => void session.set(k, v), removeItem: (k) => void session.delete(k) },
    download: () => {},
    pause: async () => {},
    account: acc.account,
    confirm: () => true,
    compile: opts.compile === false ? undefined : { checker: s.deps, downloadBlob: (name, blob) => void blobs.push({ name, blob }) },
  };
  const app = mountApp(root, deps);
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const button = (label: string) => ([...root.querySelectorAll('button')] as HTMLButtonElement[]).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
  return { app, root, q, button, db, store, acc, session, blobs };
}

const PROJECT = zipSync({
  'main.tex': strToU8('\\documentclass{article}\n\\usepackage{tabu}\n\\begin{document}\nHi\n\\end{document}\n'),
  'figs/a.png': new Uint8Array([137, 80, 78, 71]),
  'notes.docx': strToU8('word'),
  'grades.csv': strToU8('alice,A'),
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the page: Compile and check (AC-27, AC-29, AC-30, AC-35)', () => {
  it('offers Compile and check only when signed in and the build turns it on', async () => {
    const s = stub();
    const t = page(s, { signedIn: false });
    await t.app.handleFile(file('p.zip', PROJECT));
    expect(t.button('Compile and check').hidden).toBe(true);
    t.acc.set({ id: 'u1' });
    expect(t.button('Compile and check').hidden).toBe(false);
    t.acc.set(null);
    expect(t.button('Compile and check').hidden).toBe(true);
    const off = page(s, { compile: false });
    await off.app.handleFile(file('p.zip', PROJECT));
    expect(off.button('Compile and check')).toBeUndefined();
  });

  it('shows the upload notice before the first upload of a session, and sends nothing until asked', async () => {
    const s = stub();
    const t = page(s);
    await t.app.handleFile(file('p.zip', PROJECT));
    t.button('Compile and check').click();
    await settle();
    expect(t.q('#compile .upload-notice').textContent).toBe(UPLOAD_NOTICE);
    expect(t.q('#compile').textContent).toContain('1 file is not sent, because the checker does not use their type: notes.docx.');
    expect(s.calls).toEqual([]);
    t.button('Upload and check').click();
    await settle(30);
    expect(t.session.get(NOTICE_KEY)).toBe('1');
    // The upload: the checker's file types only, never a student record.
    const post = s.calls.find((c) => c.method === 'POST');
    expect(Object.keys(unzipSync(post?.body as Uint8Array)).sort()).toEqual(['figs/a.png', 'main.tex']);
    expect(post?.auth).toBe('Bearer tok');
    expect(s.calls[0].url).toBe(`${BASE}/api/health`);
  });

  it('later in the session it starts at once, the notice still shown', async () => {
    const s = stub();
    const t = page(s, { session: new Map([[NOTICE_KEY, '1']]) });
    await t.app.handleFile(file('p.zip', PROJECT));
    t.button('Compile and check').click();
    await settle(30);
    expect(t.q('#compile .upload-notice').textContent).toBe(UPLOAD_NOTICE);
    expect(s.calls.some((c) => c.method === 'POST')).toBe(true);
    expect(t.q('#compile').textContent).toContain('22 pages, compiled in 7.7 s, 3 LaTeX warnings.');
  });

  it('shows the wake line with the elapsed seconds while the checker wakes', async () => {
    const s = stub({ health: (n) => (n < 3 ? 'asleep' : 'ok') });
    const lines: string[] = [];
    const t = page(s, { session: new Map([[NOTICE_KEY, '1']]) });
    await t.app.handleFile(file('p.zip', PROJECT));
    const status = () => t.q('#compile .compile-status')?.textContent ?? '';
    const real = s.deps.sleep;
    s.deps.sleep = async (ms) => {
      lines.push(status());
      await real(ms);
    };
    t.button('Compile and check').click();
    await settle(40);
    expect(lines.slice(0, 3)).toEqual([`${WAKING} (0 s)`, `${WAKING} (3 s)`, `${WAKING} (6 s)`]);
    expect(t.q('#compile').textContent).toContain('Compiled');
  });

  it('shows an error with a retry when the checker does not wake, and the retry starts again', async () => {
    const s = stub({ health: 'asleep' });
    const t = page(s, { session: new Map([[NOTICE_KEY, '1']]) });
    await t.app.handleFile(file('p.zip', PROJECT));
    t.button('Compile and check').click();
    await settle(400);
    expect(t.q('#compile [role="alert"]').textContent).toBe(DID_NOT_WAKE);
    s.health = 'ok';
    t.button('Try again').click();
    await settle(30);
    expect(t.q('#compile').textContent).toContain('22 pages');
  });

  it('shows the checker\'s refusal in its own words', async () => {
    const s = stub({ submitAnswer: { status: 429, body: { error: 'The checker is busy, try again in a minute.' }, headers: { 'retry-after': '60' } } });
    const t = page(s, { session: new Map([[NOTICE_KEY, '1']]) });
    await t.app.handleFile(file('p.zip', PROJECT));
    t.button('Compile and check').click();
    await settle(30);
    expect(t.q('#compile [role="alert"]').textContent).toBe('The checker is busy, try again in a minute.');
    const off = page(stub({ health: 'off' }), { session: new Map([[NOTICE_KEY, '1']]) });
    await off.app.handleFile(file('p.zip', PROJECT));
    off.button('Compile and check').click();
    await settle(30);
    expect(off.q('#compile [role="alert"]').textContent).toBe(NOT_AVAILABLE);
    const noToken = page(stub(), { session: new Map([[NOTICE_KEY, '1']]), token: null });
    await noToken.app.handleFile(file('p.zip', PROJECT));
    noToken.button('Compile and check').click();
    await settle(30);
    expect(noToken.q('#compile [role="alert"]').textContent).toMatch(/^Sign in again to compile/);
  });

  it('given an unsaved scan, shows the result on the page only with "Save to keep this result", and writes no job row; saving keeps it', async () => {
    const s = stub();
    const t = page(s, { session: new Map([[NOTICE_KEY, '1']]) });
    await t.app.handleFile(file('p.zip', PROJECT));
    t.button('Compile and check').click();
    await settle(30);
    expect(t.q('#compile').textContent).toContain('Did not pass the PDF/UA-2 + Tagged PDF check');
    const rows = [...t.q('#compile table.clauses').querySelectorAll('tbody tr')].map((r) => r.getAttribute('data-clause'));
    expect(rows).toEqual(['8.2.2', '8.8', '9.9.9']);
    expect(t.button(SAVE_TO_KEEP)).toBeTruthy();
    expect(await t.db.select('jobs')).toEqual([]);
    // Save to keep this result: the save dialog, then the row.
    t.button(SAVE_TO_KEEP).click();
    await settle();
    (t.q('#save-course-name') as HTMLInputElement).value = 'Calculus';
    t.q('#save form').dispatchEvent(new Event('submit'));
    await settle(30);
    const jobs = await t.db.select<JobRow>('jobs');
    expect(jobs).toHaveLength(1);
    const scans = await t.db.select<{ id: string; project_id: string }>('scans');
    expect(jobs[0]).toMatchObject({ kind: 'check', status: 'done', scan_id: scans[0].id, project_id: scans[0].project_id, error: null });
    expect(jobs[0].result).toMatchObject({ pages: 22, warnings: 3, passed: false });
    expect(t.q('#compile').textContent).toContain(KEPT);
  });

  it('given a saved scan, writes the job row when the job ends, and the history shows it', async () => {
    const s = stub({ sequence: [failedJob({ status: 'queued', failure: null, logTail: [] }), failedJob()] });
    const t = page(s, { session: new Map([[NOTICE_KEY, '1']]) });
    await t.app.handleFile(file('p.zip', PROJECT));
    t.button('Save').click();
    await settle();
    (t.q('#save-course-name') as HTMLInputElement).value = 'Calculus';
    t.q('#save form').dispatchEvent(new Event('submit'));
    await settle(30);
    t.button('Compile and check').click();
    await settle(30);
    expect(t.q('#compile').textContent).toContain('In chapters/ch1.tex, line 12: A command is not defined.');
    expect(t.q('#compile').textContent).toContain(KEPT);
    const jobs = await t.db.select<JobRow>('jobs');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'failed', result: null });
    const project = (await t.db.select<{ id: string }>('projects'))[0];
    await t.app.route(`#/project/${project.id}`);
    await settle();
    expect(t.q('#page').textContent).toContain('Did not compile. LuaLaTeX stopped with an error.');
  });

  it('downloads the PDF, and a new drop or another person closes the panel', async () => {
    const s = stub();
    const t = page(s, { session: new Map([[NOTICE_KEY, '1']]) });
    await t.app.handleFile(file('p.zip', PROJECT));
    t.button('Compile and check').click();
    await settle(30);
    t.button('Download the PDF').click();
    await settle();
    expect(t.blobs.map((b) => b.name)).toEqual(['main.pdf']);
    t.acc.set({ id: 'u2' });
    expect(t.q('#compile')).toBeNull();
    t.acc.set({ id: 'u1' });
    t.button('Compile and check').click();
    await settle(30);
    await t.app.handleFile(file('q.zip', zipFixture('blockers')));
    expect(t.q('#compile')).toBeNull();
  });

  it('Cancel and Close leave no panel, and a cancelled run draws nothing later', async () => {
    const s = stub();
    const t = page(s);
    await t.app.handleFile(file('p.zip', PROJECT));
    t.button('Compile and check').click();
    await settle();
    t.button('Cancel').click();
    expect(t.q('#compile')).toBeNull();
    expect(s.calls).toEqual([]);
    t.button('Compile and check').click();
    await settle();
    t.button('Upload and check').click();
    t.button('Cancel').click();
    await settle(30);
    expect(t.q('#compile')).toBeNull();
  });
});

describe('the page: round 1 of the m3b review', () => {
  const seen = () => new Map([[NOTICE_KEY, '1']]);

  async function saveAs(t: ReturnType<typeof page>, course: string, label = 'Save') {
    t.button(label).click();
    await settle();
    (t.q('#save-course-name') as HTMLInputElement).value = course;
    t.q('#save form').dispatchEvent(new Event('submit'));
    await settle(30);
  }

  it('R3b.1-1 (a): a second person\'s save does not keep the first person\'s check; the same person back keeps it', async () => {
    const s = stub();
    const t = page(s, { session: seen() });
    await t.app.handleFile(file('p.zip', PROJECT));
    t.button('Compile and check').click();
    await settle(30);
    expect(t.button(SAVE_TO_KEEP)).toBeTruthy();
    t.acc.set(null);
    t.acc.set({ id: 'u2' });
    await settle();
    await saveAs(t, 'Physics');
    expect(await t.db.select('jobs')).toEqual([]);
    // The same person again (SIGNED_IN when the tab is shown): the check stays theirs, and their save keeps it.
    const s2 = stub();
    const t2 = page(s2, { session: seen() });
    await t2.app.handleFile(file('p.zip', PROJECT));
    t2.button('Compile and check').click();
    await settle(30);
    t2.acc.set({ id: 'u1' });
    await settle();
    await saveAs(t2, 'Calculus', SAVE_TO_KEEP);
    expect(await t2.db.select('jobs')).toHaveLength(1);
  });

  it('R3b.1-1 (b): a second person\'s check is not filed under the first person\'s scan; the same person\'s is', async () => {
    const s = stub();
    const t = page(s, { session: seen() });
    await t.app.handleFile(file('p.zip', PROJECT));
    await saveAs(t, 'Calculus');
    const u1scan = (await t.db.select<{ id: string }>('scans'))[0].id;
    t.acc.set(null);
    t.acc.set({ id: 'u2' });
    await settle();
    t.button('Compile and check').click();
    await settle(30);
    expect((await t.db.select<JobRow>('jobs')).filter((j) => j.scan_id === u1scan)).toEqual([]);
    expect(t.button(SAVE_TO_KEEP)).toBeTruthy();
    // The same person throughout: filed under their saved scan.
    const t2 = page(stub(), { session: seen() });
    await t2.app.handleFile(file('p.zip', PROJECT));
    await saveAs(t2, 'Calculus');
    t2.acc.set({ id: 'u1' });
    t2.button('Compile and check').click();
    await settle(30);
    const scan = (await t2.db.select<{ id: string }>('scans'))[0].id;
    expect((await t2.db.select<JobRow>('jobs')).map((j) => j.scan_id)).toEqual([scan]);
  });

  it('R3b.1-2: each poll and the PDF download ask for the token of the moment, and a sign-in that ended is not called a deleted PDF', async () => {
    const s = stub();
    const t = page(s, { session: seen() });
    let n = 0;
    t.acc.account.token = async () => `tok${++n}`;
    await t.app.handleFile(file('p.zip', PROJECT));
    t.button('Compile and check').click();
    await settle(30);
    const polls = s.calls.filter((c) => c.method === 'GET' && c.url.includes('/api/jobs/')).map((c) => c.auth);
    expect(polls.length).toBeGreaterThan(1);
    expect(new Set(polls).size).toBe(polls.length);
    const before = n;
    t.button('Download the PDF').click();
    await settle();
    expect(s.calls.filter((c) => c.url.endsWith('/pdf')).at(-1)?.auth).toBe(`Bearer tok${before + 1}`);
    expect(t.blobs).toHaveLength(1);
    // The checker refuses the token (401): the page asks for a sign-in, and says nothing of a deleted PDF.
    const real = s.deps.fetch;
    s.deps.fetch = (async (u: RequestInfo | URL, i?: RequestInit) => (String(u).endsWith('/pdf') ? new Response('{"error":"Sign in to use the checker."}', { status: 401 }) : real(u, i))) as typeof fetch;
    t.button('Download the PDF').click();
    await settle();
    expect(t.q('#compile [role="alert"]').textContent).toBe(PDF_SIGN_IN);
    // A PDF that is gone (404) is still called gone.
    s.deps.fetch = (async (u: RequestInfo | URL, i?: RequestInit) => (String(u).endsWith('/pdf') ? new Response('{"error":"Not found."}', { status: 404 }) : real(u, i))) as typeof fetch;
    t.button('Download the PDF').click();
    await settle();
    expect(t.q('#compile [role="alert"]').textContent).toBe(PDF_GONE);
    expect(t.blobs).toHaveLength(1);
  });

  it('R3b.1-4: a main file that is not .tex is told at once, and nothing is sent; a .tex one is sent', async () => {
    const s = stub();
    const t = page(s, { session: seen() });
    await t.app.handleFile(file('p.zip', zipSync({ 'thesis.ltx': strToU8('\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n') })));
    t.button('Compile and check').click();
    await settle(30);
    expect(t.q('#compile [role="alert"]').textContent).toBe(notTexMessage('thesis.ltx'));
    expect(notTexMessage('thesis.ltx')).toBe('The checker compiles .tex main files only; rename thesis.ltx to thesis.tex to check it.');
    expect(s.calls).toEqual([]);
    t.button('Close').click();
    expect(t.q('#compile')).toBeNull();
    const ok = stub();
    const u = page(ok, { session: seen() });
    await u.app.handleFile(file('p.zip', PROJECT));
    u.button('Compile and check').click();
    await settle(30);
    expect(ok.calls.find((c) => c.method === 'POST')?.url).toContain('mainFile=main.tex');
  });

  it('R3b.1-7: Cancel after the upload, and Close after the result, delete the job on the checker', async () => {
    const s = stub({ sequence: [doneJob({ status: 'queued', result: null }), doneJob({ status: 'running', result: null }), doneJob({ status: 'running', result: null }), doneJob()] });
    const t = page(s, { session: seen() });
    await t.app.handleFile(file('p.zip', PROJECT));
    const real = s.deps.sleep;
    let cancelled = false;
    s.deps.sleep = async (ms) => {
      // The first wait between polls: the job is on the checker.
      if (!cancelled && s.calls.some((c) => c.method === 'POST')) {
        cancelled = true;
        t.button('Cancel').click();
      }
      await real(ms);
    };
    t.button('Compile and check').click();
    await settle(30);
    expect(cancelled).toBe(true);
    expect(t.q('#compile')).toBeNull();
    const id = doneJob().id;
    expect(s.calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([`${BASE}/api/jobs/${id}`]);
    // Close after the result.
    const s2 = stub();
    const t2 = page(s2, { session: seen() });
    await t2.app.handleFile(file('p.zip', PROJECT));
    t2.button('Compile and check').click();
    await settle(30);
    expect(s2.calls.some((c) => c.method === 'DELETE')).toBe(false);
    t2.button('Close').click();
    await settle();
    expect(s2.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });

  it('R3b.1-7: Cancel while the upload is on its way deletes the job once its id is known', async () => {
    const s = stub();
    const t = page(s, { session: seen() });
    await t.app.handleFile(file('p.zip', PROJECT));
    const real = s.deps.fetch;
    s.deps.fetch = (async (u: RequestInfo | URL, i?: RequestInit) => {
      if (i?.method === 'POST') t.button('Cancel').click();
      return real(u, i);
    }) as typeof fetch;
    t.button('Compile and check').click();
    await settle(30);
    expect(t.q('#compile')).toBeNull();
    expect(s.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(s.calls.some((c) => c.method === 'GET' && c.url.includes('/api/jobs/'))).toBe(false);
  });

  it('R3b.1-7: a double click on "Upload and check" starts one check and does not cancel it', async () => {
    const s = stub();
    const t = page(s);
    await t.app.handleFile(file('p.zip', PROJECT));
    t.button('Compile and check').click();
    await settle();
    // Two clicks at the same place: the first button of the actions, twice.
    const at = () => t.q('#compile .actions button') as HTMLButtonElement;
    at().click();
    at().click();
    await settle(30);
    expect(t.q('#compile')).not.toBeNull();
    expect(t.q('#compile').textContent).toContain('22 pages');
    expect(s.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(s.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});
