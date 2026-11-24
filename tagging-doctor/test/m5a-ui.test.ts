// @vitest-environment jsdom
/**
 * Milestone 5a, the figure panel on the page (AC-45 to AC-48, AC-50), inside
 * the fix panel. Every model call is a stand-in.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanDocument } from '../src/core/scan';
import { CapReached, GatewayError, getByokKey, memoryStorage, setByokKey, type AskDeps, type AskRequest, type Message } from '../src/lib/llm';
import { DRAFT_LABEL, EMPTY } from '../src/ui/figures';
import { downloadedWords, mountFixes, newFixesState, type FixesCtx, type FixesState } from '../src/ui/fixes';
import { index, project } from './patch-helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const MAIN = [
  '\\documentclass{article}',
  '\\usepackage{graphicx}',
  '\\begin{document}',
  'The plot shows the means.',
  '\\begin{figure}',
  '\\includegraphics[width=3cm]{plot}',
  '\\caption{Means by week}',
  '\\label{fig:means}',
  '\\end{figure}',
  '\\includegraphics{scan.pdf}',
  '\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}',
  '\\includegraphics[alt={Already there}]{plot}',
  '\\end{document}',
  '',
].join('\n');

const reply = (text: string): Message =>
  ({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Message;

interface Setup {
  panel: HTMLElement;
  ctx: FixesCtx;
  state: FixesState;
  storage: Storage;
  calls: { req: AskRequest; deps: AskDeps }[];
}

function mount(opts: { signedIn?: boolean; answer?: (req: AskRequest, deps: AskDeps) => Promise<Message>; files?: Record<string, string | Uint8Array>; storage?: Storage } = {}): Setup {
  document.body.innerHTML = '<div id="p"></div>';
  const panel = document.getElementById('p') as HTMLElement;
  const p = project(opts.files ?? { 'main.tex': MAIN, 'plot.png': PNG, 'scan.pdf': '%PDF-1.4' });
  const state = newFixesState();
  const storage = opts.storage ?? memoryStorage();
  const calls: Setup['calls'] = [];
  let ctx: FixesCtx | null = null;
  mountFixes(panel, {
    project: p,
    scan: scanDocument(p, 'main.tex', index),
    state,
    downloadBlob: () => {},
    onClose: () => {},
    compareSlot: (_s, c) => ((ctx = c), { cancel: () => {} }),
    figures: {
      signedIn: () => opts.signedIn ?? false,
      storage,
      objectUrl: () => 'blob:thumb',
      imageDeps: { decode: async () => ({ width: 10, height: 10, source: null }), encode: async () => PNG },
      draft: {
        ask: async (req, deps) => {
          calls.push({ req, deps });
          return (opts.answer ?? (async () => reply('A line chart of weekly means.')))(req, deps);
        },
      },
    },
  });
  return { panel, ctx: ctx as unknown as FixesCtx, state, storage, calls };
}

const items = (panel: HTMLElement) => [...panel.querySelectorAll<HTMLElement>('li.figure-item')];
const button = (li: HTMLElement, role: string) => li.querySelector<HTMLButtonElement>(`[data-role="${role}"]`) as HTMLButtonElement;
const flush = () => new Promise((r) => setTimeout(r, 0));
const main = (s: Setup) => s.ctx.patch().files.get('main.tex') ?? '';

afterEach(() => vi.restoreAllMocks());

describe('AC-45: the figure panel lists the figures', () => {
  it('with file, place, caption, label, text around it, a thumbnail or "No preview", and the alt status', () => {
    const { panel } = mount();
    const li = items(panel);
    expect(li).toHaveLength(4);
    expect(li[0].querySelector('h4')?.textContent).toBe('Figure 1: plot');
    expect(li[0].querySelector('.where')?.textContent).toBe('main.tex, line 6');
    expect(li[0].querySelector('img.thumb')?.getAttribute('src')).toBe('blob:thumb');
    expect(li[0].querySelector('img.thumb')?.getAttribute('alt')).toBe('Preview of plot');
    expect(li[0].textContent).toContain('Caption: Means by week');
    expect(li[0].textContent).toContain('Label: fig:means');
    expect(li[0].querySelector('details.context')?.textContent).toContain('The plot shows the means.');
    expect(li[0].querySelector('.alt-status')?.textContent).toBe('No alt text yet.');
    expect(li[1].querySelector('.no-preview')?.textContent).toBe('No preview (PDF, EPS or another type). Drafted from the text only.');
    expect(li[2].querySelector('h4')?.textContent).toBe('Figure 3: TikZ picture');
    expect(li[2].querySelector('.no-preview')?.textContent).toMatch(/TikZ picture\)\. Drafted from the text only\./);
    expect(li[3].querySelector('.alt-status')?.textContent).toBe('Has alt text in the source.');
    expect(button(li[3], 'draft')).toBeNull();
    expect(panel.querySelector('a[href="https://lewis-alt-text.hintwise.org"]')).not.toBeNull();
  });

  it('an empty project says so', () => {
    const { panel } = mount({ files: { 'main.tex': '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n' } });
    expect(panel.querySelector('.figures-panel .empty')?.textContent).toBe(EMPTY);
  });

  it('a figure whose file is not in the zip has no preview and says why', () => {
    const { panel } = mount({ files: { 'main.tex': MAIN.replace('{scan.pdf}', '{gone.png}'), 'plot.png': PNG } });
    expect(items(panel)[1].querySelector('.no-preview')?.textContent).toMatch(/not in the zip/);
  });
});

describe('AC-46: the own key, kept in this browser, with Forget key', () => {
  it('pasting it switches drafting to it with no sign-in; the draft is labelled; Forget key removes it', async () => {
    const s = mount();
    const draft = button(items(s.panel)[0], 'draft');
    expect(draft.disabled).toBe(true);
    expect(s.panel.querySelector('.draft-mode')?.textContent).toMatch(/Paste your own Anthropic key/);
    (s.panel.querySelector('[data-role="key"]') as HTMLInputElement).value = ' sk-ant-mine ';
    (s.panel.querySelector('[data-role="save-key"]') as HTMLButtonElement).click();
    expect(getByokKey(s.storage)).toBe('sk-ant-mine');
    expect(s.panel.querySelector('.draft-mode')?.textContent).toBe('Drafts use your own key.');
    button(items(s.panel)[0], 'draft').click();
    await flush();
    await flush();
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].deps.mode).toBe('byok');
    expect((s.calls[0].req.messages[0].content as { type: string }[])[0].type).toBe('image');
    const li = items(s.panel)[0];
    expect((li.querySelector('textarea') as HTMLTextAreaElement).value).toBe('A line chart of weekly means.');
    expect(li.querySelector('.help')?.textContent).toContain(`${DRAFT_LABEL}.`);
    expect(li.querySelector('.alt-status')?.textContent).toBe('Draft: not in the patched copy until you approve it.');
    (s.panel.querySelector('[data-role="forget-key"]') as HTMLButtonElement).click();
    expect(getByokKey(s.storage)).toBeNull();
    expect(button(items(s.panel)[0], 'draft').disabled).toBe(true);
  });

  it('an empty key is not kept', () => {
    const s = mount();
    (s.panel.querySelector('[data-role="save-key"]') as HTMLButtonElement).click();
    expect(s.panel.querySelector('.figures-status')?.textContent).toBe('Paste a key first.');
  });
});

describe('AC-47: signed in with no key, HintWise’s key through the gateway', () => {
  it('drafts in gateway mode; on a 429 the figure shows the scope, the reset and "use your own key"', async () => {
    const s = mount({ signedIn: true, answer: async () => Promise.reject(new CapReached('app-user-day', '2026-11-24T00:00:00Z')) });
    expect(s.panel.querySelector('.draft-mode')?.textContent).toMatch(/HintWise’s key/);
    button(items(s.panel)[1], 'draft').click();
    await flush();
    await flush();
    expect(s.calls[0].deps.mode).toBe('gateway');
    const err = items(s.panel)[1].querySelector('[role="alert"]')?.textContent ?? '';
    expect(err).toContain('your daily allowance in this app is used up');
    expect(err).toContain('use your own key');
  });

  it('on a 403 "app": not available yet; and the own key still drafts', async () => {
    let fail = true;
    const s = mount({ signedIn: true, answer: async () => (fail ? Promise.reject(new GatewayError(403, { error: 'app' })) : reply('Fine.')) });
    button(items(s.panel)[0], 'draft').click();
    await flush();
    await flush();
    expect(items(s.panel)[0].querySelector('[role="alert"]')?.textContent).toBe('Drafting with HintWise’s key is not available yet; use your own key.');
    fail = false;
    setByokKey('k', s.storage);
    button(items(s.panel)[0], 'draft').click();
    await flush();
    await flush();
    expect(s.calls[1].deps.mode).toBe('byok');
    expect((items(s.panel)[0].querySelector('textarea') as HTMLTextAreaElement).value).toBe('Fine.');
  });
});

describe('AC-48: nothing enters the patch until Approve; Decorative and Skip', () => {
  it('a draft is editable and flagged over 250 characters; Approve puts it in, an edit takes it out again', async () => {
    const long = 'A '.repeat(140).trim();
    const storage = memoryStorage();
    setByokKey('k', storage);
    const s = mount({ storage, answer: async () => reply(long) });
    button(items(s.panel)[0], 'draft').click();
    await flush();
    await flush();
    let li = items(s.panel)[0];
    expect(li.querySelector('.help.long')?.textContent).toMatch(/Over 250 characters \(279\)/);
    expect(main(s)).not.toContain('width=3cm, alt=');
    const ta = li.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'Weekly means rise from 2 to 5 & level off.';
    ta.dispatchEvent(new Event('input'));
    expect(li.querySelector('.help.long')).toBeNull();
    expect(main(s)).not.toContain('width=3cm, alt=');
    button(li, 'approve').click();
    li = items(s.panel)[0];
    expect(button(li, 'approve').getAttribute('aria-pressed')).toBe('true');
    expect(li.querySelector('.alt-status')?.textContent).toBe('Approved: in the patched copy as its alt text.');
    expect(main(s)).toContain('\\includegraphics[width=3cm, alt={Weekly means rise from 2 to 5 \\& level off.}]{plot}');
    const ta2 = li.querySelector('textarea') as HTMLTextAreaElement;
    ta2.value += ' More.';
    ta2.dispatchEvent(new Event('input'));
    expect(main(s)).not.toContain('width=3cm, alt=');
    expect(li.querySelector('.alt-status')?.textContent).toBe('Draft: not in the patched copy until you approve it.');
  });

  it('a typed text can be approved without a draft and carries no model label; Decorative writes artifact; Skip leaves it', () => {
    const s = mount();
    let li = items(s.panel)[0];
    expect(button(li, 'approve').disabled).toBe(true);
    const ta = li.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'Typed by me';
    ta.dispatchEvent(new Event('input'));
    expect(li.querySelector('.help')?.textContent).toBe('');
    button(li, 'approve').click();
    expect(main(s)).toContain('alt={Typed by me}');
    expect(s.state.alts.get(items(s.panel)[0].dataset.figure as string)?.source).toBe('typed');
    li = items(s.panel)[1];
    button(li, 'decorative').click();
    expect(main(s)).toContain('\\includegraphics[artifact]{scan.pdf}');
    button(items(s.panel)[1], 'skip').click();
    expect(main(s)).toContain('\\includegraphics{scan.pdf}');
    expect(items(s.panel)[1].querySelector('.alt-status')?.textContent).toBe('Skipped: left as it is.');
    // An approved TikZ text is not inserted: the panel says to place it by hand.
    li = items(s.panel)[2];
    const t = li.querySelector('textarea') as HTMLTextAreaElement;
    t.value = 'Two lines';
    t.dispatchEvent(new Event('input'));
    button(li, 'approve').click();
    expect(items(s.panel)[2].querySelector('.alt-status')?.textContent).toMatch(/^Approved\. The patch does not change TikZ pictures/);
    expect(main(s)).not.toContain('Two lines');
    expect(downloadedWords(0, 0)).toBe('Downloaded the copy with no fix: none is accepted.');
    expect(downloadedWords(2, 1)).toBe('Downloaded the copy with 2 fixes and 1 alt text.');
    expect(downloadedWords(1, 3)).toBe('Downloaded the copy with 1 fix and 3 alt texts.');
  });
});

describe('AC-50: Draft all on the page', () => {
  it('drafts the figures with no text yet and stops at the first cap error', async () => {
    let n = 0;
    const s = mount({ signedIn: true, answer: async () => (++n === 2 ? Promise.reject(new CapReached('app-day', '2026-11-24T00:00:00Z')) : reply(`Draft ${n}`)) });
    (s.panel.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    expect(s.panel.querySelector('[data-role="stop-all"]')).not.toBeNull();
    for (let i = 0; i < 6; i++) await flush();
    // Three figures need a draft (the fourth has alt text in the source): at most three calls, three at a time.
    expect(s.calls.length).toBeLessThanOrEqual(3);
    expect(s.panel.querySelector('.figures-status')?.textContent).toMatch(/^Stopped after \d drafts\. HintWise’s key cannot draft now: this app’s shared allowance is used up/);
    expect(s.panel.querySelector('[data-role="draft-all"]')).not.toBeNull();
  });

  it('says when every figure has a text already, and drafts without a mode say what to do', async () => {
    const s = mount({ signedIn: true });
    (s.panel.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    for (let i = 0; i < 6; i++) await flush();
    expect(s.calls).toHaveLength(3);
    expect(s.panel.querySelector('.figures-status')?.textContent).toBe('Asked for 3 drafts. Check each one, then approve it.');
    (s.panel.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    expect(s.panel.querySelector('.figures-status')?.textContent).toBe('Every figure has a text or a choice already.');
  });

  it('Stop drafting stops the run', async () => {
    const s = mount({ signedIn: true, answer: () => new Promise((r) => setTimeout(() => r(reply('x')), 5)) });
    (s.panel.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    (s.panel.querySelector('[data-role="stop-all"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 30));
    expect(s.panel.querySelector('.figures-status')?.textContent).toMatch(/^Stopped after \d drafts\.$/);
  });
});

describe('review round 1 on the page', () => {
  const SIX = ['\\documentclass{article}', '\\usepackage{graphicx}', '\\begin{document}', ...Array.from({ length: 6 }, (_, i) => `\\includegraphics{f${i}.pdf}`), '\\end{document}', ''].join('\n');
  const sixFiles = () => Object.fromEntries([['main.tex', SIX], ...Array.from({ length: 6 }, (_, i) => [`f${i}.pdf`, '%PDF'])]) as Record<string, string>;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('R5a.1-1: after Stop drafting, a single Draft is shown; a panel closed while a draft is out does not draw it', async () => {
    const s = mount({ signedIn: true, files: sixFiles(), answer: async () => (await wait(5), reply('A draft.')) });
    (s.panel.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    (s.panel.querySelector('[data-role="stop-all"]') as HTMLButtonElement).click();
    await wait(40);
    expect(s.panel.querySelector('.figures-status')?.textContent).toMatch(/^Stopped after \d drafts\.$/);
    // As before: the drafts already sent arrived.
    expect((items(s.panel)[0].querySelector('textarea') as HTMLTextAreaElement).value).toBe('A draft.');
    button(items(s.panel)[5], 'draft').click();
    await wait(20);
    expect((items(s.panel)[5].querySelector('textarea') as HTMLTextAreaElement).value).toBe('A draft.');
    expect(s.panel.querySelector('.figures-status')?.textContent).toBe('Figure 6: draft ready. Check it, then approve it.');
  });

  it('R5a.1-2: a figure approved, marked Decorative or typed into during Draft all keeps the person\'s choice; one left alone gets its draft', async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => (open = r));
    const s = mount({ signedIn: true, files: sixFiles(), answer: async () => (await gate, reply('A model draft.')) });
    (s.panel.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    await flush();
    // Figure 1 is out: type and approve on it, approve figure 5, mark figure 6 Decorative.
    const t1 = items(s.panel)[0].querySelector('textarea') as HTMLTextAreaElement;
    t1.value = 'Typed while out';
    t1.dispatchEvent(new Event('input'));
    const t5 = items(s.panel)[4].querySelector('textarea') as HTMLTextAreaElement;
    t5.value = 'My own words for figure five';
    t5.dispatchEvent(new Event('input'));
    button(items(s.panel)[4], 'approve').click();
    button(items(s.panel)[5], 'decorative').click();
    open();
    await wait(20);
    expect(s.panel.querySelector('[data-role="draft-all"]')).not.toBeNull();
    const v = (i: number) => (items(s.panel)[i].querySelector('textarea') as HTMLTextAreaElement).value;
    expect(v(0)).toBe('Typed while out');
    expect(items(s.panel)[0].textContent).toContain('A draft arrived after you changed this figure');
    expect(v(1)).toBe('A model draft.');
    expect(v(4)).toBe('My own words for figure five');
    const out = main(s);
    expect(out).toContain('\\includegraphics[alt={My own words for figure five}]{f4.pdf}');
    expect(out).toContain('\\includegraphics[artifact]{f5.pdf}');
    // Figures 5 and 6 were passed over: four calls, not six.
    expect(s.calls).toHaveLength(4);
  });

  it('as before: Draft again on an approved figure replaces its text and takes it out of the copy', async () => {
    const s = mount({ signedIn: true, answer: async () => reply('New draft.') });
    const ta = items(s.panel)[0].querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'Old';
    ta.dispatchEvent(new Event('input'));
    button(items(s.panel)[0], 'approve').click();
    expect(main(s)).toContain('alt={Old}');
    button(items(s.panel)[0], 'draft').click();
    await flush();
    await flush();
    expect((items(s.panel)[0].querySelector('textarea') as HTMLTextAreaElement).value).toBe('New draft.');
    expect(main(s)).not.toContain('alt={Old}');
  });

  it('R5a.1-7: the focus stays on Draft while it is out and after; the key controls hand the focus on', async () => {
    let release: () => void = () => {};
    const s = mount({ signedIn: true, answer: () => new Promise((r) => (release = () => r(reply('Done.')))) });
    const d = button(items(s.panel)[0], 'draft');
    d.focus();
    d.click();
    await flush();
    expect(document.activeElement?.getAttribute('data-role')).toBe('draft');
    expect(document.activeElement?.getAttribute('aria-disabled')).toBe('true');
    (document.activeElement as HTMLButtonElement).click();
    expect(s.calls).toHaveLength(1);
    release();
    await flush();
    await flush();
    expect(document.activeElement?.getAttribute('data-role')).toBe('draft');
    expect(document.activeElement?.textContent).toBe('Draft again');
    (s.panel.querySelector('[data-role="key"]') as HTMLInputElement).value = 'k';
    (s.panel.querySelector('[data-role="save-key"]') as HTMLButtonElement).click();
    expect(document.activeElement?.getAttribute('data-role')).toBe('forget-key');
    (document.activeElement as HTMLButtonElement).click();
    expect(document.activeElement?.getAttribute('data-role')).toBe('key');
  });

  it('R5a.1-10: an image the zip cannot unpack shows "No preview", and the rest of the panel opens', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const z = zipSync({ 'main.tex': [strToU8(MAIN), { level: 0 }], 'plot.png': [new Uint8Array(4000).map((_, i) => (i * 7) % 251), { level: 9 }] });
    // plot.png's compression method set to one the reader does not know, in its local and central headers.
    const mark = (sig: number[], nameAt: number, methodAt: number) => {
      for (let k = 0; k < z.length - 4; k++) if (sig.every((b, j) => z[k + j] === b) && new TextDecoder().decode(z.subarray(k + nameAt, k + nameAt + 8)) === 'plot.png') z[k + methodAt] = 99;
    };
    mark([0x50, 0x4b, 3, 4], 30, 8);
    mark([0x50, 0x4b, 1, 2], 46, 10);
    const { openProject } = await import('../src/core/project');
    const p = openProject('bad.zip', z);
    document.body.innerHTML = '<div id="p"></div>';
    const panel = document.getElementById('p') as HTMLElement;
    let threw: unknown = null;
    try {
      mountFixes(panel, { project: p, scan: scanDocument(p, 'main.tex', index), state: newFixesState(), downloadBlob: () => {}, onClose: () => {}, figures: { signedIn: () => false, storage: memoryStorage(), objectUrl: (b) => (b.length ? 'blob:x' : null) } });
    } catch (e) {
      threw = e;
    }
    expect(() => p.bytes('plot.png')).toThrow(/compression method/);
    expect(threw).toBeNull();
    expect(panel.querySelector('#figures-h')).not.toBeNull();
    expect(panel.querySelector('li.figure-item .no-preview')?.textContent).toBe('No preview (the file cannot be read from the zip). Drafted from the text only.');
  });

  it('R5a.1-10: the thumbnails\' URLs are given back when the panel goes', () => {
    document.body.innerHTML = '<div id="p"></div>';
    const panel = document.getElementById('p') as HTMLElement;
    const p = project({ 'main.tex': MAIN, 'plot.png': PNG, 'scan.pdf': '%PDF-1.4' });
    const revoked: string[] = [];
    const run = mountFixes(panel, { project: p, scan: scanDocument(p, 'main.tex', index), state: newFixesState(), downloadBlob: () => {}, onClose: () => {}, figures: { signedIn: () => false, storage: memoryStorage(), objectUrl: () => 'blob:t', revokeUrl: (u) => void revoked.push(u) } });
    run.cancel();
    expect(revoked).toEqual(['blob:t', 'blob:t']);
  });

  it('R5a.1-11 (a): Draft all stops at a 403 "app" and says why; (d) typing updates the status at once', async () => {
    const s = mount({ signedIn: true, files: sixFiles(), answer: async () => Promise.reject(new GatewayError(403, { error: 'app' })) });
    (s.panel.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    for (let i = 0; i < 8; i++) await flush();
    expect(s.calls.length).toBeLessThanOrEqual(3);
    expect(s.panel.querySelector('.figures-status')?.textContent).toMatch(/^Stopped after \d drafts\. Drafting with HintWise’s key is not available yet; use your own key\.$/);
    const ta = items(s.panel)[5].querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'x';
    ta.dispatchEvent(new Event('input'));
    expect(items(s.panel)[5].querySelector('.alt-status')?.textContent).toBe('Draft: not in the patched copy until you approve it.');
  });

  it('R5a.1-5 on the page: a backslash in a caption figure\'s text is approved but not in the copy, and the page says so', () => {
    const s = mount({ files: { 'main.tex': '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\begin{figure}\\caption{C \\includegraphics{scan.pdf}}\\end{figure}\n\\end{document}\n', 'scan.pdf': '%PDF' } });
    const ta = items(s.panel)[0].querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a \\ b';
    ta.dispatchEvent(new Event('input'));
    button(items(s.panel)[0], 'approve').click();
    expect(items(s.panel)[0].querySelector('.alt-status')?.textContent).toMatch(/^Approved, but not in the copy\. This figure is in a title or a caption/);
    expect(main(s)).not.toContain('alt=');
  });
});

describe('milestone 5b: the minors carried from 5a round 2, on the page', () => {
  const SIX = ['\\documentclass{article}', '\\usepackage{graphicx}', '\\begin{document}', ...Array.from({ length: 6 }, (_, i) => `\\includegraphics{f${i}.pdf}`), '\\end{document}', ''].join('\n');
  const sixFiles = () => Object.fromEntries([['main.tex', SIX], ...Array.from({ length: 6 }, (_, i) => [`f${i}.pdf`, '%PDF'])]) as Record<string, string>;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('R5a.2-1: a draft out when the panel is drawn again is shown as Drafting… and drawn when it arrives; Draft all does not ask for it twice', async () => {
    document.body.innerHTML = '<div id="p"></div>';
    const panel = document.getElementById('p') as HTMLElement;
    const p = project(sixFiles());
    const state = newFixesState();
    const storage = memoryStorage();
    setByokKey('k', storage);
    let calls = 0;
    const releases: (() => void)[] = [];
    const figures = { signedIn: () => false, storage, draft: { ask: () => (calls++, new Promise<Message>((r) => releases.push(() => r(reply('Arrived.'))))) } };
    const scan = scanDocument(p, 'main.tex', index);
    const first = mountFixes(panel, { project: p, scan, state, downloadBlob: () => {}, onClose: () => {}, figures });
    button(items(panel)[0], 'draft').click();
    await flush();
    first.cancel();
    // The panel drawn again (Close and open, or a change of person) with the same state.
    mountFixes(panel, { project: p, scan, state, downloadBlob: () => {}, onClose: () => {}, figures });
    expect(button(items(panel)[0], 'draft').textContent).toBe('Drafting…');
    (panel.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    await flush();
    releases.forEach((r) => r());
    await wait(10);
    releases.forEach((r) => r());
    await wait(10);
    // Six figures, six calls: figure 1 was not asked for twice.
    expect(calls).toBe(6);
    const li = items(panel)[0];
    expect((li.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Arrived.');
    expect(li.textContent).not.toContain('A draft arrived after you changed this figure');
    // As before: a new drop (a new state) drops the old answers.
    expect(newFixesState().drafting.busy.size).toBe(0);
  });

  it('R5a.2-3: Approve announces what the status line says for a text left out', () => {
    const s = mount({ files: { 'main.tex': '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\begin{figure}\\caption{C \\includegraphics{scan.pdf}}\\end{figure}\n\\end{document}\n', 'scan.pdf': '%PDF' } });
    const ta = items(s.panel)[0].querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'a \\ b';
    ta.dispatchEvent(new Event('input'));
    button(items(s.panel)[0], 'approve').click();
    expect(s.panel.querySelector('.figures-status')?.textContent).toMatch(/^Figure 1: approved, but not in the copy\. This figure is in a title or a caption/);
    ta.value = 'a b';
    const ta2 = items(s.panel)[0].querySelector('textarea') as HTMLTextAreaElement;
    ta2.value = 'a b';
    ta2.dispatchEvent(new Event('input'));
    button(items(s.panel)[0], 'approve').click();
    expect(s.panel.querySelector('.figures-status')?.textContent).toBe('Figure 1: approved; it goes into the patched copy.');
  });

  it('R5a.2-4: figures passed over are not counted as left; untouched ones beyond the 40 still are', async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => (open = r));
    const s = mount({ signedIn: true, files: sixFiles(), answer: async () => (await gate, reply('A model draft.')) });
    (s.panel.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    await flush();
    button(items(s.panel)[5], 'decorative').click();
    const t = items(s.panel)[4].querySelector('textarea') as HTMLTextAreaElement;
    t.value = 'Mine';
    t.dispatchEvent(new Event('input'));
    open();
    await wait(20);
    expect(s.panel.querySelector('.figures-status')?.textContent).toBe('Asked for 4 drafts. Check each one, then approve it.');
    const many = ['\\documentclass{article}', '\\usepackage{graphicx}', '\\begin{document}', ...Array.from({ length: 45 }, (_, i) => `\\includegraphics{f${i}.pdf}`), '\\end{document}', ''].join('\n');
    const m = mount({ signedIn: true, files: { 'main.tex': many }, answer: async () => reply('x') });
    (m.panel.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    await wait(40);
    expect(m.panel.querySelector('.figures-status')?.textContent).toBe('Asked for 40 drafts. 5 figures are left: choose Draft all again for them. Check each one, then approve it.');
  });

  it('R5a.2-7 (a): the same refusal twice in a row stops Draft all; one figure\'s own failure does not', async () => {
    const credit = Object.assign(new Error('400'), { status: 400, error: { error: { message: 'Your credit balance is too low to access the Anthropic API.' } } });
    const storage = memoryStorage();
    setByokKey('k', storage);
    const s = mount({ storage, files: sixFiles(), answer: async () => Promise.reject(credit) });
    (s.panel.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    await wait(20);
    expect(s.calls.length).toBeLessThanOrEqual(4);
    expect(s.panel.querySelector('.figures-status')?.textContent).toMatch(/^Stopped after \d drafts: Anthropic refused two in a row\. Anthropic refused the request \(400\): Your credit balance is too low.*check your key and its credit\.$/);
    // A 413 does not speak of credit.
    const { draftErrorWords } = await import('../src/lib/draft');
    expect(draftErrorWords(Object.assign(new Error('413'), { status: 413, error: { error: { message: 'Request too large' } } }))).toBe('Anthropic refused the request (413): Request too large. Trying again will not help.');
    // Beside it: a refusal of one figure (a 5xx) does not stop the run.
    let n = 0;
    const t = mount({ storage, files: sixFiles(), answer: async () => (++n === 1 ? Promise.reject(Object.assign(new Error('500'), { status: 500 })) : reply('ok')) });
    (t.panel.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    await wait(20);
    expect(t.calls).toHaveLength(6);
  });

  it('R5a.2-7 (c): the kept-text note goes once the person chooses, and the caret stays where they type', async () => {
    let release: () => void = () => {};
    const s = mount({ signedIn: true, answer: () => new Promise((r) => (release = () => r(reply('Late draft.')))) });
    button(items(s.panel)[0], 'draft').click();
    await flush();
    const ta = items(s.panel)[0].querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'My words';
    ta.dispatchEvent(new Event('input'));
    ta.focus();
    ta.setSelectionRange(2, 2);
    release();
    await flush();
    await flush();
    const now = items(s.panel)[0].querySelector('textarea') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(now);
    expect(now.selectionStart).toBe(2);
    expect(items(s.panel)[0].textContent).toContain('A draft arrived after you changed this figure');
    button(items(s.panel)[0], 'approve').click();
    expect(items(s.panel)[0].textContent).not.toContain('A draft arrived after you changed this figure');
  });
});
