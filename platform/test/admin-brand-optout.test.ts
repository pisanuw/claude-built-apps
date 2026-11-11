import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

type Admin = typeof import('../supabase-admin.mjs');
let m: Admin;
beforeAll(async () => {
  process.env.SUPABASE_ADMIN_NO_RUN = '1';
  m = await import('../supabase-admin.mjs');
});
const here = path.dirname(fileURLToPath(import.meta.url));
const brandDir = path.join(here, '..', 'brand');

describe('brand-upload: what it sends', () => {
  it('picks the PNGs and favicon.ico, never an SVG, sorted, with their content types', () => {
    expect(m.brandFiles(['README.md', 'make_logo.py', 'b.svg', 'a.png', 'favicon.ico', 'other.ico', 'x.PNG', '../evil.png', 'sp ace.png', 'hintwise-wordmark-email@2x.png', 7])).toEqual([
      { name: 'a.png', contentType: 'image/png' },
      { name: 'favicon.ico', contentType: 'image/x-icon' },
      { name: 'hintwise-wordmark-email@2x.png', contentType: 'image/png' },
    ]);
    expect(m.brandFiles(null)).toEqual([]);
  });
  it('covers every image in platform/brand, each well under the size limit, and the email logo', () => {
    const files = m.brandFiles(fs.readdirSync(brandDir));
    expect(files.map((f) => f.name)).toContain(m.EMAIL_LOGO_FILE);
    expect(files.map((f) => f.name)).toContain('favicon.ico');
    expect(files.length).toBe(fs.readdirSync(brandDir).filter((n) => /\.(png|ico)$/.test(n)).length);
    expect(files.some((f) => f.name.endsWith('.svg'))).toBe(false);
    expect(fs.readdirSync(brandDir).some((n) => n.endsWith('.svg'))).toBe(true);
    for (const f of files) expect(fs.statSync(path.join(brandDir, f.name)).size, f.name).toBeLessThan(m.BRAND_SIZE_LIMIT);
  });
  it('makes a public bucket for PNG and ICO only (no SVG), with a small size limit', () => {
    expect(m.brandBucketConfig()).toEqual({ public: true, file_size_limit: 262144, allowed_mime_types: ['image/png', 'image/x-icon'] });
  });
  it('creates the bucket when it is missing, corrects what differs, and leaves a right one alone', () => {
    const want = m.brandBucketConfig();
    expect(m.brandBucketPlan(null)).toEqual({ action: 'create', body: { id: 'brand', name: 'brand', ...want } });
    expect(m.brandBucketPlan({ id: 'brand', ...want, allowed_mime_types: [...want.allowed_mime_types].reverse() })).toEqual({ action: 'none' });
    expect(m.brandBucketPlan({ id: 'brand', public: false, file_size_limit: null, allowed_mime_types: null })).toEqual({
      action: 'update',
      differs: ['public', 'file_size_limit', 'allowed_mime_types'],
      body: { id: 'brand', name: 'brand', ...want },
    });
    expect(m.brandBucketPlan({ ...want, file_size_limit: '262144' }).action).toBe('none');
    // A bucket that still allows SVG is corrected.
    expect(m.brandBucketPlan({ ...want, allowed_mime_types: ['image/png', 'image/svg+xml', 'image/x-icon'] })).toMatchObject({ action: 'update', differs: ['allowed_mime_types'] });
  });
  it('uploads with the type, a one-day cache and overwrite, so a rerun is harmless', () => {
    expect(m.BRAND_CACHE_SECONDS).toBe(86400);
    expect(m.brandUploadHeaders('eyJ.a.b', 'image/png')).toEqual({ apikey: 'eyJ.a.b', authorization: 'Bearer eyJ.a.b', 'content-type': 'image/png', 'cache-control': 'max-age=86400', 'x-upsert': 'true' });
    expect(m.brandUploadHeaders('sb_secret_x', 'image/x-icon')).toEqual({ apikey: 'sb_secret_x', 'content-type': 'image/x-icon', 'cache-control': 'max-age=86400', 'x-upsert': 'true' });
  });
  it('gives the logo URL on the custom domain, as EMAIL_LOGO_URL expects', () => {
    const pub = JSON.parse(fs.readFileSync(path.join(here, '..', 'supabase.json'), 'utf8'));
    expect(m.brandPublicUrl(m.publicBase(pub, 'https://ref.supabase.co'), m.EMAIL_LOGO_FILE)).toBe('https://auth.hintwise.org/storage/v1/object/public/brand/hintwise-wordmark-email@2x.png');
    expect(m.publicBase({ url: 'not a url' }, 'https://ref.supabase.co/')).toBe('https://ref.supabase.co/');
    expect(m.publicBase(null, 'f')).toBe('f');
    expect(m.brandPublicUrl('https://ref.supabase.co/', 'a.png')).toBe('https://ref.supabase.co/storage/v1/object/public/brand/a.png');
  });
});

