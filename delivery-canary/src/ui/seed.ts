/**
 * The "Check your seed inbox" card: the shop's own test Gmail account, signed
 * in to with an app password over IMAP on our server. The newest delivery
 * email from the shop's sender is found, Gmail's placement read, and the
 * delivery-email check run on it in this page.
 *
 * Signed out, the card explains the setup and offers a sample run (the
 * sample email, as the seed inbox would find it in Promotions).
 */
import { WHERE_TEXT, type SeedWhere } from '../core/seedwhere';
import type { Placement } from '../core/types';
import type { SeedInboxRow, ShopRow, Stores } from '../store/stores';
import { clear, h, when } from './dom';
import { SeedCheckFailed, type SeedRequest, type SeedResponse } from './seedclient';

export interface SeedCardDeps {
  stores: () => Stores;
  shop: () => ShopRow | null;
  ensureShop: () => Promise<ShopRow>;
  /** The session token, or null when signed out. */
  token: () => Promise<string | null>;
  check: (req: SeedRequest, token: string) => Promise<SeedResponse>;
  /** Whether the server can keep app passwords. */
  keepAvailable: () => Promise<boolean>;
  /** Runs the delivery-email check on the found message, with Gmail's placement. */
  runEmail: (raw: ArrayBuffer | string, placement: Placement, seed: { where: SeedWhere; receivedAt: string }) => Promise<void>;
  /** The sample, as a seed inbox check would find it. */
  runSample: () => Promise<void>;
  /** A sender to suggest (the From address of the last checked email), or ''. */
  suggestSender: () => string;
}

export const OUTCOME_TEXT: Record<string, string> = {
  found: 'found the delivery email',
  'not-found': 'no delivery email found',
  'login-failed': 'Gmail did not accept the app password',
  'needs-app-password': 'Gmail wanted an app password',
  'web-login': 'Google blocked the sign-in',
  'imap-off': 'IMAP was turned off',
  unreachable: 'Gmail did not answer',
  timeout: 'Gmail did not answer in time',
  mailbox: 'a folder could not be opened',
  protocol: 'Gmail answered in an unexpected way',
};

const DAYS = 14;

