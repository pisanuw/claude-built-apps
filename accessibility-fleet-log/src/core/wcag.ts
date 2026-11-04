/**
 * WCAG Level A and AA success criteria (2.0, 2.1 and 2.2), with a plain
 * sentence for each that a site owner can read without knowing WCAG. The
 * sentence describes what goes wrong when the criterion fails, because that is
 * how it is used: in issue lists, statements and client reports.
 */

export type Level = 'A' | 'AA';
export type WcagVersion = '2.0' | '2.1' | '2.2';
export type Target = '2.1' | '2.2';

export interface Criterion {
  id: string;
  name: string;
  level: Level;
  /** WCAG version that introduced the criterion. */
  since: WcagVersion;
  /** Removed from WCAG 2.2 (only 4.1.1 Parsing). */
  removedIn22?: boolean;
  /** What visitors run into when this fails, in plain words. */
  plain: string;
}

function c(id: string, name: string, level: Level, since: WcagVersion, plain: string, removedIn22 = false): Criterion {
  return removedIn22 ? { id, name, level, since, plain, removedIn22 } : { id, name, level, since, plain };
}

export const CRITERIA: Criterion[] = [
  c('1.1.1', 'Non-text Content', 'A', '2.0', 'Some images, icons or buttons have no text alternative, so screen reader users do not know what they are.'),
  c('1.2.1', 'Audio-only and Video-only (Prerecorded)', 'A', '2.0', 'Some audio or silent video has no transcript or text alternative.'),
  c('1.2.2', 'Captions (Prerecorded)', 'A', '2.0', 'Some videos have no captions, so Deaf and hard-of-hearing visitors miss what is said.'),
  c('1.2.3', 'Audio Description or Media Alternative (Prerecorded)', 'A', '2.0', 'Some videos have no description of what is shown on screen.'),
  c('1.2.4', 'Captions (Live)', 'AA', '2.0', 'Some live video or audio has no live captions.'),
  c('1.2.5', 'Audio Description (Prerecorded)', 'AA', '2.0', 'Some videos have no audio description of important visual information.'),
  c('1.3.1', 'Info and Relationships', 'A', '2.0', 'Headings, lists, tables or form groups are not marked up as such, so their structure is lost for screen reader users.'),
  c('1.3.2', 'Meaningful Sequence', 'A', '2.0', 'Some content is read out in a different order from how it appears on screen.'),
  c('1.3.3', 'Sensory Characteristics', 'A', '2.0', 'Some instructions rely only on shape, position or sound ("click the round button on the right").'),
  c('1.3.4', 'Orientation', 'AA', '2.1', 'Some pages only work with the phone held one way.'),
  c('1.3.5', 'Identify Input Purpose', 'AA', '2.1', 'Some form fields for personal details cannot be filled in automatically by the browser.'),
  c('1.4.1', 'Use of Color', 'A', '2.0', 'Some information is shown by color alone, for example links that only differ from text by color.'),
  c('1.4.2', 'Audio Control', 'A', '2.0', 'Some audio starts playing by itself with no easy way to stop it.'),
  c('1.4.3', 'Contrast (Minimum)', 'AA', '2.0', 'Some text does not stand out enough from its background to be read easily.'),
  c('1.4.4', 'Resize Text', 'AA', '2.0', 'Some text cannot be enlarged, or the page breaks when it is.'),
  c('1.4.5', 'Images of Text', 'AA', '2.0', 'Some text is shown as a picture, so it cannot be resized or read aloud reliably.'),
  c('1.4.10', 'Reflow', 'AA', '2.1', 'Some pages need sideways scrolling when zoomed in or on a narrow screen.'),
  c('1.4.11', 'Non-text Contrast', 'AA', '2.1', 'Some buttons, form field borders or icons are too faint to see clearly.'),
  c('1.4.12', 'Text Spacing', 'AA', '2.1', 'Some text gets cut off when a visitor increases line or letter spacing.'),
  c('1.4.13', 'Content on Hover or Focus', 'AA', '2.1', 'Some pop-ups that appear on hover cannot be dismissed or disappear too quickly.'),
  c('2.1.1', 'Keyboard', 'A', '2.0', 'Some parts of the page cannot be used with a keyboard alone.'),
  c('2.1.2', 'No Keyboard Trap', 'A', '2.0', 'Keyboard users can get stuck in part of the page and cannot move on.'),
  c('2.1.4', 'Character Key Shortcuts', 'A', '2.1', 'Single-key shortcuts can be triggered by accident and cannot be turned off.'),
  c('2.2.1', 'Timing Adjustable', 'A', '2.0', 'Some time limits cannot be turned off or extended.'),
  c('2.2.2', 'Pause, Stop, Hide', 'A', '2.0', 'Some moving, scrolling or auto-updating content cannot be paused.'),
  c('2.3.1', 'Three Flashes or Below Threshold', 'A', '2.0', 'Some content flashes quickly enough to risk triggering seizures.'),
  c('2.4.1', 'Bypass Blocks', 'A', '2.0', 'There is no quick way to skip past the menu to the main content.'),
  c('2.4.2', 'Page Titled', 'A', '2.0', 'Some pages have no title, or a title that does not say what the page is.'),
  c('2.4.3', 'Focus Order', 'A', '2.0', 'Moving through the page with the Tab key jumps around in a confusing order.'),
  c('2.4.4', 'Link Purpose (In Context)', 'A', '2.0', 'Some links have no text, or text that does not say where they go.'),
  c('2.4.5', 'Multiple Ways', 'AA', '2.0', 'Some pages can only be reached one way (no menu, search or site map).'),
  c('2.4.6', 'Headings and Labels', 'AA', '2.0', 'Some headings or labels do not describe what follows them.'),
  c('2.4.7', 'Focus Visible', 'AA', '2.0', 'Keyboard users cannot see where they are on the page.'),
  c('2.4.11', 'Focus Not Obscured (Minimum)', 'AA', '2.2', 'Sticky headers, banners or chat widgets hide the item a keyboard user is on.'),
  c('2.5.1', 'Pointer Gestures', 'A', '2.1', 'Some features need a swipe, pinch or other gesture with no simple tap alternative.'),
  c('2.5.2', 'Pointer Cancellation', 'A', '2.1', 'Some actions fire as soon as a finger or mouse touches down, with no chance to cancel.'),
  c('2.5.3', 'Label in Name', 'A', '2.1', 'The name a screen reader or voice control hears for a control differs from its visible label.'),
  c('2.5.4', 'Motion Actuation', 'A', '2.1', 'Some features need the device to be shaken or tilted.'),
  c('2.5.7', 'Dragging Movements', 'AA', '2.2', 'Some features need dragging with no single-click alternative.'),
  c('2.5.8', 'Target Size (Minimum)', 'AA', '2.2', 'Some buttons or links are too small or too close together to tap reliably.'),
  c('3.1.1', 'Language of Page', 'A', '2.0', 'The page does not say what language it is in, so screen readers may pronounce it wrongly.'),
  c('3.1.2', 'Language of Parts', 'AA', '2.0', 'Passages in another language are not marked, so screen readers mispronounce them.'),
  c('3.2.1', 'On Focus', 'A', '2.0', 'Moving to a control changes the page unexpectedly.'),
  c('3.2.2', 'On Input', 'A', '2.0', 'Changing a setting or field changes the page unexpectedly without warning.'),
  c('3.2.3', 'Consistent Navigation', 'AA', '2.0', 'Menus appear in a different order on different pages.'),
  c('3.2.4', 'Consistent Identification', 'AA', '2.0', 'The same function is labelled differently on different pages.'),
  c('3.2.6', 'Consistent Help', 'A', '2.2', 'Contact details or help links are in different places on different pages.'),
  c('3.3.1', 'Error Identification', 'A', '2.0', 'Form errors are not clearly described in text.'),
  c('3.3.2', 'Labels or Instructions', 'A', '2.0', 'Some form fields have no label or instructions.'),
  c('3.3.3', 'Error Suggestion', 'AA', '2.0', 'Form errors do not suggest how to fix them.'),
  c('3.3.4', 'Error Prevention (Legal, Financial, Data)', 'AA', '2.0', 'Orders or bookings cannot be checked, corrected or undone before they are final.'),
  c('3.3.7', 'Redundant Entry', 'A', '2.2', 'Visitors have to type the same information twice in one process.'),
  c('3.3.8', 'Accessible Authentication (Minimum)', 'AA', '2.2', 'Logging in needs a memory or puzzle test with no alternative (for example pasting a password is blocked).'),
  c('4.1.1', 'Parsing', 'A', '2.0', 'The page code has errors that may confuse assistive technology.', true),
  c('4.1.2', 'Name, Role, Value', 'A', '2.0', 'Some buttons, links, form fields or widgets do not tell assistive technology what they are or what state they are in.'),
  c('4.1.3', 'Status Messages', 'AA', '2.1', 'Messages such as "added to cart" or "form sent" are not announced to screen reader users.'),
];

