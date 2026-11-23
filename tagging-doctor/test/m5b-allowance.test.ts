// @vitest-environment jsdom
/**
 * Milestone 5b, S2-12's second part (PLAN.md's 5b row): signed in on
 * HintWise's key, the figure panel says about how many drafts the person's
 * allowance still covers, from the gateway's check mode (no model call).
 * The first part, one draft's measured cost, needs a live paid draft and
 * stays open (D-149); the count uses DRAFT_COST_ESTIMATE_USD until then.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanDocument } from '../src/core/scan';
import { allowanceWords, draftsLeft, DRAFT_COST_ESTIMATE_USD } from '../src/lib/draft';
import { checkAllowance, GatewayError, LlmUnavailable, memoryStorage, setByokKey, type AskDeps, type GatewayAllowance, type Message } from '../src/lib/llm';
import { mountFixes, newFixesState } from '../src/ui/fixes';
import { index, project } from './patch-helpers';

const MAIN = '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\includegraphics{a.pdf}\n\\includegraphics{b.pdf}\n\\end{document}\n';
const open = (limits: GatewayAllowance['limits'], over: Partial<GatewayAllowance> = {}): GatewayAllowance => ({ allowed: true, scope: null, resets_at: null, limits, calls_left: null, ...over });
const day = (used: number, cap: number, unit = 'usd') => ({ scope: unit === 'calls' ? 'app-user-day-calls' : 'user-day', unit, used, cap, resets_at: '2026-11-24T00:00:00Z' });
const flush = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('S2-12: the gateway check mode', () => {
  it('posts { app, check: true } with the session token and reads the answer', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const answer = open([day(0.05, 0.25)], { uses_credit: false, app_open: true });
    const a = await checkAllowance({
      getToken: async () => 'tok',
      gatewayUrl: 'https://gw.test/functions/v1/llm-gateway',
      fetch: (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return new Response(JSON.stringify(answer), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(a).toEqual(answer);
    expect(seen[0].url).toBe('https://gw.test/functions/v1/llm-gateway');
    expect(JSON.parse(seen[0].init.body as string)).toEqual({ app: 'tagging-doctor', check: true });
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('refuses signed out, on an error answer and on an answer it cannot read', async () => {
    const deps = (status: number, body: unknown): AskDeps => ({ getToken: async () => 't', gatewayUrl: 'https://gw.test', fetch: (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch });
    await expect(checkAllowance({ getToken: async () => null, gatewayUrl: 'https://gw.test' })).rejects.toBeInstanceOf(LlmUnavailable);
    await expect(checkAllowance(deps(403, { error: 'app', message: 'not enabled' }))).rejects.toBeInstanceOf(GatewayError);
    await expect(checkAllowance(deps(200, { ok: 1 }))).rejects.toThrow(/cannot read/);
    const bare = await checkAllowance(deps(200, { allowed: true, limits: [] }));
    expect(bare).toEqual({ allowed: true, limits: [], scope: null, resets_at: null, calls_left: null });
  });

  it('counts the drafts the tightest limit leaves, at the estimate, and says so', () => {
    expect(DRAFT_COST_ESTIMATE_USD).toBe(0.0006);
    expect(draftsLeft(open([]))).toBeNull();
    expect(draftsLeft(open([day(0.07, 0.25)]))).toBe(300);
    expect(draftsLeft(open([day(0.07, 0.25), day(7, 10, 'calls')]))).toBe(3);
    expect(draftsLeft(open([day(0.3, 0.25)]))).toBe(0);
    expect(draftsLeft(open([day(0, 0.25)], { allowed: false }))).toBe(0);
    expect(allowanceWords(open([]))).toBeNull();
    expect(allowanceWords(open([day(0.07, 0.25)]))).toBe('About 300 drafts are left for you today (an estimate from your daily allowance).');
    expect(allowanceWords(open([day(9, 10, 'calls')]))).toBe('About 1 draft is left for you today (an estimate from your daily allowance).');
    expect(allowanceWords(open([day(0, 1)]))).toBe('About 1,666 drafts are left for you today (an estimate from your daily allowance).');
    expect(allowanceWords(open([day(0.2499, 0.25)]))).toBe('HintWise’s key has about no drafts left for you today.');
    expect(allowanceWords(open([], { allowed: false, resets_at: '2026-11-24T00:00:00Z', scope: 'user-day' }), () => 'Tue 00:00 UTC')).toBe('HintWise’s key has no drafts left for you now; it opens again Tue 00:00 UTC.');
    expect(allowanceWords(open([], { allowed: false }))).toBe('HintWise’s key has no drafts left for you now; it opens again later.');
    expect(allowanceWords(open([], { uses_credit: true }))).toMatch(/one of your credits/);
  });
});

describe('S2-12: the figure panel states the allowance', () => {
  function mount(check: (deps: AskDeps) => Promise<GatewayAllowance>, opts: { key?: boolean } = {}) {
    document.body.innerHTML = '<div id="p"></div>';
    const panel = document.getElementById('p') as HTMLElement;
    const p = project({ 'main.tex': MAIN, 'a.pdf': '%PDF-1.4', 'b.pdf': '%PDF-1.4' });
    const storage = memoryStorage();
    if (opts.key) setByokKey('k', storage);
    const asked: string[] = [];
    mountFixes(panel, {
      project: p,
      scan: scanDocument(p, 'main.tex', index),
      state: newFixesState(),
      downloadBlob: () => {},
      onClose: () => {},
      figures: {
        signedIn: () => true,
        storage,
        draft: {
          check: async (d) => {
            asked.push('check');
            return check(d);
          },
          ask: async () => {
            asked.push('draft');
            return { id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'T' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as unknown as Message;
          },
        },
      },
    });
    const line = () => panel.querySelector('.draft-mode')?.textContent ?? '';
    return { panel, line, asked, storage };
  }

  it('on HintWise’s key: the count after the mode line, asked again after Draft all', async () => {
    let used = 0.07;
    const s = mount(async () => open([day(used, 0.25)]));
    expect(s.line()).toBe('Drafts use HintWise’s key, within its daily allowance. Your own key, above, has no such limit.');
    await flush();
    expect(s.line()).toBe('Drafts use HintWise’s key, within its daily allowance. About 300 drafts are left for you today (an estimate from your daily allowance). Your own key, above, has no such limit.');
    used = 0.13;
    (s.panel.querySelector('[data-role="draft-all"]') as HTMLButtonElement).click();
    await flush(10);
    expect(s.asked).toEqual(['check', 'draft', 'draft', 'check']);
    expect(s.line()).toContain('About 200 drafts are left for you today');
  });

  it('with the own key no check is made; Forget key asks once', async () => {
    const s = mount(async () => open([day(0, 0.25)]), { key: true });
    await flush();
    expect(s.asked).toEqual([]);
    expect(s.line()).toBe('Drafts use your own key.');
    (s.panel.querySelector('[data-role="forget-key"]') as HTMLButtonElement).click();
    await flush();
    expect(s.asked).toEqual(['check']);
    expect(s.line()).toContain('About 416 drafts are left');
  });

  it('a failed check leaves the plain mode line, and drafting works', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = mount(async () => {
      throw new GatewayError(500, {});
    });
    await flush();
    expect(warn).toHaveBeenCalled();
    expect(s.line()).toBe('Drafts use HintWise’s key, within its daily allowance. Your own key, above, has no such limit.');
    (s.panel.querySelector('li.figure-item [data-role="draft"]') as HTMLButtonElement).click();
    await flush();
    expect(s.asked).toContain('draft');
  });
});
