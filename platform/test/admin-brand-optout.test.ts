import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { maskEmail } from '../src/signin/keys.ts';

type Admin = typeof import('../supabase-admin.mjs');
let m: Admin;
beforeAll(async () => {
  process.env.SUPABASE_ADMIN_NO_RUN = '1';
  m = await import('../supabase-admin.mjs');
});
const here = path.dirname(fileURLToPath(import.meta.url));
const brandDir = path.join(here, '..', 'brand');

describe('brand-upload: what it sends', () => {
  it('picks the PNGs, SVGs and favicon.ico, sorted, with their content types', () => {
    expect(m.brandFiles(['README.md', 'make_logo.py', 'b.svg', 'a.png', 'favicon.ico', 'other.ico', 'x.PNG', '../evil.png', 'sp ace.png', 'hintwise-wordmark-email@2x.png', 7])).toEqual([
      { name: 'a.png', contentType: 'image/png' },
      { name: 'b.svg', contentType: 'image/svg+xml' },
      { name: 'favicon.ico', contentType: 'image/x-icon' },
      { name: 'hintwise-wordmark-email@2x.png', contentType: 'image/png' },
    ]);
    expect(m.brandFiles(null)).toEqual([]);
  });
  it('covers every image in platform/brand, each well under the size limit, and the email logo', () => {
    const files = m.brandFiles(fs.readdirSync(brandDir));
    expect(files.map((f) => f.name)).toContain(m.EMAIL_LOGO_FILE);
    expect(files.map((f) => f.name)).toContain('favicon.ico');
    expect(files.length).toBe(fs.readdirSync(brandDir).filter((n) => /\.(png|svg|ico)$/.test(n)).length);
    for (const f of files) expect(fs.statSync(path.join(brandDir, f.name)).size, f.name).toBeLessThan(m.BRAND_SIZE_LIMIT);
  });
  it('makes a public bucket for these image types only, with a small size limit', () => {
    expect(m.brandBucketConfig()).toEqual({ public: true, file_size_limit: 262144, allowed_mime_types: ['image/png', 'image/svg+xml', 'image/x-icon'] });
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
  });
  it('uploads with the type, a one-year cache and overwrite, so a rerun is harmless', () => {
    expect(m.BRAND_CACHE_SECONDS).toBe(31536000);
    expect(m.brandUploadHeaders('eyJ.a.b', 'image/png')).toEqual({ apikey: 'eyJ.a.b', authorization: 'Bearer eyJ.a.b', 'content-type': 'image/png', 'cache-control': 'max-age=31536000', 'x-upsert': 'true' });
    expect(m.brandUploadHeaders('sb_secret_x', 'image/svg+xml')).toEqual({ apikey: 'sb_secret_x', 'content-type': 'image/svg+xml', 'cache-control': 'max-age=31536000', 'x-upsert': 'true' });
  });
  it('gives the logo URL on the custom domain, as EMAIL_LOGO_URL expects', () => {
    const pub = JSON.parse(fs.readFileSync(path.join(here, '..', 'supabase.json'), 'utf8'));
    expect(m.brandPublicUrl(m.publicBase(pub, 'https://ref.supabase.co'), m.EMAIL_LOGO_FILE)).toBe('https://auth.hintwise.org/storage/v1/object/public/brand/hintwise-wordmark-email@2x.png');
    expect(m.publicBase({ url: 'not a url' }, 'https://ref.supabase.co/')).toBe('https://ref.supabase.co/');
    expect(m.publicBase(null, 'f')).toBe('f');
    expect(m.brandPublicUrl('https://ref.supabase.co/', 'a.png')).toBe('https://ref.supabase.co/storage/v1/object/public/brand/a.png');
  });
  it('refuses an SVG that could run script on the project domain; the committed ones are clean', () => {
    for (const n of fs.readdirSync(brandDir).filter((f) => f.endsWith('.svg'))) expect(m.svgProblems(fs.readFileSync(path.join(brandDir, n), 'utf8')), n).toEqual([]);
    expect(m.svgProblems('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).toEqual(['has a <script>']);
    expect(m.svgProblems('<svg onload="x()"></svg>')).toEqual(['has an event handler attribute']);
    expect(m.svgProblems('<svg><a href="javascript:x()"/></svg>')).toEqual(['has a javascript: URL', 'links outside itself']);
    expect(m.svgProblems('<svg><foreignObject/></svg>')).toEqual(['has a <foreignObject>']);
    expect(m.svgProblems('<!DOCTYPE svg [<!ENTITY x "y">]><svg/>')).toEqual(['does not start with <svg', 'has a DOCTYPE or ENTITY']);
    expect(m.svgProblems('<svg><image xlink:href="https://x/y.png"/></svg>')).toEqual(['links outside itself']);
    expect(m.svgProblems('<svg><use href="#a"/></svg>')).toEqual([]);
    expect(m.svgProblems('<?xml version="1.0"?>\n<svg></svg>')).toEqual([]);
    expect(m.svgProblems(null)).toEqual(['does not start with <svg']);
  });
});

describe('the Supabase admin workflow', () => {
  const wf = fs.readFileSync(path.join(here, '..', '..', '.github', 'workflows', 'supabase-admin.yml'), 'utf8');
  it('offers brand-upload and email-optout, with an email input', () => {
    expect(wf).toMatch(/description: '[^']*\| brand-upload \| email-optout \|[^']*'/);
    expect(wf).toContain("email-optout: status, add or remove'");
    expect(wf).toMatch(/\n {6}email:\n {8}description: 'email-optout only: the address \(masked in the log/);
  });
  it('masks the address before the only step that holds it, and never puts it in a script', () => {
    const mask = wf.indexOf('- name: Mask the address');
    const support = wf.indexOf('- name: Email opt-out (support)');
    expect(mask).toBeGreaterThan(0);
    expect(support).toBeGreaterThan(mask);
    expect(wf.slice(mask, support)).toContain(`jq -r '.inputs.email // ""' "$GITHUB_EVENT_PATH"`);
    expect(wf.slice(mask, support)).toContain('echo "::add-mask::$EMAIL"');
    expect(wf.match(/\$\{\{ inputs\.email \}\}/g)).toHaveLength(1);
    expect(wf.indexOf('OPTOUT_EMAIL: ${{ inputs.email }}')).toBeGreaterThan(support);
    expect(wf).not.toContain('github.event.inputs.email');
    expect(wf).toMatch(/inputs\.command != 'email-hook' && inputs\.command != 'email-optout'\n/);
  });
  it('gives the service-role key to the generic step only for brand-upload', () => {
    expect(wf).toContain("SUPABASE_SERVICE_ROLE_KEY: ${{ inputs.command == 'brand-upload' && secrets.SUPABASE_SERVICE_ROLE_KEY || '' }}");
    expect(wf.match(/SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/g)).toHaveLength(1);
  });
  it('generates EMAIL_OPTOUT_SECRET only once and sets EMAIL_LOGO_URL only when the logo is served', () => {
    expect(wf).toContain('if ! has EMAIL_OPTOUT_SECRET; then');
    expect(wf).toContain('V=$(openssl rand -hex 32); echo "::add-mask::$V"; put EMAIL_OPTOUT_SECRET "$V"; OPTOUT_NEW=true');
    expect(wf).toContain(`case "$LOGO_TYPE" in image/png*) put EMAIL_LOGO_URL "$LOGO"; LOGO_SET=true;; esac`);
    expect(wf).toContain('/storage/v1/object/public/brand/hintwise-wordmark-email@2x.png');
  });
});

describe('email-optout (support)', () => {
  it('masks the address exactly as sign-in links do', () => {
    for (const e of ['Ann.Lee+x@Example.com', ' bob@x.org ', 'nope', '@x.org', '']) expect(m.maskAddress(e)).toBe(maskEmail(e));
    expect(m.maskAddress('Ann@Example.com')).toBe('a***@example.com');
    expect(m.OPTOUT_ACTIONS).toEqual(['status', 'add', 'remove']);
  });
  it('asks the email-optout function with the service-role key; the address goes only in the body', () => {
    const r = m.optOutSupportRequest('https://ref.supabase.co/', 'eyJ.a.b', 'remove', 'ann@example.com');
    expect(r.url).toBe('https://ref.supabase.co/functions/v1/email-optout');
    expect(r.init.method).toBe('POST');
    expect(r.init.headers).toEqual({ apikey: 'eyJ.a.b', authorization: 'Bearer eyJ.a.b', 'content-type': 'application/json' });
    expect(JSON.parse(r.init.body)).toEqual({ action: 'remove', email: 'ann@example.com' });
    expect(r.url).not.toContain('ann');
  });
  it('prints the masked address and the short hash, never the address', () => {
    const e = 'Ann.Lee@Example.com';
    const lines = [
      ...m.optOutSummary('status', e, 200, { ok: true, optedOut: true, hash: '0123456789abcdef', entries: [{ scope: 'all', via: 'link', since: '2026-11-11T10:00:00Z' }] }),
      ...m.optOutSummary('status', e, 200, { ok: true, optedOut: false, hash: '0123456789abcdef', entries: [] }),
      ...m.optOutSummary('add', e, 200, { ok: true, hash: '0123456789abcdef', entries: [] }),
      ...m.optOutSummary('remove', e, 200, { ok: true, removed: 1, hash: '0123456789abcdef' }),
      ...m.optOutSummary('remove', e, 200, { ok: true, removed: 0, hash: '0123456789abcdef' }),
      ...m.optOutSummary('remove', e, 403, { ok: false, error: `Only the service-role key may do this (${e}, ${e.toLowerCase()}).` }),
      ...m.optOutSummary('status', e, 0, null),
    ];
    expect(lines).toEqual([
      'a***@example.com (hash 0123456789abcdef): gets no HintWise email',
      '  scope all, via link, since 2026-11-11T10:00:00Z',
      'a***@example.com (hash 0123456789abcdef): gets HintWise email',
      'a***@example.com (hash 0123456789abcdef): on the opt-out list; HintWise sends it no email, sign-in links included',
      'a***@example.com (hash 0123456789abcdef): taken off the opt-out list (1 row(s)); email is on again',
      'a***@example.com (hash 0123456789abcdef): was not on the opt-out list; nothing changed',
      'email-optout remove for a***@example.com failed: HTTP 403 Only the service-role key may do this (a***@example.com, a***@example.com).',
      'email-optout status for a***@example.com failed: HTTP 0',
    ]);
    for (const l of lines) {
      expect(l).not.toContain('Ann.Lee');
      expect(l).not.toContain('ann.lee');
    }
    expect(m.optOutSummary('status', '', 0, null)).toEqual(['email-optout status for *** failed: HTTP 0']);
  });
});
