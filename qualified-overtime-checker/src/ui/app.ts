/**
 * The checker's page: employer settings, the timesheet import with editable
 * columns, the payroll's TT figures, and the results with a week-by-week
 * worksheet per employee. Everything is worked out in the browser. Client
 * files are saved in this browser, or in the signed-in user's account.
 */
import { inYear, needsCorrection, type EmployeeCheck } from '../core/compare';
import { needsRate, newClientFile, reportedFor, runChecks, withReported, type ClientFile } from '../core/clientFile';
import { parseCsv, type CsvTable } from '../core/csv';
import { formatDay, WEEKDAYS } from '../core/dates';
import { employeesOf } from '../core/engine';
import { resultsCsv, STATUS_TEXT, worksheetCsv } from '../core/export';
import { summaryPdf, w2cListCsv, worksheetPdf } from '../core/reports';
import { FIELD_LABELS, FIELDS, guessMapping, importRows, mappingProblems, parseMoney, ssnColumns, type Mapping } from '../core/importer';
import { followIds, importReported, keepKnown } from '../core/reported';
import { headerSignature, mergeLines, periodTotals } from '../core/layout';
import { buildSample, sampleCsv } from '../core/sample';
import { encodeFile, worthSaving, type FileLocation, type FileSummary } from '../core/codec';
import type { BonusAllocation, BonusPeriod, WeekResult } from '../core/types';
import type { Files, FileStore } from '../store/stores';
import { downloadText, fileSlug, fill, h, readFileText, hours, money, signedMoney, uuid } from './dom';

/** Sign-in, when the build has Supabase: the panel, the user, and the account store. */
export interface AuthHooks {
  mount(el: HTMLElement): void;
  onUser(callback: (user: { id: string; email: string | null } | null) => void): void;
  accountStore(): FileStore;
}

export interface AppDeps {
  files: Files;
  auth?: AuthHooks;
  /** Saves a file; PDFs come as bytes with type application/pdf. */
  download?: (name: string, data: string | Uint8Array, type?: string) => void;
  /** Opens the print dialog (window.print by default). */
  print?: () => void;
  now?: () => Date;
  newId?: () => string;
  /** Asks before deleting a file; window.confirm by default. */
  confirm?: (question: string) => boolean;
  /** Milliseconds to wait after a change before saving (default 700; tests pass 0). */
  saveDelay?: number;
  /** Set when the browser blocks storage: files then last only while the tab is open. */
  storageBlocked?: boolean;
}

export const TAX_YEARS = [2026, 2025];

const BONUS_PERIODS: [BonusPeriod, string][] = [
  ['week', 'The workweek of its date'],
  ['month', 'The calendar month of its date'],
  ['quarter', 'The calendar quarter of its date'],
  ['year', 'The calendar year of its date'],
];

interface PendingImport {
  name: string;
  table: CsvTable;
  mapping: Mapping;
  ssn: number[];
  /** The mapping came from the file's saved choice for this layout. */
  saved?: boolean;
}

/** Largest CSV read (a year of time entries for a small employer is a few MB). */
/** Longest employer name kept (the database refuses longer). */
export const MAX_NAME = 120;
/**
 * Largest stored file, in encoded JSON characters. The database refuses 10 MB
 * of jsonb, which is about 2.7 times the JSON text (measured), so an account
 * file stays under 3.5 million characters; localStorage holds about 5 MB in all.
 */
export const MAX_STORED: Record<FileLocation, number> = { account: 3_500_000, browser: 4_000_000 };
const MAX_UPLOAD = 50 * 1024 * 1024;

