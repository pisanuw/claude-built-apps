/**
 * The live account: sign-in from the template (src/lib/auth.ts: Google
 * through Supabase, and sign-in links through the platform's sign-in-link
 * function), and the saved courses in the schema app_tagging_doctor.
 */
import type { Account } from '../ui/app';
import { mountSignIn, onAuth } from './auth';
import { CourseStore, SupabaseDb, type TableClient } from './store';
import { getSupabase } from './supabase';

export function liveAccount(): Account {
  let store: CourseStore | null = null;
  return {
    mountSignIn: (el) => mountSignIn(el),
    onUser: (cb) => void onAuth((u) => cb(u ? { id: u.id } : null)),
    store: () => (store ??= new CourseStore(new SupabaseDb(getSupabase() as unknown as TableClient))),
  };
}
