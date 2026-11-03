/** One written answer from a course evaluation. */
export interface StudentComment {
  id: string;
  course: string;
  term: string;
  text: string;
  /** File name or "Pasted text". */
  source: string;
  /** The survey question, when an export has several comment columns. */
  question?: string;
}

/** Something the faculty member changed in a course, in their own words. */
export interface CourseChange {
  id: string;
  course: string;
  /** First term the change was in place. */
  term: string;
  /** What changed, first person: "replaced the two midterms with six quizzes". */
  what: string;
  /** Why, first person; optional. */
  why: string;
  /** Theme ids this change was meant to address. */
  themes: string[];
}

export interface Settings {
  /** Page limit for the reflection. */
  pages: number;
  /** Words that fit on one page in the dossier's format. */
  wordsPerPage: number;
  /** Quotes shown per theme in the quote picker. */
  quotesPerTheme: number;
  /** Names to replace with [name] in every quote (yours, TAs', co-teachers'). */
  names: string[];
  /** Extra themes the user defined, matched by their keywords. */
  customThemes: CustomTheme[];
}

export interface CustomTheme {
  id: string;
  label: string;
  /** Words or phrases; a trailing * matches any ending ("python*"). */
  keywords: string[];
}

export interface Project {
  version: 1;
  comments: StudentComment[];
  changes: CourseChange[];
  settings: Settings;
  /** Comment ids always offered as quotes. */
  pinned: string[];
  /** Comment ids never offered as quotes. */
  excluded: string[];
  /** The reflection as the user last edited it; empty until they edit. */
  reflection: string;
}

export const DEFAULT_SETTINGS: Settings = { pages: 2, wordsPerPage: 500, quotesPerTheme: 4, names: [], customThemes: [] };

export function emptyProject(): Project {
  return { version: 1, comments: [], changes: [], settings: { ...DEFAULT_SETTINGS, names: [], customThemes: [] }, pinned: [], excluded: [], reflection: '' };
}
