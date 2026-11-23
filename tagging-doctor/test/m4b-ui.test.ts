// @vitest-environment jsdom
/** Milestone 4b, the page: R4a.3-4 (d), "Download patched zip" when the copy cannot be made. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanDocument } from '../src/core/scan';
import { mountFixes, newFixesState } from '../src/ui/fixes';
import { DOC, index, project } from './patch-helpers';

const fail = { on: false };
vi.mock('../src/core/patch', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/core/patch')>();
  return {
    ...real,
    applyFixes: (...a: Parameters<typeof real.applyFixes>) => {
      if (fail.on) throw new Error('overlapping edits in main.tex');
      return real.applyFixes(...a);
    },
  };
});

afterEach(() => {
  fail.on = false;
  vi.restoreAllMocks();
});

describe('R4a.3-4 (d): the copy cannot be made', () => {
  it('downloads nothing and says so in the status line; a later try that works downloads', () => {
    document.body.innerHTML = '<div id="p"></div>';
    const panel = document.getElementById('p') as HTMLElement;
    const p = project({ 'main.tex': DOC });
    const blobs: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mountFixes(panel, { project: p, scan: scanDocument(p, 'main.tex', index), state: newFixesState(), downloadBlob: (name) => void blobs.push(name), onClose: () => {} });
    const button = panel.querySelector<HTMLButtonElement>('#download-patched') as HTMLButtonElement;
    const status = panel.querySelector('.fixes-status') as HTMLElement;
    fail.on = true;
    expect(() => button.click()).not.toThrow();
    expect(blobs).toEqual([]);
    expect(status.textContent).toMatch(/^Something went wrong while making the copy, so nothing was downloaded\. Your project is unchanged\./);
    expect(console.warn).toHaveBeenCalled();
    fail.on = false;
    button.click();
    expect(blobs).toEqual(['p-patched.zip']);
    expect(status.textContent).toBe('Downloaded the copy with 2 fixes.');
  });
});
