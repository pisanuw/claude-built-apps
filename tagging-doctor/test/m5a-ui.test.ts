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