export async function mountApp(root: HTMLElement, deps: AppDeps): Promise<void> {
  const download = deps.download ?? downloadText;
  const printPage = deps.print ?? (() => window.print());
  const now = deps.now ?? (() => new Date());
  const makeId = deps.newId ?? uuid;
  const ask = deps.confirm ?? ((q: string) => window.confirm(q));

  const files = deps.files;
  const delay = deps.saveDelay ?? 700;
  let user: { id: string; email: string | null } | null = null;
  let file: ClientFile = newClientFile(makeId(), {}, now());
  let location: FileLocation = 'browser';
  let pending: PendingImport | null = null;
  /** For a file that already has hours: replace them, or add the new export to them. */
  let importMode: 'replace' | 'add' = 'replace';
  const open = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saveText = '';
  let saveError = false;

  // Every store write (save, move, delete) runs through one queue, so a save
  // still in flight can never land after a delete or a move.
  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  }
  let dirty = false;
  // Bumped when the signed-in account changes: a save or an open that started
  // under the previous account must not finish under the next one.
  let accountGen = 0;

  /**
   * Writes the open file now (if it is worth keeping and changed) and
   * refreshes the list. Returns false when the save failed.
   */
  async function flush(): Promise<boolean> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty || !worthSaving(file)) return true;
    const snapshot = file;
    const where = location;
    const gen = accountGen;
    const ok = await enqueue(async () => {
      if (where === 'account' && gen !== accountGen) return true; // that account has gone; its copy was offered at the switch
      try {
        await files.store(where).put(snapshot);
        if (file === snapshot) dirty = false;
        saveText = where === 'account' ? 'Saved to your account.' : 'Saved in this browser.';
        saveError = false;
        return true;
      } catch (e) {
        saveText = `Not saved: ${(e as Error).message}`;
        saveError = true;
        say(saveText);
        return false;
      }
    });
    await renderFiles();
    return ok;
  }

  /** Saves before leaving the open file; on failure asks whether to leave it unsaved. */
  async function settle(): Promise<boolean> {
    if (await flush()) return true;
    return ask(`${file.settings.name || 'This file'} could not be saved (${saveText.replace(/^Not saved: /, '')}). Leave it without saving?`);
  }

  /** Marks the file changed; it is saved after a short pause (or at once with saveDelay 0). */
  const save = async () => {
    file = { ...file, updatedAt: now().toISOString() };
    dirty = true;
    if (delay <= 0) return void (await flush());
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), delay);
  };

  root.replaceChildren();
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const privacy = h('p', { class: 'privacy' });
  const filesSec = h('section', { class: 'card', 'aria-labelledby': 'files-h' });
  // Sign-in sits at the top right: the Google button, and the email-link form
  // behind "Use email instead" (both from src/lib/auth.ts mountSignIn).
  const authBox = h('div', { class: 'auth' });
  const emailToggle = h('button', { type: 'button', class: 'link email-toggle', 'aria-expanded': 'false', text: 'Use email instead' });
  const authArea = h('div', { class: 'top-auth', role: 'region', 'aria-label': 'Sign in' }, authBox, emailToggle);
  emailToggle.addEventListener('click', () => {
    const open = !authArea.classList.contains('email-open');
    authArea.classList.toggle('email-open', open);
    emailToggle.setAttribute('aria-expanded', String(open));
    emailToggle.textContent = open ? 'Hide email sign-in' : 'Use email instead';
    if (open) (authBox.querySelector('input[type="email"]') as HTMLInputElement | null)?.focus();
  });
  const employerSec = h('section', { class: 'card', 'aria-labelledby': 'employer-h' });
  const hoursSec = h('section', { class: 'card', 'aria-labelledby': 'hours-h' });
  const reportedSec = h('section', { class: 'card', 'aria-labelledby': 'reported-h' });
  const resultsSec = h('section', { class: 'card', 'aria-labelledby': 'results-h' });

  root.append(
    h('header', { class: 'top' },
      h('div', { class: 'top-bar' }, h('h1', { text: 'Qualified Overtime Checker' }), deps.auth ? authArea : null),
      h('p', { class: 'lede', text: 'Check the overtime figure on your staff’s W-2s (Box 12, code TT) before you file. Upload your timesheet, enter what your payroll calculated, and see who is off and by how much.' }),
      privacy,
    ),
    status,
    filesSec,
    employerSec,
    hoursSec,
    reportedSec,
    resultsSec,
    methodSection(),
  );

  const say = (text: string) => {
    status.textContent = text;
  };

  function renderPrivacy() {
    const where = user
      ? 'Files you save to your account are kept in HintWise\u2019s database (United States) where only you can read them; files kept in this browser never leave it.'
      : `Your files are kept in this browser only.${deps.auth ? ' Sign in to keep them in your account instead.' : ''}`;
    fill(privacy, h('strong', { text: `${where} ` }), 'Social Security numbers are never read or kept: a column that holds them is dropped first. This is a worksheet, not tax advice.');
  }

  // ---- Client files -----------------------------------------------------
  /** Opens a saved file; returns false (with the reason on screen) when it cannot. */
  async function openFile(s: FileSummary): Promise<boolean> {
    if (!(await settle())) return false;
    try {
      const gen = accountGen;
      const next = await files.store(s.location).get(s.id);
      if (s.location === 'account' && gen !== accountGen) return false; // the account changed while it loaded
      if (!next) {
        say(`${s.name || 'That file'} is no longer there.`);
        await renderFiles();
        return false;
      }
      file = next;
      location = s.location;
      dirty = false;
      importMode = 'replace';
    } catch (e) {
      say(`${s.name || 'That file'} could not be opened: ${(e as Error).message}`);
      return false;
    }
    pending = null;
    open.clear();
    saveText = '';
    renderAll();
    say(`Opened ${file.settings.name || 'the file'} (tax year ${file.settings.taxYear}).`);
    return true;
  }

  /** Starts a blank file; the open one is saved first unless it was just deleted. */
  async function newFile(announce = true, discard = false) {
    if (discard && timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!discard && !(await settle())) return;
    file = newClientFile(makeId(), {}, now());
    dirty = false;
    importMode = 'replace';
    location = files.signedIn ? 'account' : 'browser';
    pending = null;
    open.clear();
    saveText = '';
    renderAll();
    if (announce) say('New client file. Give it the employer\u2019s name and import their hours.');
    (document.getElementById('emp-name') as HTMLInputElement | null)?.focus();
  }

  async function moveFile(s: FileSummary, to: FileLocation) {
    if (s.id === file.id && !(await flush())) return;
    try {
      const moved = await enqueue(async () => {
        const f = s.id === file.id ? file : await files.store(s.location).get(s.id);
        if (!f) return false;
        await files.move(f, s.location, to);
        if (s.id === file.id) location = to;
        return true;
      });
      if (!moved) return;
      say(to === 'account' ? `${s.name || 'The file'} is now saved to your account.` : `${s.name || 'The file'} is now kept in this browser only, and removed from your account.`);
    } catch (e) {
      say((e as Error).message);
    }
    saveText = '';
    await renderFiles();
  }

  async function deleteFile(s: FileSummary) {
    if (!ask(`Delete ${s.name || 'this file'} (tax year ${s.taxYear})? This cannot be undone.`)) return;
    if (s.id === file.id && timer) {
      // A pending save of the open file must not bring it back.
      clearTimeout(timer);
      timer = null;
    }
    if (s.id === file.id) dirty = false;
    try {
      await enqueue(() => files.store(s.location).remove(s.id));
    } catch (e) {
      say((e as Error).message);
      return;
    }
    say(`Deleted ${s.name || 'the file'}.`);
    if (s.id === file.id) await newFile(false, true);
    else await renderFiles();
  }

  let listSeq = 0;
  async function renderFiles() {
    const seq = ++listSeq;
    const { files: list, error } = await files.list();
    // A slower, older listing must not draw over a newer one.
    if (seq !== listSeq) return;
    const heading = h('h2', { id: 'files-h', text: 'Client files' });
    const add = h('button', { type: 'button', text: 'New client file' });
    add.addEventListener('click', () => void newFile());
    const where = (l: FileLocation) => (l === 'account' ? 'Your account' : 'This browser');
    const rows = list.map((s) => {
      const current = s.id === file.id;
      const actions: HTMLElement[] = [];
      if (!current) {
        const b = h('button', { type: 'button', class: 'link', 'aria-label': `Open ${s.name || 'unnamed file'} ${s.taxYear}`, text: 'Open' });
        b.addEventListener('click', () => void openFile(s));
        actions.push(b);
      }
      if (files.signedIn) {
        const to: FileLocation = s.location === 'account' ? 'browser' : 'account';
        const b = h('button', { type: 'button', class: 'link', 'aria-label': `${to === 'account' ? 'Save to your account' : 'Keep in this browser only'}: ${s.name || 'unnamed file'} ${s.taxYear}`, text: to === 'account' ? 'Save to account' : 'Keep in browser only' });
        b.addEventListener('click', () => void moveFile(s, to));
        actions.push(b);
      }
      const del = h('button', { type: 'button', class: 'link danger', 'aria-label': `Delete ${s.name || 'unnamed file'} ${s.taxYear}`, text: 'Delete' });
      del.addEventListener('click', () => void deleteFile(s));
      actions.push(del);
      const state = s.employees === 0 ? 'No hours yet' : s.needCorrection ? `${s.needCorrection} of ${s.employees} need correcting` : s.notEntered ? `${s.notEntered} of ${s.employees} not entered` : `${s.employees} checked, none off`;
      return h('tr', { class: current ? 'current' : '', 'aria-current': current ? 'true' : null },
        h('th', { scope: 'row' }, s.name || '(no name yet)', current ? h('span', { class: 'id', text: ' (open)' }) : null),
        h('td', { 'data-label': 'Tax year', text: String(s.taxYear) }),
        h('td', { 'data-label': 'Status', text: state }),
        h('td', { 'data-label': 'Kept in', text: where(s.location) }),
        h('td', { 'data-label': 'Saved', text: new Date(s.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) }),
        h('td', { class: 'actions' }, ...actions),
      );
    });
    fill(filesSec,
      heading,
      deps.auth && !user ? h('p', { class: 'help', text: 'Sign in at the top of the page to keep files in your account and open them on any computer.' }) : null,
      error ? h('p', { class: 'warn', text: error }) : null,
      deps.storageBlocked && !user ? h('p', { class: 'warn', text: `This browser does not let the page save anything (private browsing or site data turned off), so files last only while this tab is open. ${deps.auth ? 'Sign in to keep them, or download' : 'Download'} the CSV and PDF files before closing.` }) : null,
      list.length
        ? h('div', { class: 'scroll', tabindex: 0, role: 'region', 'aria-label': 'Your client files' },
            h('table', { class: 'files' },
              h('caption', { class: 'sr-only', text: 'Your client files' }),
              h('thead', {}, h('tr', {}, ...['Employer', 'Tax year', 'Status', 'Kept in', 'Saved', 'Actions'].map((t) => h('th', { scope: 'col', text: t })))),
              h('tbody', {}, ...rows),
            ))
        : h('p', { class: 'empty', text: 'No saved files yet. A file is saved as soon as it has a name or hours.' }),
      h('div', { class: 'row' }, add, h('span', { class: saveError ? 'save-status bad-text' : 'save-status', text: saveText })),
    );
  }

  // ---- Employer ---------------------------------------------------------
  function renderEmployer() {
    const name = h('input', { id: 'emp-name', type: 'text', value: file.settings.name, autocomplete: 'organization', maxlength: MAX_NAME });
    const year = h('select', { id: 'tax-year' }, ...TAX_YEARS.map((y) => h('option', { value: y, selected: y === file.settings.taxYear, text: String(y) })));
    const start = h('select', { id: 'week-start', 'aria-describedby': 'week-start-help' }, ...WEEKDAYS.map((d, i) => h('option', { value: i, selected: i === file.settings.workweekStart, text: d })));
    name.addEventListener('change', async () => {
      file = { ...file, settings: { ...file.settings, name: name.value.trim().slice(0, MAX_NAME) } };
      await save();
      renderResults();
    });
    year.addEventListener('change', async () => {
      file = { ...file, settings: { ...file.settings, taxYear: Number(year.value) } };
      await save();
      renderReported();
      renderResults();
      say(`Checking tax year ${year.value}.`);
    });
    start.addEventListener('change', async () => {
      file = { ...file, settings: { ...file.settings, workweekStart: Number(start.value) } };
      await save();
      renderResults();
      say(`Workweeks now start on ${WEEKDAYS[Number(start.value)]}.`);
    });
    const minWage = h('input', { id: 'min-wage', type: 'text', inputmode: 'decimal', value: file.settings.minimumWage.toFixed(2), 'aria-describedby': 'min-wage-help' });
    minWage.addEventListener('change', async () => {
      const v = parseMoney(minWage.value);
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        minWage.setAttribute('aria-invalid', 'true');
        say(`"${minWage.value}" is not an hourly wage.`);
        return;
      }
      minWage.removeAttribute('aria-invalid');
      file = { ...file, settings: { ...file.settings, minimumWage: v } };
      await save();
      renderResults();
      say(`Tip-credit hours now count at $${v.toFixed(2)} an hour.`);
    });
    const period = h('select', { id: 'bonus-period', 'aria-describedby': 'bonus-help' },
      ...BONUS_PERIODS.map(([v, t]) => h('option', { value: v, selected: v === file.settings.bonusPeriod, text: t })));
    period.addEventListener('change', async () => {
      file = { ...file, settings: { ...file.settings, bonusPeriod: period.value as BonusPeriod } };
      await save();
      renderResults();
      say('Bonuses re-spread over their period.');
    });
    const alloc = h('select', { id: 'bonus-alloc', 'aria-describedby': 'bonus-help' },
      h('option', { value: 'per-week', selected: file.settings.bonusAllocation === 'per-week', text: 'Equally to each week worked' }),
      h('option', { value: 'per-hour', selected: file.settings.bonusAllocation === 'per-hour', text: 'By hours worked each week' }));
    alloc.addEventListener('change', async () => {
      file = { ...file, settings: { ...file.settings, bonusAllocation: alloc.value as BonusAllocation } };
      await save();
      renderResults();
      say('Bonuses re-spread over their period.');
    });
    const hasBonus = file.lines.some((l) => l.kind === 'bonus');
    fill(employerSec,
      h('h2', { id: 'employer-h', text: '1. Employer' }),
      h('div', { class: 'grid' },
        h('label', { for: 'emp-name' }, 'Employer name'),
        name,
        h('label', { for: 'tax-year' }, 'W-2 tax year'),
        year,
        h('label', { for: 'week-start' }, 'Workweek starts on'),
        start,
      ),
      h('p', { id: 'week-start-help', class: 'help', text: 'Overtime is counted per fixed workweek of seven days, not per pay period. Use the day your workweek starts (most often Sunday).' }),
      h('details', { class: 'more', open: hasBonus },
        h('summary', { text: 'Bonuses and tipped staff' }),
        h('div', { class: 'grid' },
          h('label', { for: 'min-wage' }, 'Minimum wage for tip-credit staff ($/h)'),
          minWage,
          h('label', { for: 'bonus-period' }, 'A bonus line covers'),
          period,
          h('label', { for: 'bonus-alloc' }, 'Spread a bonus'),
          alloc,
        ),
        h('p', { id: 'min-wage-help', class: 'help', text: 'Hours paid below this rate are treated as a cash wage plus a tip credit and count at this rate (federal $7.25, or your state\u2019s tipped minimum wage total). Tips themselves are not part of the regular rate.' }),
        h('p', { id: 'bonus-help', class: 'help', text: 'A bonus, commission or incentive the employee was promised raises the overtime premium of every week it was earned in. When your export has Earned from and Earned to columns they are used; otherwise each bonus covers the week, month, quarter or year of its work date, or, with only a pay date, the period before the one it was paid in. Gifts, discretionary and holiday bonuses, tips and expense reimbursements are left out.' }),
      ),
    );
  }

  // ---- Hours ------------------------------------------------------------
  // Each read of a kind (hours, figures) gets a number; only the newest one is used.
  const readSeq = { hours: 0, figures: 0 };
  // Bumped when the open file's contents are replaced under the same id (the sample on a blank file).
  let fileEpoch = 0;

  async function readFile(f: Blob & { name: string }, then: (name: string, text: string) => void | Promise<void>, kind: 'hours' | 'figures' = 'hours') {
    if (f.size > MAX_UPLOAD) {
      say(`${f.name} is over 50 MB. Export a shorter date range (one tax year) and try again.`);
      return;
    }
    // The file being read belongs to the client file open now; if another one
    // is opened (or the account changes) while it reads, it is not put there.
    const forFile = file.id;
    const gen = accountGen;
    const epoch = fileEpoch;
    const seq = ++readSeq[kind];
    let text: string;
    try {
      text = await readFileText(f);
    } catch {
      // A failed read gives way to the one before it, if that one is still reading.
      if (seq === readSeq[kind]) readSeq[kind]--;
      say(`${f.name} could not be read. Save it as CSV and try again.`);
      return;
    }
    if (file.id !== forFile || accountGen !== gen || fileEpoch !== epoch) {
      say(`${f.name} was not imported: another client file was opened while it was being read.`);
      return;
    }
    if (seq !== readSeq[kind]) {
      say(`${f.name} was not imported: a newer file was chosen while it was being read.`);
      return;
    }
    await then(f.name, text);
  }

  function quoteNote(table: CsvTable): string {
    return table.unclosedQuote ? ` Line ${table.unclosedQuote} opens a quote (") that is never closed, so the rows after it could not be read.` : '';
  }

  function readTable(name: string, text: string) {
    const table = parseCsv(text);
    if (table.rows.length < 2) {
      say(`${name} has no rows under a header line.${quoteNote(table)}`);
      pending = null;
      renderHours();
      return;
    }
    const ssn = ssnColumns(table);
    const saved = file.mappings?.[headerSignature(table.rows[0].cells)];
    // A saved choice for this layout wins, unless it now points at an SSN column.
    const usable = saved && !Object.values(saved).some((i) => i !== null && ssn.includes(i)) ? saved : null;
    const mapping = usable ?? guessMapping(table.rows[0].cells, ssn);
    pending = { name, table, mapping, ssn, saved: usable !== null };
    if (mappingProblems(mapping).length === 0) void applyImport();
    else {
      renderHours();
      say(`Read ${name}. Choose the columns below, then import.`);
    }
  }

  async function applyImport() {
    if (!pending) return;
    const { lines: incoming, report } = importRows(pending.table, pending.mapping);
    if (incoming.length === 0) {
      say(`No usable rows in ${pending.name}. Check the columns.${quoteNote(pending.table)}`);
      renderHours();
      return;
    }
    const totals = periodTotals(incoming, report.dateHeader);
    if (totals.length) {
      say(`${pending.name} gives hours as pay-period totals (two weeks or more per row) for ${totals.slice(0, 3).join(', ')}${totals.length > 3 ? ' and others' : ''}. Overtime is counted per workweek, so the checker needs daily or weekly hours: export a timesheet or a weekly hours report instead.`);
      renderHours();
      return;
    }
    const adding = importMode === 'add' && file.lines.length > 0;
    const merged = adding ? mergeLines(file.lines, incoming) : { lines: incoming, added: incoming.length, duplicates: 0 };
    const lines = merged.lines;
    // A file too big to save would fail at every save: refuse it here instead.
    const size = JSON.stringify(encodeFile({ ...file, lines })).length;
    if (size > MAX_STORED[location] && !(location === 'browser' && deps.storageBlocked)) {
      say(`${pending.name} gives a client file of ${(size / 1e6).toFixed(1)} MB, more than ${location === 'account' ? 'an account file' : 'this browser'} can keep (${MAX_STORED[location] / 1e6} MB). Export one tax year, or fewer employees at a time, and try again.`);
      renderHours();
      return;
    }
    const employees = employeesOf(lines);
    const sig = headerSignature(pending.table.rows[0].cells);
    const source = adding && file.source ? `${file.source} + ${pending.name}` : pending.name;
    const counted = adding ? { ...report, exports: (file.report?.exports ?? 1) + 1, lastExport: pending.name } : report;
    file = { ...file, lines, report: counted, mapping: pending.mapping, mappings: { ...(file.mappings ?? {}), [sig]: pending.mapping }, source };
    // An employee known by name who now has an ID keeps their typed rate and figures.
    file = {
      ...file,
      reported: Object.fromEntries(Object.entries(file.reported).map(([y, v]) => [y, followIds(v, employees)])),
      ...(file.rates ? { rates: followIds(file.rates, employees) } : {}),
    };
    if (!adding) {
      file = withReported(file, keepKnown(reportedFor(file), employees));
      // Typed pay rates stay only for employees still in the file.
      if (file.rates) file = { ...file, rates: keepKnown(file.rates, employees) };
    }
    await save();
    renderEmployer();
    renderHours();
    renderReported();
    renderResults();
    const from = pending.saved ? ' with the columns you chose last time for this layout' : '';
    say(adding
      ? `Added ${merged.added} lines from ${pending.name}${from}${merged.duplicates ? `; ${merged.duplicates} lines were already in the file and were left out` : ''}.`
      : `Imported ${report.linesUsed} lines for ${report.employees} employees from ${pending.name}${from}.`);
  }

  /** The sample opens as a file of its own, so it never replaces a client's data. */
  async function loadSample() {
    if (!(await settle())) return;
    const s = buildSample();
    importMode = 'replace';
    const id = worthSaving(file) ? makeId() : file.id;
    if (id !== file.id) location = files.signedIn ? 'account' : 'browser';
    fileEpoch++;
    open.clear();
    file = withReported({ ...newClientFile(id, s.settings, now()), lines: s.lines, source: 'sample-timesheet.csv' }, s.reported);
    dirty = true;
    const table = parseCsv(s.csv);
    const ssn = ssnColumns(table);
    pending = { name: 'sample-timesheet.csv', table, mapping: guessMapping(table.rows[0].cells, ssn), ssn };
    file.report = importRows(table, pending.mapping).report;
    file.mapping = pending.mapping;
    await save();
    renderAll();
    say('Loaded the sample employer: eight staff (one tipped, one with quarterly bonuses), one year of hours, and the figures a payroll produced.');
    // The button that was clicked is redrawn: put focus where the news is.
    (document.getElementById('results-h') as HTMLElement | null)?.focus();
  }

  function mappingPanel(p: PendingImport): HTMLElement {
    const header = p.table.rows[0].cells;
    const problems = mappingProblems(p.mapping);
    const selects = FIELDS.map((f) => {
      const id = `map-${f}`;
      const sel = h('select', { id },
        h('option', { value: '', text: '(not in this file)' }),
        ...header.map((col, i) => h('option', { value: i, selected: p.mapping[f] === i, disabled: p.ssn.includes(i), text: p.ssn.includes(i) ? `${col || `Column ${i + 1}`} (SSN, ignored)` : col || `Column ${i + 1}` })),
      );
      sel.addEventListener('change', () => {
        p.mapping = { ...p.mapping, [f]: sel.value === '' ? null : Number(sel.value) };
        renderHours();
        (document.getElementById(id) as HTMLSelectElement | null)?.focus();
      });
      return [h('label', { for: id, text: FIELD_LABELS[f] }), sel];
    }).flat();
    const go = h('button', { type: 'button', class: 'primary', disabled: problems.length > 0, text: 'Import with these columns' });
    go.addEventListener('click', () => void applyImport());
    return h('details', { class: 'mapping', open: problems.length > 0 || !file.lines.length },
      h('summary', { text: `Columns used from ${p.name}` }),
      h('div', { class: 'grid' }, ...selects),
      problems.length ? h('ul', { class: 'problems' }, ...problems.map((t) => h('li', { text: t }))) : null,
      go,
    );
  }

  function importReport(): HTMLElement | null {
    const r = file.report;
    if (!r) return null;
    const skipped = r.skipped.length;
    // After "add", the counts are the last export's; the file's totals come first.
    const several = (r.exports ?? 1) > 1;
    return h('div', { class: 'report' },
      several
        ? h('p', { text: `In this file: ${file.lines.length} lines for ${employeesOf(file.lines).length} employees, from ${r.exports} exports (${file.source}).` })
        : null,
      h('p', {},
        h('strong', { text: `${several ? `Last added, ${r.lastExport}` : file.source ?? 'Import'}: ` }),
        `${r.rowsUsed ?? r.linesUsed} of ${r.rowsRead} rows used${r.linesUsed !== (r.rowsUsed ?? r.linesUsed) ? ` (${r.linesUsed} lines)` : ''}, ${r.employees} employees`,
        r.firstDate && r.lastDate ? `, ${formatDay(r.firstDate)} to ${formatDay(r.lastDate)}.` : '.'),
      r.droppedColumns.length ? h('p', { class: 'ok', text: `Dropped as Social Security numbers, never read or kept: ${r.droppedColumns.join(', ')}.` }) : null,
      r.overtimeLines ? h('p', { text: `${r.overtimeLines} lines were paid as overtime; their hours count at the straight rate (the row\u2019s own rate when the export gives it, otherwise the overtime rate divided by 1.5, or 2 for double time).` }) : null,
      r.excludedLines ? h('p', { text: `${r.excludedLines} lines are paid time off (holiday, vacation, sick): not hours worked, left out.` }) : null,
      r.bonusLines ? h('p', { text: `${r.bonusLines} bonus or commission lines are spread over the weeks they were earned in (settings under 1. Employer).` }) : null,
      r.extraLines ? h('p', { text: `${r.extraLines} shift differential or premium lines are added to their week\u2019s pay.` }) : null,
      r.hoursWereTotal ? h('p', { text: 'The hours column is a total that includes overtime, so the overtime columns were taken out of it.' }) : null,
      r.layout ? h('p', { class: r.layout.confirmed ? 'ok' : 'warn', text: `Recognised: ${r.layout.name} export. ${r.layout.note}` }) : null,
      r.notWagesLines ? h('p', { text: `${r.notWagesLines} lines are tips, gifts, discretionary bonuses or expenses: not part of the regular rate, left out.` }) : null,
      r.badPayDates ? h('p', { class: 'warn', text: `${r.badPayDates} pay dates could not be read; those lines take their year from the workweek.` }) : null,
      r.unclosedQuote ? h('p', { class: 'warn', text: `Line ${r.unclosedQuote} opens a quote (") that is never closed, so the rows after it could not be read. Fix that line in the file, or export it again, and import it again.` }) : null,
      skipped
        ? h('details', {},
            h('summary', { text: `${skipped} rows not used` }),
            h('ul', {}, ...r.skipped.slice(0, 200).map((s) => h('li', { text: `Line ${s.line}: ${s.reason}` }))),
            skipped > 200 ? h('p', { text: `and ${skipped - 200} more.` }) : null)
        : null,
    );
  }

  function renderHours() {
    const input = h('input', { id: 'hours-file', type: 'file', accept: '.csv,.txt,text/csv', 'aria-describedby': 'hours-help' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (f) await readFile(f, readTable);
    });
    const sample = h('button', { type: 'button', text: 'Try the sample employer' });
    sample.addEventListener('click', () => void loadSample());
    const sampleLink = h('button', { type: 'button', class: 'link', text: 'Download the sample timesheet' });
    sampleLink.addEventListener('click', () => download('sample-timesheet.csv', sampleCsv()));
    const drop = h('div', { class: 'drop' },
      h('label', { for: 'hours-file', class: 'drop-label' }, 'Timesheet or payroll export (CSV)'),
      input,
      h('p', { id: 'hours-help', class: 'help', text: 'One row per day or shift worked (or one per week): employee, date, hours, and the rate or pay if the export has them. Toast time entries and QuickBooks Online time activities exports are recognised by their columns; overtime, holiday, PTO, bonus and tips rows by their pay type. Drop the file here or choose it.' }),
    );
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer?.files?.[0];
      if (f) await readFile(f, readTable);
    });
    const modeBox = file.lines.length
      ? h('fieldset', { class: 'mode' },
          h('legend', { text: 'This file already has hours. The next export should' }),
          ...(['replace', 'add'] as const).map((m) => {
            const id = `mode-${m}`;
            const radio = h('input', { type: 'radio', name: 'import-mode', id, value: m, checked: importMode === m });
            radio.addEventListener('change', () => {
              if (radio.checked) importMode = m;
            });
            return h('label', { for: id, class: 'radio' }, radio, m === 'replace' ? ' Replace them' : ' Be added to them (rows already imported are left out)');
          }))
      : null;
    fill(hoursSec,
      h('h2', { id: 'hours-h', text: '2. Hours worked' }),
      modeBox,
      drop,
      h('div', { class: 'row' }, sample, sampleLink),
      pending ? mappingPanel(pending) : null,
      importReport(),
    );
  }

  // ---- Payroll figures ---------------------------------------------------
  async function importFigures(name: string, text: string, employees: ReturnType<typeof employeesOf>) {
    const r = importReported(text, employees);
    file = withReported(file, { ...reportedFor(file), ...r.values });
    await save();
    renderReported();
    renderResults();
    const parts = [`Read ${Object.keys(r.values).length} figures from ${name}.`];
    if (r.otherCodes) parts.push(`${r.otherCodes} rows for other Box 12 codes were skipped.`);
    if (r.unmatched.length) parts.push(`${r.unmatched.length} rows named nobody in the timesheet (${r.unmatched.slice(0, 3).map((u) => u.name).join(', ')}${r.unmatched.length > 3 ? ', ...' : ''}).`);
    if (r.unreadable.length) parts.push(`${r.unreadable.length} amounts could not be read (lines ${r.unreadable.slice(0, 5).join(', ')}).`);
    if (r.unclosedQuote) parts.push(`Line ${r.unclosedQuote} opens a quote (") that is never closed, so the rows after it could not be read.`);
    say(parts.join(' '));
  }

  function renderReported() {
    const employees = employeesOf(file.lines);
    if (!employees.length) {
      fill(reportedSec, h('h2', { id: 'reported-h', text: '3. Your payroll’s TT figures' }), h('p', { class: 'empty', text: 'Import hours first; the employees appear here.' }));
      return;
    }
    const input = h('input', { id: 'reported-file', type: 'file', accept: '.csv,.txt,text/csv' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (f) await readFile(f, (name, text) => importFigures(name, text, employeesOf(file.lines)), 'figures');
    });
    const rateFor = new Set(file.lines.filter(needsRate).map((l) => l.employeeKey));
    const showRates = rateFor.size > 0;
    const rows = employees.map((e, n) => {
      const id = `rep-${n}`;
      const rateCell = (() => {
        if (!showRates) return null;
        if (!rateFor.has(e.key)) return h('td', { class: 'muted-cell', text: 'from the file' });
        const v = file.rates?.[e.key];
        const input = h('input', { id: `rate-${n}`, type: 'text', inputmode: 'decimal', value: typeof v === 'number' ? v.toFixed(2) : '', placeholder: '0.00', 'aria-label': `Hourly pay rate for ${e.name}` });
        input.addEventListener('change', async () => {
          const raw = input.value.trim();
          const r = parseMoney(raw);
          const next = { ...(file.rates ?? {}) };
          if (raw === '') delete next[e.key];
          else if (Number.isFinite(r) && r > 0 && r < 1000) next[e.key] = r;
          else {
            input.setAttribute('aria-invalid', 'true');
            say(`"${raw}" is not an hourly rate.`);
            return;
          }
          input.removeAttribute('aria-invalid');
          say('');
          file = { ...file, rates: next };
          await save();
          renderResults();
        });
        return h('td', {}, input);
      })();
      const v = reportedFor(file)[e.key];
      const field = h('input', { id, type: 'text', inputmode: 'decimal', value: typeof v === 'number' ? v.toFixed(2) : '', placeholder: '0.00', 'aria-label': `TT reported for ${e.name}` });
      field.addEventListener('change', async () => {
        const raw = field.value.trim();
        const n = parseMoney(raw);
        const next = { ...reportedFor(file) };
        if (raw === '') delete next[e.key];
        else if (Number.isFinite(n)) next[e.key] = n;
        else {
          field.setAttribute('aria-invalid', 'true');
          say(`"${raw}" is not an amount.`);
          return;
        }
        field.removeAttribute('aria-invalid');
        say('');
        file = withReported(file, next);
        await save();
        renderResults();
      });
      return h('tr', {}, h('th', { scope: 'row', text: e.name }), h('td', { text: e.id }), rateCell, h('td', {}, field));
    });
    fill(reportedSec,
      h('h2', { id: 'reported-h', text: '3. Your payroll’s TT figures' }),
      h('p', { class: 'help', text: 'Enter the Box 12 code TT amount your payroll shows for each employee (from its W-2 preview or year-end report), or import a CSV with a name or ID column and an amount column.' }),
      showRates ? h('p', { class: 'warn', text: 'Your export has hours but no pay rates (a timesheet, or QuickBooks time activities, which show billing rates). Enter each employee\u2019s straight-time hourly pay rate below; overtime lines count at that rate times their multiplier.' }) : null,
      h('div', { class: 'row' }, h('label', { for: 'reported-file', text: 'Import figures (CSV)' }), input),
      h('div', { class: 'scroll', tabindex: 0, role: 'region', 'aria-label': 'TT figures from your payroll' },
        h('table', {},
          h('caption', { class: 'sr-only', text: 'TT figures from your payroll' }),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Employee' }), h('th', { scope: 'col', text: 'ID' }), showRates ? h('th', { scope: 'col', text: 'Hourly pay rate' }) : null, h('th', { scope: 'col', text: 'TT on payroll\u2019s W-2' }))),
          h('tbody', {}, ...rows),
        ),
      ),
    );
  }

  // ---- Results -----------------------------------------------------------
  function weekTable(c: EmployeeCheck): HTMLElement {
    const year = file.settings.taxYear;
    const shown = c.weeks.filter((w) => w.overtimeHours > 0 || w.notes.length > 0);
    const pdf = h('button', { type: 'button', class: 'link', text: `Worksheet for ${c.employee.name} (PDF)` });
    pdf.addEventListener('click', () => download(`tt-worksheet-${fileSlug(c.employee.name)}-${year}.pdf`, worksheetPdf([c], file.settings, now()), 'application/pdf'));
    if (!shown.length) return h('div', {}, h('p', { class: 'empty', text: 'No workweek over 40 hours.' }), pdf);
    const row = (w: WeekResult) =>
      h('tr', { class: w.taxYear === year || w.bonusParts.some((p) => p.taxYear === year) ? '' : 'other-year' },
        h('th', { scope: 'row', class: 'nowrap', text: `${formatDay(w.start)} – ${formatDay(w.end)}` }),
        h('td', { class: 'num', 'data-label': 'Hours', text: hours(w.hours) }),
        h('td', { class: 'num', 'data-label': 'Straight-time pay', text: money(w.straightPay) }),
        h('td', { class: 'num', 'data-label': 'Regular rate', text: `$${w.regularRate.toFixed(4)}` }),
        h('td', { class: 'num', 'data-label': 'Overtime hours', text: hours(w.overtimeHours) }),
        h('td', { class: 'num', 'data-label': `On the ${year} W-2`, text: money(inYear(w, year)) }),
        h('td', { 'data-label': 'Paid on', text: w.payDate ? `${formatDay(w.payDate)}${w.taxYear === year ? '' : ` (${w.taxYear} W-2)`}` : `none (${w.taxYear})` }),
        h('td', { class: 'notes', text: w.notes.join(' ') }),
      );
    return h('div', {},
      h('div', { class: 'scroll', tabindex: 0, role: 'region', 'aria-label': `${c.employee.name}: workweeks` },
        h('table', { class: 'weeks' },
          h('caption', { text: `${c.employee.name}: workweeks with overtime or a note` }),
          h('thead', {}, h('tr', {}, ...['Workweek', 'Hours', 'Straight-time pay', 'Regular rate', 'Overtime hours', `On the ${year} W-2`, 'Paid on', 'Notes'].map((t) => h('th', { scope: 'col', text: t })))),
          h('tbody', {}, ...shown.map(row)),
        ),
      ),
      pdf,
    );
  }

  function renderResults() {
    const heading = h('h2', { id: 'results-h', tabindex: -1, text: '4. Results' });
    if (!file.lines.length) {
      fill(resultsSec, heading, h('p', { class: 'empty', text: 'Results appear once hours are imported. Try the sample employer to see how it works.' }));
      return;
    }
    const { checks, summary } = runChecks(file);
    const year = file.settings.taxYear;
    const lead = summary.rateNeeded
      ? `Enter the hourly pay rate for ${summary.rateNeeded} employee${summary.rateNeeded > 1 ? 's' : ''} in step 3 to check ${summary.rateNeeded > 1 ? 'them' : 'them'}.${summary.needCorrection ? ` ${summary.needCorrection} of the others need correcting for ${year}.` : ''}`
      : summary.needCorrection
      ? `${summary.needCorrection} of ${summary.employees} employees have a TT figure that needs correcting for ${year}.`
      : summary.notEntered === summary.employees
        ? `Enter your payroll’s figures in step 3 to compare. The correct figures for ${year} are below.`
        : `No figure needs correcting for ${year}${summary.notEntered ? ` (${summary.notEntered} not entered yet)` : ''}.`;
    const body: HTMLElement[] = [];
    checks.forEach((c, n) => {
      const key = c.employee.key;
      const detailId = `weeks-${n}`;
      const isOpen = open.has(key);
      const toggle = h('button', { type: 'button', class: 'link', 'data-toggle': n, 'aria-expanded': isOpen ? 'true' : 'false', 'aria-controls': isOpen ? detailId : null, 'aria-label': `${isOpen ? 'Hide' : 'Show'} weeks for ${c.employee.name}`, text: isOpen ? 'Hide weeks' : 'Show weeks' });
      toggle.addEventListener('click', () => {
        if (open.has(key)) open.delete(key);
        else open.add(key);
        renderResults();
        (resultsSec.querySelector(`[data-toggle="${n}"]`) as HTMLElement | null)?.focus();
      });
      const cls = needsCorrection(c.status) ? 'bad' : c.status === 'not-entered' || c.status === 'rate-needed' ? 'muted' : 'good';
      body.push(
        h('tr', {},
          h('th', { scope: 'row' }, c.employee.name, c.employee.id ? h('span', { class: 'id', text: ` ${c.employee.id}` }) : null),
          h('td', { class: 'num', 'data-label': 'Overtime hours', text: hours(c.overtimeHours) }),
          h('td', { class: 'num', 'data-label': 'Weeks with overtime', text: String(c.weeksWithOvertime) }),
          h('td', { class: 'num strong', 'data-label': 'Correct TT', text: c.status === 'rate-needed' ? '\u2014' : money(c.correct) }),
          h('td', { class: 'num', 'data-label': 'Payroll TT', text: money(c.reported) }),
          h('td', { class: 'num', 'data-label': 'Difference', text: signedMoney(c.difference) }),
          h('td', { 'data-label': 'Status' }, h('span', { class: `badge ${cls}`, text: STATUS_TEXT[c.status] }), c.weeklyOnly ? h('span', { class: 'badge muted', text: 'Checked by week only' }) : null, c.causes.length ? h('p', { class: 'cause', text: c.causes.join(' ') }) : null),
          h('td', { class: 'toggle' }, toggle),
        ),
      );
      if (isOpen) body.push(h('tr', { id: detailId, class: 'detail' }, h('td', { colspan: 8 }, weekTable(c))));
    });
    const dlResults = h('button', { type: 'button', text: 'Download results (CSV)' });
    dlResults.addEventListener('click', () => download(`tt-check-${fileSlug(file.settings.name)}-${year}.csv`, resultsCsv(checks, file.settings)));
    const dlWeeks = h('button', { type: 'button', text: 'Week-by-week worksheet (CSV)' });
    dlWeeks.addEventListener('click', () => download(`tt-worksheet-${fileSlug(file.settings.name)}-${year}.csv`, worksheetCsv(checks, file.settings)));
    const slug = fileSlug(file.settings.name);
    const dlSummary = h('button', { type: 'button', class: 'primary', text: 'Employer summary (PDF)' });
    dlSummary.addEventListener('click', () => download(`tt-summary-${slug}-${year}.pdf`, summaryPdf(checks, file.settings, now()), 'application/pdf'));
    const dlSheets = h('button', { type: 'button', text: 'All worksheets (PDF)' });
    dlSheets.addEventListener('click', () => download(`tt-worksheets-${slug}-${year}.pdf`, worksheetPdf(checks, file.settings, now()), 'application/pdf'));
    const flagged = checks.filter((c) => needsCorrection(c.status)).length;
    const dlW2c = h('button', { type: 'button', disabled: flagged === 0, text: `W-2c list (CSV${flagged ? `, ${flagged}` : ''})` });
    dlW2c.addEventListener('click', () => download(`tt-w2c-list-${slug}-${year}.csv`, w2cListCsv(checks, file.settings)));
    const print = h('button', { type: 'button', text: 'Print results' });
    print.addEventListener('click', () => printPage());
    const spill = checks.filter((c) => c.otherYearPremium > 0).length;
    const noPayDates = checks.some((c) => c.yearFromWeekEnd);
    const unplaced = checks.flatMap((c) => c.unallocated.map((u) => `${c.employee.name}, ${u.label}`));
    const weekly = checks.filter((c) => c.weeklyOnly).length;
    fill(resultsSec,
      heading,
      h('p', { class: summary.needCorrection ? 'lead bad-text' : 'lead', text: lead }),
      h('p', { class: 'help', text: `Total TT by the workweek rules: ${money(summary.totalCorrect)}; reported by payroll: ${money(summary.totalReported)}${summary.rateNeeded ? ` (both without the ${summary.rateNeeded} employee${summary.rateNeeded > 1 ? 's' : ''} still waiting for a pay rate)` : ''}.` }),
      spill ? h('p', { class: 'help', text: `${spill} employees have overtime in weeks paid in another year; those weeks count on that year’s W-2 and are shaded in the weeks table.` }) : null,
      weekly ? h('p', { class: 'help', text: `${weekly} employee${weekly > 1 ? 's have' : ' has'} hours as weekly totals: each total is placed in the workweek that contains its date, so check that \u201cWorkweek starts on\u201d matches your export. Daily detail (and so a check of the week boundaries) is not available for them.` }) : null,
      unplaced.length ? h('p', { class: 'warn', text: `${unplaced.length} bonus${unplaced.length > 1 ? 'es' : ''} fell on no worked week of ${unplaced.length > 1 ? 'their' : 'its'} period and raise no rate: ${unplaced.slice(0, 3).join('; ')}${unplaced.length > 3 ? '; ...' : ''}. Check the bonus period setting or the dates.` }) : null,
      noPayDates ? h('p', { class: 'warn', text: 'Some lines have no pay date, so their weeks count in the year the workweek ends. Add a pay date (check date) column for weeks that are paid in January.' }) : null,
      h('div', { class: 'scroll', tabindex: 0, role: 'region', 'aria-label': `TT check for ${year}` },
        h('table', { class: 'results' },
          h('caption', { class: 'sr-only', text: `TT check for ${year}` }),
          h('thead', {}, h('tr', {}, ...['Employee', 'Overtime hours', 'Weeks with overtime', 'Correct TT', 'Payroll TT', 'Difference', 'Status', 'Worksheet'].map((t) => h('th', { scope: 'col', text: t })))),
          h('tbody', {}, ...body),
        ),
      ),
      h('div', { class: 'row downloads' }, dlSummary, dlSheets, dlW2c, dlResults, dlWeeks, print),
    );
  }

  function renderAll() {
    renderPrivacy();
    void renderFiles();
    renderEmployer();
    renderHours();
    renderReported();
    renderResults();
  }

  // Open the most recent saved file, if any; if it cannot be read, start blank and say why.
  const first = (await files.list()).files[0];
  if (!first || !(await openFile(first))) renderAll();
  else say('');

  // Leaving the page (closing, reloading, the Google sign-in redirect): save
  // now. A browser file is written synchronously; an account save is sent and
  // may or may not finish.
  window.addEventListener('pagehide', () => {
    if (!dirty || !worthSaving(file)) return;
    if (timer) clearTimeout(timer);
    timer = null;
    void files.store(location).put(file).catch(() => undefined);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });

  if (deps.auth) {
    const auth = deps.auth;
    auth.mount(authBox);
    auth.onUser((u) => {
      const was = user;
      user = u;
      authArea.classList.toggle('signed-in', u !== null);
      emailToggle.hidden = u !== null;
      const switched = was !== null && (u === null || u.id !== was.id);
      files.setAccount(u ? auth.accountStore() : null);
      renderPrivacy();
      if (switched) accountGen++;
      if (switched && location === 'account') {
        // The open file belongs to the account that just left: never show it to
        // the next user. Unsaved changes are kept as a copy in this browser.
        // Ask first: on a shared computer the next person would see the copy.
        const unsaved = dirty && worthSaving(file) && ask(`You ${u ? 'switched accounts' : 'signed out'}, and the last changes to this file were not saved to the previous account. Keep a copy of the file in this browser? Anyone using this browser could open it.`) ? { ...file, id: makeId() } : null;
        if (timer) clearTimeout(timer);
        timer = null;
        dirty = false;
        void (async () => {
          if (unsaved) await enqueue(() => files.store('browser').put(unsaved)).catch(() => undefined);
          await newFile(false, true);
          say(unsaved
            ? `${u ? 'Switched accounts' : 'Signed out'}. Your last unsaved changes were kept as a copy in this browser; ${u ? 'this account\u2019s files are listed above' : 'files in your account show again when you sign in'}.`
            : u
              ? 'Switched accounts. This account\u2019s files are listed above.'
              : 'Signed out. Files in your account show again when you sign in.');
        })();
        return;
      }
      if (u && location === 'browser' && !worthSaving(file)) location = 'account';
      void renderFiles();
    });
  }
}

