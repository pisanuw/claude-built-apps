import { DEFAULT_SETTINGS, emptyProject, type CourseChange, type CustomTheme, type Project, type StudentComment } from './model';

export const FILE_KIND = 'dossier-comment-reflector';

/** The project as a JSON file the user keeps; nothing is stored anywhere else. */
export function serializeProject(p: Project, now: Date = new Date()): string {
  return JSON.stringify({ kind: FILE_KIND, savedAt: now.toISOString(), ...p }, null, 2);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Read a saved project, dropping anything malformed. Throws on a file that is not a project. */
export function parseProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not a saved Dossier Comment Reflector project (it is not JSON).');
  }
  if (!raw || typeof raw !== 'object' || (raw as { kind?: unknown }).kind !== FILE_KIND) {
    throw new Error('This file is not a saved Dossier Comment Reflector project.');
  }
  const r = raw as Record<string, unknown>;
  const p = emptyProject();
  const ids = new Set<string>();
  for (const c of Array.isArray(r.comments) ? r.comments : []) {
    const o = (c ?? {}) as Record<string, unknown>;
    const comment: StudentComment = { id: str(o.id), course: str(o.course).trim(), term: str(o.term).trim(), text: str(o.text).trim(), source: str(o.source) || 'Saved project' };
    if (typeof o.question === 'string' && o.question) comment.question = o.question;
    if (!comment.id || ids.has(comment.id) || !comment.course || !comment.term || !comment.text) continue;
    ids.add(comment.id);
    p.comments.push(comment);
  }
  for (const c of Array.isArray(r.changes) ? r.changes : []) {
    const o = (c ?? {}) as Record<string, unknown>;
    const change: CourseChange = { id: str(o.id), course: str(o.course), term: str(o.term), what: str(o.what), why: str(o.why), themes: strings(o.themes) };
    if (change.id && change.course && change.term) p.changes.push(change);
  }
  const s = (r.settings ?? {}) as Record<string, unknown>;
  const custom: CustomTheme[] = (Array.isArray(s.customThemes) ? s.customThemes : [])
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return { id: str(o.id), label: str(o.label), keywords: strings(o.keywords) };
    })
    .filter((c) => c.id && c.label);
  p.settings = {
    pages: num(s.pages, DEFAULT_SETTINGS.pages, 0.5, 20),
    wordsPerPage: num(s.wordsPerPage, DEFAULT_SETTINGS.wordsPerPage, 100, 1500),
    quotesPerTheme: Math.round(num(s.quotesPerTheme, DEFAULT_SETTINGS.quotesPerTheme, 1, 12)),
    names: strings(s.names),
    customThemes: custom,
  };
  p.pinned = strings(r.pinned).filter((id) => ids.has(id));
  p.excluded = strings(r.excluded).filter((id) => ids.has(id));
  p.reflection = str(r.reflection);
  return p;
}
