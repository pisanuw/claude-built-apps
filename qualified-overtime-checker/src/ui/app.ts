/**
 * The checker's page: employer settings, the timesheet import with editable
 * columns, the payroll's TT figures, and the results with a week-by-week
 * worksheet per employee. Everything runs in the browser; the client file is
 * kept through the repository (in the tab until sign-in arrives).
 */
import { needsCorrection, type EmployeeCheck } from '../core/compare';
import { newClientFile, runChecks, type ClientFile } from '../core/clientFile';
import { parseCsv, type CsvTable } from '../core/csv';
import { formatDay, WEEKDAYS } from '../core/dates';
import { employeesOf } from '../core/engine';
import { resultsCsv, STATUS_TEXT, worksheetCsv } from '../core/export';
import { FIELD_LABELS, FIELDS, guessMapping, importRows, mappingProblems, parseMoney, ssnColumns, type Mapping } from '../core/importer';
import { importReported, keepKnown } from '../core/reported';
import { buildSample, sampleCsv } from '../core/sample';
import type { WeekResult } from '../core/types';
import type { Repository } from '../lib/repository';
import { downloadText, fileSlug, fill, h, readFileText, hours, money, signedMoney } from './dom';

export interface AppDeps {
  repo: Repository<ClientFile>;
  download?: (name: string, text: string) => void;
  now?: () => Date;
  newId?: () => string;
}

export const TAX_YEARS = [2026, 2025];

interface PendingImport {
  name: string;
  table: CsvTable;
  mapping: Mapping;
  ssn: number[];
}

