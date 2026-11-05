// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { findOverlays, type Overlay } from '../src/engine/detect';
import { GuidedRecorder, guidedFindings, type GuidedResult } from '../src/engine/guided';
import { escapeFindings, focusInFinding, nameOf, pressKey, tabTrapFinding } from '../src/engine/keyboard';
import { applyGuided, runEscapeTest, runTabTests, scanPage, setFinding, toReport } from '../src/engine/scan';
import { html, testEnv, tick } from './helpers';

const BACKDROP = 'position:fixed;inset:0';

function trapPopup(opts: { escape?: boolean; returnTo?: string; aria?: string } = {}): void {
  html(`<a href="/" id="home">Home</a><button id="opener">Open</button>
    <div id="pop" style="${BACKDROP}"><div role="dialog" aria-modal="true" aria-label="Offer" ${opts.aria ?? ''}>
      <p>Subscribe</p><button id="first" aria-label="Close">×</button><input id="mid" aria-label="Email"><button id="last">Join</button>
    </div></div><a href="/after" id="after">After</a>`);
  const pop = document.getElementById('pop')!;
  const first = document.getElementById('first')!;
  const last = document.getElementById('last')!;
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (e.key === 'Tab' && e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (e.key === 'Escape' && opts.escape) {
      pop.remove();
      if (opts.returnTo) document.getElementById(opts.returnTo)?.focus();
    }
  });
}

const only = (): Overlay => findOverlays(testEnv())[0];

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('simulated keys', () => {
  it('sends key events with legacy key codes', () => {
    const b = document.createElement('button');
    document.body.append(b);
    const seen: number[] = [];
    b.addEventListener('keydown', (e) => seen.push(e.keyCode, e.which));
    const ev = pressKey(b, 'Escape');
    expect(seen).toEqual([27, 27]);
    expect(ev.key).toBe('Escape');
    expect(nameOf(null)).toBe('nothing');
    expect(nameOf(document.body)).toBe('the top of the page');
    expect(nameOf(b)).toBe('button');
  });

  it('reports focus in or out of the popup', () => {
    trapPopup();
    const o = only();
    expect(focusInFinding(o, document.getElementById('mid')).status).toBe('pass');
    expect(focusInFinding(o, document.getElementById('home')).status).toBe('fail');
    expect(focusInFinding(o, null).status).toBe('fail');
  });

  it('passes a popup that holds focus and restores the earlier focus', async () => {
    trapPopup();
    document.getElementById('opener')!.focus();
    const f = await tabTrapFinding(testEnv(), only());
    expect(f.status).toBe('pass');
    expect(f.detail).toMatch(/its own code moved focus/);
    expect(document.activeElement?.id).toBe('opener');
  });

  it('fails a popup that lets focus out in either direction', async () => {
    html(`<a href="/" id="home">Home</a><div style="${BACKDROP}"><p>Subscribe</p><button>Join</button></div><a href="/after">After</a>`);
    const f = await tabTrapFinding(testEnv(), only());
    expect(f.status).toBe('fail');
    expect(f.detail).toMatch(/After/);
    expect(f.detail).toMatch(/Home/);
  });

  it('notices focus that is pushed out by the popup’s own code, held in place, or sent to the browser', async () => {
    html(`<a href="/" id="home">Home</a><div id="pop" style="${BACKDROP}"><p>Subscribe</p><button id="only">Join</button></div>`);
    const pop = document.getElementById('pop')!;
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey) document.getElementById('home')!.focus();
      if (e.key === 'Tab' && e.shiftKey) e.preventDefault();
    });
    const f = await tabTrapFinding(testEnv(), only());
    expect(f.detail).toMatch(/moved focus out/);
    expect(f.detail).toMatch(/holds focus where it is/);

    html(`<div style="${BACKDROP}"><p>Subscribe</p><button>Join</button></div>`);
    const g = await tabTrapFinding(testEnv(), only());
    expect(g.status).toBe('pass');
    expect(g.detail).toMatch(/browser’s own controls/);
  });

  it('fails or defers when nothing inside can take focus', async () => {
    html(`<div style="${BACKDROP}"><p>Subscribe</p></div>`);
    expect((await tabTrapFinding(testEnv(), only())).status).toBe('fail');
    const framed = { ...only(), framed: true };
    expect((await tabTrapFinding(testEnv(), framed)).status).toBe('manual');
  });

  it('accepts a native modal dialog', async () => {
    html('<a href="/">Home</a><dialog id="d" open aria-label="Offer"><p>Subscribe</p><button>Join</button></dialog>');
    const d = document.getElementById('d') as HTMLDialogElement;
    const real = d.matches.bind(d);
    d.matches = (sel: string) => (sel === ':modal' ? true : real(sel));
    const f = await tabTrapFinding(testEnv(), only());
    expect(f.status).toBe('pass');
    expect(f.detail).toMatch(/modal dialog/);
  });

  it('tests Escape and where focus goes', async () => {
    trapPopup({ escape: true, returnTo: 'opener' });
    let f = await escapeFindings(testEnv(), only());
    expect(f.map((x) => x.status)).toEqual(['pass', 'pass']);

    trapPopup({ escape: true });
    f = await escapeFindings(testEnv(), only());
    expect(f[1].status).toBe('warn');

    trapPopup({ escape: false });
    f = await escapeFindings(testEnv(), only());
    expect(f.map((x) => x.status)).toEqual(['fail', 'notrun']);

    html('<div id="c" style="position:fixed;left:0px;right:0px;bottom:0px;height:80px"><p>We use cookies</p><button>OK</button></div>');
    f = await escapeFindings(testEnv(), only());
    expect(f[0].status).toBe('warn');

    html(`<div style="${BACKDROP}"><div role="dialog" aria-modal="true"><p>Are you 21 or older?</p><button>Yes</button></div></div>`);
    f = await escapeFindings(testEnv(), only());
    expect(f.map((x) => x.status)).toEqual(['na', 'na']);
  });

  it('fails when focus is left on something that disappeared', async () => {
    html(`<div id="pop" style="${BACKDROP}"><div id="dlg" role="dialog" aria-modal="true"><p>Subscribe</p><button id="b">Close</button></div></div>`);
    const dlg = document.getElementById('dlg')!;
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') dlg.style.display = 'none';
    });
    const f = await escapeFindings(testEnv(), only());
    expect(f[0].status).toBe('pass');
    expect(f[1].status).toBe('fail');
  });
});

