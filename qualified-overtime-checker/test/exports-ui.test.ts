// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Files, MemoryFileStore } from '../src/store/stores';
import { mountApp } from '../src/ui/app';
import qboCsv from './fixtures/qbo-time-activities.csv?raw';
import toastCsv from './fixtures/toast-time-entries.csv?raw';

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 25; i++) await tick();
};
let root: HTMLElement;
const status = () => root.querySelector('p.status')?.textContent;

async function mount() {
  const browser = new MemoryFileStore('browser');
  let n = 0;
  await mountApp(root, { files: new Files(browser), newId: () => `id${++n}`, confirm: () => true, saveDelay: 0 });
  await settle();
  return browser;
}

async function importCsv(name: string, text: string) {
  const input = root.querySelector('#hours-file') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], name)] });
  input.dispatchEvent(new Event('change'));
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  root = document.getElementById('app') as HTMLElement;
});

describe('real exports in the page', () => {
  it('recognises a Toast export and adds a second export without duplicates', async () => {
    const browser = await mount();
    await importCsv('toast.csv', toastCsv);
    expect(status()).toBe('Imported 13 lines for 2 employees from toast.csv.');
    expect(root.querySelector('.report')?.textContent).toContain('Recognised: Toast time entries export.');
    const add = root.querySelector('#mode-add') as HTMLInputElement;
    add.checked = true;
    add.dispatchEvent(new Event('change'));
    await importCsv('toast.csv', toastCsv);
    expect(status()).toBe('Added 0 lines from toast.csv with the columns you chose last time for this layout; 13 lines were already in the file and were left out.');
    const replace = root.querySelector('#mode-replace') as HTMLInputElement;
    replace.checked = true;
    replace.dispatchEvent(new Event('change'));
    await importCsv('toast.csv', toastCsv);
    expect(status()).toMatch(/^Imported 13 lines/);
    expect((await browser.get('id1'))?.lines).toHaveLength(13);
  });

  it('reuses columns chosen by hand for the same layout', async () => {
    await mount();
    const odd = 'Who,When,Time,Pay\nAnn,2026-11-02,45,900\n';
    await importCsv('odd.csv', odd);
    for (const [id, v] of [['map-employeeName', '0'], ['map-date', '1'], ['map-amount', '3']]) {
      const sel = root.querySelector(`#${id}`) as HTMLSelectElement;
      sel.value = v;
      sel.dispatchEvent(new Event('change'));
    }
    (root.querySelector('.mapping button.primary') as HTMLButtonElement).click();
    await settle();
    await importCsv('odd2.csv', 'Who,When,Time,Pay\nBo,2026-11-03,41,820\n');
    expect(status()).toBe('Imported 1 lines for 1 employees from odd2.csv with the columns you chose last time for this layout.');
  });

  it('refuses pay-period totals', async () => {
    await mount();
    await importCsv('register.csv', 'Employee,Pay Period End,Hours,Rate\nAnn,2026-03-14,84,20\nAnn,2026-03-28,80,20\n');
    expect(status()).toMatch(/gives hours as pay-period totals .* for Ann\. Overtime is counted per workweek/);
    expect(root.textContent).toContain('Results appear once hours are imported');
  });

  it('takes pay rates for an hours-only QuickBooks export', async () => {
    await mount();
    await importCsv('qbo.csv', qboCsv);
    expect(root.querySelector('.report')?.textContent).toContain('Recognised: QuickBooks Online time activities export. Layout inferred');
    expect(root.querySelector('.lead')?.textContent).toBe('Enter the hourly pay rate for 2 employees in step 3 to check them.');
    const ann = root.querySelector('input[aria-label="Hourly pay rate for Ann Lee"]') as HTMLInputElement;
    ann.value = 'free';
    ann.dispatchEvent(new Event('change'));
    await settle();
    expect(ann.getAttribute('aria-invalid')).toBe('true');
    ann.value = '$20';
    ann.dispatchEvent(new Event('change'));
    await settle();
    expect(root.querySelector('.lead')?.textContent).toBe('Enter the hourly pay rate for 1 employee in step 3 to check them.');
    const row = [...root.querySelectorAll('table.results tbody tr')].find((tr) => tr.textContent?.includes('Ann Lee')) as HTMLElement;
    expect(row.textContent).toContain('$50.00');
    const bo = root.querySelector('input[aria-label="Hourly pay rate for Bo Ray"]') as HTMLInputElement;
    bo.value = '18';
    bo.dispatchEvent(new Event('change'));
    await settle();
    expect(root.querySelector('.lead')?.textContent).toMatch(/^Enter your payroll/);
    ann.value = '';
    ann.dispatchEvent(new Event('change'));
    await settle();
    expect(root.querySelector('.lead')?.textContent).toBe('Enter the hourly pay rate for 1 employee in step 3 to check them.');
  });

  it('marks weekly totals as checked by week only', async () => {
    await mount();
    await importCsv('weeks.csv', 'Employee,Week Ending,Hours,Rate\nAnn,2026-03-07,46,20\n');
    expect(root.textContent).toContain('Checked by week only');
    expect(root.textContent).toContain('1 employee has hours as weekly totals');
  });
});
