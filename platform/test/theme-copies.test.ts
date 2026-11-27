// Every copy of the theme switch in this repository matches platform/src/theme
// (review round 1, M1). The platform CI job runs on every push, so changing the
// source here fails CI until every app's copy in the same pull request is
// updated, and editing an app's copy fails it too.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkCopies, cspHash, inlineSnippets, sha256hex, themeFiles } from '../src/theme/copies.mjs';
import { HW_THEME_SHA256, THEME_INIT_CSP, THEME_INIT_JS, THEME_INIT_SNIPPET } from '../src/theme/snippet.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SRC = fileURLToPath(new URL('../src/theme/', import.meta.url));

describe('the copies in this repository', () => {
  const { copies, problems } = checkCopies(REPO);

  it('all match the source', () => {
    expect(problems).toEqual([]);
  });

  it('include the pilot, so the walk really reaches the apps', () => {
    expect(copies).toContainEqual({ file: path.join('accessibility-lens', 'client', 'src', 'lib', 'hw-theme.js'), kind: 'hw-theme.js', ok: true });
    expect(copies).toContainEqual({ file: path.join('accessibility-lens', 'client', 'index.html'), kind: 'head snippet', ok: true });
  });
});

describe('checkCopies on a planted tree', () => {
  let root = '';
  const tree = (files: Record<string, string>): string => {
    root = mkdtempSync(path.join(tmpdir(), 'theme-copies-'));
    for (const [file, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), body);
    }
    return root;
  };
  const runtime = readFileSync(path.join(SRC, 'hw-theme.js'), 'utf8');
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('passes exact copies of all three forms', () => {
    const r = tree({
      'app/src/lib/hw-theme.js': runtime,
      'app/hw-theme-init.js': THEME_INIT_JS,
      'app/index.html': `<head>${THEME_INIT_SNIPPET}<link rel="stylesheet" href="x.css"></head>`,
    });
    const { copies, problems } = checkCopies(r);
    expect(problems).toEqual([]);
    expect(copies.map((c) => c.kind).sort()).toEqual(['head snippet', 'hw-theme-init.js', 'hw-theme.js']);
  });

  it('fails a copy of hw-theme.js that is one byte off (an old copy after a platform change)', () => {
    const { problems } = checkCopies(tree({ 'app/src/lib/hw-theme.js': runtime.replace('44px', '43px') }));
    expect(problems).toHaveLength(1);
    expect(problems[0].file).toBe(path.join('app', 'src', 'lib', 'hw-theme.js'));
  });

  it('fails a changed init file and a changed inline snippet', () => {
    const old = THEME_INIT_JS.replace("'hw-theme'", "'hw-theme-old'");
    const { problems } = checkCopies(tree({ 'site/hw-theme-init.js': old, 'site/page.html': `<head><script>${old}</script></head>` }));
    expect(problems.map((p) => p.file).sort()).toEqual([path.join('site', 'hw-theme-init.js'), path.join('site', 'page.html')]);
  });

  it('a reformatted copy fails too (a formatter run over the app)', () => {
    const { problems } = checkCopies(tree({ 'app/index.html': `<head><script>\n  ${THEME_INIT_JS}\n</script></head>` }));
    expect(problems).toHaveLength(1);
  });

  it('skips node_modules, dist, coverage, dot folders and the source folder', () => {
    const bad = 'stale';
    const r = tree({
      'app/node_modules/x/hw-theme.js': bad,
      'app/client/dist/hw-theme.js': bad,
      'app/coverage/hw-theme.js': bad,
      '.cache/hw-theme.js': bad,
      'platform/src/theme/hw-theme.js': bad,
    });
    expect(themeFiles(r)).toEqual([]);
    expect(checkCopies(r).problems).toEqual([]);
  });

  it('checks a folder named platform below the top level', () => {
    const { problems } = checkCopies(tree({ 'app/platform/hw-theme.js': 'stale' }));
    expect(problems).toHaveLength(1);
  });

  it('the real source tree, walked without skipping platform/, passes', () => {
    const r = tree({});
    cpSync(SRC, path.join(r, 'platform', 'src', 'theme'), { recursive: true });
    const { copies, problems } = checkCopies(r, { skipTop: [] });
    expect(copies.map((c) => c.kind)).toEqual(['hw-theme.js']);
    expect(problems).toEqual([]);
  });
});

describe('the helpers', () => {
  it('find only inline scripts that mention hw-theme', () => {
    const html = `<script>var a</script><script src="/hw-theme.js"></script><script type="text/javascript">x('hw-theme')</script>${THEME_INIT_SNIPPET}`;
    expect(inlineSnippets(html)).toEqual(["x('hw-theme')", THEME_INIT_JS]);
  });
  it('hash the way the README values are written', () => {
    expect(cspHash(THEME_INIT_JS)).toBe(THEME_INIT_CSP);
    expect(sha256hex(readFileSync(path.join(SRC, 'hw-theme.js')))).toBe(HW_THEME_SHA256);
  });
});
