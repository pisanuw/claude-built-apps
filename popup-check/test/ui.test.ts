// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeReport } from '../src/engine/report';
import type { Report } from '../src/engine/types';
import { Panel, togglePanel } from '../src/panel/panel';
import { bookmarkletHref, mount } from '../src/site/app';
import { HISTORY_KEY } from '../src/site/history';
import { mountPractice, SAMPLES } from '../src/site/practice';
import { memoryStorage, testEnv, tick, waitFor } from './helpers';

const NOW = () => new Date('2026-11-05T10:00:00Z');
const buttons = (root: ParentNode, name: string | RegExp): HTMLButtonElement[] =>
  Array.from(root.querySelectorAll('button')).filter((b) => (typeof name === 'string' ? b.textContent === name : name.test(b.textContent ?? '')));
const button = (root: ParentNode, name: string | RegExp): HTMLButtonElement => {
  const b = buttons(root, name)[0];
  if (!b) throw new Error(`no button ${name}`);
  return b;
};

function popup(): void {
  document.body.innerHTML = `<a href="/">Home</a>
    <div id="pop" style="position:fixed;inset:0"><div class="box"><span class="x" style="cursor:pointer">×</span><p>Get 10% off</p><input placeholder="Email"><button id="join">Join</button></div></div>`;
  document.getElementById('pop')!.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.getElementById('pop')!.remove();
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

describe('panel', () => {
  it('checks the page, runs the tests and opens the report', async () => {
    popup();
    const opened: string[] = [];
    const copied: string[] = [];
    const panel = new Panel({ siteUrl: 'https://popup-check.pisan.me/', env: testEnv(), now: NOW, open: (u) => opened.push(u), copy: async (t) => void copied.push(t) });
    await tick();
    await tick();
    const root = panel.root;
    expect(root.textContent).toMatch(/1 open popup found/);
    expect(root.textContent).toMatch(/Email sign-up or discount popup/);
    expect(panel.current?.items[0].result.findings.find((f) => f.check === 'tab-trap')?.status).toBe('fail');

    button(root, 'Show it').click();
    expect(root.querySelector('.highlight')).not.toBeNull();
    await tick();
    await tick();
    expect(root.querySelector('.highlight')).toBeNull();

    button(root, 'Guided keyboard test').click();
    expect(root.textContent).toMatch(/Press Tab slowly/);
    expect(Array.from(root.querySelectorAll('button')).every((b) => b.getAttribute('tabindex') === '-1')).toBe(true);
    document.getElementById('join')!.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(root.querySelector('[data-live]')?.textContent).toMatch(/1 Tab press so far\. Focus is on “Join”.*inside the popup/);
    document.querySelector('a')!.focus();
    expect(root.querySelector('[data-live]')?.textContent).toMatch(/outside the popup/);
    button(root, 'Done').click();
    await tick();
    expect(root.textContent).toMatch(/Recorded 1 Tab press\./);

    button(root, 'Copy report code').click();
    // Encoding the report is async; a fixed number of ticks was flaky on CI.
    await waitFor(() => copied.length > 0 && /Report code copied/.test(root.textContent ?? ''), 'report code copied');
    expect(copied[0]).toMatch(/^[01]\./);
    expect(root.textContent).toMatch(/Report code copied/);

    const url = await panel.openReport();
    expect(opened[0]).toBe(url);
    expect(url).toMatch(/^https:\/\/popup-check\.pisan\.me\/#report=/);

    button(root, 'Test Escape (may close it)').click();
    await tick();
    await tick();
    expect(root.textContent).toMatch(/Escape test done/);
    expect(document.getElementById('pop')).toBeNull();

    button(root, 'Check again').click();
    await tick();
    await tick();
    expect(root.textContent).toMatch(/No open popup found/);

    (root.querySelector('[aria-label="Close Popup Check"]') as HTMLButtonElement).click();
    expect(panel.isOpen()).toBe(false);
  });

  it('can start without checking, reports copy failures and toggles', async () => {
    popup();
    const panel = togglePanel({ siteUrl: 'x/', env: testEnv(), autoScan: false, copy: () => Promise.reject(new Error('no')) })!;
    expect(panel.root.textContent).toMatch(/press Check now/);
    expect(await panel.openReport()).toBe('');
    await panel.copyCode();
    await panel.finishGuided();
    await panel.check();
    await panel.copyCode();
    expect(panel.root.textContent).toMatch(/Could not copy/);
    expect(togglePanel({ siteUrl: 'x/' }, panel)).toBeNull();
    expect(panel.isOpen()).toBe(false);
  });

  it('ignores focus moves inside the panel when deciding where page focus was', async () => {
    popup();
    document.getElementById('join')!.focus();
    const panel = new Panel({ siteUrl: 'x/', env: testEnv(), autoScan: false });
    button(panel.root, 'Check now').focus();
    await panel.check();
    expect(panel.current?.items[0].result.findings[0]).toMatchObject({ check: 'focus-in', status: 'pass' });
    panel.close();
  });
});

describe('site', () => {
  const report = (over: Partial<Report> = {}): Report => ({
    v: 1,
    url: 'https://shop.example/',
    title: 'Shop',
    checkedAt: '2026-11-05T10:00:00.000Z',
    appsOnPage: ['Klaviyo'],
    overlays: [
      {
        id: 'o1',
        kind: 'email',
        app: 'Klaviyo',
        label: 'Get 10% off',
        where: 'div',
        modal: true,
        framed: false,
        findings: [
          { check: 'focus-in', status: 'fail', how: 'read', detail: 'Focus stayed behind.' },
          { check: 'contrast', status: 'pass', how: 'read', detail: 'Fine.' },
        ],
      },
      { id: 'o2', kind: 'cookie', label: 'Cookies', where: 'div', modal: false, framed: false, findings: [{ check: 'contrast', status: 'pass', how: 'read', detail: 'Fine.' }] },
    ],
    ...over,
  });

  it('shows the bookmark, opens reports from the address, compares and keeps history', async () => {
    const storage = memoryStorage();
    const copied: string[] = [];
    let printed = 0;
    const earlier = report({ checkedAt: '2026-11-01T10:00:00.000Z', overlays: [{ ...report().overlays[0], findings: [{ check: 'contrast', status: 'fail', how: 'read', detail: '' }] }] });
    storage.setItem(HISTORY_KEY, JSON.stringify([earlier]));
    history.replaceState(null, '', `/#report=${await encodeReport(report())}`);
    const root = document.createElement('div');
    document.body.append(root);
    mount(root, { bookmarkletCode: 'alert(1%2)', storage, copy: async (t) => void copied.push(t), print: () => printed++ });
    await tick();
    await tick();
    const link = root.querySelector('a.bookmarklet') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('javascript:alert(1%252)');
    const rep = root.querySelector('#report') as HTMLElement;
    expect(rep.hidden).toBe(false);
    expect(rep.textContent).toMatch(/Report for shop\.example/);
    expect(rep.textContent).toMatch(/Since your check on 2026-11-01/);
    expect(rep.textContent).toMatch(/Fixed/);
    expect(rep.textContent).toMatch(/Message for Klaviyo support/);
    expect(rep.textContent).toMatch(/Apps seen on the page: Klaviyo/);
    expect(document.activeElement?.id).toBe('report-title');
    expect(root.querySelectorAll('#history li')).toHaveLength(2);

    button(rep, 'Copy message').click();
    button(rep, 'Copy as text').click();
    button(rep, 'Print or save as PDF').click();
    button(root, 'Copy bookmark code').click();
    await tick();
    expect(copied[0]).toMatch(/^Hello Klaviyo support/);
    expect(copied[1]).toMatch(/^Popup Check report for shop\.example/);
    expect(copied[2]).toBe('javascript:alert(1%252)');
    expect(printed).toBe(1);

    button(root, /^shop\.example, 2026-11-01/).click();
    expect(rep.textContent).toMatch(/Checked: 2026-11-01/);
    expect(rep.textContent).not.toMatch(/Since your check/);

    button(root, 'Delete').click();
    expect(root.querySelectorAll('#history li')).toHaveLength(1);
    expect(root.querySelector('.status')?.textContent).toBe('Deleted.');
  });

  it('opens pasted codes, explains bad ones and copes without storage', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const api = mount(root, { bookmarkletCode: 'x', storage: null, copy: () => Promise.reject(new Error('no')) });
    expect(root.textContent).toMatch(/None yet/);
    (root.querySelector('#paste-code') as HTMLTextAreaElement).value = 'nonsense';
    button(root, 'Open report').click();
    await tick();
    expect(root.querySelector('.status')?.textContent).toMatch(/does not look like/);
    await api.openCode(await encodeReport(report({ overlays: [] })));
    expect(root.querySelector('#report')?.textContent).toMatch(/No open popup was found/);
    button(root, 'Copy bookmark code').click();
    await tick();
    expect(root.querySelector('.status')?.textContent).toMatch(/Could not copy/);
    expect(bookmarkletHref('a b')).toBe('javascript:a%20b');
  });

  it('uses window storage, clipboard and print by default', async () => {
    const write = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const root = document.createElement('div');
    document.body.append(root);
    const api = mount(root, { bookmarkletCode: 'x' });
    api.showReport(report());
    button(root, 'Print or save as PDF').click();
    button(root, 'Copy as text').click();
    await tick();
    expect(print).toHaveBeenCalled();
    expect(write).toHaveBeenCalled();
    expect(window.localStorage.getItem(HISTORY_KEY)).toMatch(/shop\.example/);
  });
});

describe('practice shop', () => {
  async function openAndCheck(label: string) {
    document.body.innerHTML = '<div id="app"></div>';
    const opened: string[] = [];
    const practice = mountPractice(document.getElementById('app')!, { checkDelayMs: 0, panel: { env: testEnv(), open: (u) => opened.push(u) } });
    const opener = button(document, `Open: ${label}`);
    opener.focus();
    opener.click();
    await waitFor(() => /popup|found/.test(document.getElementById('popup-check-panel-host')?.shadowRoot?.querySelector('.lead')?.textContent ?? ''), 'panel results');
    const host = document.getElementById('popup-check-panel-host')!;
    return { practice, panel: host.shadowRoot!, opened };
  }

  it('lists five samples', () => {
    expect(SAMPLES).toHaveLength(5);
  });

  it('finds the planted problems in the badly built popup', async () => {
    const { practice, panel } = await openAndCheck('Discount popup, badly built');
    expect(panel.textContent).toMatch(/1 open popup found/);
    const text = panel.textContent ?? '';
    for (const t of ['Screen readers are told a popup opened', 'Everything clickable works with the keyboard', 'Images have text descriptions']) expect(text).toContain(t);
    expect(practice.isOpen('bad-email')).toBe(true);
    expect(practice.open('bad-email')).toBe(document.querySelector('.promo-overlay'));
    (document.querySelector('.x') as HTMLElement).click();
    expect(practice.isOpen('bad-email')).toBe(false);
  });

  it('passes the well built popup, including Escape and focus return', async () => {
    const { practice, panel } = await openAndCheck('Discount popup, well built');
    expect(panel.textContent).toMatch(/0 problems/);
    button(panel, 'Test Escape (may close it)').click();
    await tick(5);
    expect(practice.isOpen('good-email')).toBe(false);
    expect(document.activeElement?.textContent).toBe('Open: Discount popup, well built');
  });

  it('checks the age gate, cookie banner and chat button', async () => {
    let r = await openAndCheck('Age gate');
    expect(r.panel.textContent).toMatch(/Age gate/);
    expect(r.panel.textContent).toMatch(/0 problems/);
    button(document, 'No').click();
    expect(document.body.textContent).toMatch(/Sorry/);
    button(document, 'Yes, I am 21 or older').click();
    expect(r.practice.isOpen('age')).toBe(false);

    r = await openAndCheck('Cookie banner');
    expect(r.panel.textContent).toMatch(/Cookie banner/);
    expect(r.panel.textContent).toMatch(/1 problem,/);
    button(document, 'Accept all').click();
    expect(r.practice.isOpen('cookie')).toBe(false);

    r = await openAndCheck('Chat button');
    expect(r.panel.textContent).toMatch(/Chat button/);
    expect(r.panel.textContent).toMatch(/1 problem,/);
    r.practice.close('chat');
    r.practice.close('chat');
  });

  it('re-checks when the panel is already open and can be run by hand', async () => {
    const { practice } = await openAndCheck('Cookie banner');
    button(document, 'Accept all').click();
    button(document, 'Open: Chat button').click();
    await waitFor(() => /Chat button/.test(document.getElementById('popup-check-panel-host')?.shadowRoot?.textContent ?? ''), 'chat result');
    const host = document.getElementById('popup-check-panel-host')!;
    expect(host.shadowRoot!.textContent).toMatch(/Chat button/);
    expect(practice.launchCheck()).toBeNull();
    button(document, 'Run Popup Check here').click();
    expect(document.getElementById('popup-check-panel-host')).not.toBeNull();
  });
});
