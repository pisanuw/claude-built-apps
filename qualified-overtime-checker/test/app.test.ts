// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientFile } from '../src/core/clientFile';
import { newClientFile } from '../src/core/clientFile';
import { Files, MemoryFileStore } from '../src/store/stores';
import { mountApp } from '../src/ui/app';
import { fileSlug, fill, h, hours, money, signedMoney } from '../src/ui/dom';

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 20; i++) await flush();
};

let root: HTMLElement;
let repo: MemoryFileStore;
let ids: number;
let downloads: { name: string; text: string }[];

function button(name: string | RegExp): HTMLButtonElement {
  const b = [...root.querySelectorAll('button')].find((x) => (typeof name === 'string' ? x.textContent === name : name.test(x.textContent ?? '')));
  if (!b) throw new Error(`no button ${name}`);
  return b as HTMLButtonElement;
}

async function pickFile(input: HTMLInputElement, name: string, text: string) {
  const file = new File([text], name, { type: 'text/csv' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new Event('change'));
  await settle();
}

async function mount(seed: ClientFile[] = [], confirm: (q: string) => boolean = () => true) {
  repo = new MemoryFileStore('browser');
  for (const f of seed) await repo.put(f);
  downloads = [];
  ids = 0;
  await mountApp(root, { files: new Files(repo), download: (name, text) => downloads.push({ name, text }), now: () => new Date('2026-11-10T12:00:00Z'), newId: () => `f${++ids}`, confirm, saveDelay: 0 });
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  root = document.getElementById('app') as HTMLElement;
});

