// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Files, MemoryFileStore } from '../src/store/stores';
import { mountApp, type AuthHooks } from '../src/ui/app';

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 25; i++) await tick();
};
let root: HTMLElement;
const status = () => root.querySelector('p.status')?.textContent;

async function mount(hooks?: AuthHooks) {
  const browser = new MemoryFileStore('browser');
  let n = 0;
  await mountApp(root, { files: new Files(browser), auth: hooks, newId: () => `id${++n}`, confirm: () => true, saveDelay: 0 });
  await settle();
  return browser;
}

async function importCsv(text: string) {
  const input = root.querySelector('#hours-file') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], 'a.csv')] });
  input.dispatchEvent(new Event('change'));
  await settle();
}

function change(id: string, value: string) {
  const el = root.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement;
  el.value = value;
  el.dispatchEvent(new Event('change'));
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  root = document.getElementById('app') as HTMLElement;
});

const CSV = [
  'Employee,Date,Pay Type,Hours,Rate,Amount,Pay Date',
  ...[2, 3, 4, 5, 6].map((d) => `Rosa,2026-03-0${d},Server,9,2.13,,2026-03-13`),
  'Rosa,2026-03-06,Tips,,,300,2026-03-13',
  'Rosa,2026-03-04,Night differential,4,1.5,,2026-03-13',
  'Rosa,2026-03-31,Quarterly bonus,,,130,2026-04-10',
  'Rosa,2026-09-30,Quarterly bonus,,,80,2026-10-09',
].join('\n');

describe('milestone 3 in the page', () => {
  it('reports bonus, differential and tips lines, and opens the settings', async () => {
    await mount();
    await importCsv(CSV);
    const report = root.querySelector('.report')?.textContent ?? '';
    expect(report).toContain('2 bonus or commission lines');
    expect(report).toContain('1 shift differential');
    expect(report).toContain('1 lines are tips, gifts');
    expect(root.querySelector('details.more')?.hasAttribute('open')).toBe(true);
    // Week bonus period: both bonuses fall on weeks with no hours.
    expect(root.querySelector('.warn')?.textContent).toMatch(/2 bonuses fell on no worked week/);
  });

  it('changes the minimum wage, the bonus period and the spreading', async () => {
    const browser = await mount();
    await importCsv(CSV);
    const bad = change('min-wage', 'lots');
    await settle();
    expect(bad.getAttribute('aria-invalid')).toBe('true');
    expect(status()).toBe('"lots" is not an hourly wage.');
    change('min-wage', '16.66');
    await settle();
    expect(status()).toBe('Tip-credit hours now count at $16.66 an hour.');
    change('bonus-period', 'quarter');
    await settle();
    expect(status()).toBe('Bonuses re-spread over their period.');
    expect(root.querySelector('.warn')?.textContent ?? '').toMatch(/1 bonus fell on no worked week of its period/);
    change('bonus-alloc', 'per-hour');
    await settle();
    const saved = await browser.get('id1');
    expect(saved?.settings).toMatchObject({ minimumWage: 16.66, bonusPeriod: 'quarter', bonusAllocation: 'per-hour' });
  });

  it('shows the email sign-in behind a toggle in the header, hidden once signed in', async () => {
    let cb: (u: { id: string; email: string | null } | null) => void = () => {};
    const hooks: AuthHooks = {
      mount: (el) => {
        const form = document.createElement('form');
        const input = document.createElement('input');
        input.type = 'email';
        form.append(input);
        el.append(form);
      },
      onUser: (c) => (cb = c),
      accountStore: () => new MemoryFileStore('account'),
    };
    await mount(hooks);
    const area = root.querySelector('header .top-auth') as HTMLElement;
    const toggle = area.querySelector('.email-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(area.classList.contains('email-open')).toBe(true);
    expect(toggle.textContent).toBe('Hide email sign-in');
    expect(document.activeElement?.getAttribute('type')).toBe('email');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(root.textContent).toContain('Sign in at the top of the page');
    cb({ id: 'u', email: 'a@x.org' });
    await settle();
    expect(toggle.hidden).toBe(true);
    expect(area.classList.contains('signed-in')).toBe(true);
    expect(root.textContent).not.toContain('Sign in at the top of the page');
  });
});
