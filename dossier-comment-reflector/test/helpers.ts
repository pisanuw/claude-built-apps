import type { StudentComment } from '../src/core/model';
import { emptyProject, type Project } from '../src/core/model';

let n = 0;
export function c(text: string, course = 'BIO 101', term = 'Fall 2023', extra: Partial<StudentComment> = {}): StudentComment {
  n += 1;
  return { id: `t${n}`, course, term, text, source: 'test', ...extra };
}

export function projectOf(comments: StudentComment[], patch: Partial<Project> = {}): Project {
  return { ...emptyProject(), comments, ...patch };
}
