// @vitest-environment jsdom
/**
 * AC-57: each screen's empty, loading and error states, in plain words. The
 * states already covered elsewhere are listed in DECISIONS.md (D-165); these
 * are the ones that had no test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '../src/lib/llm';
import { CourseStore, MemoryDb } from '../src/lib/store';
import { mountApp, type Account, type AppDeps, type DroppedFile } from '../src/ui/app';
import { mountFixes, newFixesState } from '../src/ui/fixes';
import { statusIndex, zipFixture } from './helpers';

const idx = statusIndex();
const NOW = new Date('2026-11-24T12:00:00Z');
const file = (name: string, bytes: Uint8Array): DroppedFile => ({ name, arrayBuffer: async () => bytes.slice().buffer });
async function settle(n = 8) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

function setup(store: CourseStore, over: Partial<AppDeps> = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app') as HTMLElement;
  const account: Account = { mountSignIn: () => () => {}, onUser: (cb) => cb({ id: 'u1' }), store: () => store };
  const app = mountApp(root, { loadStatus: async () => idx, now: () => NOW, session: null, download: () => {}, pause: async () => {}, account, confirm: () => true, print: () => {}, ...over });
  const q = (sel: string) => root.querySelector(sel) as HTMLElement;
  return { root, app, q };
}

beforeEach(() => history.replaceState(null, '', '/'));
afterEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

describe('AC-57: the scan screen', () => {
  it('loading: "Reading <file>…" while the package list loads; then the result', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const t = setup(new CourseStore(new MemoryDb('u1', () => NOW)), { loadStatus: async () => (await gate, idx) });
    const going = t.app.handleFile(file('hw1.zip', zipFixture('blockers')));
    await settle(2);
    expect(t.q('#status').textContent).toBe('Reading hw1.zip…');
    release();
    await going;
    expect(t.q('#result-h').textContent).toBe('2 blockers found');
  });
});

describe('AC-57: the course, the project and the course report, loading and failing', () => {
  async function seeded() {
    const store = new CourseStore(new MemoryDb('u1', () => NOW));
    const c = await store.createCourse('Calculus I', null);
    return { store, c };
  }

  for (const [name, hash] of [
    ['course', (id: string) => `#/course/${id}`],
    ['course report', (id: string) => `#/course/${id}/report`],
  ] as const) {
    it(`${name}: a loading line, then the error with a retry that works`, async () => {
      const { store, c } = await seeded();
      const spy = vi.spyOn(store, 'course').mockRejectedValueOnce(new Error('offline'));
      const t = setup(store);
      const going = t.app.route(hash(c.id));
      expect(t.q('#page .loading').textContent).toMatch(/^Loading .+…$/);
      await going;
      const alert = t.q('#page [role="alert"]').textContent ?? '';
      expect(alert).toMatch(/^Could not load /);
      expect(alert).toContain('offline');
      ([...t.root.querySelectorAll('#page button')] as HTMLButtonElement[]).find((b) => b.textContent === 'Retry')?.click();
      await settle();
      expect(spy).toHaveBeenCalledTimes(2);
      expect(t.q('#page [role="alert"]')).toBeNull();
    });
  }

  it('project: a loading line, the error with a retry; empty: no checks and no saved alt texts say so', async () => {
    const { store, c } = await seeded();
    const [saved] = await store.save(c.id, [{ name: 'hw1', mainFile: 'main.tex', scan: { summary: { verdict: 'No known blockers', blockers: 0, warnings: 0, unknown: 0, ok: 0, notes: [] }, findings: [], data_as_of: '2026-11-19' } as never }]);
    const spy = vi.spyOn(store, 'history').mockRejectedValueOnce(new Error('offline'));
    const t = setup(store);
    const going = t.app.route(`#/project/${saved.project.id}`);
    expect(t.q('#page .loading').textContent).toBe('Loading this project…');
    await going;
    expect(t.q('#page [role="alert"]').textContent).toBe('Could not load this project: offline');
    ([...t.root.querySelectorAll('#page button')] as HTMLButtonElement[]).find((b) => b.textContent === 'Retry')?.click();
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(t.q('#page').textContent).toContain('No checks yet. “Compile and check” on a saved scan adds one here.');
    expect(t.q('#page').textContent).toContain('No saved alt texts.');
  });
});

describe('AC-57: the fix panel', () => {
  it('its empty state is the metadata card, always drawn: a document that needs nothing says "already done"', async () => {
    const { setup: patchSetup, card } = await import('./patch-helpers');
    const s = patchSetup({ 'main.tex': '\\DocumentMetadata{lang=en-US,pdfstandard=ua-2,tagging=on}\n\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n' });
    expect(card(s.plan, 'metadata')?.state).toBe('already-done');
    document.body.innerHTML = '<div id="p"></div>';
    const panel = document.getElementById('p') as HTMLElement;
    mountFixes(panel, { project: s.p, scan: s.scan, state: newFixesState(), downloadBlob: () => {}, onClose: () => {}, figures: { signedIn: () => false, storage: memoryStorage() } });
    expect(panel.querySelector('li.fix-card.already-done')).not.toBeNull();
    expect(panel.textContent).toContain('No figures found in this project.');
  });
});