describe('guided test', () => {
  it('records real focus moves and Escape', async () => {
    trapPopup({ escape: true, returnTo: 'opener' });
    const env = testEnv();
    const o = only();
    let changes = 0;
    const rec = new GuidedRecorder(env, o, () => changes++);
    rec.start();
    for (const id of ['first', 'mid', 'last', 'first']) {
      document.getElementById(id)!.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    }
    document.getElementById('first')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(rec.current.escapePressed).toBe(true);
    const r = await rec.stop();
    expect(changes).toBeGreaterThan(0);
    expect(r.tabs).toBe(4);
    expect(r.closedByEscape).toBe(true);
    const f = guidedFindings(r, o);
    expect(f.map((x) => `${x.check}:${x.status}`)).toEqual(['focus-in:pass', 'tab-trap:pass', 'escape:pass', 'focus-return:pass']);
  });

  it('turns recordings into findings for each case', () => {
    trapPopup();
    const o = only();
    const base: GuidedResult = { steps: [], tabs: 0, escapePressed: false, closedByEscape: null, focusAfterEscape: null, focusAfterLost: false, controls: 3 };
    expect(guidedFindings(base, o)[0].status).toBe('notrun');
    const out = guidedFindings({ ...base, tabs: 2, steps: [{ inside: false, label: 'Home', open: true }, { inside: true, label: 'x', open: true }], escapePressed: true, closedByEscape: false }, o);
    expect(out.map((x) => `${x.check}:${x.status}`)).toEqual(['focus-in:fail', 'tab-trap:fail', 'escape:fail']);
    const partial = guidedFindings({ ...base, tabs: 1, steps: [{ inside: true, label: 'x', open: true }], escapePressed: true, closedByEscape: true, focusAfterEscape: 'gone', focusAfterLost: true }, o);
    expect(partial.map((x) => `${x.check}:${x.status}`)).toEqual(['focus-in:pass', 'tab-trap:warn', 'escape:pass', 'focus-return:fail']);
    const top = guidedFindings({ ...base, tabs: 1, steps: [{ inside: true, label: 'x', open: true }], escapePressed: true, closedByEscape: true, focusAfterEscape: 'the top of the page' }, o);
    expect(top[3].status).toBe('warn');
    const chat = { ...o, modal: false, kind: 'chat' as const };
    expect(guidedFindings({ ...base, tabs: 3, steps: [{ inside: false, label: 'a', open: true }] }, chat)[0]).toMatchObject({ check: 'keyboard-reach', status: 'fail' });
    expect(guidedFindings({ ...base, tabs: 3, steps: [{ inside: true, label: 'a', open: true }] }, chat)[0].status).toBe('pass');
    const cookie = { ...o, modal: false, kind: 'cookie' as const };
    expect(guidedFindings({ ...base, tabs: 1, steps: [{ inside: true, label: 'a', open: true }], escapePressed: true, closedByEscape: false }, cookie)[1].status).toBe('warn');
  });

  it('ignores the panel’s own focus and keys', async () => {
    trapPopup();
    const host = document.createElement('div');
    host.id = 'popup-check-panel-host';
    const b = document.createElement('button');
    host.append(b);
    document.body.append(host);
    const rec = new GuidedRecorder(testEnv(), only());
    rec.start();
    b.focus();
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    const r = await rec.stop();
    expect(r.steps).toHaveLength(0);
    expect(r.tabs).toBe(0);
  });
});

