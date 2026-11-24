import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHECKER_ADDRESS, NOT_CALLED } from './checker-address';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => fs.readFileSync(path.join(APP, p), 'utf8');

/** The source files the page bundles: src/main.ts and everything it imports, relatively, in turn. */
function bundled(): string[] {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const body = read(file);
    for (const m of body.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const rel = m[1] ?? m[2];
      const base = path.join(path.dirname(file), rel);
      const hit = [base, `${base}.ts`, path.join(base, 'index.ts')].find((f) => fs.existsSync(path.join(APP, f)) && fs.statSync(path.join(APP, f)).isFile());
      if (hit) walk(hit);
    }
  };
  walk('src/main.ts');
  return [...seen];
}

describe('AC-13: the page loads nothing from another host', () => {
  it('index.html loads no external script, stylesheet, font or image', () => {
    const html = read('index.html');
    expect(html).not.toMatch(/<script[^>]+src=["']?https?:/i);
    expect(html).not.toMatch(/<link[^>]+href=["']?https?:/i);
    expect(html).not.toMatch(/@import|url\(\s*['"]?https?:/i);
    expect(html).not.toMatch(/<img|<iframe/i);
    expect(html).toMatch(/<script type="module" src="\/src\/main\.ts"><\/script>/);
  });

  it('the bundled code names only the hosts AC-13 lists, and only sign-in makes network calls', () => {
    const files = bundled();
    expect(files).toEqual(
      expect.arrayContaining(['src/main.ts', 'src/ui/app.ts', 'src/ui/pages.ts', 'src/core/scan.ts', 'src/core/zip.ts', 'src/data/tagging-status.json', 'src/lib/auth.ts', 'src/lib/store.ts', 'src/ui/preview-account.ts']),
    );
    // From milestone 5a the model call is mounted (the figure panel): llm.ts, through draft.ts.
    expect(files).toEqual(expect.arrayContaining(['src/lib/llm.ts', 'src/lib/draft.ts', 'src/ui/figures.ts']));
    // lewis-alt-text is a link in the figure panel (SPEC §2), not a load.
    const linkHosts = new Set(['latex3.github.io', 'github.com', 'tagging-doctor.hintwise.org', 'json-schema.org', 'lewis-alt-text.hintwise.org']);
    // AC-13 (CR-3): the sign-in panel loads Cloudflare Turnstile when the sign-in-link function asks for a check.
    const loadHosts = new Set(['challenges.cloudflare.com']);
    // The calls of sign-in (sign-in-link, delete-account) go to VITE_SUPABASE_URL, auth.hintwise.org in target.yml.
    // From M3b the checker's calls go to VITE_CHECKER_URL (src/lib/checker.ts, through the fetch main.ts hands it).
    // From 5a llm.ts calls the llm-gateway function, under VITE_SUPABASE_URL too; its own-key path goes through the
    // Anthropic SDK to api.anthropic.com only (AC-46; the Playwright walkthrough lists the hosts).
    const callers = new Set(['src/lib/auth.ts', 'src/lib/account.ts', 'src/lib/checker.ts', 'src/main.ts', 'src/lib/llm.ts']);
    for (const f of files) {
      const body = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
      if (!callers.has(f)) expect(body, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts/);
      for (const m of body.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const host = m[1].toLowerCase();
        expect(linkHosts.has(host) || (loadHosts.has(host) && f === 'src/lib/auth.ts'), `${f}: ${m[0]}`).toBe(true);
      }
    }
    const target = read('deploy/target.yml');
    expect(target).toMatch(/VITE_SUPABASE_URL: https:\/\/auth\.hintwise\.org\n/);
    // AC-13: the checker's address as one value, the one of this release step (test/checker-address.ts, D-133).
    expect(target).toContain(`VITE_CHECKER_URL: ${CHECKER_ADDRESS}\n`);
    expect(target).not.toContain(new URL(NOT_CALLED).hostname);
    // CR-11, need 4 (D-97): Compile and check is on in the released build.
    expect(target).toMatch(/VITE_COMPILE_CHECK: 'on'\n/);
    // Every request of the checker client goes to that one base address.
    const checker = read('src/lib/checker.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of checker.matchAll(/\bfetch\(([^,)]+)/g)) expect(m[1].trim(), m[0]).toMatch(/^`\$\{d\.base\}\/api\//);
    expect([...checker.matchAll(/\bfetch\(/g)].length).toBeGreaterThanOrEqual(5);
    // llm.ts's one fetch goes to the gateway, built from VITE_SUPABASE_URL.
    const llm = read('src/lib/llm.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    expect([...llm.matchAll(/\bdoFetch\(([^,]+),/g)].map((m) => m[1].trim())).toEqual(['deps.gatewayUrl ?? gatewayUrl()']);
    expect(llm).toMatch(/return `\$\{url\.replace\(\/\\\/\$\/, ''\)\}\/functions\/v1\/llm-gateway`;/);
    // main.ts's fetch is the browser's, handed to the checker client only.
    expect(read('src/main.ts')).toMatch(/fetch: \(\.\.\.a\) => fetch\(\.\.\.a\)/);
  });

  it('sets no content security policy of its own in this milestone', () => {
    expect(read('index.html')).not.toMatch(/Content-Security-Policy/i);
    expect(fs.existsSync(path.join(APP, 'public', '_headers'))).toBe(false);
  });
});

describe('AC-14: the footer, the layout and no prices', () => {
  const html = read('index.html');
  it('adds no footer of its own', () => {
    expect(html).not.toMatch(/<footer|data-site-footer|Want something like this/i);
    for (const f of bundled()) expect(read(f), f).not.toMatch(/<footer|data-site-footer|Want something like this/i);
  });

  it('does not make body a row flexbox', () => {
    const body = [...html.matchAll(/(?:^|[}\s])body\s*\{([^}]*)\}/g)].map((m) => m[1]).join(';');
    expect(body).toBeTruthy();
    expect(body).not.toMatch(/display\s*:\s*(inline-)?flex/);
  });

  it('offers no payment or price anywhere', () => {
    const texts = [html, read('README.md'), ...bundled().map(read)];
    for (const t of texts) expect(t).not.toMatch(/\bprice|\bpricing|\bpayment|\bsubscribe|\bcheckout|(?<!['"\w])\$\s?\d+(?![$\w])|\bUSD\b|per month/i);
  });
});

describe('AC-53, AC-57: the page before its script runs', () => {
  it('index.html draws the heading and the lede the script draws, and says JavaScript is needed when it is off', async () => {
    const { shellHtml } = await import('../src/ui/app');
    const html = read('index.html');
    const app = /<div id="app">([\s\S]*?)<\/div>\s*<script/.exec(html)?.[1] ?? '';
    expect(app).toContain('<h1>Tagging Doctor</h1>');
    const lede = /<p class="lede">([^<]+)<\/p>/.exec(shellHtml())?.[1];
    expect(lede).toBeTruthy();
    expect(app).toContain(`<p class="lede">${lede}</p>`);
    expect(app).toMatch(/<noscript>[\s\S]*needs JavaScript[\s\S]*<\/noscript>/);
  });
});
