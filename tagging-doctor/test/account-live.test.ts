import { beforeEach, describe, expect, it, vi } from 'vitest';

const mountSignIn = vi.fn();
const onAuth = vi.fn();
vi.mock('../src/lib/auth', () => ({ mountSignIn: (...a: unknown[]) => mountSignIn(...a), onAuth: (...a: unknown[]) => onAuth(...a) }));
const from = vi.fn();
vi.mock('../src/lib/supabase', () => ({ getSupabase: () => ({ from }) }));

import { liveAccount } from '../src/lib/account-live';
import { CourseStore } from '../src/lib/store';

describe('the live account', () => {
  beforeEach(() => {
    mountSignIn.mockReset();
    onAuth.mockReset();
  });

  it('mounts the template sign-in, reports the person, and keeps one store on the app schema client', () => {
    const a = liveAccount();
    const el = {} as HTMLElement;
    a.mountSignIn(el);
    expect(mountSignIn).toHaveBeenCalledWith(el);
    const seen: unknown[] = [];
    a.onUser((u) => seen.push(u));
    const cb = onAuth.mock.calls[0][0] as (u: { id: string } | null) => void;
    cb({ id: 'u1' });
    cb(null);
    expect(seen).toEqual([{ id: 'u1' }, null]);
    const s = a.store();
    expect(s).toBeInstanceOf(CourseStore);
    expect(a.store()).toBe(s);
  });
});