describe('the Supabase admin workflow', () => {
  const wf = fs.readFileSync(path.join(here, '..', '..', '.github', 'workflows', 'supabase-admin.yml'), 'utf8');
  it('offers brand-upload and email-optout, with an email input', () => {
    expect(wf).toMatch(/description: '[^']*\| brand-upload \| email-optout \|[^']*'/);
    expect(wf).toContain("email-optout: status, add or remove'");
    expect(wf).toMatch(/\n {6}email:\n {8}description: 'email-optout only: the address \(masked in the log, never printed\)'/);
  });
  it('masks the address before the only step that holds it, and never puts it in a script', () => {
    const mask = wf.indexOf('- name: Mask the address');
    const support = wf.indexOf('- name: Email opt-out (support)');
    expect(mask).toBeGreaterThan(0);
    expect(support).toBeGreaterThan(mask);
    const step = wf.slice(mask, support);
    expect(step).toContain(`ARG=$(jq -r '.inputs.arg // ""' "$GITHUB_EVENT_PATH")`);
    expect(step).toContain('case "$ARG" in status|add|remove) ;; *) echo "::error::');
    expect(step).toContain(`gsub("%"; "%25") | gsub("\\r"; "%0D") | gsub("\\n"; "%0A")`);
    expect(step).toContain('ascii_downcase');
    expect(step).toContain('while IFS= read -r V; do echo "::add-mask::$V"; done');
    expect(step).not.toContain('${{');
    // The support step uses no Management API token.
    expect(wf.slice(support, wf.indexOf('- name: Commit platform/supabase.json'))).not.toContain('SUPABASE_ACCESS_TOKEN');
    expect(wf.match(/\$\{\{ inputs\.email \}\}/g)).toHaveLength(1);
    expect(wf.indexOf('OPTOUT_EMAIL: ${{ inputs.email }}')).toBeGreaterThan(support);
    expect(wf).not.toContain('github.event.inputs.email');
    expect(wf).toMatch(/inputs\.command != 'email-hook' && inputs\.command != 'email-optout'\n/);
  });
  it('gives the service-role key to the generic step only for brand-upload and optout-ready', () => {
    expect(wf).toContain("SUPABASE_SERVICE_ROLE_KEY: ${{ (inputs.command == 'brand-upload' || inputs.command == 'optout-ready') && secrets.SUPABASE_SERVICE_ROLE_KEY || '' }}");
    expect(wf.match(/SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/g)).toHaveLength(1);
  });
  it('deploys sign-in-link and auth-email-hook only after optout-ready passes', () => {
    const deploy = wf.slice(wf.indexOf('- name: Deploy an edge function'), wf.indexOf('- name: Set the ANTHROPIC_API_KEY function secret'));
    const guard = deploy.indexOf('case "$NAME" in sign-in-link|auth-email-hook) node supabase-admin.mjs optout-ready;; esac');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(deploy.indexOf('supabase functions deploy'));
    expect(deploy).toContain("SUPABASE_SERVICE_ROLE_KEY: ${{ (inputs.arg == 'sign-in-link' || inputs.arg == 'auth-email-hook') && secrets.SUPABASE_SERVICE_ROLE_KEY || '' }}");
    // The step runs under bash -e, so a failed guard stops the deploy.
    expect(deploy).not.toContain('set +e');
  });
  it('generates EMAIL_OPTOUT_SECRET only once and sets EMAIL_LOGO_URL only when the logo is served', () => {
    expect(wf).toContain('if ! has EMAIL_OPTOUT_SECRET; then');
    expect(wf).toContain('V=$(openssl rand -hex 32); echo "::add-mask::$V"; put EMAIL_OPTOUT_SECRET "$V"; OPTOUT_NEW=true');
    expect(wf).toContain(`case "$LOGO_TYPE" in image/png*) put EMAIL_LOGO_URL "$LOGO"; LOGO_SET=true;; esac`);
    expect(wf).toContain('/storage/v1/object/public/brand/hintwise-wordmark-email@2x.png');
  });
});

