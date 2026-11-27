/**
 * The page of milestone 1 (SPEC section 4, Home): the promise, the
 * "Simulated" line and sign-in for a visitor; for a signed-in person, the
 * upload screen, which says "The checker is not available yet." and has no
 * upload box, because no capture service answers for this page (AC-11). The
 * page asks the capture service nothing in this milestone (DECISIONS.md D-7).
 */
import type { User } from '@supabase/supabase-js';
import { mountSignIn as defaultMountSignIn, onAuth as defaultOnAuth, type AuthCallback, type AuthClient } from '../lib/auth';
import { APP_NAME, NOT_AVAILABLE, PROMISE, SIMULATED_LABEL } from '../core/text';

export interface AppDeps {
  /** The sign-in client, or null in preview mode (a build without Supabase values). */
  client: AuthClient | null;
  mountSignIn?: (el: HTMLElement, opts: { client: AuthClient }) => () => void;
  onAuth?: (callback: AuthCallback, client: AuthClient) => () => void;
}

export const PREVIEW_NOTE = 'Sign-in appears once VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.';

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The signed-out card: what a visitor can do (sign in; the examples come in milestone 3). */
export function signedOutCard(doc: Document): HTMLElement {
  const card = el(doc, 'section', { class: 'card', 'aria-labelledby': 'check-heading' });
  card.append(
    el(doc, 'h2', { id: 'check-heading' }, 'Check a tagged PDF'),
    el(doc, 'p', {}, 'Sign in to check a PDF: use "Sign in with Google" or "Email code" at the top right.'),
    el(doc, 'p', { class: 'muted' }, 'Free, with a daily limit. Nothing is saved unless you choose to save it.'),
  );
  return card;
}

/** The upload screen of milestone 1: no upload box while no capture service answers. */
export function uploadScreen(doc: Document): HTMLElement {
  const card = el(doc, 'section', { class: 'card', 'aria-labelledby': 'check-heading' });
  card.append(el(doc, 'h2', { id: 'check-heading' }, 'Check a tagged PDF'), el(doc, 'p', { class: 'notice', role: 'status' }, NOT_AVAILABLE));
  return card;
}

/** Draws the page into `root` and keeps the check area in step with sign-in. Returns the clean-up. */
export function mount(root: HTMLElement, deps: AppDeps): () => void {
  const doc = root.ownerDocument;
  root.textContent = '';
  const header = el(doc, 'header', { class: 'top-bar' });
  const signin = el(doc, 'div', { id: 'signin', role: 'region', 'aria-label': 'Account' });
  header.append(el(doc, 'h1', {}, APP_NAME), el(doc, 'hw-theme-toggle'), signin);
  const main = el(doc, 'main');
  const area = el(doc, 'div', { id: 'check-area' });
  main.append(el(doc, 'p', { class: 'promise' }, PROMISE), el(doc, 'p', { class: 'label' }, SIMULATED_LABEL), area);
  root.append(header, main);

  let shown: string | null | undefined;
  const show = (user: User | null) => {
    const id = user?.id ?? null;
    // The sign-in library repeats SIGNED_IN when the tab is shown again: redraw only on a change of person.
    if (id === shown) return;
    shown = id;
    area.replaceChildren(id ? uploadScreen(doc) : signedOutCard(doc));
  };

  if (!deps.client) {
    signin.textContent = PREVIEW_NOTE;
    show(null);
    return () => {};
  }
  show(null);
  const unmountSignIn = (deps.mountSignIn ?? defaultMountSignIn)(signin, { client: deps.client });
  const unsubscribe = (deps.onAuth ?? defaultOnAuth)((user) => show(user), deps.client);
  return () => {
    unsubscribe();
    unmountSignIn();
  };
}