const BY_ID = new Map(CRITERIA.map((x) => [x.id, x]));

export function criterion(id: string): Criterion | undefined {
  return BY_ID.get(id);
}

/** Sort key so 1.4.10 comes after 1.4.5. */
export function compareCriteria(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Whether a criterion is part of the given target (WCAG 2.1 AA or 2.2 AA). */
export function inTarget(id: string, target: Target): boolean {
  const cr = BY_ID.get(id);
  if (!cr) return false;
  if (target === '2.1') return cr.since !== '2.2';
  return !cr.removedIn22;
}

/** axe-core tag (wcag143, wcag1410) to criterion id, or null. */
export function tagToCriterion(tag: string): string | null {
  const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
  if (!m) return null;
  const id = `${m[1]}.${m[2]}.${m[3]}`;
  return BY_ID.has(id) ? id : null;
}

/**
 * Find criterion ids in free text: "1.4.3", "WCAG 1.4.3 Contrast", "SC 2.4.4",
 * and pa11y/HTML_CodeSniffer codes such as
 * "WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail".
 */
export function criteriaInText(text: string): string[] {
  const found: string[] = [];
  const add = (id: string) => {
    if (BY_ID.has(id) && !found.includes(id)) found.push(id);
  };
  for (const m of text.matchAll(/(?<![\d.])([1-4])\.(\d{1,2})\.(\d{1,2})(?![\d])/g)) add(`${m[1]}.${m[2]}.${m[3]}`);
  for (const m of text.matchAll(/(?<![\d_])([1-4])_(\d{1,2})_(\d{1,2})(?![\d_])/g)) add(`${m[1]}.${m[2]}.${m[3]}`);
  return found;
}

/**
 * WCAG criteria for common axe-core rules, used when a tool reports the axe
 * rule id without tags (Lighthouse, pa11y's axe runner, CSV exports). Taken
 * from the tags axe-core 4.11 puts on each rule. Rules missing here are
 * reported as best practice.
 */
export const AXE_RULE_CRITERIA: Record<string, string[]> = {
  'area-alt': ['1.1.1', '2.4.4', '4.1.2'],
  'aria-allowed-attr': ['4.1.2'],
  'aria-command-name': ['4.1.2'],
  'aria-hidden-body': ['4.1.2'],
  'aria-hidden-focus': ['4.1.2'],
  'aria-input-field-name': ['4.1.2'],
  'aria-meter-name': ['1.1.1'],
  'aria-progressbar-name': ['1.1.1'],
  'aria-required-attr': ['4.1.2'],
  'aria-required-children': ['1.3.1'],
  'aria-required-parent': ['1.3.1'],
  'aria-roles': ['4.1.2'],
  'aria-toggle-field-name': ['4.1.2'],
  'aria-tooltip-name': ['4.1.2'],
  'aria-valid-attr': ['4.1.2'],
  'aria-valid-attr-value': ['4.1.2'],
  'autocomplete-valid': ['1.3.5'],
  'avoid-inline-spacing': ['1.4.12'],
  blink: ['2.2.2'],
  'button-name': ['4.1.2'],
  bypass: ['2.4.1'],
  'color-contrast': ['1.4.3'],
  'css-orientation-lock': ['1.3.4'],
  'definition-list': ['1.3.1'],
  dlitem: ['1.3.1'],
  'document-title': ['2.4.2'],
  'duplicate-id-aria': ['4.1.2'],
  'form-field-multiple-labels': ['3.3.2'],
  'frame-focusable-content': ['2.1.1'],
  'frame-title': ['4.1.2'],
  'frame-title-unique': ['4.1.2'],
  'html-has-lang': ['3.1.1'],
  'html-lang-valid': ['3.1.1'],
  'html-xml-lang-mismatch': ['3.1.1'],
  'image-alt': ['1.1.1'],
  'input-button-name': ['4.1.2'],
  'input-image-alt': ['1.1.1', '4.1.2'],
  label: ['4.1.2'],
  'link-in-text-block': ['1.4.1'],
  'link-name': ['2.4.4', '4.1.2'],
  list: ['1.3.1'],
  listitem: ['1.3.1'],
  marquee: ['2.2.2'],
  'meta-refresh': ['2.2.1'],
  'meta-viewport': ['1.4.4'],
  'nested-interactive': ['4.1.2'],
  'no-autoplay-audio': ['1.4.2'],
  'object-alt': ['1.1.1'],
  'role-img-alt': ['1.1.1'],
  'scrollable-region-focusable': ['2.1.1'],
  'select-name': ['4.1.2'],
  'server-side-image-map': ['2.1.1'],
  'summary-name': ['4.1.2'],
  'svg-img-alt': ['1.1.1'],
  'target-size': ['2.5.8'],
  'td-headers-attr': ['1.3.1'],
  'th-has-data-cells': ['1.3.1'],
  'valid-lang': ['3.1.2'],
  'video-caption': ['1.2.2'],
};

export function criteriaForRule(ruleId: string): string[] {
  return AXE_RULE_CRITERIA[ruleId] ?? [];
}
