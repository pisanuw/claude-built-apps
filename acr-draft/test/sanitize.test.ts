// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { prepareHtml, validBase } from '../src/core/sanitize';

describe('prepareHtml', () => {
  it('removes scripts, handlers, javascript: links, refreshes and frame sources', () => {
    const src = `<!DOCTYPE html><html lang="en"><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=/x"><script>alert(1)</script><link rel="stylesheet" href="/app.css"></head>
<body onload="x()"><a href="javascript:alert(1)" onclick="y()">Go</a><form action=" JavaScript:void(0)"><button formaction="javascript:z()">B</button></form>
<iframe src="https://ads.example/" title="Ad"></iframe><object data="x.swf"></object><noscript>Enable JS</noscript><script src="/b.js"></script><img src="logo.png" onerror="z()"></body></html>`;
    const r = prepareHtml(src, 'https://app.example.com/courses');
    expect(r.removedScripts).toBe(2);
    expect(r.unstyled).toBe(false);
    expect(r.html.startsWith('<!doctype html>\n<html lang="en"><head><base href="https://app.example.com/courses">')).toBe(true);
    for (const bad of ['<script', 'onload', 'onclick', 'onerror', 'javascript:', 'JavaScript:', 'evil.example', 'refresh', 'ads.example', 'x.swf', 'Enable JS']) {
      expect(r.html, bad).not.toContain(bad);
    }
    expect(r.html).toContain('<iframe title="Ad"></iframe>');
    expect(r.html).toContain('href="#"');
    expect(r.html).toContain('<img src="logo.png">');
  });

  it('skips the base for missing or unsafe addresses and notices unstyled pages', () => {
    const r = prepareHtml('<p>Hi</p>', 'ftp://x');
    expect(r.html).toBe('<html><head></head><body><p>Hi</p></body></html>');
    expect(r.unstyled).toBe(true);
    expect(prepareHtml('<style>p{}</style><p>x</p>', '').unstyled).toBe(false);
    expect(validBase(' http://a.example/x ')).toBe('http://a.example/x');
    expect(validBase('not a url')).toBeNull();
  });
});
