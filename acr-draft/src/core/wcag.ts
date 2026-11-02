/**
 * WCAG 2.1 Level A and AA success criteria, with the guided manual test the
 * app shows for each one.
 *
 * `automated` says whether axe-core has rules for the criterion. Even where it
 * does, automation only finds some failures: a clean scan never proves a
 * criterion is met, so every criterion still needs a person's answer (except
 * 4.1.1, which WCAG 2.1's 2023 errata treats as always satisfied for HTML).
 *
 * `gate` names a product question. If the vendor answers "no" (the product has
 * no such content), the criterion is reported as Not Applicable with the
 * gate's reason as the remark.
 */

export type Level = 'A' | 'AA';

export type GateId =
  | 'media'
  | 'live'
  | 'timeLimits'
  | 'autoAudio'
  | 'movingContent'
  | 'shortcuts'
  | 'gestures'
  | 'motionInput'
  | 'forms'
  | 'commitments'
  | 'otherLanguages'
  | 'hoverContent';

export interface Gate {
  id: GateId;
  question: string;
  /** Remark used when the answer is "no". */
  naRemark: string;
  /** Example to help a non-specialist answer. */
  example: string;
}

export interface Criterion {
  id: string;
  name: string;
  level: Level;
  /** Added in WCAG 2.1 (not in 2.0). */
  wcag21: boolean;
  /** One plain sentence: what the rule asks for. */
  plain: string;
  /** Manual test steps, in order. */
  steps: string[];
  /** The yes/no question the steps answer. */
  ask: string;
  automated: boolean;
  gate?: GateId;
  /** Criterion is always satisfied (WCAG 2.1 errata for 4.1.1). */
  alwaysSupports?: string;
}

export const GATES: Gate[] = [
  {
    id: 'media',
    question: 'Does the product include prerecorded video or audio?',
    example: 'Lesson videos, tutorial screencasts, podcast episodes, onboarding videos.',
    naRemark: 'The product contains no prerecorded audio or video content.',
  },
  {
    id: 'live',
    question: 'Does the product stream live audio or video?',
    example: 'Live classes, webinars, live office hours inside the product.',
    naRemark: 'The product does not stream live audio or video.',
  },
  {
    id: 'timeLimits',
    question: 'Does anything have a time limit?',
    example: 'Session timeouts, timed quizzes or exams, offers that expire on screen.',
    naRemark: 'The product sets no time limits on users.',
  },
  {
    id: 'autoAudio',
    question: 'Does any sound start playing by itself?',
    example: 'A welcome video with sound that autoplays, background music.',
    naRemark: 'No audio plays automatically.',
  },
  {
    id: 'movingContent',
    question: 'Is there content that moves, blinks, scrolls or updates by itself?',
    example: 'Carousels, animated banners, live tickers, auto-refreshing leaderboards.',
    naRemark: 'The product has no moving, blinking, scrolling or auto-updating content.',
  },
  {
    id: 'shortcuts',
    question: 'Does the product have keyboard shortcuts that use a single letter, number or symbol key?',
    example: 'Pressing "j" for next item or "?" for help, without Ctrl or Alt.',
    naRemark: 'The product has no single-character keyboard shortcuts.',
  },
  {
    id: 'gestures',
    question: 'Does anything need a pinch, swipe, drag path or multi-finger gesture?',
    example: 'Swipe between flashcards, pinch to zoom a diagram, draw a signature.',
    naRemark: 'No functionality uses multipoint or path-based gestures.',
  },
  {
    id: 'motionInput',
    question: 'Is anything triggered by shaking or tilting the device?',
    example: 'Shake to undo, tilt to scroll.',
    naRemark: 'No functionality is operated by device motion.',
  },
  {
    id: 'forms',
    question: 'Do users fill in forms or input fields?',
    example: 'Sign-up, settings, search, quiz answers, assignment submission.',
    naRemark: 'The product has no forms or user input.',
  },
  {
    id: 'commitments',
    question: 'Can users pay, submit test or quiz answers, or change or delete their stored data?',
    example: 'Checkout, submitting an exam, deleting a course or an account.',
    naRemark: 'Users cannot make payments, submit test responses, or modify or delete stored data.',
  },
  {
    id: 'otherLanguages',
    question: 'Does any content appear in a different language from the rest of the page?',
    example: 'A Spanish course inside an English interface, quotations in French.',
    naRemark: 'All content is in the language of the page.',
  },
  {
    id: 'hoverContent',
    question: 'Do tooltips, popovers or menus appear when hovering or focusing?',
    example: 'Help tooltips on icons, hover cards, dropdowns that open on hover.',
    naRemark: 'No additional content appears on hover or focus.',
  },
];

