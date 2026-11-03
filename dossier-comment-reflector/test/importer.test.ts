import { describe, expect, it } from 'vitest';
import { importCsv, importPasted, isEmptyAnswer, newId, previewCsv, splitPasted } from '../src/core/importer';

let i = 0;
const ids = () => `id${++i}`;

describe('isEmptyAnswer', () => {
  it('skips answers with no feedback', () => {
    for (const t of ['N/A', 'n/a', 'none.', 'No comments', '-', '...', 'ok', '', 'x']) expect(isEmptyAnswer(t)).toBe(true);
    expect(isEmptyAnswer('No, the labs were great')).toBe(false);
  });
});

describe('previewCsv', () => {
  it('finds comment, course and term columns', () => {
    const p = previewCsv(
      'Respondent ID,Course,Term,Overall rating,What helped your learning?,What could be improved?\n' +
        '1,CS 142,Fall 2024,5,The weekly quizzes kept me on track all term,More practice problems before exams please\n' +
        '2,CS 142,Fall 2024,4,Office hours were really helpful for me,N/A\n',
    );
    expect(p.guess).toEqual({ comment: [4, 5], course: 1, term: 2, question: null });
    expect(p.rows).toHaveLength(2);
  });
  it('does not take a long question column for the course', () => {
    const p = previewCsv('What did you think of this class?\nIt was a really great class and I learned a lot from it\n');
    expect(p.guess.course).toBeNull();
    expect(p.guess.comment).toEqual([0]);
  });
  it('falls back to a named or the longest column when comments are short', () => {
    expect(previewCsv('id,comment\n1,good\n2,fine\n').guess.comment).toEqual([1]);
    expect(previewCsv('a,b\n1,okay then\n2,sure\n').guess.comment).toEqual([1]);
  });
  it('handles an empty file and rows wider than the header', () => {
    expect(previewCsv('').headers).toEqual([]);
    const p = previewCsv('a\n1,This extra cell is a long written comment');
    expect(p.headers).toEqual(['a', 'Column 2']);
  });
});

describe('importCsv', () => {
  const p = previewCsv(
    'Course,Term,Liked,Improve\nCS 142,Fall 2024,The weekly quizzes kept me on track all term,N/A\n,,Office hours were really helpful for me,More examples\n',
  );
  it('tags rows from columns, falling back to the boxes, and records the question', () => {
    const r = importCsv(p, { commentColumns: [2, 3], courseColumn: 0, termColumn: 1, course: 'CS 999', term: 'Spring 2020', source: 'f.csv' }, ids);
    expect(r.skipped).toBe(1);
    expect(r.comments.map((c) => [c.course, c.term, c.question])).toEqual([
      ['CS 142', 'Fall 2024', 'Liked'],
      ['CS 999', 'Spring 2020', 'Liked'],
      ['CS 999', 'Spring 2020', 'Improve'],
    ]);
  });
  it('counts comments it cannot tag', () => {
    const r = importCsv(p, { commentColumns: [2], courseColumn: 0, termColumn: 1, course: '', term: '', source: 'f.csv' }, ids);
    expect(r.comments).toHaveLength(1);
    expect(r.missingTag).toBe(1);
    expect(r.comments[0].question).toBeUndefined();
  });
});

describe('pasted text', () => {
  it('splits by line, or by paragraph when there are blank lines', () => {
    expect(splitPasted('1. Great class\n- Too fast\n• Loved it')).toEqual(['Great class', 'Too fast', 'Loved it']);
    expect(splitPasted('First comment\ncontinues here\n\nSecond')).toEqual(['First comment continues here', 'Second']);
    expect(splitPasted('   ')).toEqual([]);
  });
  it('imports with the given course and term and skips empty answers', () => {
    const r = importPasted('Great labs and fair grading\nN/A', ' CS 1 ', ' Fall 2024 ', undefined, ids);
    expect(r.comments).toEqual([{ id: expect.any(String), course: 'CS 1', term: 'Fall 2024', text: 'Great labs and fair grading', source: 'Pasted text' }]);
    expect(r.skipped).toBe(1);
  });
  it('makes unique ids', () => {
    expect(newId()).not.toBe(newId());
    expect(newId('x').startsWith('x')).toBe(true);
  });
});
