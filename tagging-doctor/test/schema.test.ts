/**
 * The migration on a real Postgres (PGlite, in process): AC-22 (no user
 * reaches another's rows, and a signed-out request reads nothing), AC-23's
 * excerpt limit in the database, AC-25 (the rules "Delete my account" needs,
 * and deletes that cascade) and AC-63 (the migration touches only
 * app_tagging_doctor). Supabase's own pieces are stood in for by the same
 * names: the roles anon and authenticated, auth.users, and auth.uid()
 * reading the request's claim, as Supabase's does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, '..', 'supabase', 'migrations');
const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const migration = files.map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')).join('\n');

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const S = 'app_tagging_doctor';
const TABLES = ['courses', 'projects', 'scans', 'jobs', 'alt_texts'];

const SUPABASE_STAND_IN = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
-- Supabase's own definition: the claim set by PostgREST, in either form.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
`;

let db: PGlite;

/** Runs SQL as a signed-in user (or anon with uid null), in a transaction that is kept. */
async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    // As PostgREST does: the claims as JSON (auth.uid() reads their sub).
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : '']);
    const r = await tx.query<T>(sql, params);
    return r.rows;
  });
}

/** The SQLSTATE or message of an error, for expectations. */
async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return `${err.code ?? ''} ${err.message ?? ''}`;
  }
  return 'no error';
}

interface Ids {
  course: string;
  project: string;
  scan: string;
  job: string;
  alt: string;
}

async function seed(uid: string, tag: string): Promise<Ids> {
  const [c] = await as<{ id: string }>(uid, `insert into ${S}.courses (name, term) values ($1, 'Fall 2026') returning id`, [`Course ${tag}`]);
  const [p] = await as<{ id: string }>(uid, `insert into ${S}.projects (course_id, name, main_file) values ($1, 'hw1', 'hw1/main.tex') returning id`, [c.id]);
  const [s] = await as<{ id: string }>(
    uid,
    `insert into ${S}.scans (project_id, data_as_of, summary, findings) values ($1, '2026-11-19', '{"verdict":"1 blocker found","blockers":1}', '[{"path":"main.tex","line":3,"rule":"package-status","severity":"blocker","package":"tabu","excerpt":"\\\\usepackage{tabu}"}]') returning id`,
    [p.id],
  );
  const [j] = await as<{ id: string }>(uid, `insert into ${S}.jobs (project_id, scan_id, kind, status) values ($1, $2, 'check', 'done') returning id`, [p.id, s.id]);
  const [a] = await as<{ id: string }>(
    uid,
    `insert into ${S}.alt_texts (project_id, figure_path, figure_hash, text, decision, source) values ($1, 'fig/a.png', 'abc', 'A graph', 'approved', 'typed') returning id`,
    [p.id],
  );
  return { course: c.id, project: p.id, scan: s.id, job: j.id, alt: a.id };
}

