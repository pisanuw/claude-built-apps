/** The words the mount says (SPEC section 3 and section 4, Check screen). One place, so tests and the page can quote them. */
export const MESSAGES = {
  tooLargeUpload: 'This file is larger than 10 MB, the limit for one check.',
  notPdf: 'This does not look like a PDF.',
  password: 'This PDF is password protected. Remove the password and try again.',
  noTags: 'This PDF has no tags: a screen reader has only the plain text to go on.',
  tooLarge: 'This file is too large to read.',
  memory: 'This file needs more memory than the checker has.',
  structCut: 'The structure tree is deeper than 40 levels; pdf.js reads only the first 40.',
  timeout: 'This file took longer than 90 seconds to read.',
  unreadable: 'This PDF could not be read.',
  interrupted: 'The check was interrupted. Try again.',
  unavailable: 'The checker is not available.',
  busy: 'The checker is busy, try again in a minute.',
  internal: 'The checker had an internal error. Try again.',
  cancelled: 'The check was cancelled.',
  signIn: 'Sign in to use the checker.',
  authUnavailable: 'The sign-in check is unavailable. Try again in a minute.',
  cutShort: 'The upload was cut short.',
  tooSlow: 'The upload took too long. Try again on a faster connection.',
  origin: 'This origin may not use the checker.',
} as const;

/** "Read the first 60 of 75 pages." (AC-18), or null when every page was read. */
export function pagesNote(pages: number, pagesRead: number): string | null {
  return pagesRead < pages ? `Read the first ${pagesRead} of ${pages} pages.` : null;
}
