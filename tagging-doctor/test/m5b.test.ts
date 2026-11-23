/**
 * Milestone 5b: the course report's compile and alt text columns (AC-52).
 */
import { describe, expect, it } from 'vitest';
import { altWords, checkWords, courseReportBody, courseRows, latestCheck, toStoredScan, type CheckRow, type StoredScan } from '../src/core/saved';
import { scanDocument } from '../src/core/scan';
import { CourseStore, MemoryDb } from '../src/lib/store';
import { courseReport } from '../src/ui/pages';
import { index, project } from './patch-helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const DOC = '\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\includegraphics[alt={A}]{a.png}\\includegraphics{a.png}\\includegraphics[artifact]{a.png}\\begin{tikzpicture}\\end{tikzpicture}\n\\end{document}\n';
const stored = (): StoredScan => toStoredScan(scanDocument(project({ 'main.tex': DOC, 'a.png': PNG }), 'main.tex', index), '2026-11-19');
const result = { pages: 3, seconds: 20, warnings: 0, runs: 2, bibliography: null, profile: 'PDF/UA-2', verapdfVersion: 'veraPDF 1.30', passed: false, failedRules: 2, failedChecks: 5, failures: [] };

describe('AC-52: each project row shows its latest check and alt text coverage', () => {
  it('the latest check by when it finished, the original or the patched copy, its date, and "older than the latest scan"', () => {
    const jobs: CheckRow[] = [
      { project_id: 'p1', scan_id: 's1', kind: 'check', status: 'done', finished_at: '2026-11-20T10:00:00Z', created_at: '2026-11-20T10:00:01Z', result, error: null },
      { project_id: 'p1', scan_id: 's1', kind: 'patched-check', status: 'failed', finished_at: '2026-11-21T10:00:00Z', created_at: '2026-11-21T10:00:01Z', result: null, error: 'compile: ./main.tex:3: Undefined control sequence' },
      { project_id: 'p2', scan_id: 's2', kind: 'check', status: 'done', finished_at: null, created_at: '2026-11-22T09:00:00Z', result: { ...result, passed: true, failedRules: 0 }, error: null },
    ];
    const latest = latestCheck(jobs);
    expect(latest.get('p1')?.kind).toBe('patched-check');
    const s = stored();
    const rows = courseRows(
      [
        { id: 'p1', name: 'hw1', main_file: 'main.tex' },
        { id: 'p2', name: 'hw2', main_file: 'main.tex' },
        { id: 'p3', name: 'hw3', main_file: 'main.tex' },
        { id: 'p4', name: 'hw4', main_file: 'main.tex' },
      ],
      new Map([
        ['p1', { id: 's9', created_at: '2026-11-22T00:00:00Z', ...s }],
        ['p2', { id: 's2', created_at: '2026-11-22T00:00:00Z', ...s, summary: { ...s.summary, altCopy: { approved: 1, decorative: 0 } } }],
        ['p3', { id: 's3', created_at: '2026-11-22T00:00:00Z', ...s }],
      ]),
      latest,
    );
    expect(checkWords(rows[0].check, 'UTC')).toBe('Did not compile. (the patched copy, 21 Nov 2026; older than the latest scan)');
    expect(checkWords(rows[1].check, 'UTC')).toMatch(/^3 pages, compiled in 20.0 s.*Passed the PDF\/UA-2 check\. \(the original, 22 Nov 2026\)$/);
    expect(checkWords(rows[2].check)).toBe('not run');
    expect(checkWords(rows[3].check)).toBe('not run');
    // The scan's figures: two images and the artifact, one TikZ picture; alt or artifact on two of the four.
    expect(rows[0].alt).toEqual({ figures: 4, withAlt: 2, copy: null });
    expect(altWords(rows[0].alt)).toBe('2 of 4 figures');
    expect(altWords(rows[1].alt)).toBe('2 of 4 figures; in Tagging Doctor’s patched copy, 1 more with alt text');
    expect(altWords(rows[3].alt)).toBe('not run');
    expect(altWords({ figures: 0, withAlt: 0, copy: null })).toBe('no figures');
    expect(altWords({ figures: 1, withAlt: 1, copy: null })).toBe('1 of 1 figure');
    expect(altWords({ figures: 3, withAlt: 0, copy: { approved: 0, decorative: 0 } })).toBe('0 of 3 figures');
    expect(altWords({ figures: 3, withAlt: 0, copy: { approved: 2, decorative: 1 } })).toBe('0 of 3 figures; in Tagging Doctor’s patched copy, 2 more with alt text and 1 marked decorative');
    expect(altWords({ figures: 3, withAlt: 0, copy: { approved: 0, decorative: 1 } })).toBe('0 of 3 figures; in Tagging Doctor’s patched copy, 1 marked decorative');
    // A failed check's detail names files and lines: not in a report that is handed on.
    expect(checkWords(rows[0].check)).not.toContain('main.tex');
  });

  it('through the store: the report reads the jobs and the alt texts of the course, and the HTML has the two columns', async () => {
    const store = new CourseStore(new MemoryDb('u1', () => new Date('2026-11-23T12:00:00Z')));
    const course = await store.createCourse('STAT 201', 'Fall 2026');
    const s = stored();
    const [first] = await store.save(course.id, [{ name: 'hw1', mainFile: 'main.tex', scan: s }]);
    await store.saveJob(first.project.id, first.scan.id, { kind: 'check', status: 'done', started_at: '2026-11-23T12:00:00Z', finished_at: '2026-11-23T12:00:30Z', result, error: null });
    // A newer scan of the same project: the check is now older than the latest scan.
    await store.save(course.id, [{ name: 'hw1', mainFile: 'main.tex', scan: s }]);
    await store.save(course.id, [{ name: 'hw2', mainFile: 'main.tex', scan: s }]);
    const r = await courseReport(store, course.id, new Date('2026-11-23T13:00:00Z'), index.data);
    const body = courseReportBody(r as NonNullable<typeof r>, 1, 'UTC');
    expect(body).toContain('<th scope="col">Latest compile and PDF/UA check</th><th scope="col">Alt text in the sources</th>');
    expect(body).toContain('Did not pass the PDF/UA-2 check (2 rules failed). (the original, 23 Nov 2026; older than the latest scan)');
    expect(body).toMatch(/<td>hw2<\/td>.*<td>not run<\/td><td>2 of 4 figures<\/td>/);
  });
});
