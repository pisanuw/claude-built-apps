import type { Answer, Project, RuleOutcome, RuleResult, Scan } from './project';

/** Real axe-core 4.11 rule metadata for the rules the example uses. */
const RULES: Record<string, { help: string; criteria: string[]; impact: string }> = {
  'image-alt': { help: 'Images must have alternative text', criteria: ['1.1.1'], impact: 'critical' },
  'color-contrast': { help: 'Elements must meet minimum color contrast ratio thresholds', criteria: ['1.4.3'], impact: 'serious' },
  label: { help: 'Form elements must have labels', criteria: ['4.1.2'], impact: 'critical' },
  'button-name': { help: 'Buttons must have discernible text', criteria: ['4.1.2'], impact: 'critical' },
  'link-name': { help: 'Links must have discernible text', criteria: ['2.4.4', '4.1.2'], impact: 'serious' },
  'document-title': { help: 'Documents must have <title> element to aid in navigation', criteria: ['2.4.2'], impact: 'serious' },
  'html-has-lang': { help: '<html> element must have a lang attribute', criteria: ['3.1.1'], impact: 'serious' },
  'autocomplete-valid': { help: 'autocomplete attribute must be used correctly', criteria: ['1.3.5'], impact: 'serious' },
  'meta-viewport': { help: 'Zooming and scaling must not be disabled', criteria: ['1.4.4'], impact: 'critical' },
  bypass: { help: 'Page must have means to bypass repeated blocks', criteria: ['2.4.1'], impact: 'serious' },
  list: { help: '<ul> and <ol> must only directly contain <li>, <script> or <template> elements', criteria: ['1.3.1'], impact: 'serious' },
  'aria-required-children': { help: 'Certain ARIA roles must contain particular children', criteria: ['1.3.1'], impact: 'critical' },
  'link-in-text-block': { help: 'Links must be distinguishable without relying on color', criteria: ['1.4.1'], impact: 'serious' },
  'scrollable-region-focusable': { help: 'Scrollable region must have keyboard access', criteria: ['2.1.1'], impact: 'serious' },
  'video-caption': { help: '<video> elements must have captions', criteria: ['1.2.2'], impact: 'critical' },
  'aria-progressbar-name': { help: 'ARIA progressbar nodes must have an accessible name', criteria: ['1.1.1'], impact: 'serious' },
};

function rule(id: string, outcome: RuleOutcome, nodes = 0, targets: string[] = []): RuleResult {
  const meta = RULES[id];
  return {
    id,
    help: meta.help,
    helpUrl: `https://dequeuniversity.com/rules/axe/4.11/${id}?application=axeAPI`,
    impact: outcome === 'pass' ? null : meta.impact,
    outcome,
    criteria: meta.criteria,
    nodes: outcome === 'pass' ? Math.max(nodes, 1) : nodes,
    targets,
  };
}

const passes = (...ids: string[]) => ids.map((id) => rule(id, 'pass', 3));

function scan(url: string, date: string, rules: RuleResult[]): Scan {
  return { source: 'axe-json', engine: 'axe-core 4.11.0', url, timestamp: `${date}T15:20:00.000Z`, rules };
}

const BASE = 'https://app.quiznest.example';

function current(): Project['screens'] {
  const d = '2026-10-30';
  return [
    {
      id: 'sample-signin',
      name: 'Sign in',
      url: `${BASE}/signin`,
      scan: scan(`${BASE}/signin`, d, [
        rule('autocomplete-valid', 'violation', 1, ['#email']),
        ...passes('label', 'button-name', 'document-title', 'html-has-lang', 'color-contrast', 'meta-viewport', 'link-name', 'image-alt'),
      ]),
    },
    {
      id: 'sample-dashboard',
      name: 'Instructor dashboard',
      url: `${BASE}/courses`,
      scan: scan(`${BASE}/courses`, d, [
        rule('image-alt', 'violation', 2, ['.course-card:nth-child(2) > img', '.course-card:nth-child(5) > img']),
        rule('color-contrast', 'incomplete', 4, ['.hero-banner > h2', '.hero-banner > p']),
        ...passes('link-name', 'button-name', 'document-title', 'html-has-lang', 'bypass', 'list', 'meta-viewport', 'link-in-text-block'),
      ]),
    },
    {
      id: 'sample-editor',
      name: 'Quiz editor',
      url: `${BASE}/quizzes/new`,
      scan: scan(`${BASE}/quizzes/new`, d, [
        rule('button-name', 'violation', 3, ['.q-toolbar > button:nth-child(1)', '.q-toolbar > button:nth-child(2)', '.q-toolbar > button:nth-child(3)']),
        rule('label', 'violation', 1, ['#points-per-question']),
        rule('scrollable-region-focusable', 'violation', 1, ['.question-bank']),
        ...passes('image-alt', 'document-title', 'html-has-lang', 'bypass', 'link-name', 'color-contrast', 'list', 'aria-required-children'),
      ]),
    },
    {
      id: 'sample-player',
      name: 'Student quiz player',
      url: `${BASE}/play/quiz-1042`,
      scan: scan(`${BASE}/play/quiz-1042`, d, [
        rule('color-contrast', 'violation', 5, ['.choice-hint', '.timer-label', '.q-number', '.progress-text', '.skip-link']),
        ...passes('label', 'button-name', 'image-alt', 'document-title', 'html-has-lang', 'bypass', 'video-caption', 'aria-progressbar-name', 'meta-viewport'),
      ]),
    },
  ];
}

