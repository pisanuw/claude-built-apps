/**
 * Mounts the /terminal/ page with the real sign-in link function and
 * Turnstile. Everything else is in src/ui/terminal.ts.
 */
import './ui/styles.css';
import { loadTurnstile, sendMagicLink, TURNSTILE_ACTION } from './lib/auth';
import { mountTerminal } from './ui/terminal';

const root = document.getElementById('app');
if (!root) throw new Error('terminal/index.html needs <main id="app">');

mountTerminal(root, {
  redirectTo: location.origin + location.pathname,
  sendLink: (email, redirectTo, opts) => sendMagicLink(email, redirectTo, opts),
  loadTurnstile: () => loadTurnstile(),
  turnstileAction: TURNSTILE_ACTION,
  href: location.href,
  replaceUrl: (url) => history.replaceState(null, '', url),
});