let a: Ids;
let b: Ids;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STAND_IN);
  await db.exec(migration);
  // Idempotent: a second run is harmless.
  await db.exec(migration);
  await db.query('insert into auth.users (id) values ($1), ($2)', [A, B]);
  a = await seed(A, 'A');
  b = await seed(B, 'B');
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('AC-22: user B cannot reach any row of user A', () => {
  it('B selects only their own rows in every table', async () => {
    for (const t of TABLES) {
      const rows = await as<{ user_id: string }>(B, `select user_id from ${S}.${t}`);
      expect(rows.map((r) => r.user_id), t).toEqual([B]);
    }
  });

  it('B updates and deletes nothing of A', async () => {
    const ids: Record<string, string> = { courses: a.course, projects: a.project, scans: a.scan, jobs: a.job, alt_texts: a.alt };
    for (const t of TABLES) {
      const col = t === 'courses' || t === 'projects' ? 'name' : t === 'scans' ? 'data_as_of' : t === 'jobs' ? 'status' : 'text';
      const value = t === 'scans' ? '2020-01-01' : t === 'jobs' ? 'failed' : 'taken';
      expect(await as(B, `update ${S}.${t} set ${col} = $2 where id = $1 returning id`, [ids[t], value]), t).toEqual([]);
      expect(await as(B, `delete from ${S}.${t} where id = $1 returning id`, [ids[t]]), t).toEqual([]);
      // A's row is untouched.
      expect(await as(A, `select id from ${S}.${t} where id = $1`, [ids[t]]), t).toHaveLength(1);
    }
  });

  it('B cannot insert a row in A\'s name, or move a row to A', async () => {
    expect(await failure(as(B, `insert into ${S}.courses (user_id, name) values ($1, 'x')`, [A]))).toMatch(/row-level security/);
    expect(await failure(as(B, `update ${S}.courses set user_id = $1 where id = $2`, [A, b.course]))).toMatch(/row-level security/);
  });

  it('B cannot insert or update a row that names A\'s course, project or scan', async () => {
    const fk = /23503|foreign key/;
    expect(await failure(as(B, `insert into ${S}.projects (course_id, name, main_file) values ($1, 'x', 'x.tex')`, [a.course]))).toMatch(fk);
    expect(await failure(as(B, `update ${S}.projects set course_id = $1 where id = $2`, [a.course, b.project]))).toMatch(fk);
    expect(await failure(as(B, `insert into ${S}.scans (project_id, data_as_of, summary, findings) values ($1, '2026-11-19', '{}', '[]')`, [a.project]))).toMatch(fk);
    expect(await failure(as(B, `update ${S}.scans set project_id = $1 where id = $2`, [a.project, b.scan]))).toMatch(fk);
    expect(await failure(as(B, `insert into ${S}.jobs (project_id, scan_id, kind, status) values ($1, $2, 'check', 'queued')`, [b.project, a.scan]))).toMatch(fk);
    expect(await failure(as(B, `insert into ${S}.jobs (project_id, scan_id, kind, status) values ($1, $2, 'check', 'queued')`, [a.project, a.scan]))).toMatch(fk);
    expect(await failure(as(B, `update ${S}.jobs set scan_id = $1 where id = $2`, [a.scan, b.job]))).toMatch(fk);
    expect(await failure(as(B, `insert into ${S}.alt_texts (project_id, figure_path, figure_hash, text, decision, source) values ($1, 'fig/b.png', 'h', 't', 'approved', 'typed')`, [a.project]))).toMatch(fk);
    expect(await failure(as(B, `update ${S}.alt_texts set project_id = $1 where id = $2`, [a.project, b.alt]))).toMatch(/23503|foreign key/);
  });

  it('a job names a scan of its own project only', async () => {
    const [p2] = await as<{ id: string }>(A, `insert into ${S}.projects (course_id, name, main_file) values ($1, 'hw2', 'hw2.tex') returning id`, [a.course]);
    expect(await failure(as(A, `insert into ${S}.jobs (project_id, scan_id, kind, status) values ($1, $2, 'check', 'queued')`, [p2.id, a.scan]))).toMatch(/23503|foreign key/);
    await as(A, `delete from ${S}.projects where id = $1`, [p2.id]);
  });

  it('a signed-out request reads nothing: anon has no access to any table', async () => {
    for (const t of TABLES) {
      expect(await failure(as(null, `select * from ${S}.${t}`)), t).toMatch(/permission denied/);
      expect(await failure(as(null, `insert into ${S}.${t} default values`)), t).toMatch(/permission denied/);
    }
  });

  it('a signed-in stranger sees no row, as check-schema asks', async () => {
    for (const t of TABLES) {
      expect(await as(crypto.randomUUID(), `select count(*)::int as n from ${S}.${t}`), t).toEqual([{ n: 0 }]);
    }
  });
});