const ANSWERS: Record<string, Answer> = {
  '1.1.1': {
    outcome: 'partial',
    note: 'Course card thumbnails uploaded by instructors have no alt text field yet; all interface icons and charts have text alternatives (checked with NVDA 2025.3 and Chrome).',
  },
  '1.2.2': { outcome: 'pass', note: 'All 14 tutorial videos have human-edited captions; instructor-uploaded videos accept a captions file.' },
  '1.3.1': { outcome: 'pass', note: 'Headings, lists, tables and form groups checked on all four screens with the NVDA elements list.' },
  '1.4.3': { outcome: 'pass', note: 'Checked body text and buttons with a contrast checker.' },
  '2.1.1': {
    outcome: 'partial',
    note: 'Reordering questions in the quiz editor needs drag and drop and has no keyboard alternative. Sign-in, dashboard and taking a quiz work with the keyboard alone (Chrome 130, Windows 11).',
  },
  '2.1.2': { outcome: 'pass', note: 'Tabbed into and out of the code question editor, the video player and every dialog on all four screens.' },
  '2.2.1': {
    outcome: 'pass',
    note: 'The session timeout warns two minutes ahead and can be extended. Timed quizzes support per-student time extensions, and instructors can turn the limit off.',
  },
  '2.4.7': { outcome: 'pass', note: 'A visible focus ring appears on every control on all four screens.' },
  '3.3.4': { outcome: 'pass', note: 'Submitting a quiz shows a review page listing unanswered questions and asks for confirmation; deleting a course can be undone for 30 days.' },
};

/** A made-up quiz platform, partly reviewed, so every part of the app has something to show. */
export function sampleProject(): Project {
  return {
    format: 'acr-draft',
    version: 1,
    product: {
      name: 'QuizNest',
      version: '4.2',
      reportDate: '2026-10-30',
      description: 'Web-based quiz and assessment platform for college courses: instructors build quizzes, students take them in the browser, and grades sync to the LMS.',
      contact: 'Accessibility contact, QuizNest (example company), accessibility@quiznest.example',
      notes: 'This report covers the instructor and student web interfaces. The mobile apps are not included.',
      testedWith: 'Chrome 130 and Firefox 132 on Windows 11 with NVDA 2025.3; Safari 18 on macOS with VoiceOver',
    },
    gates: {
      media: 'yes',
      live: 'no',
      timeLimits: 'yes',
      autoAudio: 'no',
      movingContent: 'no',
      shortcuts: 'no',
      gestures: 'no',
      motionInput: 'no',
      forms: 'yes',
      commitments: 'yes',
      otherLanguages: 'no',
    },
    screens: current(),
    answers: { ...ANSWERS },
    savedAt: '2026-10-30T16:00:00.000Z',
  };
}

/** The same product one release earlier, for the "Compare releases" example. */
export function samplePrevious(): Project {
  const p = sampleProject();
  p.product.version = '4.1';
  p.product.reportDate = '2026-07-15';
  p.savedAt = '2026-07-15T16:00:00.000Z';
  const editor = p.screens.find((s) => s.id === 'sample-editor')!;
  editor.scan!.rules = editor.scan!.rules.map((r) => (r.id === 'button-name' ? { ...r, nodes: 6 } : r));
  const dash = p.screens.find((s) => s.id === 'sample-dashboard')!;
  dash.scan!.rules.push(rule('link-name', 'violation', 4, ['.course-card a.more']));
  dash.scan!.rules = dash.scan!.rules.filter((r) => !(r.id === 'link-name' && r.outcome === 'pass'));
  const player = p.screens.find((s) => s.id === 'sample-player')!;
  player.scan!.rules = player.scan!.rules.filter((r) => r.id !== 'color-contrast').concat(passes('color-contrast'));
  p.screens = p.screens.filter((s) => s.id !== 'sample-signin');
  p.answers['2.4.7'] = { outcome: 'partial', note: 'The quiz player hid the focus ring on answer choices.' };
  delete p.answers['3.3.4'];
  return p;
}
