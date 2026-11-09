// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, User } from '@supabase/supabase-js';
import { currentToken, defaultRedirect, ensureProfile, mountSignIn, onAuth, sendMagicLink, signInWithGoogle, signOut, type AuthClient, type ProfileClient } from '../src/lib/auth';

type Listener = (event: string, session: Session | null) => void;

/** A fake of the supabase-js auth surface the sign-in code uses. */
function fakeAuth(session: Session | null = null) {
  let listener: Listener | null = null;
  const unsubscribe = vi.fn();
  const auth = {
    signInWithOAuth: vi.fn(async () => ({ data: { provider: 'google', url: 'https://accounts.google.com/o' }, error: null })),
    signInWithOtp: vi.fn(async () => ({ data: { user: null, session: null }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: { session }, error: null })),
    onAuthStateChange: vi.fn((cb: Listener) => {
      listener = cb;
      return { data: { subscription: { id: 's', callback: cb, unsubscribe } } };
    }),
  };
  const client = { auth } as unknown as AuthClient;
  return { client, auth, unsubscribe, emit: (s: Session | null) => listener?.('SIGNED_IN', s) };
}

const user = { id: 'u1', email: 'ann@example.com' } as User;
const session = { access_token: 'tok-1', user } as Session;
const flush = () => new Promise((r) => setTimeout(r, 0));

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="panel"></div>';
  root = document.getElementById('panel')!;
});

describe('auth functions', () => {
  it('start Google and magic-link sign-in with the redirect, and sign out', async () => {
    const { client, auth } = fakeAuth();
    await signInWithGoogle('https://x.hintwise.org/', client);
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://x.hintwise.org/', queryParams: { prompt: 'select_account' } } });
    await sendMagicLink('ann@example.com', 'https://x.hintwise.org/', client);
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'ann@example.com', options: { emailRedirectTo: 'https://x.hintwise.org/' } });
    await signOut(client);
    expect(auth.signOut).toHaveBeenCalled();
  });
  it('reads the session token for the gateway', async () => {
    expect(await currentToken(fakeAuth(null).client)).toBeNull();
    expect(await currentToken(fakeAuth(session).client)).toBe('tok-1');
  });
  it('calls back now and on every change, until unsubscribed', async () => {
    const { client, emit, unsubscribe } = fakeAuth(session);
    const cb = vi.fn();
    const off = onAuth(cb, client);
    await flush();
    expect(cb).toHaveBeenCalledWith(user, session);
    emit(null);
    expect(cb).toHaveBeenLastCalledWith(null, null);
    off();
    expect(unsubscribe).toHaveBeenCalled();
  });
  it('redirects back to this page without query or hash', () => {
    expect(defaultRedirect()).toBe(location.origin + location.pathname);
  });
  it('uses the app client by default, which needs the Supabase env', () => {
    expect(() => mountSignIn(root)).toThrow(/Supabase is not configured/);
  });
});

