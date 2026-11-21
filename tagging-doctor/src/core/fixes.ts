/**
 * Plain words for the source's comments (tag names such as <Div> stay), and a named suggested fix for each
 * package or class finding (AC-1). The curated fixes name only replacements
 * that the pinned status data lists as compatible; a test checks this.
 */
import type { Group, StatusEntry } from './status';

export interface Fix {
  /** A short name for the fix, such as "Replace tabu with tabularx". */
  name: string;
  /** What to do, in plain words. */
  detail: string;
}

/** The source's markdown comment as plain words: no emphasis marks, links as their text. */
export function plainWords(markdown: string | undefined): string {
  if (!markdown) return '';
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Curated replacements, each listed as compatible in the pinned data. */
export const CURATED: Record<string, { fix: Fix; replacements: string[] }> = {
  tabu: {
    fix: {
      name: 'Replace tabu with tabularx or array',
      detail:
        'Rewrite the tables that use tabu with tabularx (tables of a fixed width) or with tabular and the array package. Both are listed as compatible with tagging.',
    },
    replacements: ['tabularx', 'array'],
  },
  epsfig: {
    fix: {
      name: 'Replace epsfig with graphicx',
      detail: 'Load graphicx instead and write \\includegraphics in place of \\epsfig or \\psfig. graphicx is listed as compatible with tagging.',
    },
    replacements: ['graphicx'],
  },
};

/** Classes the pinned data lists as compatible, named in the fix for a blocking class (AC-71); a test checks each. */
export const COMPATIBLE_CLASSES = ['article', 'book', 'report'];

/**
 * The fix for a blocking class (AC-71): a document cannot do without its
 * class, so the advice is to keep it for now or move the content by hand,
 * never to remove it. Beamer has its own (AC-3).
 */
export function classFix(name: string, status: string | undefined): Fix {
  const to = `a class the list names as compatible, such as ${COMPATIBLE_CLASSES.slice(0, -1).join(', ')} or ${COMPATIBLE_CLASSES[COMPATIBLE_CLASSES.length - 1]}`;
  if (status === 'no-support') {
    return {
      name: `Move from ${name} to a compatible class`,
      detail: `The LaTeX Project does not expect the ${name} class ever to work with tagging. Move the content by hand to ${to}.`,
    };
  }
  return {
    name: `Keep ${name} for now, or move to a compatible class`,
    detail: `The LaTeX Project expects the ${name} class to be updated for tagging, but it does not work yet. Keep the class for now and check the status page again before the next term, or move the content by hand to ${to}.`,
  };
}

/** The named fix for a package, class or library finding; null when nothing needs doing. */
export function suggestedFix(name: string, kind: StatusEntry['type'], group: Group, status: string | undefined): Fix | null {
  const curated = Object.hasOwn(CURATED, name) ? CURATED[name] : undefined;
  if (curated && group !== 'ok') return curated.fix;
  if (kind === 'class' && group === 'blocker') return classFix(name, status);
  const what = kind === 'class' ? `the ${name} class` : kind === 'library' ? `the ${name} library` : `the ${name} package`;
  switch (group) {
    case 'blocker':
      if (status === 'no-support') {
        return {
          name: `Replace ${name}`,
          detail: `The LaTeX Project does not expect ${what} ever to work with tagging. Replace it with one listed as compatible on the project's status page, or remove it.`,
        };
      }
      return {
        name: `Remove ${name} for now`,
        detail: `The LaTeX Project expects ${what} to be updated for tagging, but it does not work yet. Remove it if the document can do without it; otherwise keep it, and check the status page again before the next term.`,
      };
    case 'warning':
      return {
        name: `Keep ${name}, check its parts`,
        detail: `Parts of ${what} work with tagging. Read the note from the LaTeX Project and check those parts in the tagged PDF.`,
      };
    case 'unknown':
      return {
        name: `Check ${name} by hand`,
        detail: `The status list has no result for ${what}. After compiling with tagging on, check the parts of the PDF it affects.`,
      };
    default:
      return null;
  }
}