describe('the facts check-schema reads', () => {
  it('row level security is on, with four own-row policies, on every table; anon has no privilege; no security definer function', async () => {
    const rows = (
      await db.query<{ name: string; rls: boolean; forced: boolean; policies: number; anon: boolean }>(
        `select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
           (select count(*)::int from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname) as policies,
           (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
             or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')) as anon
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = $1 and c.relkind in ('r', 'p') order by 1`,
        [S],
      )
    ).rows;
    expect(rows.map((r) => r.name)).toEqual([...TABLES].sort());
    for (const r of rows) expect(r, r.name).toMatchObject({ rls: true, forced: false, policies: 4, anon: false });
    const policies = (await db.query<{ qual: string; with_check: string | null; roles: string[] }>(`select qual, with_check, roles::text[] as roles from pg_policies where schemaname = $1`, [S])).rows;
    for (const p of policies) {
      expect(p.roles).toEqual(['authenticated']);
      for (const expr of [p.qual, p.with_check].filter(Boolean)) expect(expr).toBe('(user_id = auth.uid())');
    }
    const definers = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1`, [S])).rows;
    expect(definers).toEqual([]);
  });
});

describe('AC-25: deletes cascade, and "Delete my account" finds every row', () => {
  it('every table has user_id referencing auth.users(id) on delete cascade, and every key between app tables cascades', async () => {
    const keys = (
      await db.query<{ tbl: string; target: string; cols: string[]; del: string }>(
        `select c.conrelid::regclass::text as tbl, c.confrelid::regclass::text as target, c.confdeltype as del,
           array(select a.attname::text from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k) as cols
         from pg_constraint c join pg_namespace n on n.oid = c.connamespace
         where n.nspname = $1 and c.contype = 'f'`,
        [S],
      )
    ).rows;
    for (const t of TABLES) {
      const users = keys.filter((k) => k.tbl === `${S}.${t}` && k.target === 'auth.users');
      expect(users, t).toEqual([{ tbl: `${S}.${t}`, target: 'auth.users', del: 'c', cols: ['user_id'] }]);
    }
    const inner = keys.filter((k) => k.target.startsWith(`${S}.`));
    expect(inner.length).toBe(5);
    for (const k of inner) {
      expect(k.del, `${k.tbl} -> ${k.target}`).toBe('c');
      expect(k.cols, `${k.tbl} -> ${k.target}`).toContain('user_id');
    }
  });

  it('deleting a project deletes its scans, jobs and alt texts; deleting a course deletes its projects', async () => {
    const x = await seed(A, 'X');
    await as(A, `delete from ${S}.projects where id = $1`, [x.project]);
    for (const [t, id] of [['scans', x.scan], ['jobs', x.job], ['alt_texts', x.alt]]) {
      expect(await as(A, `select id from ${S}.${t} where id = $1`, [id]), t).toEqual([]);
    }
    const y = await seed(A, 'Y');
    await as(A, `delete from ${S}.courses where id = $1`, [y.course]);
    for (const [t, id] of [['projects', y.project], ['scans', y.scan], ['jobs', y.job], ['alt_texts', y.alt]]) {
      expect(await as(A, `select id from ${S}.${t} where id = $1`, [id]), t).toEqual([]);
    }
    expect(await as(A, `select id from ${S}.courses where id = $1`, [a.course])).toHaveLength(1);
  });

  it('removing the sign-in removes every row of that person, and only theirs', async () => {
    await db.query('insert into auth.users (id) values ($1)', ['00000000-0000-4000-8000-00000000000c']);
    await seed('00000000-0000-4000-8000-00000000000c', 'C');
    await db.query('delete from auth.users where id = $1', ['00000000-0000-4000-8000-00000000000c']);
    for (const t of TABLES) {
      const left = (await db.query<{ n: number }>(`select count(*)::int as n from ${S}.${t} where user_id = $1`, ['00000000-0000-4000-8000-00000000000c'])).rows[0].n;
      expect(left, t).toBe(0);
      expect(await as(B, `select id from ${S}.${t}`), t).toHaveLength(1);
    }
  });
});

describe('AC-23 in the database: an excerpt longer than 200 characters is refused', () => {
  const insert = (excerpt: string) =>
    as(A, `insert into ${S}.scans (project_id, data_as_of, summary, findings) values ($1, '2026-11-19', '{}', $2::jsonb) returning id`, [
      a.project,
      JSON.stringify([{ path: 'main.tex', line: 1, rule: 'no-title', severity: 'warning', excerpt }]),
    ]);

  it('takes 200 characters and refuses 201', async () => {
    expect(await insert('x'.repeat(200))).toHaveLength(1);
    expect(await failure(insert('x'.repeat(201)))).toMatch(/23514|check constraint/);
    expect(await failure(insert(`${'x'.repeat(100)}\n${'y'.repeat(100)}`))).toMatch(/23514|check constraint/);
  });

  it('refuses findings that are not a list, and an unknown job kind', async () => {
    expect(await failure(as(A, `insert into ${S}.scans (project_id, data_as_of, summary, findings) values ($1, '2026-11-19', '{}', '{}')`, [a.project]))).toMatch(/23514|check constraint/);
    expect(await failure(as(A, `insert into ${S}.jobs (project_id, scan_id, kind, status) values ($1, $2, 'other', 'done')`, [a.project, a.scan]))).toMatch(/23514|check constraint/);
  });
});

describe('AC-63: the migration touches only app_tagging_doctor', () => {
  const code = migration.replace(/--.*$/gm, '');

  it('has no statement on platform, public or any other schema', () => {
    expect(code).not.toMatch(/\bplatform\b/i);
    expect(code).not.toMatch(/\bpublic\b/i);
    expect(code).not.toMatch(/llm_apps/i);
    // Every schema-qualified name is the app's own, or the two auth names it refers to.
    const names = [...code.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi)].map((m) => `${m[1]}.${m[2]}`.toLowerCase());
    expect(names.length).toBeGreaterThan(20);
    for (const n of names) expect(n.startsWith(`${S}.`) || n === 'auth.users' || n === 'auth.uid', n).toBe(true);
  });

  it('creates, alters, grants and comments only in its own schema', () => {
    for (const st of code.split(';').map((s) => s.trim()).filter(Boolean)) {
      const target = /^(?:create (?:schema|table|index|policy)|alter table|alter default privileges|grant|comment on (?:schema|table)|drop policy)\b/i.exec(st);
      expect(target, st.slice(0, 80)).not.toBeNull();
      expect(st, st.slice(0, 80)).toMatch(new RegExp(`\\b${S}\\b`));
    }
  });

  it('is the only migration so far, and is named NNNN_<name>.sql', () => {
    expect(files).toEqual(['0001_init.sql']);
  });
});
