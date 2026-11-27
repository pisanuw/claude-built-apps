/**
 * Migration 0001 on a real Postgres (PGlite, in process): AC-7 (applied twice;
 * the shape check-schema needs; function privileges), AC-8 (no person reaches
 * another's rows; anon reads nothing), AC-9 (the caps in the database, the
 * trims and set_baseline) and AC-10 (the ci_* functions). Supabase's own pieces
 * are stood in for by the same names, as in tagging-doctor/test/schema.test.ts:
 * the roles anon and authenticated, auth.users, and auth.uid() reading the
 * request's claims.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, '..', 'supabase', 'migrations');
const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const migration = files.map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')).join('\n');

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const S = 'app_heard_as_check';
const TABLES = ['api_keys', 'documents', 'runs'];

const SUPABASE_STAND_IN = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
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

/** Runs SQL as a signed-in person (or as anon when uid is null), in a transaction that is kept. */
async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : '']);
    const r = await tx.query<T>(sql, params);
    return r.rows;
  });
}

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return `${err.code ?? ''} ${err.message ?? ''}`;
  }
  return 'no error';
}

const hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const H64 = 'a'.repeat(64);

/** The columns of a run a test does not care about. */
function runRow(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: 'web',
    file_sha256: H64,
    file_bytes: 1000,
    pages: 2,
    pages_read: 2,
    pdfjs_version: '6.5.438',
    chromium_version: '143.0.7499.4',
    verdict: 'Passes the validator, reads as intended',
    transcript_sha256: H64,
    transcript_lines: 3,
    ...extra,
  };
}

async function insertRun(uid: string, documentId: string, extra: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = { document_id: documentId, ...runRow(extra) };
  const cols = Object.keys(row);
  const [r] = await as<{ id: string; is_baseline: boolean }>(
    uid,
    `insert into ${S}.runs (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id, is_baseline`,
    cols.map((c) => (c === 'faults' ? JSON.stringify(row[c]) : row[c])),
  );
  return r;
}

async function newDocument(uid: string, name: string, keepText = false): Promise<string> {
  const [d] = await as<{ id: string }>(uid, `insert into ${S}.documents (name, keep_text) values ($1, $2) returning id`, [name, keepText]);
  return d.id;
}

/** A key for a person: the plaintext, and its row written as the page writes it. */
async function newKey(uid: string, label = 'ci'): Promise<{ key: string; id: string }> {
  const key = `hac_${createHash('sha256').update(`${uid}${label}${Math.random()}`).digest('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32)}`;
  const [k] = await as<{ id: string }>(uid, `insert into ${S}.api_keys (label, prefix, key_hash) values ($1, $2, $3) returning id`, [label, key.slice(0, 8), hex(key)]);
  return { key, id: k.id };
}