function methodSection(): HTMLElement {
  const li = (t: string) => h('li', { text: t });
  return h('section', { class: 'card', 'aria-labelledby': 'method-h' },
    h('h2', { id: 'method-h', text: 'How the figure is worked out' }),
    h('ul', {},
      li('Each employee’s hours are put into fixed seven-day workweeks starting on the day you chose, whatever the pay period (29 CFR 778.104).'),
      li('Regular rate = all straight-time pay for the week divided by all hours worked. With two or more rates it is the weighted average (29 CFR 778.115). Holiday, vacation and sick pay are left out of both.'),
      li('Qualified overtime for the week = hours over 40 × half the regular rate, rounded to the cent. Overtime the FLSA does not require (daily overtime, double time beyond time and a half) is not qualified.'),
      li('A week belongs to the W-2 of the year it is paid as wages (IRS FS-2026-13, Q3): the latest pay date in the week, or the year the week ends when the file has no pay dates.'),
      li('Box 12 code TT shows the full qualified amount. The $12,500 limit ($25,000 joint) applies on the employee\u2019s own return, not to the W-2 figure (FS-2026-13, Q10).'),
      li('A non-discretionary bonus or commission is spread over the weeks it was earned in, equally or by hours (29 CFR 778.209); each share adds share \u00f7 hours \u00d7 half \u00d7 overtime hours, on the W-2 of the year the bonus is paid. Shift differentials add to their week\u2019s pay (778.207).'),
      li('Tip-credit staff count at the minimum wage you set, not their cash wage (29 CFR 531.60); tips, gifts, discretionary bonuses and expense reimbursements are left out (778.208-224).'),
      li('Where your file shows the overtime actually paid, the figure is capped at that premium, and any shortfall is flagged as overtime that looks owed. The extra overtime a bonus causes is assumed paid with the bonus; a payroll that never recalculated it owes it.'),
      li('Differences under $1.00 are shown as rounding.'),
    ),
    h('p', { class: 'help', text: 'Source: IRS fact sheet FS-2026-13 (6 August 2026): the premium is FLSA hours over 40 \u00d7 one-half \u00d7 the FLSA regular rate (Q12), and only the amount the FLSA requires is qualified (Q16). The regular-rate rules for bonuses, differentials and tip credit are the Labor Department\u2019s (29 CFR 778, 531).' }),
    h('p', { class: 'help', text: 'Not covered: the FLSA\u2019s alternative overtime systems (the 8-and-80 system for hospitals, public safety employees under section 7(k), compensatory time under 7(o)), salaried non-exempt staff on a fluctuating workweek, and qualified tips (code TP). State daily overtime is never qualified, so it is simply left out. Leave out exempt employees and owners of 20% or more who work in the business: they cannot claim the deduction (FS-2026-13, Q4-5). Rows the checker cannot use are listed under the import, so you can see what was left out.' }),
  );
}
