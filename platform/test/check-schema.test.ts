import { beforeAll, describe, expect, it } from 'vitest';

type Admin = typeof import('../supabase-admin.mjs');
let schemaFactsSql: Admin['schemaFactsSql'];
let strangerSql: Admin['strangerSql'];
let queryResult: Admin['queryResult'];
let schemaFindings: Admin['schemaFindings'];
beforeAll(async () => {
  process.env.SUPABASE_ADMIN_NO_RUN = '1';
  const m = await import('../supabase-admin.mjs');
  schemaFactsSql = m.schemaFactsSql;
  strangerSql = m.strangerSql;
  queryResult = m.queryResult;
  schemaFindings = m.schemaFindings;
});

const table = (over: Record<string, unknown> = {}) => ({ name: 'files', rls: true, policies: 4, anon_access: false, rows: 3, ...over });

describe('schema check SQL', () => {
  it('describes tables and unpinned security definer functions of one schema', () => {
    const q = schemaFactsSql('app_x');
    expect(q).toContain("n.nspname = 'app_x'");
    expect(q).toContain('relrowsecurity');
    expect(q).toContain("has_table_privilege('anon'");
    expect(q).toContain('prosecdef');
    expect(q).toContain("like 'search_path=%'");
  });

  it('counts rows as a signed-in stranger inside one transaction, writing nothing', () => {
    const q = strangerSql('app_x', '00000000-0000-4000-8000-000000000000');
    expect(q.startsWith('begin;\nset local role authenticated;')).toBe(true);
    expect(q).toContain(`set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}'`);
    expect(q).toContain("set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000000'");
    expect(q).not.toMatch(/\b(insert|update|delete|commit)\b/i);
  });

  it('quotes the schema as a literal', () => {
    expect(schemaFactsSql("a'b")).toContain("'a''b'");
  });
});

describe('queryResult', () => {
  it('finds the result row in the shapes the query API may return', () => {
    expect(queryResult([{ result: { a: 1 } }])).toEqual({ a: 1 });
    expect(queryResult([[], [{ result: '{"a":2}' }]])).toEqual({ a: 2 });
    expect(queryResult({ result: null })).toBeNull();
    expect(queryResult([{ other: 1 }])).toBeUndefined();
    expect(queryResult(null)).toBeUndefined();
  });
});

describe('schemaFindings', () => {
  it('passes a schema with RLS, no anon access and nothing visible to a stranger', () => {
    const f = schemaFindings('app_x', { tables: [table()], definers: [] }, { files: 0 }, []);
    expect(f).toEqual({ errors: [], warnings: [], notes: [] });
  });

  it('fails on RLS off, anon access, a leak to a stranger and an unpinned definer', () => {
    const f = schemaFindings(
      'app_x',
      { tables: [table({ rls: false, anon_access: true })], definers: ['share'] },
      { files: 2 },
      [],
    );
    expect(f.errors).toEqual([
      'app_x.files: row level security is off',
      'app_x.files: the anon role has table access (share rows through a security definer function instead)',
      'app_x.files: a signed-in stranger sees 2 of 3 row(s)',
      'app_x.share(): security definer without a fixed search_path',
    ]);
  });

  it('warns on RLS without policies and notes an empty table', () => {
    const f = schemaFindings('app_x', { tables: [table({ policies: 0, rows: 0 })], definers: [] }, {}, []);
    expect(f.errors).toEqual([]);
    expect(f.warnings).toEqual(['app_x.files: RLS is on but has no policy, so the app cannot use it']);
    expect(f.notes).toEqual(['app_x.files: no rows yet, so the stranger check had nothing to see']);
  });

  it('keeps only advisor lints for this schema: ERROR fails, others warn', () => {
    const lints = [
      { name: 'rls_disabled_in_public', title: 'RLS Disabled in Public', level: 'ERROR', metadata: { schema: 'public', name: 'quiz' } },
      { name: 'function_search_path_mutable', title: 'Function Search Path Mutable', level: 'WARN', metadata: { schema: 'app_x', name: 'f' } },
      { name: 'security_definer_view', level: 'ERROR', metadata: { schema: 'app_x' } },
    ];
    const f = schemaFindings('app_x', { tables: [], definers: [] }, {}, lints);
    expect(f.errors).toEqual(['advisor ERROR: security_definer_view']);
    expect(f.warnings).toEqual(['advisor WARN: Function Search Path Mutable (f)']);
  });

  it('copes with missing parts', () => {
    expect(schemaFindings('app_x', null, null, null)).toEqual({ errors: [], warnings: [], notes: [] });
  });
});