let docA: string;
let runA: string;
let keyA: { key: string; id: string };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STAND_IN);
  await db.exec(migration);
  await db.exec(migration);
  await db.query('insert into auth.users (id) values ($1), ($2), ($3)', [A, B, C]);
  docA = await newDocument(A, 'invoice-generator/report.pdf');
  runA = (await insertRun(A, docA)).id;
  keyA = await newKey(A, 'A key');
  const docB = await newDocument(B, 'b-doc');
  await insertRun(B, docB);
  await newKey(B, 'B key');
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('AC-7: the migration and the shape check-schema needs', () => {
  it('applies twice to an empty Postgres (the second run in beforeAll succeeded)', async () => {
    const t = await db.query<{ n: number }>(`select count(*)::int as n from pg_tables where schemaname = $1`, [S]);
    expect(t.rows[0].n).toBe(3);
  });

  it('every table: user_id uuid not null default auth.uid() references auth.users on delete cascade; RLS on, not forced; no anon grant', async () => {
    const rows = (
      await db.query<{ name: string; rls: boolean; forced: boolean; anon: boolean; policies: number }>(
        `select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
           (select count(*)::int from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname) as policies,
           (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
             or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')
             or has_any_column_privilege('anon', c.oid, 'SELECT')) as anon
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = $1 and c.relkind in ('r', 'p') order by 1`,
        [S],
      )
    ).rows;
    expect(rows.map((r) => r.name)).toEqual(TABLES);
    for (const r of rows) expect(r, r.name).toMatchObject({ rls: true, forced: false, anon: false, policies: 4 });
    const cols = (
      await db.query<{ tbl: string; type: string; nullable: string; dflt: string }>(
        `select table_name as tbl, data_type as type, is_nullable as nullable, column_default as dflt
         from information_schema.columns where table_schema = $1 and column_name = 'user_id' order by 1`,
        [S],
      )
    ).rows;
    expect(cols.map((c) => c.tbl)).toEqual(TABLES);
    for (const c of cols) expect(c, c.tbl).toMatchObject({ type: 'uuid', nullable: 'NO', dflt: 'auth.uid()' });
    const fks = (
      await db.query<{ tbl: string; def: string }>(
        `select cl.relname as tbl, pg_get_constraintdef(co.oid) as def from pg_constraint co
         join pg_class cl on cl.oid = co.conrelid join pg_namespace n on n.oid = cl.relnamespace
         where n.nspname = $1 and co.contype = 'f' and pg_get_constraintdef(co.oid) like '%auth.users%' order by 1`,
        [S],
      )
    ).rows;
    expect(fks.map((f) => f.tbl)).toEqual(TABLES);
    for (const f of fks) expect(f.def).toBe('FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE');
    const policies = (await db.query<{ qual: string | null; with_check: string | null; roles: string[] }>(`select qual, with_check, roles::text[] as roles from pg_policies where schemaname = $1`, [S])).rows;
    for (const p of policies) {
      expect(p.roles).toEqual(['authenticated']);
      for (const expr of [p.qual, p.with_check].filter(Boolean)) expect(expr).toBe('(user_id = auth.uid())');
    }
  });

  it('every security definer function has a fixed search_path; every function is closed to public, anon and authenticated except the three granted', async () => {
    const fns = (
      await db.query<{ name: string; definer: boolean; config: string[] | null; oid: number; trigger: boolean }>(
        `select p.proname as name, p.prosecdef as definer, p.proconfig as config, p.oid::int as oid,
           p.prorettype = 'trigger'::regtype as trigger
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 order by 1`,
        [S],
      )
    ).rows;
    expect(fns.map((f) => f.name)).toEqual([
      'api_keys_rules',
      'ci_baseline',
      'ci_check_name',
      'ci_key_owner',
      'ci_record_run',
      'documents_cap',
      'documents_keep_text',
      'runs_after_insert',
      'runs_before_insert',
      'runs_before_update',
      'set_baseline',
    ]);
    for (const f of fns) expect(f.config ?? [], f.name).toContain('search_path=""');
    expect(fns.filter((f) => f.definer).map((f) => f.name)).toEqual(['ci_baseline', 'ci_key_owner', 'ci_record_run']);
    const can = async (role: string, oid: number) =>
      (await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2::oid, 'EXECUTE') as ok`, [role, oid])).rows[0].ok;
    const allowed: Record<string, string[]> = { anon: ['ci_baseline', 'ci_record_run'], authenticated: ['set_baseline'], public: [] };
    for (const role of ['anon', 'authenticated', 'public']) {
      const granted: string[] = [];
      for (const f of fns) if (await can(role, f.oid)) granted.push(f.name);
      expect(granted, role).toEqual(allowed[role]);
    }
    // No trigger function is granted to anyone.
    for (const f of fns.filter((x) => x.trigger)) {
      const acl = (await db.query<{ acl: string | null }>(`select proacl::text as acl from pg_proc where oid = $1`, [f.oid])).rows[0].acl ?? '';
      expect(acl, f.name).not.toMatch(/(^|[{,])(anon|authenticated|)=X/);
    }
  });

  it('no table or function of the removed weekly feature exists', async () => {
    const names = (
      await db.query<{ name: string }>(
        `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1
         union all select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1`,
        [S],
      )
    ).rows.map((r) => r.name);
    for (const n of names) expect(n).not.toMatch(/weekly|rerun|re_run|unsubscribe|worker|email|files?$|pdfs?$/);
  });
});

describe('AC-8: B reaches nothing of A; anon reads nothing', () => {
  it('B selects only their own rows in every table', async () => {
    for (const t of TABLES) {
      const rows = await as<{ user_id: string }>(B, `select user_id from ${S}.${t}`);
      expect(rows.map((r) => r.user_id), t).toEqual([B]);
    }
  });

  it('B updates and deletes nothing of A', async () => {
    const ids: Record<string, [string, string, unknown]> = {
      documents: [docA, 'name', 'taken'],
      // The browser may update only is_baseline and transcript on runs (R1.1-1).
      runs: [runA, 'is_baseline', false],
      api_keys: [keyA.id, 'label', 'taken'],
    };
    for (const t of TABLES) {
      const [id, col, value] = ids[t];
      expect(await as(B, `update ${S}.${t} set ${col} = $2 where id = $1 returning id`, [id, value]), t).toEqual([]);
      expect(await as(B, `delete from ${S}.${t} where id = $1 returning id`, [id]), t).toEqual([]);
      expect(await as(A, `select id from ${S}.${t} where id = $1`, [id]), t).toHaveLength(1);
    }
  });

  it('B cannot insert a row in A\'s name, or move a row to A', async () => {
    expect(await failure(as(B, `insert into ${S}.documents (user_id, name) values ($1, 'x')`, [A]))).toMatch(/row-level security/);
    const [d] = await as<{ id: string }>(B, `select id from ${S}.documents limit 1`);
    expect(await failure(as(B, `update ${S}.documents set user_id = $1 where id = $2`, [A, d.id]))).toMatch(/row-level security|foreign key|23503/);
  });

  it('a run naming A\'s document is refused: by the composite key on insert, and on update because no run can be moved', async () => {
    expect(await failure(insertRun(B, docA))).toMatch(/23503|foreign key/);
    const [r] = await as<{ id: string }>(B, `select id from ${S}.runs limit 1`);
    expect(await failure(as(B, `update ${S}.runs set document_id = $1 where id = $2`, [docA, r.id]))).toMatch(/42501 permission denied/);
    // A's document still has only A's run.
    expect(await as(A, `select id from ${S}.runs where document_id = $1`, [docA])).toEqual([{ id: runA }]);
  });

  it('B may use a document name that A also uses, and learns nothing about A\'s', async () => {
    const id = await newDocument(B, 'invoice-generator/report.pdf');
    expect(id).not.toBe(docA);
    await as(B, `delete from ${S}.documents where id = $1`, [id]);
  });

  it('anon reads and writes nothing in any table', async () => {
    for (const t of TABLES) {
      expect(await failure(as(null, `select * from ${S}.${t}`)), t).toMatch(/permission denied/);
      expect(await failure(as(null, `insert into ${S}.${t} default values`)), t).toMatch(/permission denied/);
    }
  });

  it('a signed-in stranger sees no row (as check-schema asks)', async () => {
    for (const t of TABLES) expect(await as(C, `select count(*)::int as n from ${S}.${t}`), t).toEqual([{ n: 0 }]);
  });

  it('the browser cannot read key_hash, or write last_used_at', async () => {
    expect(await failure(as(A, `select key_hash from ${S}.api_keys`))).toMatch(/permission denied/);
    expect(await failure(as(A, `select * from ${S}.api_keys`))).toMatch(/permission denied/);
    expect(await as(A, `select id, label, prefix, created_at, last_used_at, revoked_at from ${S}.api_keys`)).toHaveLength(1);
    expect(await failure(as(A, `update ${S}.api_keys set last_used_at = now() where id = $1`, [keyA.id]))).toMatch(/permission denied/);
  });

  it('deleting the account deletes every row of the person through the cascades', async () => {
    const X = '00000000-0000-4000-8000-0000000000ee';
    await db.query('insert into auth.users (id) values ($1)', [X]);
    const d = await newDocument(X, 'x');
    await insertRun(X, d);
    await newKey(X);
    await db.query('delete from auth.users where id = $1', [X]);
    for (const t of TABLES) expect((await db.query(`select 1 from ${S}.${t} where user_id = $1`, [X])).rows, t).toEqual([]);
  });
});

describe('AC-9: the caps hold for a direct write through the Data API', () => {
  const P = '00000000-0000-4000-8000-0000000000a9';
  beforeAll(async () => {
    await db.query('insert into auth.users (id) values ($1)', [P]);
  });

  it('a name over 80 characters is refused (80 is accepted)', async () => {
    expect(await failure(newDocument(P, 'x'.repeat(81)))).toMatch(/23514|check constraint/);
    const id = await newDocument(P, 'y'.repeat(80));
    await as(P, `delete from ${S}.documents where id = $1`, [id]);
    expect(await failure(newDocument(P, ''))).toMatch(/23514|check constraint/);
  });

  it('faults over 200 kB and a transcript over 1 MB are refused; at the cap they are kept', async () => {
    const d = await newDocument(P, 'caps', true);
    const fault = (n: number) => [{ text: 'f'.repeat(n) }];
    // '[{"text": "..."}]' as Postgres prints jsonb: 14 bytes around the text.
    const over = fault(204_800 - 14 + 1);
    const at = fault(204_800 - 14);
    expect(JSON.stringify(at).length).toBeLessThanOrEqual(204_800);
    expect(await failure(insertRun(P, d, { faults: over }))).toMatch(/23514|check constraint/);
    await insertRun(P, d, { faults: at });
    expect(await failure(insertRun(P, d, { transcript: 'x'.repeat(1_048_577) }))).toMatch(/23514|check constraint/);
    const r = await insertRun(P, d, { transcript: 'x'.repeat(1_048_576) });
    const [kept] = await as<{ n: number }>(P, `select octet_length(transcript) as n from ${S}.runs where id = $1`, [r.id]);
    expect(kept.n).toBe(1_048_576);
    await as(P, `delete from ${S}.documents where id = $1`, [d]);
  });

  it('a 21st document is refused', async () => {
    const before = (await as<{ n: number }>(P, `select count(*)::int as n from ${S}.documents`))[0].n;
    for (let i = before; i < 20; i++) await newDocument(P, `doc ${i}`);
    expect(await failure(newDocument(P, 'doc 21'))).toMatch(/up to 20 documents/);
    expect((await as<{ n: number }>(P, `select count(*)::int as n from ${S}.documents`))[0].n).toBe(20);
    // After a delete there is room again.
    await as(P, `delete from ${S}.documents where name = 'doc 19'`);
    await newDocument(P, 'doc 21');
    await as(P, `delete from ${S}.documents`);
  });

  it('a 6th active API key is refused; a revoked one makes room and cannot come back', async () => {
    const keys = [];
    for (let i = 0; i < 5; i++) keys.push(await newKey(P, `k${i}`));
    expect(await failure(newKey(P, 'k5'))).toMatch(/up to 5 active API keys/);
    await as(P, `update ${S}.api_keys set revoked_at = now() where id = $1`, [keys[0].id]);
    await newKey(P, 'k5');
    expect(await failure(as(P, `update ${S}.api_keys set revoked_at = null where id = $1`, [keys[0].id]))).toMatch(/cannot be used again/);
    await as(P, `delete from ${S}.api_keys`);
  });

  it('a 51st run is accepted and deletes the oldest run that is not the baseline', async () => {
    const d = await newDocument(P, 'fifty');
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push((await insertRun(P, d, { transcript_lines: i })).id);
    // The first is the baseline; make the second the oldest non-baseline worth checking.
    const all = async () => (await as<{ id: string; is_baseline: boolean }>(P, `select id, is_baseline from ${S}.runs where document_id = $1 order by seq`, [d]));
    expect((await all()).length).toBe(50);
    expect((await all())[0]).toEqual({ id: ids[0], is_baseline: true });
    const r51 = await insertRun(P, d);
    const after = await all();
    expect(after.length).toBe(50);
    expect(after.map((r) => r.id)).toEqual([ids[0], ...ids.slice(2), r51.id]);
    expect(r51.is_baseline).toBe(false);
    await as(P, `delete from ${S}.documents where id = $1`, [d]);
  });

  it('a run\'s transcript text is set to null once five newer runs of the document exist; kept only when the document keeps text', async () => {
    const d = await newDocument(P, 'texts', true);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await insertRun(P, d, { transcript: `t${i}` })).id);
    const texts = await as<{ id: string; transcript: string | null }>(P, `select id, transcript from ${S}.runs where document_id = $1 order by seq`, [d]);
    expect(texts.map((t) => t.transcript)).toEqual([null, 't1', 't2', 't3', 't4', 't5']);
    // Turning the switch off sets the text of its runs to null (AC-61).
    await as(P, `update ${S}.documents set keep_text = false where id = $1`, [d]);
    expect((await as<{ n: number }>(P, `select count(transcript)::int as n from ${S}.runs where document_id = $1`, [d]))[0].n).toBe(0);
    // With the switch off, no text is kept at all.
    const r = await insertRun(P, d, { transcript: 'not kept' });
    expect((await as<{ transcript: string | null }>(P, `select transcript from ${S}.runs where id = $1`, [r.id]))[0].transcript).toBeNull();
    await as(P, `delete from ${S}.documents where id = $1`, [d]);
  });

  it('set_baseline makes a run the only baseline, the new one older or newer than the old one, and refuses another person\'s run', async () => {
    const d = await newDocument(P, 'baseline');
    const r1 = await insertRun(P, d);
    const r2 = await insertRun(P, d);
    const r3 = await insertRun(P, d);
    expect([r1.is_baseline, r2.is_baseline, r3.is_baseline]).toEqual([true, false, false]);
    const baselines = async () => (await as<{ id: string }>(P, `select id from ${S}.runs where document_id = $1 and is_baseline`, [d])).map((r) => r.id);
    // Newer than the old baseline.
    await as(P, `select ${S}.set_baseline($1)`, [r3.id]);
    expect(await baselines()).toEqual([r3.id]);
    // Older than the old baseline.
    await as(P, `select ${S}.set_baseline($1)`, [r2.id]);
    expect(await baselines()).toEqual([r2.id]);
    // The same run again changes nothing.
    await as(P, `select ${S}.set_baseline($1)`, [r2.id]);
    expect(await baselines()).toEqual([r2.id]);
    // Another person's run: not found, and nothing changes.
    expect(await failure(as(B, `select ${S}.set_baseline($1)`, [r1.id]))).toMatch(/No such run/);
    expect(await failure(as(P, `select ${S}.set_baseline($1)`, [runA]))).toMatch(/No such run/);
    expect(await baselines()).toEqual([r2.id]);
    expect((await as<{ is_baseline: boolean }>(A, `select is_baseline from ${S}.runs where id = $1`, [runA]))[0].is_baseline).toBe(true);
    // A direct second baseline is refused by the index; anon cannot call it at all.
    expect(await failure(as(P, `update ${S}.runs set is_baseline = true where id = $1`, [r1.id]))).toMatch(/23505|unique/);
    expect(await failure(as(null, `select ${S}.set_baseline($1)`, [r1.id]))).toMatch(/permission denied/);
    // Trimming keeps the baseline even when it is the oldest run.
    await as(P, `delete from ${S}.documents where id = $1`, [d]);
  });
});

describe('AC-10: the ci_* functions', () => {
  const Q = '00000000-0000-4000-8000-0000000000a1';
  let key: { key: string; id: string };
  const ci = <T = Record<string, unknown>>(sql: string, params: unknown[]) => as<T>(null, sql, params);
  const baseline = (k: unknown, doc: unknown) => ci<{ r: Record<string, unknown> }>(`select ${S}.ci_baseline($1, $2) as r`, [k, doc]).then((x) => x[0].r);
  const record = (k: unknown, doc: unknown, run: unknown) =>
    ci<{ r: Record<string, unknown> }>(`select ${S}.ci_record_run($1, $2, $3::jsonb) as r`, [k, doc, run === null ? null : JSON.stringify(run)]).then((x) => x[0].r);
  const counts = async () => ({
    docs: (await db.query<{ n: number }>(`select count(*)::int as n from ${S}.documents where user_id = $1`, [Q])).rows[0].n,
    runs: (await db.query<{ n: number }>(`select count(*)::int as n from ${S}.runs where user_id = $1`, [Q])).rows[0].n,
  });

  beforeAll(async () => {
    await db.query('insert into auth.users (id) values ($1)', [Q]);
    key = await newKey(Q, 'ci key');
  });

  it('a wrong, revoked, null or empty key gets the same error and writes no row', async () => {
    const revoked = await newKey(Q, 'old');
    await as(Q, `update ${S}.api_keys set revoked_at = now() where id = $1`, [revoked.id]);
    const wrong = `hac_${'Z'.repeat(32)}`;
    for (const k of [wrong, revoked.key, null, '', key.key.slice(0, 20), `${key.key} `, key.key.toUpperCase().replace('HAC_', 'hac_')]) {
      if (k === key.key) continue;
      expect(await failure(baseline(k, 'doc')), String(k)).toMatch(/28000 invalid key/);
      expect(await failure(record(k, 'doc', runRow())), String(k)).toMatch(/28000 invalid key/);
    }
    expect(await counts()).toEqual({ docs: 0, runs: 0 });
    const [used] = await as<{ last_used_at: string | null }>(Q, `select last_used_at from ${S}.api_keys where id = $1`, [revoked.id]);
    expect(used.last_used_at).toBeNull();
    await as(Q, `delete from ${S}.api_keys where id = $1`, [revoked.id]);
  });

  it('a valid key on a new document: ci_baseline returns the owner and no baseline, and sets last_used_at; nothing is created', async () => {
    const r = await baseline(key.key, 'reports/invoice.pdf');
    expect(r).toEqual({ user_id: Q, document: null, baseline: null });
    expect(await counts()).toEqual({ docs: 0, runs: 0 });
    const [k] = await as<{ last_used_at: string | null }>(Q, `select last_used_at from ${S}.api_keys where id = $1`, [key.id]);
    expect(k.last_used_at).not.toBeNull();
  });

  it('the first run creates the document and is its baseline; later runs are compared with it; no text is kept', async () => {
    const first = await record(key.key, 'reports/invoice.pdf', runRow({ source: 'web', transcript: 'secret text', faults: [{ key: 'missing-alt|Figure|x' }] }));
    expect(first.is_baseline).toBe(true);
    const second = await record(key.key, 'reports/invoice.pdf', runRow());
    expect(second.is_baseline).toBe(false);
    expect(second.document_id).toBe(first.document_id);
    const rows = (await db.query<{ source: string; transcript: string | null; user_id: string }>(`select source, transcript, user_id from ${S}.runs where user_id = $1`, [Q])).rows;
    expect(rows).toEqual([
      { source: 'ci', transcript: null, user_id: Q },
      { source: 'ci', transcript: null, user_id: Q },
    ]);
    const b = await baseline(key.key, 'reports/invoice.pdf');
    expect(b.user_id).toBe(Q);
    expect((b.document as { id: string }).id).toBe(first.document_id);
    expect((b.baseline as { id: string; faults: unknown }).id).toBe(first.run_id);
    expect((b.baseline as { faults: unknown }).faults).toEqual([{ key: 'missing-alt|Figure|x' }]);
  });

  it('the key hash is computed in the database exactly as the page writes it (sha256, hex)', async () => {
    const [k] = await db.query<{ key_hash: string }>(`select key_hash from ${S}.api_keys where id = $1`, [key.id]).then((r) => r.rows);
    expect(k.key_hash).toBe(hex(key.key));
  });

  it('another person\'s document name reaches only the caller\'s own documents: nothing of B is returned or written', async () => {
    const bDoc = (await db.query<{ id: string }>(`select id from ${S}.documents where user_id = $1 and name = 'b-doc'`, [B])).rows[0].id;
    const bRuns = (await db.query<{ n: number }>(`select count(*)::int as n from ${S}.runs where document_id = $1`, [bDoc])).rows[0].n;
    const r = await baseline(key.key, 'b-doc');
    expect(r).toEqual({ user_id: Q, document: null, baseline: null });
    const w = await record(key.key, 'b-doc', runRow());
    expect(w.document_id).not.toBe(bDoc);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from ${S}.runs where document_id = $1`, [bDoc])).rows[0].n).toBe(bRuns);
    await db.query(`delete from ${S}.documents where user_id = $1 and name = 'b-doc'`, [Q]);
  });

  it('a run past the caps, a bad name or a bad run is refused and writes no row', async () => {
    const before = await counts();
    const over = runRow({ faults: [{ text: 'f'.repeat(204_800) }] });
    expect(await failure(record(key.key, 'reports/invoice.pdf', over))).toMatch(/22023|23514/);
    expect(await failure(record(key.key, 'reports/invoice.pdf', runRow({ verdict: 'Certified compliant' })))).toMatch(/23514/);
    expect(await failure(record(key.key, 'reports/invoice.pdf', runRow({ pages_read: 61, pages: 75 })))).toMatch(/23514/);
    expect(await failure(record(key.key, 'reports/invoice.pdf', null))).toMatch(/22023/);
    expect(await failure(record(key.key, 'reports/invoice.pdf', [1, 2]))).toMatch(/22023/);
    for (const name of ['', 'x'.repeat(81), 'bad;name', 'a\nb', null]) {
      expect(await failure(record(key.key, name, runRow())), String(name)).toMatch(/22023 invalid document name/);
      expect(await failure(baseline(key.key, name)), String(name)).toMatch(/22023 invalid document name/);
    }
    // A 21st document through CI is refused too, and the new document is not left behind.
    for (let i = (await counts()).docs; i < 20; i++) await record(key.key, `doc-${i}`, runRow());
    const at20 = await counts();
    expect(at20.docs).toBe(20);
    expect(await failure(record(key.key, 'one-too-many', runRow()))).toMatch(/up to 20 documents/);
    expect(await counts()).toEqual(at20);
    expect(before.runs).toBeLessThanOrEqual(at20.runs);
  });

  it('trimming through CI keeps the baseline', async () => {
    await db.query(`delete from ${S}.documents where user_id = $1 and name like 'doc-%'`, [Q]);
    const first = await record(key.key, 'trim', runRow());
    for (let i = 0; i < 52; i++) await record(key.key, 'trim', runRow());
    const rows = (await db.query<{ id: string; is_baseline: boolean }>(`select id, is_baseline from ${S}.runs where document_id = $1 order by seq`, [first.document_id])).rows;
    expect(rows.length).toBe(50);
    expect(rows[0]).toEqual({ id: first.run_id, is_baseline: true });
  });

  it('a signed-in person cannot call the ci_* functions (they are for the mount, with a key)', async () => {
    expect(await failure(as(Q, `select ${S}.ci_baseline($1, 'x')`, [key.key]))).toMatch(/permission denied/);
    expect(await failure(as(null, `select ${S}.ci_key_owner($1)`, [key.key]))).toMatch(/permission denied/);
  });
});

