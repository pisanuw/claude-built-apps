/**
 * The /terminal/ page: signs a terminal in to HintWise for the command-line
 * tool. Without a code in the address it asks for an email address and has
 * the platform send a sign-in link that returns here. With one, it shows the
 * code to paste into the terminal and never uses it, so this browser stays
 * signed out and the terminal gets a session of its own.
 */
import type { SignInLinkResult, TurnstileApi } from '../lib/auth';
import { formatReset } from '../core/caps';

export interface TerminalDeps {
  /** Where the sign-in link returns: this page's address without query. */
  redirectTo: string;
  sendLink: (email: string, redirectTo: string, opts: { turnstileToken?: string }) => Promise<SignInLinkResult>;
  loadTurnstile: () => Promise<TurnstileApi>;
  turnstileAction: string;
  /** The page's current address. */
  href: string;
  /** Replaces the address without reloading (drops the code from history). */
  replaceUrl?: (url: string) => void;
  clipboard?: Pick<Clipboard, 'writeText'>;
  formatTime?: (iso: string) => string;
}

const HELP = `
  <header>
    <h1>Terminal sign-in</h1>
    <p class="lede">For the <a href="/">Lewis Structure Alt Text</a> command-line tool. It signs your terminal in to HintWise, so the tool can write alt text with your HintWise allowance.</p>
  </header>`;

const ASK = `${HELP}
  <section class="card" aria-labelledby="ask-h">
    <h2 id="ask-h">1. Get a sign-in link</h2>
    <form id="link-form" novalidate>
      <label for="email">Email address</label>
      <input id="email" type="email" autocomplete="email" required>
      <div id="challenge"></div>
      <div class="actions">
        <button id="send" type="submit">Email me a link for my terminal</button>
      </div>
      <p id="link-status" role="status" aria-live="polite"></p>
    </form>
  </section>
  <section class="card" aria-labelledby="next-h">
    <h2 id="next-h">2. Then</h2>
    <p>Open the link in the email. It brings you back to this page with a code. Paste the code into the terminal where <code>lewis-alt-text login</code> is waiting.</p>
    <p class="muted small">This page never signs this browser in. To use the app here instead, go to <a href="/">the app</a>.</p>
  </section>`;

const SHOW = `${HELP}
  <section class="card" aria-labelledby="code-h">
    <h2 id="code-h" tabindex="-1">Your terminal sign-in code</h2>
    <p>Paste this into the terminal where <code>lewis-alt-text login</code> is waiting.</p>
    <textarea id="code" rows="2" readonly aria-labelledby="code-h" spellcheck="false"></textarea>
    <div class="row">
      <button id="copy" type="button">Copy code</button>
      <span id="copy-status" class="muted" role="status" aria-live="polite"></span>
    </div>
    <p class="muted small">The code works once and expires soon. Treat it like a password: anyone with it can sign in as you. This browser has not been signed in.</p>
  </section>`;

export function mountTerminal(root: HTMLElement, deps: TerminalDeps): { idle(): Promise<void> } {
  const url = new URL(deps.href);
  const code = url.searchParams.get('token_hash');
  const format = deps.formatTime ?? ((iso: string) => formatReset(iso));
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector(`#${id}`) as T;
  let busy: Promise<void> = Promise.resolve();

  if (code) {
    root.innerHTML = SHOW;
    $<HTMLTextAreaElement>('code').value = code;
    // Keep the code out of the address bar and history once it is on the page.
    deps.replaceUrl?.(url.origin + url.pathname);
    $('code-h').focus();
    $('copy').addEventListener('click', () => {
      busy = (async () => {
        try {
          await (deps.clipboard ?? navigator.clipboard).writeText(code);
          $('copy-status').textContent = 'Copied.';
        } catch {
          $<HTMLTextAreaElement>('code').select();
          $('copy-status').textContent = 'Press Ctrl+C (or Command+C) to copy the selected code.';
        }
      })();
    });
    return { idle: () => busy };
  }

  root.innerHTML = ASK;
  const form = $<HTMLFormElement>('link-form');
  const status = $('link-status');
  const send = $<HTMLButtonElement>('send');

  async function request(email: string, turnstileToken?: string): Promise<void> {
    send.disabled = true;
    status.textContent = 'Sending...';
    const r = await deps.sendLink(email, deps.redirectTo, turnstileToken ? { turnstileToken } : {});
    send.disabled = false;
    if (r.status === 'sent') {
      status.textContent = `Sent. Open the link in the email to ${email} to get your code.`;
      $('challenge').replaceChildren();
    } else if (r.status === 'wait') {
      status.textContent = `A link was sent recently. You can ask for another at ${format(r.retryAt)}.`;
    } else if (r.status === 'suppressed' || r.status === 'error') {
      status.textContent = r.message;
    } else {
      status.textContent = r.failed ? 'The check did not pass. Try it again.' : 'One quick check first.';
      try {
        const turnstile = await deps.loadTurnstile();
        const box = root.ownerDocument.createElement('div');
        $('challenge').replaceChildren(box);
        turnstile.render(box, {
          sitekey: r.siteKey,
          action: deps.turnstileAction,
          callback: (token) => {
            busy = request(email, token);
          },
          'error-callback': () => {
            status.textContent = 'The check could not run. Reload the page and try again.';
          },
        });
      } catch {
        status.textContent = 'The check could not load. Reload the page and try again.';
      }
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $<HTMLInputElement>('email').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      status.textContent = 'Enter your email address.';
      $('email').focus();
      return;
    }
    busy = request(email);
  });
  return { idle: () => busy };
}