describe('email-optout (support)', () => {
  it('takes status, add or remove', () => {
    expect(m.OPTOUT_ACTIONS).toEqual(['status', 'add', 'remove']);
    expect(m.NO_ACCESS_TOKEN).toEqual(['brand-upload', 'email-optout', 'optout-ready']);
  });
  it('asks the email-optout function with the service-role key; the address goes only in the body', () => {
    const r = m.optOutSupportRequest('https://ref.supabase.co/', 'eyJ.a.b', 'remove', 'ann@example.com');
    expect(r.url).toBe('https://ref.supabase.co/functions/v1/email-optout');
    expect(r.init.method).toBe('POST');
    expect(r.init.headers).toEqual({ apikey: 'eyJ.a.b', authorization: 'Bearer eyJ.a.b', 'content-type': 'application/json' });
    expect(JSON.parse(r.init.body)).toEqual({ action: 'remove', email: 'ann@example.com' });
    expect(r.url).not.toContain('ann');
  });
  it('prints only the action, the hash prefix and the time: no local part, domain or mask', () => {
    const when = new Date('2026-11-11T12:00:00Z');
    const hash = '0123456789abcdef';
    const lines = [
      ...m.optOutSummary('status', 200, { ok: true, optedOut: true, hash, entries: [{ scope: 'all', via: 'link', since: '2026-11-11T10:00:00Z' }] }, when),
      ...m.optOutSummary('status', 200, { ok: true, optedOut: false, hash, entries: [] }, when),
      ...m.optOutSummary('add', 200, { ok: true, hash: `${hash}ffff`, entries: [] }, when),
      ...m.optOutSummary('remove', 200, { ok: true, removed: 1, hash }, when),
      ...m.optOutSummary('remove', 200, { ok: true, removed: 0, hash }, when),
      ...m.optOutSummary('remove', 403, { ok: false, error: 'Only the service-role key may do this (ann@example.com).' }, when),
      ...m.optOutSummary('status', 400, { ok: false }, when),
      ...m.optOutSummary('status', 404, null, when),
      ...m.optOutSummary('status', 503, { ok: false }, when),
      ...m.optOutSummary('status', 0, null, when),
    ];
    expect(lines).toEqual([
      'email-optout status 0123456789abcdef at 2026-11-11T12:00:00.000Z: email off',
      '  scope all, via link, since 2026-11-11T10:00:00Z',
      'email-optout status 0123456789abcdef at 2026-11-11T12:00:00.000Z: email on',
      'email-optout add 0123456789abcdef at 2026-11-11T12:00:00.000Z: email off (on the opt-out list; sign-in links included)',
      'email-optout remove 0123456789abcdef at 2026-11-11T12:00:00.000Z: email on again (1 row(s) removed)',
      'email-optout remove 0123456789abcdef at 2026-11-11T12:00:00.000Z: was not on the opt-out list; nothing changed',
      'email-optout remove at 2026-11-11T12:00:00.000Z: failed, HTTP 403 (the key was refused)',
      'email-optout status at 2026-11-11T12:00:00.000Z: failed, HTTP 400 (the function refused the address or the action)',
      'email-optout status at 2026-11-11T12:00:00.000Z: failed, HTTP 404 (the email-optout function is not deployed)',
      'email-optout status at 2026-11-11T12:00:00.000Z: failed, HTTP 503 (the email-optout function is not configured)',
      'email-optout status at 2026-11-11T12:00:00.000Z: failed, HTTP 0 (no answer from the function)',
    ]);
    for (const l of lines) expect(l).not.toMatch(/@|\*\*\*|example/);
  });
});

describe('optout-ready (the deploy guard)', () => {
  it('probes platform.email_optout_check with the service-role key and a hash no address has', () => {
    const r = m.optOutReadyRequest('https://ref.supabase.co/', 'eyJ.a.b');
    expect(r.url).toBe('https://ref.supabase.co/rest/v1/rpc/email_optout_check');
    expect(r.init.headers).toEqual({ apikey: 'eyJ.a.b', authorization: 'Bearer eyJ.a.b', 'content-type': 'application/json', 'content-profile': 'platform', accept: 'application/json' });
    expect(JSON.parse(r.init.body)).toEqual({ p_email_hash: '0'.repeat(64), p_scopes: [] });
    expect(m.optOutReadyRequest('https://ref.supabase.co', 'sb_secret_x').init.headers).not.toHaveProperty('authorization');
  });
  it('passes only on a boolean answer', () => {
    expect(m.optOutReadyProblem(200, 'false')).toBeNull();
    expect(m.optOutReadyProblem(200, ' true\n')).toBeNull();
    expect(m.optOutReadyProblem(404, '{"code":"PGRST202","message":"Could not find the function platform.email_optout_check"}')).toMatch(/does not exist: run apply-shared/);
    expect(m.optOutReadyProblem(400, '{"code":"PGRST202"}')).toMatch(/does not exist/);
    expect(m.optOutReadyProblem(200, '1')).toMatch(/did not answer a boolean \(HTTP 200: 1\)/);
    expect(m.optOutReadyProblem(401, '{"message":"Invalid API key"}')).toMatch(/HTTP 401/);
    expect(m.optOutReadyProblem(0, null)).toMatch(/HTTP 0/);
  });
});