export async function mountApp(root: HTMLElement, deps: AppDeps): Promise<void> {
  const download = deps.download ?? downloadText;
  const now = deps.now ?? (() => new Date());
  const makeId = deps.newId ?? (() => `file-${now().getTime()}`);

  const existing = await deps.repo.list();
  let file: ClientFile = existing[0] ?? newClientFile(makeId(), {}, now());
  let pending: PendingImport | null = null;
  const open = new Set<string>();

  const save = async () => {
    file = { ...file, updatedAt: now().toISOString() };
    await deps.repo.put(file);
  };

  root.replaceChildren();
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const employerSec = h('section', { class: 'card', 'aria-labelledby': 'employer-h' });
  const hoursSec = h('section', { class: 'card', 'aria-labelledby': 'hours-h' });
  const reportedSec = h('section', { class: 'card', 'aria-labelledby': 'reported-h' });
  const resultsSec = h('section', { class: 'card', 'aria-labelledby': 'results-h' });

  root.append(
    h('header', { class: 'top' },
      h('h1', { text: 'Qualified Overtime Checker' }),
      h('p', { class: 'lede', text: 'Check the overtime figure on your staff’s W-2s (Box 12, code TT) before you file. Upload your timesheet, enter what your payroll calculated, and see who is off and by how much.' }),
      h('p', { class: 'privacy' },
        h('strong', { text: 'Your data stays in this browser tab. ' }),
        'Social Security numbers are ignored: a column that holds them is dropped before anything is read. This is a worksheet, not tax advice.'),
    ),
    status,
    employerSec,
    hoursSec,
    reportedSec,
    resultsSec,
    methodSection(),
  );

  const say = (text: string) => {
    status.textContent = text;
  };

  // ---- Employer ---------------------------------------------------------
  function renderEmployer() {
    const name = h('input', { id: 'emp-name', type: 'text', value: file.settings.name, autocomplete: 'organization' });
    const year = h('select', { id: 'tax-year' }, ...TAX_YEARS.map((y) => h('option', { value: y, selected: y === file.settings.taxYear, text: String(y) })));
    const start = h('select', { id: 'week-start', 'aria-describedby': 'week-start-help' }, ...WEEKDAYS.map((d, i) => h('option', { value: i, selected: i === file.settings.workweekStart, text: d })));
    name.addEventListener('change', async () => {
      file = { ...file, settings: { ...file.settings, name: name.value.trim() } };
      await save();
      renderResults();
    });
    year.addEventListener('change', async () => {
      file = { ...file, settings: { ...file.settings, taxYear: Number(year.value) } };
      await save();
      renderResults();
      say(`Checking tax year ${year.value}.`);
    });
    start.addEventListener('change', async () => {
      file = { ...file, settings: { ...file.settings, workweekStart: Number(start.value) } };
      await save();
      renderResults();
      say(`Workweeks now start on ${WEEKDAYS[Number(start.value)]}.`);
    });
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
    );
  }

  // ---- Hours ------------------------------------------------------------
  function readTable(name: string, text: string) {
    const table = parseCsv(text);
    if (table.rows.length < 2) {
      say(`${name} has no rows under a header line.`);
      pending = null;
      renderHours();
      return;
    }
    const ssn = ssnColumns(table);
    const mapping = guessMapping(table.rows[0].cells, ssn);
    pending = { name, table, mapping, ssn };
    if (mappingProblems(mapping).length === 0) applyImport();
    else {
      renderHours();
      say(`Read ${name}. Choose the columns below, then import.`);
    }
  }

  async function applyImport() {
    if (!pending) return;
    const { lines, report } = importRows(pending.table, pending.mapping);
    if (lines.length === 0) {
      say(`No usable rows in ${pending.name}. Check the columns.`);
      renderHours();
      return;
    }
    const employees = employeesOf(lines);
    file = { ...file, lines, report, mapping: pending.mapping, source: pending.name, reported: keepKnown(file.reported, employees) };
    await save();
    renderHours();
    renderReported();
    renderResults();
    say(`Imported ${report.linesUsed} lines for ${report.employees} employees from ${pending.name}.`);
  }

  async function loadSample() {
    const s = buildSample();
    file = { ...newClientFile(file.id, s.settings, now()), lines: s.lines, reported: s.reported, source: 'sample-timesheet.csv' };
    const table = parseCsv(s.csv);
    const ssn = ssnColumns(table);
    pending = { name: 'sample-timesheet.csv', table, mapping: guessMapping(table.rows[0].cells, ssn), ssn };
    file.report = importRows(table, pending.mapping).report;
    file.mapping = pending.mapping;
    await save();
    renderAll();
    say('Loaded the sample employer: six staff, one year of hours, and the figures a payroll produced.');
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
    return h('div', { class: 'report' },
      h('p', {},
        h('strong', { text: `${file.source ?? 'Import'}: ` }),
        `${r.linesUsed} of ${r.rowsRead} rows used, ${r.employees} employees`,
        r.firstDate && r.lastDate ? `, ${formatDay(r.firstDate)} to ${formatDay(r.lastDate)}.` : '.'),
      r.droppedColumns.length ? h('p', { class: 'ok', text: `Dropped as Social Security numbers, never read or kept: ${r.droppedColumns.join(', ')}.` }) : null,
      r.overtimeLines ? h('p', { text: `${r.overtimeLines} lines were paid as overtime; their hours count at the straight rate (the overtime rate divided by 1.5, or 2 for double time).` }) : null,
      r.excludedLines ? h('p', { text: `${r.excludedLines} lines are paid time off (holiday, vacation, sick): not hours worked, left out.` }) : null,
      r.badPayDates ? h('p', { class: 'warn', text: `${r.badPayDates} pay dates could not be read; those lines take their year from the workweek.` }) : null,
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
      if (f) readTable(f.name, await readFileText(f));
    });
    const sample = h('button', { type: 'button', text: 'Try the sample employer' });
    sample.addEventListener('click', () => void loadSample());
    const sampleLink = h('button', { type: 'button', class: 'link', text: 'Download the sample timesheet' });
    sampleLink.addEventListener('click', () => download('sample-timesheet.csv', sampleCsv()));
    const drop = h('div', { class: 'drop' },
      h('label', { for: 'hours-file', class: 'drop-label' }, 'Timesheet or payroll export (CSV)'),
      input,
      h('p', { id: 'hours-help', class: 'help', text: 'One row per day (or shift) worked: employee, date, hours and rate or pay. Overtime, holiday and PTO rows are recognised by their pay type. Drop the file here or choose it.' }),
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
      if (f) readTable(f.name, await readFileText(f));
    });
    fill(hoursSec, 
      h('h2', { id: 'hours-h', text: '2. Hours worked' }),
      drop,
      h('div', { class: 'row' }, sample, sampleLink),
      pending ? mappingPanel(pending) : null,
      importReport(),
    );
  }

  // ---- Payroll figures ---------------------------------------------------
  function renderReported() {
    const employees = employeesOf(file.lines);
    if (!employees.length) {
      fill(reportedSec, h('h2', { id: 'reported-h', text: '3. Your payroll’s TT figures' }), h('p', { class: 'empty', text: 'Import hours first; the employees appear here.' }));
      return;
    }
    const input = h('input', { id: 'reported-file', type: 'file', accept: '.csv,.txt,text/csv' });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      const r = importReported(await readFileText(f), employees);
      file = { ...file, reported: { ...file.reported, ...r.values } };
      await save();
      renderReported();
      renderResults();
      const parts = [`Read ${Object.keys(r.values).length} figures from ${f.name}.`];
      if (r.unmatched.length) parts.push(`${r.unmatched.length} rows named nobody in the timesheet (${r.unmatched.slice(0, 3).map((u) => u.name).join(', ')}${r.unmatched.length > 3 ? ', ...' : ''}).`);
      if (r.unreadable.length) parts.push(`${r.unreadable.length} amounts could not be read (lines ${r.unreadable.slice(0, 5).join(', ')}).`);
      say(parts.join(' '));
    });
    const rows = employees.map((e) => {
      const id = `rep-${e.key.replace(/[^a-z0-9]/gi, '-')}`;
      const v = file.reported[e.key];
      const field = h('input', { id, type: 'text', inputmode: 'decimal', value: typeof v === 'number' ? v.toFixed(2) : '', placeholder: '0.00', 'aria-label': `TT reported for ${e.name}` });
      field.addEventListener('change', async () => {
        const raw = field.value.trim();
        const n = parseMoney(raw);
        const next = { ...file.reported };
        if (raw === '') delete next[e.key];
        else if (Number.isFinite(n)) next[e.key] = n;
        else {
          field.setAttribute('aria-invalid', 'true');
          say(`"${raw}" is not an amount.`);
          return;
        }
        field.removeAttribute('aria-invalid');
        say('');
        file = { ...file, reported: next };
        await save();
        renderResults();
      });
      return h('tr', {}, h('th', { scope: 'row', text: e.name }), h('td', { text: e.id }), h('td', {}, field));
    });
    fill(reportedSec, 
      h('h2', { id: 'reported-h', text: '3. Your payroll’s TT figures' }),
      h('p', { class: 'help', text: 'Enter the Box 12 code TT amount your payroll shows for each employee (from its W-2 preview or year-end report), or import a CSV with a name or ID column and an amount column.' }),
      h('div', { class: 'row' }, h('label', { for: 'reported-file', text: 'Import figures (CSV)' }), input),
      h('div', { class: 'scroll' },
        h('table', {},
          h('caption', { class: 'sr-only', text: 'TT figures from your payroll' }),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Employee' }), h('th', { scope: 'col', text: 'ID' }), h('th', { scope: 'col', text: 'TT on payroll’s W-2' }))),
          h('tbody', {}, ...rows),
        ),
      ),
    );
  }

  // ---- Results -----------------------------------------------------------
  function weekTable(c: EmployeeCheck): HTMLElement {
    const year = file.settings.taxYear;
    const shown = c.weeks.filter((w) => w.overtimeHours > 0 || w.notes.length > 0);
    if (!shown.length) return h('p', { class: 'empty', text: 'No workweek over 40 hours.' });
    const row = (w: WeekResult) =>
      h('tr', { class: w.taxYear === year ? '' : 'other-year' },
        h('th', { scope: 'row', class: 'nowrap', text: `${formatDay(w.start)} – ${formatDay(w.end)}` }),
        h('td', { class: 'num', text: hours(w.hours) }),
        h('td', { class: 'num', text: money(w.straightPay) }),
        h('td', { class: 'num', text: `$${w.regularRate.toFixed(4)}` }),
        h('td', { class: 'num', text: hours(w.overtimeHours) }),
        h('td', { class: 'num', text: money(w.premium) }),
        h('td', { text: w.payDate ? `${formatDay(w.payDate)}${w.taxYear === year ? '' : ` (${w.taxYear} W-2)`}` : `none (${w.taxYear})` }),
        h('td', { class: 'notes', text: w.notes.join(' ') }),
      );
    return h('div', { class: 'scroll' },
      h('table', { class: 'weeks' },
        h('caption', { text: `${c.employee.name}: workweeks with overtime or a note` }),
        h('thead', {}, h('tr', {}, ...['Workweek', 'Hours', 'Straight-time pay', 'Regular rate', 'Overtime hours', 'Qualified premium', 'Paid on', 'Notes'].map((t) => h('th', { scope: 'col', text: t })))),
        h('tbody', {}, ...shown.map(row)),
      ),
    );
  }

  function renderResults() {
    const heading = h('h2', { id: 'results-h', text: '4. Results' });
    if (!file.lines.length) {
      fill(resultsSec, heading, h('p', { class: 'empty', text: 'Results appear once hours are imported. Try the sample employer to see how it works.' }));
      return;
    }
    const { checks, summary } = runChecks(file);
    const year = file.settings.taxYear;
    const lead = summary.needCorrection
      ? `${summary.needCorrection} of ${summary.employees} employees have a TT figure that needs correcting for ${year}.`
      : summary.notEntered === summary.employees
        ? `Enter your payroll’s figures in step 3 to compare. The correct figures for ${year} are below.`
        : `No figure needs correcting for ${year}${summary.notEntered ? ` (${summary.notEntered} not entered yet)` : ''}.`;
    const body: HTMLElement[] = [];
    for (const c of checks) {
      const key = c.employee.key;
      const isOpen = open.has(key);
      const toggle = h('button', { type: 'button', class: 'link', 'aria-expanded': isOpen ? 'true' : 'false', 'aria-controls': `weeks-${key.replace(/[^a-z0-9]/gi, '-')}`, text: isOpen ? 'Hide weeks' : 'Show weeks' });
      toggle.addEventListener('click', () => {
        if (open.has(key)) open.delete(key);
        else open.add(key);
        renderResults();
        (resultsSec.querySelector(`[aria-controls="weeks-${key.replace(/[^a-z0-9]/gi, '-')}"]`) as HTMLElement | null)?.focus();
      });
      const cls = needsCorrection(c.status) ? 'bad' : c.status === 'not-entered' ? 'muted' : 'good';
      body.push(
        h('tr', {},
          h('th', { scope: 'row' }, c.employee.name, c.employee.id ? h('span', { class: 'id', text: ` ${c.employee.id}` }) : null),
          h('td', { class: 'num', 'data-label': 'Overtime hours', text: hours(c.overtimeHours) }),
          h('td', { class: 'num', 'data-label': 'Weeks with overtime', text: String(c.weeksWithOvertime) }),
          h('td', { class: 'num strong', 'data-label': 'Correct TT', text: money(c.correct) }),
          h('td', { class: 'num', 'data-label': 'Payroll TT', text: money(c.reported) }),
          h('td', { class: 'num', 'data-label': 'Difference', text: signedMoney(c.difference) }),
          h('td', { 'data-label': 'Status' }, h('span', { class: `badge ${cls}`, text: STATUS_TEXT[c.status] }), c.causes.length ? h('p', { class: 'cause', text: c.causes.join(' ') }) : null),
          h('td', { class: 'toggle' }, toggle),
        ),
      );
      if (isOpen) body.push(h('tr', { id: `weeks-${key.replace(/[^a-z0-9]/gi, '-')}`, class: 'detail' }, h('td', { colspan: 8 }, weekTable(c))));
    }
    const dlResults = h('button', { type: 'button', text: 'Download results (CSV)' });
    dlResults.addEventListener('click', () => download(`tt-check-${fileSlug(file.settings.name)}-${year}.csv`, resultsCsv(checks, file.settings)));
    const dlWeeks = h('button', { type: 'button', text: 'Download week-by-week worksheet (CSV)' });
    dlWeeks.addEventListener('click', () => download(`tt-worksheet-${fileSlug(file.settings.name)}-${year}.csv`, worksheetCsv(checks, file.settings)));
    const spill = checks.filter((c) => c.otherYearPremium > 0).length;
    const noPayDates = checks.some((c) => c.yearFromWeekEnd);
    fill(resultsSec, 
      heading,
      h('p', { class: summary.needCorrection ? 'lead bad-text' : 'lead', text: lead }),
      h('p', { class: 'help', text: `Total TT by the workweek rules: ${money(summary.totalCorrect)}; reported by payroll: ${money(summary.totalReported)}.` }),
      spill ? h('p', { class: 'help', text: `${spill} employees have overtime in weeks paid in another year; those weeks count on that year’s W-2 and are shaded in the weeks table.` }) : null,
      noPayDates ? h('p', { class: 'warn', text: 'Some lines have no pay date, so their weeks count in the year the workweek ends. Add a pay date (check date) column for weeks that are paid in January.' }) : null,
      h('div', { class: 'scroll' },
        h('table', { class: 'results' },
          h('caption', { class: 'sr-only', text: `TT check for ${year}` }),
          h('thead', {}, h('tr', {}, ...['Employee', 'Overtime hours', 'Weeks with overtime', 'Correct TT', 'Payroll TT', 'Difference', 'Status', 'Worksheet'].map((t) => h('th', { scope: 'col', text: t })))),
          h('tbody', {}, ...body),
        ),
      ),
      h('div', { class: 'row' }, dlResults, dlWeeks),
    );
  }

  function renderAll() {
    renderEmployer();
    renderHours();
    renderReported();
    renderResults();
  }

  renderAll();
}

function methodSection(): HTMLElement {
  const li = (t: string) => h('li', { text: t });
  return h('section', { class: 'card', 'aria-labelledby': 'method-h' },
    h('h2', { id: 'method-h', text: 'How the figure is worked out' }),
    h('ul', {},
      li('Each employee’s hours are put into fixed seven-day workweeks starting on the day you chose, whatever the pay period (29 CFR 778.104).'),
      li('Regular rate = all straight-time pay for the week divided by all hours worked. With two or more rates it is the weighted average (29 CFR 778.115). Holiday, vacation and sick pay are left out of both.'),
      li('Qualified overtime for the week = hours over 40 × half the regular rate, rounded to the cent. Overtime the FLSA does not require (daily overtime, double time beyond time and a half) is not qualified.'),
      li('A week belongs to the W-2 of the year it is paid: the latest pay date in the week, or the year the week ends when the file has no pay dates.'),
      li('Differences under $1.00 are shown as rounding.'),
    ),
    h('p', { class: 'help', text: 'Not covered yet: bonuses, commissions and shift differentials (they raise the regular rate), tip-credit staff, California and other daily-overtime states. Rows for them are listed as not used, so you can see what was left out.' }),
  );
}
