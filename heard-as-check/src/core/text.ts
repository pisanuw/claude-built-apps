/**
 * The words every screen and report shares. Pure data: `src/core/` is the
 * engine's folder (no DOM), and from milestone 3 the reports read the label
 * from here too (AC-33).
 */

export const APP_NAME = 'Heard-As Check';

/** The sentence every result carries (SPEC section 1, AC-33). */
export const SIMULATED_LABEL = 'Simulated from pdf.js in Chromium; evaluation, not certification.';

/** The promise, in one sentence (SPEC section 1). */
export const PROMISE =
  'See what a PDF viewer’s tagged layer hands to a screen reader from your tagged PDF, beside veraPDF’s verdict, so the faults a validator passes are caught before a listener hears them.';

/** The upload screen while no capture service answers for this page (AC-11, and AC-13 from milestone 3). */
export const NOT_AVAILABLE = 'The checker is not available yet.';
