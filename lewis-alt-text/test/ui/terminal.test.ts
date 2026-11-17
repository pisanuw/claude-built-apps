// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { SignInLinkResult, TurnstileApi } from '../../src/lib/auth';
import { mountTerminal, type TerminalDeps } from '../../src/ui/terminal';

const PAGE = 'https://lewis-alt-text.hintwise.org/terminal/';

function setup(over: Partial<TerminalDeps> = {}) {
  document.body.innerHTML = '<main id="app"></main>';
  const root = document.getElementById('app') as HTMLElement;
  const deps: TerminalDeps = {
    redirectTo: PAGE,
    sendLink: vi.fn(async (): Promise<SignInLinkResult> => ({ status: 'sent' })),
    loadTurnstile: vi.fn(async () => ({ render: vi.fn(), reset: vi.fn() }) as TurnstileApi),
    turnstileAction: 'sign-in',
    href: PAGE,
    replaceUrl: vi.fn(),
    clipboard: { writeText: vi.fn(async () => {}) },
    formatTime: (iso) => `T(${iso})`,
    ...over,
  };
  const page = mountTerminal(root, deps);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector(`#${id}`) as T;
  return { deps, page, $ };
}

async function ask(t: ReturnType<typeof setup>, email = 'ann@example.com') {
  t.$<HTMLInputElement>('email').value = email;
  t.$<HTMLFormElement>('link-form').dispatchEvent(new Event('submit', { cancelable: true }));
  await t.page.idle();
}

describe('with a code in the address', () => {
  it('shows the code, never uses it, and clears it from the address bar', async () => {
    const t = setup({ href: `${PAGE}?token_hash=abc123&type=email&email_hint=a***@b.c` });
    expect(t.$<HTMLTextAreaElement>('code').value).toBe('abc123');
    expect(t.deps.replaceUrl).toHaveBeenCalledWith(PAGE);
    expect(t.deps.sendLink).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(t.$('code-h'));
    t.$('copy').click();
    await t.page.idle();
    expect(t.deps.clipboard!.writeText).toHaveBeenCalledWith('abc123');
    expect(t.$('copy-status').textContent).toBe('Copied.');
  });
  it('selects the code when the clipboard is blocked', async () => {
    const t = setup({ href: `${PAGE}?token_hash=abc123`, clipboard: { writeText: async () => Promise.reject(new Error('no')) } });
    t.$('copy').click();
    await t.page.idle();
    expect(t.$('copy-status').textContent).toMatch(/Ctrl\+C/);
  });
});

describe('asking for a link', () => {
  it('needs an email address', async () => {
    const t = setup();
    await ask(t, 'nope');
    expect(t.$('link-status').textContent).toBe('Enter your email address.');
    expect(t.deps.sendLink).not.toHaveBeenCalled();
  });
  it('sends a link that returns to this page', async () => {
    const t = setup();
    await ask(t);
    expect(t.deps.sendLink).toHaveBeenCalledWith('ann@example.com', PAGE, {});
    expect(t.$('link-status').textContent).toMatch(/^Sent\. Open the link in the email to ann@example.com/);
    expect(t.$<HTMLButtonElement>('send').disabled).toBe(false);
  });
  it('explains waits, suppressed addresses and errors', async () => {
    const wait = setup({ sendLink: async () => ({ status: 'wait', retryAt: 'R' }) });
    await ask(wait);
    expect(wait.$('link-status').textContent).toMatch(/another at T\(R\)/);
    const off = setup({ sendLink: async () => ({ status: 'suppressed', message: 'Email is off.' }) });
    await ask(off);
    expect(off.$('link-status').textContent).toBe('Email is off.');
    const err = setup({ sendLink: async () => ({ status: 'error', message: 'Down.' }) });
    await ask(err);
    expect(err.$('link-status').textContent).toBe('Down.');
  });
  it('runs the Turnstile check when asked, then sends with its token', async () => {
    let callback: (token: string) => void = () => {};
    let onError: () => void = () => {};
    const render = vi.fn((_el: HTMLElement, opts: Parameters<TurnstileApi['render']>[1]) => {
      callback = opts.callback;
      onError = opts['error-callback']!;
      return 'w1';
    });
    const sendLink = vi
      .fn<TerminalDeps['sendLink']>()
      .mockResolvedValueOnce({ status: 'challenge', siteKey: 'K' })
      .mockResolvedValueOnce({ status: 'sent' });
    const t = setup({ sendLink, loadTurnstile: async () => ({ render, reset: vi.fn() }) });
    await ask(t);
    expect(t.$('link-status').textContent).toBe('One quick check first.');
    expect(render.mock.calls[0][1]).toMatchObject({ sitekey: 'K', action: 'sign-in' });
    onError();
    expect(t.$('link-status').textContent).toMatch(/could not run/);
    callback('tok');
    await t.page.idle();
    expect(sendLink).toHaveBeenLastCalledWith('ann@example.com', PAGE, { turnstileToken: 'tok' });
    expect(t.$('link-status').textContent).toMatch(/^Sent/);
    expect(t.$('challenge').children).toHaveLength(0);
  });
  it('says when the check failed or could not load', async () => {
    const failed = setup({ sendLink: async () => ({ status: 'challenge', siteKey: 'K', failed: true }) });
    await ask(failed);
    await vi.waitFor(() => expect(failed.$('link-status').textContent).toBe('The check did not pass. Try it again.'));
    const broken = setup({ sendLink: async () => ({ status: 'challenge', siteKey: 'K' }), loadTurnstile: async () => Promise.reject(new Error('blocked')) });
    await ask(broken);
    await vi.waitFor(() => expect(broken.$('link-status').textContent).toMatch(/could not load/));
  });
});