describe('scan', () => {
  it('scans, runs the tab test, the Escape test and applies guided results', async () => {
    trapPopup({ escape: true, returnTo: 'opener' });
    document.title = 'Fern shop';
    const env = testEnv();
    const scan = scanPage(env, document.getElementById('mid'), new Date('2026-11-05T10:00:00Z'));
    expect(scan.items).toHaveLength(1);
    expect(scan.checkedAt).toBe('2026-11-05T10:00:00.000Z');
    const r = scan.items[0].result;
    expect(r.findings[0].check).toBe('focus-in');
    expect(r.findings.find((f) => f.check === 'tab-trap')?.status).toBe('notrun');
    await runTabTests(env, scan);
    expect(r.findings.find((f) => f.check === 'tab-trap')?.status).toBe('pass');
    applyGuided(scan.items[0], { steps: [{ inside: false, label: 'Home', open: true }], tabs: 1, escapePressed: false, closedByEscape: null, focusAfterEscape: null, focusAfterLost: false, controls: 3 });
    expect(r.findings.find((f) => f.check === 'tab-trap')).toMatchObject({ status: 'fail', how: 'you' });
    await runTabTests(env, scan);
    expect(r.findings.find((f) => f.check === 'tab-trap')?.how).toBe('you');
    await runEscapeTest(env, scan.items[0]);
    expect(r.findings.find((f) => f.check === 'escape')?.status).toBe('pass');
    setFinding(r, { check: 'frame', status: 'manual', how: 'read', detail: 'x' });
    expect(r.findings[r.findings.length - 1].check).toBe('frame');
    const report = toReport(scan);
    expect(report).toMatchObject({ v: 1, title: 'Fern shop', overlays: [{ id: 'o1', kind: 'email', modal: true }] });
    await tick();
  });

  it('skips the tab test for banners and chat buttons', async () => {
    html('<button style="position:fixed;right:10px;bottom:10px;width:50px;height:50px" aria-label="Chat"></button>');
    const env = testEnv();
    const scan = scanPage(env, null);
    await runTabTests(env, scan);
    expect(scan.items[0].result.findings.some((f) => f.check === 'tab-trap' || f.check === 'escape')).toBe(false);
  });
});
