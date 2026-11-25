// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { openProject } from '../src/core/project';
import { buildReport, CAVEAT, downloadName, escapeHtml, findingTitle, reportHtml, reportJson, where } from '../src/core/report';
import { COULD_NOT_SCAN, findMainFiles, scanDocument, type Finding } from '../src/core/scan';
import { EMPTY_TEXT, NO_MAIN_TEXT, shellHtml } from '../src/ui/app';
import schema from '../schema/report.schema.json';
import { FIXTURES, statusIndex, zipFixture } from './helpers';

const idx = statusIndex();
const NOW = new Date('2026-11-19T12:00:00Z');

async function reportOf(name: string, all = true) {
  const p = openProject(`${name}.zip`, zipFixture(name));
  const mains = await findMainFiles(p);
  const docs = (all ? mains : mains.slice(0, 1)).map((m) => scanDocument(p, m, idx));
  return buildReport(p.name, p.leftOut, p.warnings, docs, idx.data, NOW);
}

const FIXTURE_NAMES = fs.readdirSync(FIXTURES).filter((n) => fs.statSync(path.join(FIXTURES, n)).isDirectory());

describe('AC-11: the standalone HTML report', () => {
  it('loads nothing: no script, stylesheet link, image, frame or CSS url', async () => {
    for (const name of FIXTURE_NAMES) {
      const html = reportHtml(await reportOf(name));
      expect(html).not.toMatch(/<script|<link|<img|<iframe|<object|<embed|url\(|@import|srcset/i);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      expect(doc.querySelectorAll('[src]')).toHaveLength(0);
    }
  });

  it('shows the same findings, the as-of date, the source and the caveat', async () => {
    const r = await reportOf('blockers');
    const doc = new DOMParser().parseFromString(reportHtml(r), 'text/html');
    const body = doc.body.textContent ?? '';
    expect(body).toContain('2 blockers found');
    expect(body).toContain(`Package data as of ${idx.data.asOf}`);
    expect(body).toContain(CAVEAT);
    expect(body).toContain('LaTeX Project Public License, version 1.3c or later');
    const items = [...doc.querySelectorAll('li.finding')].map((li) => li.textContent ?? '');
    expect(items).toHaveLength(r.documents[0].findings.length);
    expect(items[0]).toMatch(/tabu \(package; LaTeX Project: no-support\).*main\.tex, line 3/);
    expect(items[0]).toContain('The LaTeX Project says: “In theory a nice package');
    expect(items[0]).toContain('Suggested fix: Replace tabu with tabularx or array.');
    expect(doc.querySelector('h1')?.textContent).toBe('Tagging Doctor report: blockers.zip');
    expect(doc.documentElement.lang).toBe('en');
  });

  it('holds a summary table and every document after "Scan all", and the files left out', async () => {
    const doc = new DOMParser().parseFromString(reportHtml(await reportOf('course')), 'text/html');
    expect(doc.querySelector('table')?.querySelectorAll('tbody tr')).toHaveLength(4);
    expect(doc.querySelectorAll('section.doc')).toHaveLength(4);
    const s = new DOMParser().parseFromString(reportHtml(await reportOf('students')), 'text/html');
    expect(s.body.textContent).toMatch(/Remove student records from course folders/);
    expect(s.body.textContent).not.toMatch(/SECRET/);
  });

  it('lists the figures without alt text in a table with header cells', async () => {
    const doc = new DOMParser().parseFromString(reportHtml(await reportOf('figures')), 'text/html');
    const t = [...doc.querySelectorAll('table')].find((x) => x.caption?.textContent?.startsWith('Figures without alt text in '));
    expect(t?.querySelectorAll('th[scope=col]')).toHaveLength(3);
    expect(t?.querySelectorAll('tbody tr')).toHaveLength(4);
  });

  it('escapes what it shows', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('AC-12: the JSON report', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  it('validates against the documented schema for every fixture', async () => {
    for (const name of FIXTURE_NAMES) {
      const json = JSON.parse(reportJson(await reportOf(name)));
      const ok = validate(json);
      expect(validate.errors ?? [], name).toEqual([]);
      expect(ok).toBe(true);
    }
  });

  it('holds the findings, the summary and the data\'s asOf date', async () => {
    const json = JSON.parse(reportJson(await reportOf('blockers')));
    expect(json.data.asOf).toBe(idx.data.asOf);
    expect(json.documents[0].summary).toMatchObject({ verdict: '2 blockers found', blockers: 2, warnings: 1 });
    expect(json.documents[0].findings[0]).toMatchObject({ package: 'tabu', status: 'no-support', line: 3 });
    expect(json.generatedAt).toBe('2026-11-19T12:00:00.000Z');
  });

  it('is refused by the schema when a field is wrong', () => {
    expect(validate({ format: 'other' })).toBe(false);
  });
});

const BANNED_ANYWHERE = [/is compliant/i, /is accessible/i, /fully accessible/i, /ADA compliant/i];
const BANNED_IN_VERDICT = [/compliant/i, /accessible/i];

describe('AC-9: no report string claims conformance', () => {
  it('checks every report, verdict and summary of every fixture', async () => {
    for (const name of FIXTURE_NAMES) {
      const r = await reportOf(name);
      const html = reportHtml(r);
      const json = reportJson(r);
      for (const re of BANNED_ANYWHERE) {
        expect(html, `${name} html`).not.toMatch(re);
        expect(json, `${name} json`).not.toMatch(re);
      }
      for (const d of r.documents) {
        const verdictAndSummary = [d.summary.verdict, ...d.summary.notes, `${d.summary.blockers} blockers, ${d.summary.warnings} warnings`].join(' ');
        for (const re of BANNED_IN_VERDICT) expect(verdictAndSummary).not.toMatch(re);
        expect(d.summary.verdict).toMatch(/^(No known blockers|1 blocker found|\d+ blockers found)$/);
      }
    }
  });

  it('checks the page\'s own strings and every string in the app\'s source', () => {
    for (const s of [shellHtml(), EMPTY_TEXT, NO_MAIN_TEXT, COULD_NOT_SCAN, CAVEAT]) {
      for (const re of BANNED_ANYWHERE) expect(s).not.toMatch(re);
    }
    for (const re of BANNED_IN_VERDICT) expect(COULD_NOT_SCAN).not.toMatch(re);
    const src = path.join(FIXTURES, '..', '..', 'src');
    const files = fs.readdirSync(src, { recursive: true }).map(String).filter((f) => /\.(ts|json)$/.test(f));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const body = fs.readFileSync(path.join(src, f), 'utf8');
      for (const re of BANNED_ANYWHERE) expect(body, f).not.toMatch(re);
    }
  });
});

describe('report helpers', () => {
  it('names a download after the project', () => {
    expect(downloadName('My Course (Fall).zip', 'html')).toBe('tagging-doctor-My-Course-Fall.html');
    expect(downloadName('lecture.tex', 'json')).toBe('tagging-doctor-lecture.json');
    expect(downloadName('***.zip', 'json')).toBe('tagging-doctor-project.json');
  });

  it('titles a finding by package or by rule', () => {
    const base: Finding = { severity: 'warning', rule: 'no-title', path: 'a.tex', line: null, message: 'm', fix: null };
    expect(findingTitle(base)).toBe('No title');
    expect(findingTitle({ ...base, rule: 'package-status', package: 'x', kind: 'package' })).toBe('x (package; not in the list)');
    expect(findingTitle({ ...base, rule: 'package-status', package: 'x' })).toBe('x (package; not in the list)');
    expect(findingTitle({ ...base, rule: 'pdftex-only', package: 'fontenc' })).toBe('fontenc: not needed with LuaLaTeX');
    expect(findingTitle({ ...base, rule: 'package-status', package: 'x', status: 'compatible' })).toBe('x (package; LaTeX Project: compatible)');
    expect(where(base)).toBe('a.tex');
  });
});
