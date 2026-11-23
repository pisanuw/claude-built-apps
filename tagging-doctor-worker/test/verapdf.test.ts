import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_RULES, parseReport } from '../src/verapdf.ts';

// veraPDF 1.30.4's JSON report for the untagged math-notes PDF (the spike, D-56).
const REAL = readFileSync(new URL('./fixtures/verapdf-math-notes.json', import.meta.url), 'utf8');

describe("reading veraPDF's report", () => {
  it('takes the profile, the version, the verdict and the rules by failed checks', () => {
    const v = parseReport(REAL);
    expect(v).toMatchObject({
      profile: 'PDF/UA-2 + Tagged PDF validation profile',
      verapdfVersion: 'veraPDF 1.30.4',
      compliant: false,
      failedRules: 9,
      failedChecks: 4785,
    });
    expect(v?.clauses[0]).toMatchObject({ specification: 'ISO 14289-2:2024', clause: '8.2.2', testNumber: 1, failedChecks: 4668 });
    expect(v?.clauses.map((c) => c.failedChecks)).toEqual([...(v?.clauses.map((c) => c.failedChecks) ?? [])].sort((a, b) => b - a));
  });

  it('keeps every failed rule, the most frequent first, up to MAX_RULES (R4a.1-8 a)', () => {
    const many = JSON.parse(REAL);
    const details = many.report.jobs[0].validationResult[0].details;
    details.ruleSummaries = Array.from({ length: 30 }, (_, i) => ({ clause: `c${i}`, testNumber: 1, failedChecks: i }));
    details.failedRules = 30;
    const v = parseReport(JSON.stringify(many));
    expect(v?.clauses).toHaveLength(30); // 20 before m4b
    expect(v?.clauses[0]).toMatchObject({ clause: 'c29', failedChecks: 29, specification: '', description: '' });
    details.ruleSummaries = Array.from({ length: MAX_RULES + 5 }, (_, i) => ({ clause: `c${i}`, testNumber: 1, failedChecks: i }));
    details.failedRules = MAX_RULES + 5;
    const cut = parseReport(JSON.stringify(many));
    expect(cut?.clauses).toHaveLength(MAX_RULES);
    expect(cut?.failedRules).toBe(MAX_RULES + 5); // the app tells the list was cut
    expect(parseReport(JSON.stringify(many), 20)?.clauses).toHaveLength(20);
  });

  it('answers null for anything else', () => {
    expect(parseReport('not json')).toBeNull();
    expect(parseReport('{}')).toBeNull();
    expect(parseReport('{"report":{"jobs":[{"validationResult":[{}]}]}}')).toBeNull();
    expect(parseReport('{"report":{"jobs":[{"validationResult":[{"compliant":true}]}]}}')).toMatchObject({ compliant: true, failedRules: 0, verapdfVersion: 'veraPDF unknown', profile: 'unknown' });
  });
});
