/**
 * The account of a build without Supabase env (`vite preview`, the Playwright
 * walkthrough): the template's real sign-in controls on a stand-in client
 * that signs a preview person in at once, and saved courses kept in memory.
 * Sign-in returns only to https://*.hintwise.org, so a local build cannot
 * use the real one (BUILD_ROUTINE.md, "The usual architecture"). The live
 * build never loads this file: src/main.ts imports it only without the env.
 */
import type { Session, User } from '@supabase/supabase-js';
import { mountSignIn, type AuthClient } from '../lib/auth';
import { CourseStore, MemoryDb } from '../lib/store';
import type { Account } from './app';

export const PREVIEW_USER = { id: '00000000-0000-4000-8000-0000000000aa', email: 'preview@example.com' };

type Listener = (event: string, session: Session | null) => void;

/** A stand-in for the part of supabase.auth that the sign-in controls use. */
export function previewAuthClient(): AuthClient {
  let session: Session | null = null;
  const listeners = new Set<Listener>();
  const emit = (event: string) => {
    for (const l of [...listeners]) l(event, session);
  };
  const signIn = () => {
    const user = { id: PREVIEW_USER.id, email: PREVIEW_USER.email, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-11-20T00:00:00Z' } as User;
    session = { access_token: 'preview', refresh_token: 'preview', expires_in: 3600, token_type: 'bearer', user } as Session;
    emit('SIGNED_IN');
  };
  const auth = {
    getSession: async () => ({ data: { session }, error: null }),
    onAuthStateChange: (cb: Listener) => {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },
    signInWithOAuth: async () => {
      signIn();
      return { data: { provider: 'google', url: null }, error: null };
    },
    verifyOtp: async () => {
      signIn();
      return { data: { session, user: session?.user ?? null }, error: null };
    },
    signOut: async () => {
      session = null;
      emit('SIGNED_OUT');
      return { error: null };
    },
  };
  return { auth } as unknown as AuthClient;
}

export function previewAccount(now: () => Date = () => new Date()): Account {
  const client = previewAuthClient();
  const store = new CourseStore(new MemoryDb(PREVIEW_USER.id, now));
  return {
    mountSignIn: (el) =>
      mountSignIn(el, {
        client,
        profileClient: false,
        completeFromUrl: false,
        // The preview sends no email: a link "sent" signs the preview person in.
        sendLink: async () => {
          await client.auth.signInWithOAuth({ provider: 'google' });
          return { status: 'sent' };
        },
      }),
    onUser: (cb) => {
      void client.auth.getSession().then(({ data }) => cb(data.session?.user ? { id: data.session.user.id } : null));
      client.auth.onAuthStateChange((_e, s) => cb(s?.user ? { id: s.user.id } : null));
    },
    store: () => store,
  };
}