export function mountSeed(deps: SeedCardDeps): { el: HTMLElement; refresh: () => Promise<void>; reset: () => void } {
  let row: SeedInboxRow | undefined;
  let canKeep = false;
  let busy = false;

  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite', id: 'seed-status' });
  const say = (t: string) => {
    status.textContent = t;
  };
  const address = h('input', { id: 'seed-address', type: 'email', maxlength: '254', autocomplete: 'off', spellcheck: 'false', placeholder: 'canary.myshop@gmail.com' });
  const sender = h('input', { id: 'seed-sender', type: 'text', maxlength: '254', autocomplete: 'off', spellcheck: 'false', placeholder: 'orders@myshop.com or myshop.com', 'aria-describedby': 'seed-sender-hint' });
  const subject = h('input', { id: 'seed-subject', type: 'text', maxlength: '100', autocomplete: 'off', placeholder: 'Your download is ready', 'aria-describedby': 'seed-subject-hint' });
  const password = h('input', { id: 'seed-password', type: 'password', maxlength: '64', autocomplete: 'new-password', spellcheck: 'false', 'aria-describedby': 'seed-password-hint' });
  const passwordHint = h('p', { class: 'hint', id: 'seed-password-hint' });
  const remember = h('input', { id: 'seed-remember', type: 'checkbox' });
  const rememberLabel = h('label', { for: 'seed-remember', class: 'check' }, remember, ' Keep the app password, encrypted, so later checks (and scheduled ones, coming soon) can run without me');
  const checkBtn = h('button', { type: 'submit', id: 'seed-check', class: 'primary' }, 'Check my seed inbox now');
  const forgetBtn = h('button', { type: 'button', id: 'seed-forget', class: 'link danger', hidden: true }, 'Forget this seed inbox');
  const sampleBtn = h('button', { type: 'button', id: 'seed-sample' }, 'See a sample seed inbox check');
  const last = h('p', { class: 'hint', id: 'seed-last' });
  const signedOutNote = h('p', { class: 'hint', id: 'seed-signin-note' }, 'Sign in (top of the page) to connect your seed inbox. The check signs in to Gmail from our server, so it needs an account.');

  const form = h(
    'form',
    { id: 'seed-form', novalidate: true },
    h(
      'div',
      { class: 'grid2' },
      h('div', {}, h('label', { for: 'seed-address', class: 'block' }, 'Seed Gmail address'), address),
      h('div', {}, h('label', { for: 'seed-password', class: 'block' }, 'App password'), password, passwordHint),
      h('div', {}, h('label', { for: 'seed-sender', class: 'block' }, 'Download emails come from'), sender, h('p', { class: 'hint', id: 'seed-sender-hint' }, 'The address (or just the domain) your delivery app sends from.')),
      h('div', {}, h('label', { for: 'seed-subject', class: 'block' }, 'Subject words (optional)'), subject, h('p', { class: 'hint', id: 'seed-subject-hint' }, 'Only when the same sender also sends other mail, like order confirmations.')),
    ),
    rememberLabel,
    h('div', { class: 'actions' }, checkBtn, forgetBtn),
  );

  const el = h(
    'section',
    { class: 'card', 'aria-labelledby': 'seed-h', id: 'seed-card' },
    h('h2', { id: 'seed-h' }, 'Check your seed inbox'),
    h('p', {}, 'Keep a Gmail account just for test orders. Delivery Canary signs in to it, finds your newest download email, reads whether Gmail put it in the inbox, Promotions or Spam, and checks it like the email above.'),
    h(
      'details',
      { class: 'howto' },
      h('summary', {}, 'How to set up a seed inbox'),
      h(
        'ol',
        {},
        h('li', {}, 'Create a Gmail account for test orders only, not your personal or shop mailbox.'),
        h('li', {}, 'In that Google Account, turn on 2-Step Verification (Security, then "2-Step Verification").'),
        h('li', {}, 'Create an app password at myaccount.google.com/apppasswords, name it "Delivery Canary", and paste the 16 letters here.'),
        h('li', {}, 'Place a test order in your shop with that address (a 100% off code works), wait a minute, then check.'),
      ),
      h('p', {}, 'Our server uses the app password to sign in to imap.gmail.com, opens the folders read-only and passes the newest delivery email to this page; the email is not stored. Only if you tick "Keep" is the password stored, encrypted with a key only the server holds. You can revoke the app password in that Google Account at any time.'),
    ),
    signedOutNote,
    form,
    h('div', { class: 'actions' }, sampleBtn),
    status,
    last,
  );

  function signedIn(): boolean {
    return deps.stores().saved;
  }

  function render(): void {
    const on = signedIn();
    signedOutNote.hidden = on;
    form.hidden = !on;
    sampleBtn.hidden = on;
    forgetBtn.hidden = !row;
    if (row) {
      address.value = row.address;
      sender.value = row.sender;
      subject.value = row.subject_hint;
    } else if (!sender.value) {
      sender.value = deps.suggestSender();
    }
    passwordHint.textContent = row?.has_secret ? 'A password is kept for this inbox: leave this empty to use it.' : 'Spaces are fine. Never your normal Google password.';
    remember.disabled = !canKeep;
    if (!canKeep) remember.checked = false;
    else if (row?.has_secret) remember.checked = true;
    rememberLabel.title = canKeep ? '' : 'Keeping passwords is not switched on for this site yet; enter it for each check.';
    last.textContent = row?.last_checked_at ? `Last checked ${when(row.last_checked_at)}: ${OUTCOME_TEXT[row.last_outcome ?? ''] ?? 'no result'}.` : '';
  }

  async function refresh(): Promise<void> {
    row = undefined;
    const shop = deps.shop();
    if (signedIn()) {
      canKeep = await deps.keepAvailable();
      if (shop) {
        try {
          row = await deps.stores().seeds.get(shop.id);
        } catch (e) {
          say(`Could not load the seed inbox: ${(e as Error).message}`);
        }
      }
    }
    render();
  }

  function reset(): void {
    row = undefined;
    address.value = '';
    sender.value = '';
    subject.value = '';
    password.value = '';
    say('');
  }

  async function check(): Promise<void> {
    if (busy) return;
    const req = { address: address.value.trim(), sender: sender.value.trim(), subject: subject.value.trim(), password: password.value, remember: remember.checked && canKeep };
    if (!req.address) {
      say('Enter the seed Gmail address.');
      address.focus();
      return;
    }
    if (!req.sender) {
      say('Enter the address or domain your download emails come from.');
      sender.focus();
      return;
    }
    if (!req.password.trim() && !row?.has_secret) {
      say('Paste the app password of the seed account.');
      password.focus();
      return;
    }
    busy = true;
    checkBtn.disabled = true;
    try {
      const token = await deps.token();
      if (!token) {
        say('Sign in to check your seed inbox.');
        return;
      }
      const shop = await deps.ensureShop();
      say(`Signing in to ${req.address} and looking for the newest email from ${req.sender}…`);
      let res: SeedResponse;
      try {
        res = await deps.check({ ...req, shopId: shop.id }, token);
      } catch (e) {
        say(e instanceof SeedCheckFailed ? e.message : 'The seed inbox check could not run. Try again in a minute.');
        if (e instanceof SeedCheckFailed && e.outcome === 'no-password') password.focus();
        await refresh();
        return;
      }
      password.value = '';
      const keptNote = res.kept ? ' The app password is kept, encrypted.' : '';
      const savedNote = res.saved ? '' : ' (The inbox settings could not be saved.)';
      if (!res.found) {
        say(`No email from ${req.sender} in the last ${DAYS} days in ${req.address}: not in the inbox, its tabs, All Mail or Spam. Place a test order to that address, wait a minute, and check again.${keptNote}${savedNote}`);
      } else {
        say(`Found it: Gmail put the newest email from ${req.sender} in ${WHERE_TEXT[res.where]}${res.receivedAt ? ` (arrived ${when(res.receivedAt)})` : ''}. The full check is above.${res.truncated ? ' The email was very large, so only its start was read.' : ''}${keptNote}${savedNote}`);
        await deps.runEmail(res.raw, res.placement, { where: res.where, receivedAt: res.receivedAt });
      }
      await refresh();
    } catch (e) {
      say(`Could not check the seed inbox: ${(e as Error).message}`);
    } finally {
      busy = false;
      checkBtn.disabled = false;
    }
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void check();
  });

  forgetBtn.addEventListener('click', () => {
    void (async () => {
      const shop = deps.shop();
      if (!shop) return;
      try {
        await deps.stores().seeds.remove(shop.id);
        reset();
        say('Seed inbox forgotten, with any kept app password. You can also revoke the app password in that Google Account.');
      } catch (e) {
        say(`Could not forget the seed inbox: ${(e as Error).message}`);
      }
      await refresh();
    })();
  });

  sampleBtn.addEventListener('click', () => {
    void (async () => {
      say('Sample: the seed inbox found the newest download email from hello@juniperstitch.example in the Promotions tab. The full check is above.');
      await deps.runSample();
    })();
  });

  clear(status);
  render();
  return { el, refresh, reset };
}
