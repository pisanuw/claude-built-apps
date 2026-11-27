/**
 * AC-5: the built page and the deploy file. The page has no price, plan,
 * payment or upgrade wording; it adds no "built by" footer (the deploy does);
 * `body` is not a row flexbox; target.yml has the custom domain, `supabase:
 * true` and the VITE_ values of SPEC section 6; .env.example lists them; and
 * the app is in the sign-in allow-list that `npm run app-hosts` writes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { parse } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';

const VALUES = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_CHECK_URL'];
const target = parse(fs.readFileSync('deploy/target.yml', 'utf8')) as Record<string, unknown> & { env: Record<string, string>; netlify: Record<string, string> };
const supabaseJson = JSON.parse(fs.readFileSync('../platform/supabase.json', 'utf8')) as { url: string; anonKey: string };
export const MONEY = /\b(prices?|pricing|plans?|payments?|pay|upgrade|premium|subscribe|subscriptions?|billing|checkout|trial)\b|[$€£]\s?\d/i;

let out: string;
let builtHtml: string;
let builtCss: string;

beforeAll(async () => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), 'hac-site-'));
  await build({ logLevel: 'silent', build: { outDir: out, emptyOutDir: true, sourcemap: false } });
  builtHtml = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const assets = fs.readdirSync(path.join(out, 'assets'));
  builtCss = assets.filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(path.join(out, 'assets', f), 'utf8')).join('\n');
}, 60_000);

describe('AC-5: the built page', () => {
  it('has no price, plan, payment or upgrade wording', () => {
    const visible = builtHtml.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
    expect(visible).not.toMatch(MONEY);
    expect(builtHtml.match(/content="([^"]*)"/g)?.join(' ') ?? '').not.toMatch(MONEY);
    // The drawn page, signed out and signed in, is checked in test/app.test.ts.
    // The guard itself catches the words it is for.
    for (const s of ['Upgrade to Pro', 'Plans and pricing', '$7 a month', 'Start your free trial']) expect(s).toMatch(MONEY);
  });

  it('adds no "built by" footer of its own (the deploy injects it)', () => {
    expect(builtHtml).not.toMatch(/data-site-footer|site-footer|Want something like this/i);
    for (const f of fs.readdirSync('src', { recursive: true }) as string[]) {
      if (!/\.(ts|css|html)$/.test(f)) continue;
      expect(fs.readFileSync(path.join('src', f), 'utf8'), f).not.toMatch(/data-site-footer|Want something like this/);
    }
  });

  it('body is not a row flexbox', () => {
    const rules = [...`${builtCss}\n${builtHtml}`.matchAll(/(?:^|[}\s,])body\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      if (/display\s*:\s*(inline-)?flex/.test(r)) expect(r).toMatch(/flex-direction\s*:\s*column/);
    }
  });

  it('the built page carries the head snippet and the app shell, and no model or payment library', () => {
    expect(builtHtml).toContain("localStorage.getItem('hw-theme')");
    expect(builtHtml).toContain('<div id="app">');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).toEqual(['@supabase/supabase-js']);
  });
});

describe('AC-5: deploy/target.yml, .env.example and the sign-in allow-list', () => {
  it('target.yml: the custom domain, supabase: true and the three VITE_ values of SPEC section 6', () => {
    expect(target).toMatchObject({ provider: 'netlify', projectName: 'heard-as-check', directory: 'heard-as-check', publish: 'dist', supabase: true });
    expect(target.netlify).toMatchObject({ customDomain: 'heard-as-check.pisan.me', siteName: 'heard-as-check', accountSlug: 'yusuf-pisan' });
    expect(Object.keys(target.env).sort()).toEqual([...VALUES].sort());
    expect(target.env.VITE_SUPABASE_URL).toBe(supabaseJson.url);
    expect(target.env.VITE_SUPABASE_ANON_KEY).toBe(supabaseJson.anonKey);
    expect(target.env.VITE_CHECK_URL).toBe('https://backend-hub-wk2e.onrender.com/heard-as-check');
    expect(target.envPassthrough).toEqual([]);
  });

  it('.env.example lists every build value', () => {
    const names = fs.readFileSync('.env.example', 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')[0]);
    expect(names.sort()).toEqual([...VALUES].sort());
  });

  it('`npm run app-hosts` has been run: the app is on the sign-in allow-list', () => {
    const hosts = fs.readFileSync('../platform/src/signin/app-hosts.ts', 'utf8');
    expect(hosts).toContain("'heard-as-check',");
  });
});