describe('mountSignIn', () => {
  const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label)!;

  it('renders the signed-out panel: Google button and an email form', async () => {
    const { client, auth } = fakeAuth();
    mountSignIn(root, { client, redirectTo: 'https://x.hintwise.org/app/' });
    await flush();
    expect(root.classList.contains('hw-signin')).toBe(true);
    expect(button('Continue with Google')).toBeTruthy();
    expect(root.querySelector('input[type=email]')).toBeTruthy();
    expect(button('Email me a sign-in link').type).toBe('submit');
    button('Continue with Google').click();
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'https://x.hintwise.org/app/', queryParams: { prompt: 'select_account' } } });
  });
  it('sends the magic link and reports it; ignores an empty email', async () => {
    const { client, auth } = fakeAuth();
    mountSignIn(root, { client, redirectTo: 'https://x/' });
    await flush();
    const form = root.querySelector('form')!;
    const input = root.querySelector('input')!;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
    input.value = ' ann@example.com ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'ann@example.com', options: { emailRedirectTo: 'https://x/' } });
    expect(root.querySelector('.hw-signin-status')!.textContent).toBe('Sending...');
    await flush();
    expect(root.querySelector('.hw-signin-status')!.textContent).toBe('Check ann@example.com for a sign-in link.');
    expect(button('Email me a sign-in link').disabled).toBe(false);
  });
  it('shows the error when the link cannot be sent', async () => {
    const { client, auth } = fakeAuth();
    auth.signInWithOtp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { message: 'rate limit' } } as never);
    mountSignIn(root, { client, redirectTo: 'https://x/' });
    await flush();
    root.querySelector('input')!.value = 'bob@example.com';
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(root.querySelector('.hw-signin-status')!.textContent).toBe('Could not send the link: rate limit');
  });
  it('switches to the signed-in state and back, with sign-out', async () => {
    const { client, auth, emit, unsubscribe } = fakeAuth(session);
    const off = mountSignIn(root, { client, redirectTo: 'https://x/' });
    await flush();
    expect(root.querySelector('.hw-signin-user')!.textContent).toBe('Signed in as ann@example.com');
    expect(root.querySelector('form')).toBeNull();
    button('Sign out').click();
    expect(auth.signOut).toHaveBeenCalled();
    emit(null);
    expect(root.querySelector('form')).toBeTruthy();
    emit({ ...session, user: { id: 'u2' } as User });
    expect(root.querySelector('.hw-signin-user')!.textContent).toBe('Signed in as u2');
    off();
    expect(unsubscribe).toHaveBeenCalled();
  });
  it('defaults the redirect to this page', async () => {
    const { client, auth } = fakeAuth();
    mountSignIn(root, { client });
    await flush();
    button('Continue with Google').click();
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } } });
  });
});

describe('ensureProfile', () => {
  it('calls platform.ensure_profile and returns null on success', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const schema = vi.fn().mockReturnValue({ rpc });
    expect(await ensureProfile({ schema } as unknown as ProfileClient)).toBeNull();
    expect(schema).toHaveBeenCalledWith('platform');
    expect(rpc).toHaveBeenCalledWith('ensure_profile');
  });

  it('returns the error message instead of throwing', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'not signed in' } });
    expect(await ensureProfile({ schema: () => ({ rpc }) } as unknown as ProfileClient)).toBe('not signed in');
  });
});

describe('Google sign-in options', () => {
  it('asks Google for the account chooser and returns to the given page', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
    await signInWithGoogle('https://x.hintwise.org/app/', { auth: { signInWithOAuth } } as unknown as AuthClient);
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://x.hintwise.org/app/', queryParams: { prompt: 'select_account' } },
    });
  });
});

describe('mountSignIn profiles', () => {
  function authFake(user: { id: string; email: string } | null) {
    const session = user ? ({ user, access_token: 't' } as unknown as Session) : null;
    let listener: ((e: string, s: Session | null) => void) | undefined;
    const auth = {
      getSession: vi.fn().mockResolvedValue({ data: { session } }),
      onAuthStateChange: vi.fn((cb: (e: string, s: Session | null) => void) => {
        listener = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signOut: vi.fn(),
      signInWithOAuth: vi.fn(),
      signInWithOtp: vi.fn(),
    };
    return { auth, emit: (s: Session | null) => listener?.('SIGNED_IN', s), session };
  }

  it('creates the profile once per signed-in user when the client can', async () => {
    const f = authFake({ id: 'u1', email: 'a@b.c' });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const schema = vi.fn().mockReturnValue({ rpc });
    mountSignIn(document.createElement('div'), { client: { auth: f.auth, schema } as unknown as AuthClient, redirectTo: 'https://x/' });
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    f.emit(f.session);
    await Promise.resolve();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(schema).toHaveBeenCalledWith('platform');
  });

  it('skips profiles when told to, or when the client has no schema()', async () => {
    const f = authFake({ id: 'u2', email: 'a@b.c' });
    const rpc = vi.fn();
    mountSignIn(document.createElement('div'), { client: { auth: f.auth, schema: () => ({ rpc }) } as unknown as AuthClient, redirectTo: 'https://x/', profileClient: false });
    mountSignIn(document.createElement('div'), { client: { auth: f.auth } as unknown as AuthClient, redirectTo: 'https://x/' });
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('uses an explicit profile client', async () => {
    const f = authFake({ id: 'u3', email: 'a@b.c' });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    mountSignIn(document.createElement('div'), { client: { auth: f.auth } as unknown as AuthClient, redirectTo: 'https://x/', profileClient: { schema: () => ({ rpc }) } });
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  });
});