describe('R1.1-1: a saved run cannot be rewritten through the Data API', () => {
  const R = '00000000-0000-4000-8000-0000000000b1';
  beforeAll(async () => {
    await db.query('insert into auth.users (id) values ($1)', [R]);
  });

  it('P1: moving runs to another of my documents is refused, so the 50-run cap holds', async () => {
    const d1 = await newDocument(R, 'p1-a');
    const d2 = await newDocument(R, 'p1-b');
    for (let i = 0; i < 50; i++) await insertRun(R, d1);
    expect(await failure(as(R, `update ${S}.runs set document_id = $1 where document_id = $2 and not is_baseline`, [d2, d1]))).toMatch(/42501 permission denied/);
    const count = async (d: string) => (await as<{ n: number }>(R, `select count(*)::int as n from ${S}.runs where document_id = $1`, [d]))[0].n;
    expect([await count(d1), await count(d2)]).toEqual([50, 0]);
    // The trigger refuses it for any caller, also one that may update every column (the migration's owner, as a definer function would be).
    const [one] = await as<{ id: string }>(R, `select id from ${S}.runs where document_id = $1 and not is_baseline limit 1`, [d1]);
    expect(await failure(db.query(`update ${S}.runs set document_id = $1 where id = $2`, [d2, one.id]))).toMatch(/cannot be changed/);
    await as(R, `delete from ${S}.documents where id in ($1, $2)`, [d1, d2]);
  });

  it('P2: text cannot be written onto a run, whatever the switch, the run\'s age or its source; in any form', async () => {
    const off = await newDocument(R, 'p2-off');
    const ci = (await insertRun(R, off, { source: 'ci' })).id;
    for (let i = 0; i < 6; i++) await insertRun(R, off);
    for (const text of ['x'.repeat(1_048_576), 'short', '']) {
      expect(await failure(as(R, `update ${S}.runs set transcript = $1 where document_id = $2`, [text, off])), JSON.stringify(text.slice(0, 5))).toMatch(/can only be removed/);
    }
    expect(await failure(as(R, `update ${S}.runs set transcript = 'x' where id = $1`, [ci]))).toMatch(/can only be removed/);
    expect((await as<{ n: number }>(R, `select count(transcript)::int as n from ${S}.runs where document_id = $1`, [off]))[0].n).toBe(0);
    // On a document that keeps text, kept text cannot be replaced either; removing it is allowed (the nearest case the old grant allowed).
    const on = await newDocument(R, 'p2-on', true);
    const kept = await insertRun(R, on, { transcript: 'kept' });
    expect(await failure(as(R, `update ${S}.runs set transcript = 'changed' where id = $1`, [kept.id]))).toMatch(/can only be removed/);
    expect(await as(R, `update ${S}.runs set transcript = 'kept' where id = $1 returning id`, [kept.id])).toEqual([{ id: kept.id }]);
    expect(await as(R, `update ${S}.runs set transcript = null where id = $1 returning id`, [kept.id])).toEqual([{ id: kept.id }]);
    await as(R, `delete from ${S}.documents where id in ($1, $2)`, [off, on]);
  });

  it('P3: a run\'s source and its other facts cannot be changed', async () => {
    const d = await newDocument(R, 'p3');
    const r = (await insertRun(R, d, { source: 'ci' })).id;
    for (const [col, v] of [['source', 'web'], ['verdict', 'No tags found'], ['faults', '[]'], ['error_count', 0], ['created_at', '2020-01-01'], ['file_sha256', 'b'.repeat(64)]] as const) {
      expect(await failure(as(R, `update ${S}.runs set ${col} = $1 where id = $2`, [v, r])), col).toMatch(/42501 permission denied/);
    }
    expect((await as<{ source: string }>(R, `select source from ${S}.runs where id = $1`, [r]))[0].source).toBe('ci');
    // The baseline flag still changes, through set_baseline and directly (nearest case that must keep working).
    const r2 = (await insertRun(R, d)).id;
    await as(R, `select ${S}.set_baseline($1)`, [r2]);
    expect((await as<{ id: string }>(R, `select id from ${S}.runs where document_id = $1 and is_baseline`, [d])).map((x) => x.id)).toEqual([r2]);
    expect(await as(R, `update ${S}.runs set is_baseline = false where id = $1 returning id`, [r2])).toEqual([{ id: r2 }]);
    await as(R, `delete from ${S}.documents where id = $1`, [d]);
  });

  it('deleting a run is still allowed', async () => {
    const d = await newDocument(R, 'del');
    const r = (await insertRun(R, d)).id;
    expect(await as(R, `delete from ${S}.runs where id = $1 returning id`, [r])).toEqual([{ id: r }]);
    await as(R, `delete from ${S}.documents where id = $1`, [d]);
  });
});