describe('the checker page', () => {
  it('starts empty and explains what to do', async () => {
    await mount();
    expect(root.querySelector('h1')?.textContent).toBe('Qualified Overtime Checker');
    expect(root.textContent).toContain('Import hours first');
    expect(root.textContent).toContain('Results appear once hours are imported');
  });

  it('loads the sample, flags four employees and opens a worksheet', async () => {
    await mount();
    button('Try the sample employer').click();
    await settle();
    expect(root.querySelector('.lead')?.textContent).toBe('6 of 8 employees have a TT figure that needs correcting for 2026.');
    expect(root.textContent).toContain('Dropped as Social Security numbers, never read or kept: SSN.');
    const dev = [...root.querySelectorAll('table.results tbody tr')].find((tr) => tr.textContent?.includes('Dev Patel')) as HTMLElement;
    expect(dev.textContent).toContain('Too low');
    expect(dev.textContent).toContain('One pay rate ($19.50)');
    const toggle = dev.querySelector('button') as HTMLButtonElement;
    toggle.click();
    await settle();
    expect(root.querySelector('table.weeks caption')?.textContent).toContain('Dev Patel');
    expect(root.querySelector('table.weeks')?.textContent).toContain('2027 W-2');
    const again = [...root.querySelectorAll('table.results tbody tr')].find((tr) => tr.textContent?.includes('Dev Patel'))!.querySelector('button') as HTMLButtonElement;
    expect(again.getAttribute('aria-expanded')).toBe('true');
    again.click();
    await settle();
    expect(root.querySelector('table.weeks')).toBeNull();
    const saved = await repo.get('f1');
    expect(saved?.lines.length).toBeGreaterThan(1000);
  });

  it('downloads results, the worksheet and the sample timesheet', async () => {
    await mount();
    button('Download the sample timesheet').click();
    button('Try the sample employer').click();
    await settle();
    button('Download results (CSV)').click();
    button('Download week-by-week worksheet (CSV)').click();
    expect(downloads.map((d) => d.name)).toEqual(['sample-timesheet.csv', 'tt-check-cedar-lane-kitchen-sample-2026.csv', 'tt-worksheet-cedar-lane-kitchen-sample-2026.csv']);
    expect(downloads[1].text).toContain('Sam Okafor');
  });

  it('imports a timesheet, takes typed figures and reacts to settings', async () => {
    await mount();
    const csv = 'Employee,Date,Hours,Rate\nPat Doe,2026-11-02,9,20\nPat Doe,2026-11-03,9,20\nPat Doe,2026-11-04,9,20\nPat Doe,2026-11-05,9,20\nPat Doe,2026-11-06,9,20\n';
    await pickFile(root.querySelector('#hours-file') as HTMLInputElement, 'week.csv', csv);
    expect(root.querySelector('.status')?.textContent).toBe('Imported 5 lines for 1 employees from week.csv.');
    expect(root.querySelector('.lead')?.textContent).toContain('Enter your payroll');
    const field = root.querySelector('#reported-file') as HTMLInputElement;
    expect(field).not.toBeNull();
    const input = root.querySelector('input[aria-label="TT reported for Pat Doe"]') as HTMLInputElement;
    input.value = 'abc';
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    input.value = '$150';
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(root.querySelector('.lead')?.textContent).toBe('1 of 1 employees have a TT figure that needs correcting for 2026.');
    expect(root.textContent).toContain('full overtime pay');
    expect(root.querySelector('.status')?.textContent).toBe('');
    input.value = '50';
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(root.querySelector('.lead')?.textContent).toBe('No figure needs correcting for 2026.');
    expect(root.textContent).toContain('Some lines have no pay date');
    input.value = '';
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(root.querySelector('.lead')?.textContent).toContain('Enter your payroll');

    const start = root.querySelector('#week-start') as HTMLSelectElement;
    start.value = '4';
    start.dispatchEvent(new Event('change'));
    await settle();
    expect(root.querySelector('.status')?.textContent).toBe('Workweeks now start on Thursday.');
    const year = root.querySelector('#tax-year') as HTMLSelectElement;
    year.value = '2025';
    year.dispatchEvent(new Event('change'));
    await settle();
    expect(root.querySelector('.status')?.textContent).toBe('Checking tax year 2025.');
    const name = root.querySelector('#emp-name') as HTMLInputElement;
    name.value = '  Doe Plumbing ';
    name.dispatchEvent(new Event('change'));
    await settle();
    expect((await repo.get('f1'))?.settings).toMatchObject({ name: 'Doe Plumbing', taxYear: 2025, workweekStart: 4, minimumWage: 7.25 });
  });

  it('imports payroll figures from a CSV and reports unmatched rows', async () => {
    await mount();
    button('Try the sample employer').click();
    await settle();
    await pickFile(root.querySelector('#reported-file') as HTMLInputElement, 'tt.csv', 'Employee,TT\nMaria Lopez,1071\nNobody,5\nNobody2,5\nNobody3,5\nNobody4,1\nJo Kim,abc\n');
    expect(root.querySelector('.status')?.textContent).toBe('Read 1 figures from tt.csv. 4 rows named nobody in the timesheet (Nobody, Nobody2, Nobody3, ...). 1 amounts could not be read (lines 7).');
  });

  it('asks for columns it cannot guess, then imports', async () => {
    await mount();
    const csv = 'Who,When,Time,Pay\nAnn,2026-11-02,45,900\n';
    await pickFile(root.querySelector('#hours-file') as HTMLInputElement, 'odd.csv', csv);
    expect(root.querySelector('.status')?.textContent).toBe('Read odd.csv. Choose the columns below, then import.');
    expect(root.querySelector('.problems')?.textContent).toContain('employee name or ID');
    const go = button('Import with these columns');
    expect(go.disabled).toBe(true);
    for (const [id, v] of [['map-employeeName', '0'], ['map-date', '1'], ['map-amount', '3']]) {
      const sel = root.querySelector(`#${id}`) as HTMLSelectElement;
      sel.value = v;
      sel.dispatchEvent(new Event('change'));
    }
    const hoursSel = root.querySelector('#map-hours') as HTMLSelectElement;
    expect(hoursSel.value).toBe('2');
    hoursSel.value = '';
    hoursSel.dispatchEvent(new Event('change'));
    hoursSel.value = '2';
    (root.querySelector('#map-hours') as HTMLSelectElement).value = '2';
    (root.querySelector('#map-hours') as HTMLSelectElement).dispatchEvent(new Event('change'));
    button('Import with these columns').click();
    await settle();
    expect(root.querySelector('.status')?.textContent).toBe('Imported 1 lines for 1 employees from odd.csv.');
  });

  it('says so when a file has no usable rows', async () => {
    await mount();
    await pickFile(root.querySelector('#hours-file') as HTMLInputElement, 'empty.csv', 'Employee,Date,Hours,Rate\n');
    expect(root.querySelector('.status')?.textContent).toBe('empty.csv has no rows under a header line.');
    await pickFile(root.querySelector('#hours-file') as HTMLInputElement, 'bad.csv', 'Employee,Date,Hours,Rate\nAnn,never,8,20\n');
    expect(root.querySelector('.status')?.textContent).toBe('No usable rows in bad.csv. Check the columns.');
    expect(root.querySelector('details.mapping')?.hasAttribute('open')).toBe(true);
  });

  it('lists rows not used and paid time off in the import report', async () => {
    await mount();
    const rows = ['Employee,Date,Pay Type,Hours,Rate,Pay Date', 'Ann,2026-11-02,Regular,40,20,2026-11-13', 'Ann,2026-11-03,Holiday,8,20,2026-11-13', 'Ann,2026-11-04,Overtime,2,30,nope'];
    for (let i = 0; i < 205; i++) rows.push('Ann,2026-11-05,Bonus,,,50,');
    await pickFile(root.querySelector('#hours-file') as HTMLInputElement, 'mixed.csv', rows.join('\n'));
    const report = root.querySelector('.report')?.textContent ?? '';
    expect(report).toContain('205 rows not used');
    expect(report).toContain('and 5 more.');
    expect(report).toContain('paid time off');
    expect(report).toContain('paid as overtime');
    expect(report).toContain('1 pay dates could not be read');
  });

  it('accepts a dropped file', async () => {
    await mount();
    const drop = root.querySelector('.drop') as HTMLElement;
    const over = new Event('dragover', { cancelable: true });
    drop.dispatchEvent(over);
    expect(drop.classList.contains('over')).toBe(true);
    drop.dispatchEvent(new Event('dragleave'));
    expect(drop.classList.contains('over')).toBe(false);
    const ev = new Event('drop', { cancelable: true }) as Event & { dataTransfer: unknown };
    ev.dataTransfer = { files: [new File(['Employee,Date,Hours,Rate\nAnn,2026-11-02,8,20\n'], 'd.csv')] };
    drop.dispatchEvent(ev);
    await settle();
    expect(root.querySelector('.status')?.textContent).toBe('Imported 1 lines for 1 employees from d.csv.');
  });

  it('opens the sample as a file of its own', async () => {
    await mount();
    await pickFile(root.querySelector('#hours-file') as HTMLInputElement, 'mine.csv', 'Employee,Date,Hours,Rate\nAnn,2026-11-02,8,20\n');
    button('Try the sample employer').click();
    await settle();
    expect(root.textContent).toContain('Dev Patel');
    const list = await repo.list();
    expect(list.map((f) => f.name).sort()).toEqual(['', 'Cedar Lane Kitchen (sample)']);
    expect(list.find((f) => f.name === '')?.employees).toBe(1);
  });

  it('keeps payroll figures per tax year in the form', async () => {
    await mount();
    button('Try the sample employer').click();
    await settle();
    const year = root.querySelector('#tax-year') as HTMLSelectElement;
    year.value = '2025';
    year.dispatchEvent(new Event('change'));
    await settle();
    expect((root.querySelector('input[aria-label="TT reported for Dev Patel"]') as HTMLInputElement).value).toBe('');
    year.value = '2026';
    year.dispatchEvent(new Event('change'));
    await settle();
    expect((root.querySelector('input[aria-label="TT reported for Dev Patel"]') as HTMLInputElement).value).toBe('1706.25');
  });

  it('says so when a file cannot be read', async () => {
    await mount();
    const bad = { name: 'locked.csv', text: () => Promise.reject(new Error('denied')) } as unknown as File;
    const input = root.querySelector('#hours-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [bad] });
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(root.querySelector('.status')?.textContent).toBe('locked.csv could not be read. Save it as CSV and try again.');
  });

  it('reports other Box 12 codes skipped in a figures import', async () => {
    await mount();
    button('Try the sample employer').click();
    await settle();
    await pickFile(root.querySelector('#reported-file') as HTMLInputElement, 'w2.csv', 'Employee ID,Box 12 Code,Box 12 Amount\nE101,TT,1071\nE101,DD,4000\n');
    expect(root.querySelector('.status')?.textContent).toBe('Read 1 figures from w2.csv. 1 rows for other Box 12 codes were skipped.');
  });

  it('reopens a saved file', async () => {
    const saved = { ...newClientFile('old', { name: 'Kept Co' }), lines: [] };
    await mount([saved]);
    expect((root.querySelector('#emp-name') as HTMLInputElement).value).toBe('Kept Co');
  });
});

describe('dom helpers', () => {
  it('formats money, hours and file names', () => {
    expect(money(1234.5)).toBe('$1,234.50');
    expect(money(-3)).toBe('-$3.00');
    expect(money(null)).toBe('');
    expect(signedMoney(5)).toBe('+$5.00');
    expect(signedMoney(-5)).toBe('-$5.00');
    expect(signedMoney(0.001)).toBe('$0.00');
    expect(signedMoney(null)).toBe('');
    expect(hours(7.333333)).toBe('7.33');
    expect(fileSlug('Cedar Lane Kitchen (sample)')).toBe('cedar-lane-kitchen-sample');
    expect(fileSlug('***')).toBe('employer');
  });
  it('builds elements with boolean and text attributes and skips empty children', () => {
    const el = h('input', { disabled: true, hidden: false, value: 3, title: null });
    expect(el.hasAttribute('disabled')).toBe(true);
    expect(el.hasAttribute('hidden')).toBe(false);
    expect(el.getAttribute('value')).toBe('3');
    const div = h('div', {}, 'a', null, false, h('b', { text: 'x' }));
    expect(div.innerHTML).toBe('a<b>x</b>');
    fill(div, null, 'y');
    expect(div.textContent).toBe('y');
  });
  it('downloads through a temporary link', async () => {
    const { downloadText } = await import('../src/ui/dom');
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.useFakeTimers();
    downloadText('a.csv', 'x');
    vi.runAllTimers();
    vi.useRealTimers();
    expect(create).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });
});
