/**
 * Sign-in for HintWise apps (docs/platform.md, section 2): Google, or a
 * magic link by email. One Supabase user pool, so a visitor signed in on one
 * app is known to all of them. Passwords are not offered.
 *
 * Every function takes the client as its last argument so tests pass a fake;
 * the default is the app's client from ./supabase.
 */
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

/** The part of the Supabase client the sign-in code uses. */
export type AuthClient = Pick<SupabaseClient, 'auth'>;

export type AuthCallback = (user: User | null, session: Session | null) => void;

/**
 * Starts Google sign-in through Supabase (docs/platform.md, section 2): the
 * browser goes to Google and comes back to `redirectTo`, which must match the
 * project's redirect allow-list (https://*.hintwise.org/** does). Google
 * always shows its account chooser, so a shared computer does not silently
 * reuse the last account.
 */
export function signInWithGoogle(redirectTo: string, client: AuthClient = getSupabase()) {
  return client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } });
}

/** Emails a sign-in link (through the platform's Resend SMTP). */
export function sendMagicLink(email: string, redirectTo: string, client: AuthClient = getSupabase()) {
  return client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
}

export function signOut(client: AuthClient = getSupabase()) {
  return client.auth.signOut();
}

/** The part of the Supabase client ensureProfile uses. */
export type ProfileClient = { schema(name: string): { rpc(fn: string): PromiseLike<{ error: { message: string } | null }> } };

/**
 * Creates or refreshes the user's row in platform.profiles. Called once per
 * sign-in; the platform has no trigger on auth.users (docs/platform.md).
 * Failures are reported, never thrown: the app works without a profile row.
 */
export async function ensureProfile(client: ProfileClient = getSupabase() as unknown as ProfileClient): Promise<string | null> {
  const { error } = await client.schema('platform').rpc('ensure_profile');
  return error ? error.message : null;
}

/** The current session's access token, for the LLM gateway. */
export async function currentToken(client: AuthClient = getSupabase()): Promise<string | null> {
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Calls back with the current user right away and again on every change.
 * Returns the unsubscribe function.
 */
export function onAuth(callback: AuthCallback, client: AuthClient = getSupabase()): () => void {
  void client.auth.getSession().then(({ data }) => callback(data.session?.user ?? null, data.session));
  const { data } = client.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
    callback(session?.user ?? null, session);
  });
  return () => data.subscription.unsubscribe();
}

/** Where sign-in returns to: this page, without query or hash. */
export function defaultRedirect(): string {
  return typeof location === 'undefined' ? '' : location.origin + location.pathname;
}

function button(label: string, onClick: () => void, type: 'button' | 'submit' = 'button'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = type;
  b.textContent = label;
  if (type === 'button') b.addEventListener('click', onClick);
  return b;
}

export interface SignInOptions {
  client?: AuthClient;
  redirectTo?: string;
  /** Client for platform.ensure_profile; default: `client` when it has `schema`, false to skip. */
  profileClient?: ProfileClient | false;
}

/** The client mountSignIn should create profiles with, or null. */
function profileClientFor(client: AuthClient, opt: ProfileClient | false | undefined): ProfileClient | null {
  if (opt === false) return null;
  if (opt) return opt;
  const maybe = client as unknown as Partial<ProfileClient>;
  return typeof maybe.schema === 'function' ? (maybe as ProfileClient) : null;
}

/**
 * Renders the sign-in panel with plain DOM: a Google button, an email field
 * for a magic link, and, once signed in, the user's email with a sign-out
 * button. Returns the unsubscribe function.
 */
export function mountSignIn(el: HTMLElement, opts: SignInOptions = {}): () => void {
  const client = opts.client ?? getSupabase();
  const redirectTo = opts.redirectTo ?? defaultRedirect();
  const profiles = profileClientFor(client, opts.profileClient);
  let profiled: string | null = null;
  el.classList.add('hw-signin');

  const render = (user: User | null): void => {
    el.replaceChildren();
    if (user && profiles && profiled !== user.id) {
      // Once per signed-in user: the platform has no trigger on auth.users.
      profiled = user.id;
      void ensureProfile(profiles);
    }
    if (user) {
      const who = document.createElement('p');
      who.className = 'hw-signin-user';
      who.textContent = `Signed in as ${user.email ?? user.id}`;
      el.append(who, button('Sign out', () => void signOut(client)));
      return;
    }
    const google = button('Continue with Google', () => void signInWithGoogle(redirectTo, client));
    google.className = 'hw-signin-google';

    const form = document.createElement('form');
    const input = document.createElement('input');
    input.type = 'email';
    input.required = true;
    input.autocomplete = 'email';
    input.placeholder = 'you@example.com';
    input.setAttribute('aria-label', 'Email for a sign-in link');
    const send = button('Email me a sign-in link', () => undefined, 'submit');
    form.append(input, send);

    const status = document.createElement('p');
    status.className = 'hw-signin-status';
    status.setAttribute('role', 'status');

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = input.value.trim();
      if (!email) return;
      send.disabled = true;
      status.textContent = 'Sending...';
      void sendMagicLink(email, redirectTo, client).then(({ error }) => {
        status.textContent = error ? `Could not send the link: ${error.message}` : `Check ${email} for a sign-in link.`;
        send.disabled = false;
      });
    });

    el.append(google, form, status);
  };

  return onAuth((user) => render(user), client);
}