describe('R1.1-4: keys in all, revoked ones included, are capped at 50', () => {
  const K = '00000000-0000-4000-8000-0000000000b4';
  beforeAll(async () => {
    await db.query('insert into auth.users (id) values ($1)', [K]);
  });
  it('the 50th key is accepted, the 51st refused even with every other key revoked; a delete makes room', async () => {
    for (let i = 0; i < 50; i++) {
      const k = await newKey(K, `k${i}`);
      await as(K, `update ${S}.api_keys set revoked_at = now() where id = $1`, [k.id]);
    }
    expect((await as<{ n: number }>(K, `select count(*)::int as n from ${S}.api_keys`))[0].n).toBe(50);
    expect(await failure(newKey(K, 'k50'))).toMatch(/50 API keys/);
    await as(K, `delete from ${S}.api_keys where label = 'k0'`);
    await newKey(K, 'k50');
    // Revoking and un-revoking are updates, not inserts: the total cap does not touch them.
    expect(await failure(newKey(K, 'k51'))).toMatch(/50 API keys/);
    await as(K, `delete from ${S}.api_keys`);
  });
});

describe('R1.1-2 and R1.1-3: the locks are taken before the lookups', () => {
  // The races themselves need two connections (test/schema-race.test.ts, on a real Postgres when HAC_PG_URL is set).
  const src = (fn: string) => migration.slice(migration.indexOf(`function app_heard_as_check.${fn}(`), migration.indexOf('$$;', migration.indexOf(`function app_heard_as_check.${fn}(`)));
  it('ci_record_run takes the per-person document lock (the one documents_cap takes) before it looks the document up', () => {
    const body = src('ci_record_run');
    const lock = body.indexOf("pg_advisory_xact_lock(hashtextextended('app_heard_as_check.documents:' || k.owner::text, 0))");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(body.indexOf('select d.id into doc_id'));
    expect(src('documents_cap')).toContain("hashtextextended('app_heard_as_check.documents:' || new.user_id::text, 0)");
  });
  it('set_baseline locks the document row before it clears the old baseline', () => {
    const body = src('set_baseline');
    expect(body.indexOf('for update')).toBeGreaterThan(-1);
    expect(body.indexOf('for update')).toBeLessThan(body.indexOf('set is_baseline = false'));
  });
});