const c = (
  id: string,
  name: string,
  level: Level,
  plain: string,
  steps: string[],
  ask: string,
  extra: Partial<Criterion> = {},
): Criterion => ({
  id,
  name,
  level,
  plain,
  steps,
  ask,
  automated: false,
  wcag21: false,
  ...extra,
});

export const CRITERIA: Criterion[] = [
  c('1.1.1', 'Non-text Content', 'A', 'Every image, icon and control has a text alternative that serves the same purpose; decorative images are hidden from screen readers.', [
    'On each screen, find every image, icon button and chart.',
    'Check the alt text or accessible name (browser DevTools > Accessibility pane, or a screen reader). An icon-only button needs a name such as "Delete".',
    'Decorative images should have empty alt (alt="") so screen readers skip them.',
  ], 'Does every meaningful image and icon have a fitting text alternative?', { automated: true }),
  c('1.2.1', 'Audio-only and Video-only (Prerecorded)', 'A', 'Audio-only content has a transcript; silent video has a transcript or audio track describing it.', [
    'List every audio-only clip (podcasts) and video without sound (silent demos, GIF tutorials).',
    'Check that each has a transcript, or for silent video a text or audio description.',
  ], 'Does every audio-only and video-only item have an alternative?', { gate: 'media' }),
  c('1.2.2', 'Captions (Prerecorded)', 'A', 'Prerecorded video with sound has accurate captions.', [
    'Play each video with sound and turn captions on.',
    'Check that captions exist, are synchronized and include speaker changes and important sounds. Auto-generated captions usually need correcting.',
  ], 'Do all prerecorded videos have accurate captions?', { gate: 'media', automated: true }),
  c('1.2.3', 'Audio Description or Media Alternative (Prerecorded)', 'A', 'Visual information in video that the soundtrack does not explain is available as audio description or a full text alternative.', [
    'Watch each video with the screen turned away: is anything important only shown, never said (on-screen code, slide text, a demonstrated click)?',
    'If so, check for an audio-described version or a full text alternative.',
  ], 'Is visual-only information in videos described or provided as text?', { gate: 'media' }),
  c('1.2.4', 'Captions (Live)', 'AA', 'Live audio in synchronized media has captions.', [
    'Join a live session as a participant and turn captions on.',
    'Check that live captions are provided (human or automatic) for all spoken content.',
  ], 'Are live streams captioned?', { gate: 'live' }),
  c('1.2.5', 'Audio Description (Prerecorded)', 'AA', 'Prerecorded video has audio description of important visual content.', [
    'For each video where something important is only shown, not said, check for an audio-described version (a text transcript alone is not enough at AA).',
    'A video whose narration already explains everything on screen passes.',
  ], 'Is important visual content in videos narrated or audio described?', { gate: 'media' }),
  c('1.3.1', 'Info and Relationships', 'A', 'Structure shown visually (headings, lists, tables, form labels, groups) is also in the code.', [
    'Use a headings outline (browser extension or screen reader heading list): do visual headings appear as real headings in a sensible order?',
    'Check that lists are lists, data tables have header cells, and every form field is programmatically tied to its label.',
    'Radio buttons and checkboxes that belong together should be grouped (fieldset and legend, or role="group" with a name).',
  ], 'Is the visual structure conveyed in the markup?', { automated: true }),
  c('1.3.2', 'Meaningful Sequence', 'A', 'The reading order in the code matches the meaning when order matters.', [
    'Read each screen with a screen reader, or with CSS turned off.',
    'Check that content comes out in an order that still makes sense (for example, a question before its answer choices).',
  ], 'Is the reading order meaningful?'),
  c('1.3.3', 'Sensory Characteristics', 'A', 'Instructions do not rely only on shape, size, position or sound.', [
    'Read the instructions and help text on each screen.',
    'Flag phrases such as "click the round button", "see the box on the right" or "when you hear the beep" that give no other cue such as a label.',
  ], 'Do instructions work without seeing shape or position?'),
  c('1.3.4', 'Orientation', 'AA', 'Content works in both portrait and landscape unless one orientation is essential.', [
    'On a phone or tablet, rotate the device on each screen.',
    'Check that the product does not lock to one orientation and stays usable in both.',
  ], 'Does the product work in both orientations?', { wcag21: true, automated: true }),
  c('1.3.5', 'Identify Input Purpose', 'AA', 'Fields that ask for the user\'s own information declare their purpose so browsers can autofill them.', [
    'Find fields for the user\'s own name, email, phone, address, username or new password.',
    'Check that each has the right autocomplete attribute (for example autocomplete="email").',
  ], 'Do personal-information fields have correct autocomplete values?', { wcag21: true, automated: true, gate: 'forms' }),
  c('1.4.1', 'Use of Color', 'A', 'Color is not the only way information is shown.', [
    'Look for places where color alone carries meaning: required fields in red, correct/incorrect answers in green/red, links distinguished only by color, chart series.',
    'Check that each also has text, an icon, a pattern or underline.',
  ], 'Is color never the only cue?', { automated: true }),
  c('1.4.2', 'Audio Control', 'A', 'Audio that plays automatically for more than 3 seconds can be paused or muted independently.', [
    'Find any audio that starts on its own.',
    'Check that it stops within 3 seconds, or that there is a pause, stop or volume control near the start of the page.',
  ], 'Can automatic audio be stopped?', { gate: 'autoAudio', automated: true }),
  c('1.4.3', 'Contrast (Minimum)', 'AA', 'Text has a contrast ratio of at least 4.5:1 (3:1 for large text).', [
    'The automated scan checks most text. Also check text on images and gradients, placeholder text, disabled-looking but active controls, and hover and focus states, which scans often miss.',
    'Use a contrast checker on any doubtful pair of colors.',
  ], 'Does all text meet the contrast minimum?', { automated: true }),
  c('1.4.4', 'Resize text', 'AA', 'Text can be zoomed to 200% without losing content or function.', [
    'Zoom the browser to 200% on each screen.',
    'Check that no text is cut off or overlapping and that every control still works.',
  ], 'Does the product work at 200% zoom?', { automated: true }),
  c('1.4.5', 'Images of Text', 'AA', 'Text is real text, not a picture of text, except logos or where the image is essential.', [
    'Look for text inside images: banners, buttons, infographics, screenshots of instructions.',
    'Check that each is real text or is essential (logo, a sample of handwriting).',
  ], 'Is text presented as real text rather than images?'),
  c('1.4.10', 'Reflow', 'AA', 'Content fits a 320 CSS pixel wide window without scrolling in two directions.', [
    'Set the browser window to 1280 pixels wide and zoom to 400% (or use a 320 pixel wide responsive view).',
    'Check that you can read and use everything with vertical scrolling only. Data tables, maps and code editors may scroll horizontally.',
  ], 'Does content reflow at 320 pixels wide?', { wcag21: true }),
  c('1.4.11', 'Non-text Contrast', 'AA', 'Controls, focus indicators and meaningful graphics have at least 3:1 contrast with their surroundings.', [
    'Check the borders of text fields, checkboxes and buttons, icons that carry meaning, chart lines, and focus indicators.',
    'Use a contrast checker: each needs 3:1 against the adjacent color.',
  ], 'Do controls and meaningful graphics meet 3:1 contrast?', { wcag21: true }),
  c('1.4.12', 'Text Spacing', 'AA', 'No content is lost when users increase line, paragraph, letter and word spacing.', [
    'Apply a text spacing bookmarklet (line height 1.5, paragraph spacing 2x, letter spacing 0.12em, word spacing 0.16em).',
    'Check that no text is cut off or overlaps on each screen.',
  ], 'Does content survive increased text spacing?', { wcag21: true, automated: true }),
  c('1.4.13', 'Content on Hover or Focus', 'AA', 'Tooltips and popovers can be dismissed, can be hovered, and stay until dismissed.', [
    'Trigger each tooltip or popover with the mouse and with the keyboard.',
    'Check that Escape closes it without moving focus, that you can move the pointer onto it without it disappearing, and that it stays until you move away or dismiss it.',
  ], 'Do hover and focus popups behave correctly?', { wcag21: true, gate: 'hoverContent' }),
  c('2.1.1', 'Keyboard', 'A', 'Everything can be done with a keyboard alone.', [
    'Put the mouse away. Use Tab, Shift+Tab, Enter, Space, arrow keys and Escape.',
    'Complete each key flow: sign in, navigate, open menus and dialogs, fill and submit forms, use custom widgets (editors, drag and drop, sliders).',
  ], 'Can every function be operated from the keyboard?', { automated: true }),
  c('2.1.2', 'No Keyboard Trap', 'A', 'Keyboard focus never gets stuck.', [
    'Tab through each screen, including into embedded editors, video players, iframes and dialogs.',
    'Check that you can always Tab or Escape out again (if a special key is needed, the product tells the user).',
  ], 'Can focus always leave every component?'),
  c('2.1.4', 'Character Key Shortcuts', 'A', 'Single-key shortcuts can be turned off, remapped, or only work when their control has focus.', [
    'List every shortcut that uses a single letter, number or symbol key.',
    'Check that users can turn them off or remap them, or that they only work while the relevant control has focus.',
  ], 'Can single-key shortcuts be turned off or remapped?', { wcag21: true, gate: 'shortcuts' }),
  c('2.2.1', 'Timing Adjustable', 'A', 'Users can turn off, adjust or extend time limits.', [
    'Find each time limit: session timeouts, timed quizzes, auto-advancing content.',
    'Check that users are warned and can extend it (at least 10 times the default, or with a simple action and 20 seconds to respond), or turn it off. Real-time events and exams where timing is essential may be exempt: say so in your note.',
  ], 'Can users adjust or extend time limits?', { gate: 'timeLimits', automated: true }),
  c('2.2.2', 'Pause, Stop, Hide', 'A', 'Moving, blinking, scrolling or auto-updating content can be paused, stopped or hidden.', [
    'Find carousels, animations, tickers and live-updating areas that start on their own and last over 5 seconds.',
    'Check that each has a pause, stop or hide control that works with the keyboard.',
  ], 'Can moving or auto-updating content be paused?', { gate: 'movingContent', automated: true }),
  c('2.3.1', 'Three Flashes or Below Threshold', 'A', 'Nothing flashes more than three times in one second.', [
    'Look for flashing or strobing content: animations, video, celebration effects, alerts.',
    'Check that nothing flashes more than three times per second.',
  ], 'Is the product free of rapid flashing?'),
  c('2.4.1', 'Bypass Blocks', 'A', 'Users can skip repeated navigation.', [
    'Press Tab once after the page loads: is there a "Skip to main content" link, or do screens use landmarks (header, nav, main) and headings?',
    'Check that the skip link moves focus to the main content.',
  ], 'Can users skip repeated blocks?', { automated: true }),
  c('2.4.2', 'Page Titled', 'A', 'Each page has a title that describes its topic or purpose.', [
    'Look at the browser tab on each screen, including after in-app navigation in single-page apps.',
    'Check that the title names the screen, for example "Gradebook - Biology 101 - QuizNest".',
  ], 'Does every screen have a descriptive title?', { automated: true }),
  c('2.4.3', 'Focus Order', 'A', 'Keyboard focus moves in an order that preserves meaning.', [
    'Tab through each screen and through dialogs.',
    'Check that focus follows a logical order, moves into a dialog when it opens, and returns to the trigger when it closes.',
  ], 'Is the focus order logical?'),
  c('2.4.4', 'Link Purpose (In Context)', 'A', 'The purpose of each link is clear from its text or its context.', [
    'List the links on each screen (a screen reader links list helps).',
    'Flag vague links such as "click here" or "more" whose surrounding sentence or list item does not explain them, and icon-only links without a name.',
  ], 'Is each link\'s purpose clear?', { automated: true }),
  c('2.4.5', 'Multiple Ways', 'AA', 'There is more than one way to find a page within the product.', [
    'Check that users can reach screens in at least two ways: navigation menu plus search, a site map, or a table of contents.',
    'Steps in a process (such as a checkout) are exempt.',
  ], 'Are there two or more ways to find pages?'),
  c('2.4.6', 'Headings and Labels', 'AA', 'Headings and labels describe their topic or purpose.', [
    'Read the headings and form labels on each screen.',
    'Check that each says what follows or what to enter (not just "Section 1" or "Field").',
  ], 'Are headings and labels descriptive?'),
  c('2.4.7', 'Focus Visible', 'AA', 'The keyboard focus is always visible.', [
    'Tab through each screen.',
    'Check that you can always see where focus is, on every link, button, field and custom control.',
  ], 'Is keyboard focus always visible?'),
  c('2.5.1', 'Pointer Gestures', 'A', 'Multi-finger and path gestures have a single-pointer alternative.', [
    'For each pinch, swipe, drag path or multi-finger action, look for an alternative using simple taps or clicks (buttons for next/previous, zoom controls).',
  ], 'Does every complex gesture have a simple alternative?', { wcag21: true, gate: 'gestures' }),
  c('2.5.2', 'Pointer Cancellation', 'A', 'Actions fire on release (not on press), so users can slide away to cancel.', [
    'Press and hold the mouse button or finger on buttons and links, then move away before releasing.',
    'Check that the action does not happen. Drag and drop and piano-style controls are allowed exceptions.',
  ], 'Can users cancel a click by moving away?', { wcag21: true }),
  c('2.5.3', 'Label in Name', 'A', 'A control\'s accessible name contains its visible label text.', [
    'For buttons and links with visible text, check the accessible name (DevTools Accessibility pane).',
    'The name should include the visible words, so a voice-control user saying "click Submit" works.',
  ], 'Do accessible names include the visible label?', { wcag21: true, automated: true }),
  c('2.5.4', 'Motion Actuation', 'A', 'Motion-triggered functions also work through the interface, and motion can be turned off.', [
    'For each function triggered by shaking or tilting, check there is a button alternative and a setting to turn motion off.',
  ], 'Do motion-triggered functions have alternatives?', { wcag21: true, gate: 'motionInput' }),
  c('3.1.1', 'Language of Page', 'A', 'The page declares its main language.', [
    'Check that each page\'s <html> element has a lang attribute matching its language (for example lang="en").',
  ], 'Does every page declare its language?', { automated: true }),
  c('3.1.2', 'Language of Parts', 'AA', 'Passages in another language are marked with that language.', [
    'Find content in a language different from the page.',
    'Check that it is wrapped in an element with the right lang attribute so screen readers pronounce it correctly.',
  ], 'Are passages in other languages marked?', { gate: 'otherLanguages', automated: true }),
  c('3.2.1', 'On Focus', 'A', 'Moving focus to something does not trigger a change of context.', [
    'Tab onto every control.',
    'Check that merely focusing does not submit a form, open a new window or move to another page.',
  ], 'Does focus alone never change context?'),
  c('3.2.2', 'On Input', 'A', 'Changing a setting does not unexpectedly change context.', [
    'Change dropdowns, checkboxes and radio buttons.',
    'Check that this does not navigate, submit or open a window without warning (a "Go" button or a notice beforehand is fine).',
  ], 'Does changing a control avoid unexpected context changes?'),
  c('3.2.3', 'Consistent Navigation', 'AA', 'Repeated navigation appears in the same order across screens.', [
    'Compare the menus and navigation across screens.',
    'Check that repeated items appear in the same relative order.',
  ], 'Is navigation consistent across screens?'),
  c('3.2.4', 'Consistent Identification', 'AA', 'Components with the same function are identified the same way.', [
    'Compare icons and labels across screens: the same action (Save, Search, Help) should use the same label and icon everywhere.',
  ], 'Are repeated functions labeled consistently?'),
  c('3.3.1', 'Error Identification', 'A', 'Input errors are identified and described in text.', [
    'Submit each form with missing and invalid values.',
    'Check that each error names the field and the problem in text (not only a red border), and that a screen reader announces or can find it.',
  ], 'Are input errors described in text?', { gate: 'forms' }),
  c('3.3.2', 'Labels or Instructions', 'A', 'Fields have labels or instructions, including required fields and formats.', [
    'Check that every field has a visible label (a placeholder alone disappears when typing) and that required fields and expected formats are stated.',
  ], 'Do all fields have labels or instructions?', { gate: 'forms', automated: true }),
  c('3.3.3', 'Error Suggestion', 'AA', 'When an error is detected and a fix is known, the fix is suggested.', [
    'Trigger format errors (bad email, short password, wrong date).',
    'Check that the message says how to fix it, for example "Enter a date as MM/DD/YYYY".',
  ], 'Do error messages suggest a fix?', { gate: 'forms' }),
  c('3.3.4', 'Error Prevention (Legal, Financial, Data)', 'AA', 'Submissions that pay, commit, delete data or submit test answers can be reversed, checked or confirmed.', [
    'Find actions that take payment, submit quiz or exam answers, or delete or overwrite data.',
    'Check that each can be undone, is checked for errors with a chance to correct, or asks for review and confirmation first.',
  ], 'Are important submissions reversible, checked or confirmed?', { gate: 'commitments' }),
  c('4.1.1', 'Parsing', 'A', 'Obsolete for HTML: WCAG 2.1 errata treat it as always satisfied.', [
    'No test needed for HTML content.',
  ], 'No test needed.', {
    automated: false,
    alwaysSupports:
      'For WCAG 2.1, the September 2023 errata state that this criterion should be considered always satisfied for content using HTML or XML.',
  }),
  c('4.1.2', 'Name, Role, Value', 'A', 'Every control exposes its name, role, and state to assistive technology.', [
    'With a screen reader, move through custom controls: menus, tabs, toggles, accordions, sliders, drag handles, rich editors.',
    'Check that each announces what it is, its name, and its state (expanded, selected, checked), and that state changes are announced.',
  ], 'Do all controls expose name, role and state?', { automated: true }),
  c('4.1.3', 'Status Messages', 'AA', 'Status messages are announced by screen readers without moving focus.', [
    'Trigger messages that appear without a page change: "Saved", "3 results", "Upload complete", form error summaries, toasts.',
    'Check that a screen reader announces each one (via role="status", role="alert" or aria-live).',
  ], 'Are status messages announced?', { wcag21: true }),
];

export const CRITERIA_BY_ID: ReadonlyMap<string, Criterion> = new Map(CRITERIA.map((x) => [x.id, x]));

export const PRINCIPLES: Record<string, string> = {
  '1': 'Perceivable',
  '2': 'Operable',
  '3': 'Understandable',
  '4': 'Robust',
};

/** Sort key for "1.4.10" style ids (numeric per part). */
export function compareIds(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Map an axe-core tag such as "wcag1410" to "1.4.10", or null if it is not a WCAG 2.1 A/AA criterion tag. */
export function tagToCriterion(tag: string): string | null {
  const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
  if (!m) return null;
  const id = `${m[1]}.${m[2]}.${m[3]}`;
  return CRITERIA_BY_ID.has(id) ? id : null;
}
