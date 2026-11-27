/**
 * R1.1-2, R1.1-3 and R1.2-1 on a real Postgres with two connections (PGlite has one).
 * Skipped unless HAC_PG_URL names a throwaway server, for example:
 *   docker run -d --rm --name hac-pg -e POSTGRES_PASSWORD=race -p 127.0.0.1:55432:5432 postgres:17.6
 *   HAC_PG_URL=postgres://postgres:race@127.0.0.1:55432/postgres npx vitest run test/schema-race.test.ts
 * It creates a database of its own and drops it at the end. The order of the
 * two transactions is fixed by waiting on each statement, not on the clock.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL_ = process.env.HAC_PG_URL;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(HERE, '..', 'supabase', 'migrations', '0001_init.sql'), 'utf8');
const S = 'app_heard_as_check';
const U = '00000000-0000-4000-8000-0000000000c1';
const STAND_IN = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
`;
const run = {
  file_sha256: 'a'.repeat(64), file_bytes: 1, pages: 1, pages_read: 1, pdfjs_version: '6.5.438', chromium_version: '158.0.8127.36',
  verdict: 'Passes the validator, reads as intended', transcript_sha256: 'a'.repeat(64), transcript_lines: 1,
};

describe.skipIf(!URL_)('races on a real Postgres (R1.1-2, R1.1-3, R1.2-1)', () => {
  const dbName = `hac_race_${randomUUID().replace(/-/g, '')}`;
  let admin: pg.Client;
  let c1: pg.Client;
  let c2: pg.Client;
  // Two keys of one person, as a team with one key per workflow has: with one key the
  // key row's last_used_at update already makes the second call wait.
  const key = `hac_${'A1b2C3d4'.repeat(4)}`;
  const key2 = `hac_${'Z9y8X7w6'.repeat(4)}`;
  let pid2 = 0;
  /** Waits until c2's backend is waiting on a lock: the order is then fixed. */
  const blocked = async () => {
    for (;;) {
      const r = await admin.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid2]);
      if (r.rows[0]?.wait_event_type === 'Lock') return;
      await new Promise((res) => setImmediate(res));
    }
  };

  const asUser = async (c: pg.Client, uid: string | null) => {
    await c.query(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [uid ? JSON.stringify({ sub: uid }) : '']);
  };
  const failure = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'no error';
    } catch (e) {
      return `${(e as { code?: string }).code} ${(e as Error).message}`;
    }
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: URL_ });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const url = new URL(URL_!);
    url.pathname = `/${dbName}`;
    const setup = new pg.Client({ connectionString: url.toString() });
    await setup.connect();
    await setup.query(STAND_IN);
    await setup.query(migration);
    await setup.query('insert into auth.users (id) values ($1)', [U]);
    for (const k of [key, key2]) await setup.query(`insert into ${S}.api_keys (user_id, label, prefix, key_hash) values ($1, 'ci', $2, $3)`, [U, k.slice(0, 8), createHash('sha256').update(k).digest('hex')]);
    await setup.end();
    c1 = new pg.Client({ connectionString: url.toString() });
    c2 = new pg.Client({ connectionString: url.toString() });
    await c1.connect();
    await c2.connect();
    pid2 = (await c2.query('select pg_backend_pid() as p')).rows[0].p;
  }, 60_000);

  afterAll(async () => {
    await c1?.end();
    await c2?.end();
    await admin?.query(`drop database if exists ${dbName} with (force)`);
    await admin?.end();
  });

  it('R1.1-2: two first CI runs for one new name at once both succeed, into one document', async () => {
    const call = (c: pg.Client, k: string) => c.query(`select ${S}.ci_record_run($1, 'matrix/report.pdf', $2::jsonb) as r`, [k, JSON.stringify(run)]);
    await c1.query('begin');
    await asUser(c1, null);
    const first = await call(c1, key);
    await c2.query('begin');
    await asUser(c2, null);
    const second = call(c2, key2).then((r) => ({ r }), (e: Error) => ({ e }));
    await blocked(); // c2 waits for c1's per-person lock
    await c1.query('commit');
    const settled = await second;
    if ('e' in settled) {
      await c2.query('rollback');
      throw settled.e;
    }
    const r2 = settled.r;
    await c2.query('commit');
    expect(first.rows[0].r.is_baseline).toBe(true);
    expect(r2.rows[0].r.is_baseline).toBe(false);
    expect(r2.rows[0].r.document_id).toBe(first.rows[0].r.document_id);
    const docs = await c1.query(`select count(*)::int as n from ${S}.documents where name = 'matrix/report.pdf'`);
    expect(docs.rows[0].n).toBe(1);
  });

  it('the nearest case the old code got right: two first runs with one shared key, also into one document', async () => {
    const call = (c: pg.Client) => c.query(`select ${S}.ci_record_run($1, 'shared/key.pdf', $2::jsonb) as r`, [key, JSON.stringify(run)]);
    await c1.query('begin');
    await asUser(c1, null);
    const first = await call(c1);
    await c2.query('begin');
    await asUser(c2, null);
    const second = call(c2).then((r) => ({ r }), (e: Error) => ({ e }));
    await blocked();
    await c1.query('commit');
    const settled = await second;
    if ('e' in settled) {
      await c2.query('rollback');
      throw settled.e;
    }
    const r2 = settled.r;
    await c2.query('commit');
    expect(r2.rows[0].r.document_id).toBe(first.rows[0].r.document_id);
    expect([first.rows[0].r.is_baseline, r2.rows[0].r.is_baseline]).toEqual([true, false]);
  });

  it('R1.1-3: two set_baseline calls at once on one document end with the second\'s run as the only baseline', async () => {
    const [d] = (await c1.query(`insert into ${S}.documents (user_id, name) values ($1, 'two-tabs') returning id`, [U])).rows;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await c1.query(
        `insert into ${S}.runs (user_id, document_id, source, file_sha256, file_bytes, pages, pages_read, pdfjs_version, chromium_version, verdict, transcript_sha256, transcript_lines)
         values ($1, $2, 'web', $3, 1, 1, 1, 'p', 'c', 'No tags found', $3, 1) returning id`,
        [U, d.id, 'a'.repeat(64)],
      );
      ids.push(r.rows[0].id);
    }
    const [, y, z] = ids;
    await c1.query('begin');
    await asUser(c1, U);
    await c1.query(`select ${S}.set_baseline($1)`, [y]);
    await c2.query('begin');
    await asUser(c2, U);
    const second = failure(c2.query(`select ${S}.set_baseline($1)`, [z]));
    await blocked(); // c2 waits for c1
    await c1.query('commit');
    const outcome = await second;
    await c2.query(outcome === 'no error' ? 'commit' : 'rollback');
    expect(outcome).toBe('no error');
    const base = await c1.query(`select id from ${S}.runs where document_id = $1 and is_baseline`, [d.id]);
    expect(base.rows.map((r) => r.id)).toEqual([z]);
  });
  /** A document with 50 runs: ids[0] is the baseline, ids[1] the oldest run that is not. */
  const fiftyRuns = async (name: string) => {
    const [d] = (await c1.query(`insert into ${S}.documents (user_id, name) values ($1, $2) returning id`, [U, name])).rows;
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push((await c1.query(insertRun, [U, d.id, 'a'.repeat(64)])).rows[0].id as string);
    return { doc: d.id as string, ids };
  };
  const insertRun = `insert into ${S}.runs (user_id, document_id, source, file_sha256, file_bytes, pages, pages_read, pdfjs_version, chromium_version, verdict, transcript_sha256, transcript_lines)
     values ($1, $2, 'web', $3, 1, 1, 1, 'p', 'c', 'No tags found', $3, 1) returning id`;
  const baselines = async (doc: string) => (await c1.query(`select id from ${S}.runs where document_id = $1 and is_baseline`, [doc])).rows.map((r) => r.id as string);

  /** c1 does `remove` and holds it; c2 calls set_baseline(target) and waits; c1 commits. Returns c2's outcome. */
  const raceSetBaseline = async (remove: (c: pg.Client) => Promise<unknown>, target: string) => {
    await c1.query('begin');
    await asUser(c1, U);
    await remove(c1);
    await c2.query('begin');
    await asUser(c2, U);
    // The handler is attached when the query is sent: c2's error can arrive before c1's commit returns.
    const second = failure(c2.query(`select ${S}.set_baseline($1)`, [target]));
    await blocked();
    await c1.query('commit');
    const outcome = await second;
    await c2.query(outcome === 'no error' ? 'commit' : 'rollback');
    return outcome;
  };

  it('R1.2-1: set_baseline of a run that a 51st run\'s trim deletes meanwhile is refused, and the old baseline stays', async () => {
    const { doc, ids } = await fiftyRuns('trim-race');
    const outcome = await raceSetBaseline((c) => c.query(insertRun, [U, doc, 'a'.repeat(64)]), ids[1]);
    expect(outcome).toMatch(/^P0002 No such run/);
    expect((await c1.query(`select count(*)::int as n from ${S}.runs where id = $1`, [ids[1]])).rows[0].n).toBe(0);
    expect(await baselines(doc)).toEqual([ids[0]]);
  });

  it('R1.2-1: set_baseline of a run deleted meanwhile in another tab is refused, and the old baseline stays', async () => {
    const { doc, ids } = await fiftyRuns('delete-race');
    const outcome = await raceSetBaseline((c) => c.query(`delete from ${S}.runs where id = $1`, [ids[1]]), ids[1]);
    expect(outcome).toMatch(/^P0002 No such run/);
    expect(await baselines(doc)).toEqual([ids[0]]);
  });

  it('the nearest case the old code got right: set_baseline of a run that survives the trim succeeds', async () => {
    const { doc, ids } = await fiftyRuns('trim-other');
    const outcome = await raceSetBaseline((c) => c.query(insertRun, [U, doc, 'a'.repeat(64)]), ids[5]);
    expect(outcome).toBe('no error');
    expect(await baselines(doc)).toEqual([ids[5]]);
    expect((await c1.query(`select count(*)::int as n from ${S}.runs where document_id = $1`, [doc])).rows[0].n).toBe(50);
  });
});
