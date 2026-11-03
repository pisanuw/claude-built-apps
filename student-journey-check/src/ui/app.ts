import { DEMO_BREAKS, DEMO_CONFIG, demoAcademy, type DemoBreak } from '../core/demo';
import { clearRuns, loadRuns, loadSettings, previousRun, saveRun, saveSettings, type KeyValue } from '../core/history';
import { compareRuns, runJourney, summarize } from '../core/journey';
import { alertEmail, describeChanges, textReport } from '../core/report';
import { runStep, STEP_LABELS, STEP_ORDER } from '../core/steps';
import type { JourneyConfig, JourneyRun, StepResult, StepRunner } from '../core/types';
import { ConfigError, normalizeSiteUrl, shortUrl } from '../core/urls';
import { download, h } from './dom';
import { InputError, remoteRunner } from './remote';

export interface Deps {
  fetchImpl?: typeof fetch;
  storage?: KeyValue | null;
  now?: () => Date;
  copy?: (text: string) => Promise<void>;
  /** Pause between demo steps so the walk is visible. */
  demoDelayMs?: number;
}

export interface App {
  runDemo(breaks: DemoBreak[]): Promise<JourneyRun>;
  runSite(config: JourneyConfig): Promise<JourneyRun | null>;
  readonly runs: JourneyRun[];
}

const STATUS_TEXT: Record<StepResult['status'], string> = { pass: 'Works', warn: 'Look at this', fail: 'Broken', skip: 'Not checked' };
const STATUS_ICON: Record<StepResult['status'], string> = { pass: '✓', warn: '!', fail: '✕', skip: '–' };

type Field = { key: keyof JourneyConfig; label: string; hint?: string; type?: string; required?: boolean; placeholder?: string; autocomplete?: string };

const MAIN_FIELDS: Field[] = [
  { key: 'siteUrl', label: 'Your course site', placeholder: 'https://mycourses.com', required: true, autocomplete: 'url' },
  { key: 'username', label: 'Test student’s username or email', required: true, autocomplete: 'off' },
  { key: 'password', label: 'Test student’s password', type: 'password', required: true, autocomplete: 'off', hint: 'Used for this check only. It is never saved.' },
  { key: 'coursePath', label: 'Course page', placeholder: '/courses/yoga-basics/', required: true, hint: 'The address of one course the test student is enrolled in.' },
  { key: 'courseTitle', label: 'Course title (optional)', placeholder: 'Yoga Basics', hint: 'Checked on the dashboard and course page.' },
  { key: 'expectedPrice', label: 'Price a new customer should see (optional)', placeholder: '$79.00' },
];

const PATH_FIELDS: Field[] = [
  { key: 'loginPath', label: 'Login page', placeholder: '/wp-login.php' },
  { key: 'dashboardPath', label: 'Student dashboard', placeholder: '/dashboard/' },
  { key: 'lessonPath', label: 'A lesson', placeholder: 'First lesson on the course page', hint: 'Leave empty to open the first lesson linked from the course page.' },
  { key: 'quizPath', label: 'A quiz', placeholder: '/courses/yoga-basics/quizzes/week-1/', hint: 'The checker opens the quiz but never starts it.' },
  { key: 'certificatePath', label: 'A certificate', placeholder: '/tutor-certificate/?cert_hash=…', hint: 'From a course the test student completed.' },
  { key: 'pricePath', label: 'Page that shows the price', placeholder: 'The course page', hint: 'Opened as a logged-out visitor.' },
];

function safeStorage(): KeyValue | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mount(root: HTMLElement, deps: Deps = {}): App {
  const storage = deps.storage === undefined ? safeStorage() : deps.storage;
  const fetchImpl = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = deps.now ?? (() => new Date());
  const copy = deps.copy ?? ((t: string) => navigator.clipboard.writeText(t));
  const demoDelay = deps.demoDelayMs ?? 250;
  let runs = loadRuns(storage);
  let busy = false;

  const results = h('section', { class: 'results', 'aria-live': 'polite', id: 'results' });
  const historyBox = h('section', { class: 'history' });

  // ---------- demo ----------
  const breakBoxes = DEMO_BREAKS.map((b) => {
    const box = h('input', { type: 'checkbox', id: `break-${b.id}`, value: b.id });
    return { id: b.id, box, row: h('label', { class: 'break', for: `break-${b.id}` }, box, h('span', {}, h('strong', {}, b.label), h('span', { class: 'hint' }, b.story))) };
  });
  const demoButton = h('button', { type: 'button', class: 'primary' }, 'Walk through the demo course');
  demoButton.addEventListener('click', () => {
    void runDemo(breakBoxes.filter((b) => b.box.checked).map((b) => b.id));
  });
  const demoPanel = h(
    'section',
    { class: 'panel', id: 'panel-demo', role: 'tabpanel', 'aria-labelledby': 'tab-demo' },
    h('p', {}, 'Lotus Yoga Academy is a pretend Tutor LMS course site that lives inside this page. Break something the way real updates broke real course sites this year, then watch the test student run into it.'),
    h('fieldset', { class: 'breaks' }, h('legend', {}, 'Break the demo site'), ...breakBoxes.map((b) => b.row)),
    demoButton,
  );

  // ---------- own site ----------
  const saved = loadSettings(storage);
  const inputs = new Map<keyof JourneyConfig, HTMLInputElement>();
  const fieldEl = (f: Field) => {
    const input = h('input', {
      id: `f-${f.key}`,
      name: f.key,
      type: f.type ?? 'text',
      placeholder: f.placeholder ?? '',
      autocomplete: f.autocomplete ?? 'off',
      required: !!f.required,
      spellcheck: 'false',
      ...(f.hint ? { 'aria-describedby': `h-${f.key}` } : {}),
    });
    input.value = f.key === 'password' ? '' : (saved[f.key] ?? '');
    inputs.set(f.key, input);
    return h('div', { class: 'field' }, h('label', { for: `f-${f.key}` }, f.label), input, f.hint ? h('span', { class: 'hint', id: `h-${f.key}` }, f.hint) : null);
  };
  const consent = h('input', { type: 'checkbox', id: 'f-consent', required: true });
  const formError = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const adminWarning = h('p', { class: 'note warn-note', hidden: true }, 'That looks like an administrator login. Please use a test student account: it can see only what students see, and it is safe to give to a checker.');
  const siteButton = h('button', { type: 'submit', class: 'primary' }, 'Run the check');
  const form = h(
    'form',
    { class: 'site-form', novalidate: true },
    h('div', { class: 'fields' }, ...MAIN_FIELDS.map(fieldEl)),
    adminWarning,
    h('details', { class: 'paths' }, h('summary', {}, 'Page addresses (optional)'), h('p', { class: 'hint' }, 'Tutor LMS defaults are used when these are empty. A full address or just the part after your domain both work.'), h('div', { class: 'fields' }, ...PATH_FIELDS.map(fieldEl))),
    h('label', { class: 'consent', for: 'f-consent' }, consent, h('span', {}, 'This is my site, or I have permission to check it.')),
    formError,
    siteButton,
    h('p', { class: 'hint' }, 'The check runs from our server as your test student and reads each page the way your site sends it. The password is used for the login step and then forgotten. Your settings (never the password) are remembered on this device for next time.'),
  );
  inputs.get('username')?.addEventListener('input', () => {
    adminWarning.hidden = !/^(admin|administrator|webmaster|root)$/i.test(inputs.get('username')?.value.trim() ?? '');
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const config = {} as Record<string, string>;
    for (const [k, input] of inputs) if (input.value.trim()) config[k] = k === 'password' ? input.value : input.value.trim();
    if (!consent.checked) return showError('Please confirm that this is your site or that you have permission to check it.');
    void runSite(config as unknown as JourneyConfig);
  });
  const sitePanel = h(
    'section',
    { class: 'panel', id: 'panel-site', role: 'tabpanel', 'aria-labelledby': 'tab-site', hidden: true },
    h('p', {}, 'Works with Tutor LMS on your own WordPress site. You need a test student: a normal student account, enrolled in one course, that only you use.'),
    form,
    guide(),
  );

  function showError(msg: string): null {
    formError.textContent = msg;
    formError.hidden = false;
    return null;
  }

  // ---------- tabs ----------
  const tabs = [
    { id: 'demo', label: 'Try the demo academy', panel: demoPanel },
    { id: 'site', label: 'Check my site', panel: sitePanel },
  ];
  const tabButtons = tabs.map((t, i) =>
    h('button', { type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': `panel-${t.id}`, 'aria-selected': i === 0 ? 'true' : 'false', tabindex: i === 0 ? '0' : '-1' }, t.label),
  );
  function select(i: number): void {
    tabs.forEach((t, j) => {
      t.panel.hidden = i !== j;
      tabButtons[j].setAttribute('aria-selected', String(i === j));
      tabButtons[j].tabIndex = i === j ? 0 : -1;
    });
  }
  tabButtons.forEach((b, i) => {
    b.addEventListener('click', () => select(i));
    b.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k !== 'ArrowRight' && k !== 'ArrowLeft') return;
      const j = (i + (k === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      select(j);
      tabButtons[j].focus();
    });
  });

  // ---------- running ----------
  function stepItem(r: StepResult): HTMLElement {
    return h(
      'li',
      { class: `step ${r.status}` },
      h('span', { class: 'badge', 'aria-hidden': 'true' }, STATUS_ICON[r.status]),
      h(
        'div',
        { class: 'step-body' },
        h('h4', {}, STEP_LABELS[r.id], ' ', h('span', { class: `tag ${r.status}` }, STATUS_TEXT[r.status])),
        h('p', { class: 'headline' }, r.headline),
        r.detail ? h('p', { class: 'detail' }, r.detail) : null,
        r.evidence ? h('blockquote', {}, h('span', { class: 'visually-hidden' }, 'The page said: '), r.evidence) : null,
        r.advice && r.status !== 'pass' ? h('p', { class: 'advice' }, h('strong', {}, 'What to try: '), r.advice) : null,
        r.url ? h('p', { class: 'where' }, shortUrl(r.url), r.httpStatus ? ` · HTTP ${r.httpStatus}` : '', r.ms >= 50 ? ` · ${(r.ms / 1000).toFixed(1)} s` : '') : null,
      ),
    );
  }

  async function walk(config: JourneyConfig, runner: StepRunner, demo: boolean): Promise<JourneyRun> {
    busy = true;
    demoButton.disabled = siteButton.disabled = true;
    const list = h('ol', { class: 'steps' });
    const pending = STEP_ORDER.map((id) => h('li', { class: 'step waiting' }, h('span', { class: 'badge', 'aria-hidden': 'true' }, '…'), h('div', { class: 'step-body' }, h('h4', {}, STEP_LABELS[id]), h('p', { class: 'hint' }, 'Waiting…'))));
    list.append(...pending);
    results.replaceChildren(h('h2', {}, demo ? 'Walking the demo course…' : `Checking ${new URL(config.siteUrl).host}…`), list);
    results.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    try {
      const run = await runJourney(config, runner, {
        demo,
        now,
        onStep: (r, i) => pending[i].replaceWith(stepItem(r)),
      });
      const before = previousRun(runs, run);
      runs = saveRun(storage, run);
      showRun(run, before);
      renderHistory();
      return run;
    } finally {
      busy = false;
      demoButton.disabled = siteButton.disabled = false;
    }
  }

  async function runDemo(breaks: DemoBreak[]): Promise<JourneyRun> {
    const transport = demoAcademy(breaks);
    const runner: StepRunner = async (step, c, s) => {
      if (demoDelay) await sleep(demoDelay);
      return runStep(step, c, s, transport);
    };
    return walk(DEMO_CONFIG, runner, true);
  }

  async function runSite(config: JourneyConfig): Promise<JourneyRun | null> {
    if (busy) return null;
    formError.hidden = true;
    try {
      config.siteUrl = normalizeSiteUrl(config.siteUrl ?? '');
    } catch (e) {
      return showError((e as ConfigError).message);
    }
    if (!config.username) return showError('Enter the test student’s username or email.');
    if (!config.password) return showError('Enter the test student’s password.');
    if (!config.coursePath) return showError('Enter the address of a course the test student is enrolled in.');
    saveSettings(storage, config);
    try {
      return await walk(config, remoteRunner(fetchImpl), false);
    } catch (e) {
      results.replaceChildren();
      if (e instanceof InputError) return showError(e.message);
      throw e;
    }
  }

  function showRun(run: JourneyRun, before?: JourneyRun): void {
    const s = summarize(run);
    const mail = alertEmail(run, before);
    const mailBox = h('pre', { class: 'mail' }, `Subject: ${mail.subject}\n\n${mail.body}`);
    const copyButton = h('button', { type: 'button' }, 'Copy alert email');
    copyButton.addEventListener('click', () => {
      copy(`Subject: ${mail.subject}\n\n${mail.body}`).then(
        () => (copyButton.textContent = 'Copied'),
        () => (copyButton.textContent = 'Copy failed: select the text instead'),
      );
    });
    const saveButton = h('button', { type: 'button' }, 'Download report');
    saveButton.addEventListener('click', () => download(`student-journey-${new URL(run.siteUrl).host}-${run.finishedAt.slice(0, 10)}.txt`, textReport(run), 'text/plain'));
    const changes = before ? describeChanges(compareRuns(before, run)) : [];
    const parts: Array<Node | null> = [
      h('h2', {}, run.demo ? 'Demo academy result' : `Result for ${new URL(run.siteUrl).host}`),
      h('div', { class: `summary ${s.tone}` }, h('p', { class: 'big' }, s.headline), h('p', {}, `${s.passed} working · ${s.warnings} to look at · ${s.failures} broken · ${s.skipped} not checked`)),
      changes.length ? h('div', { class: 'changes' }, h('h3', {}, 'Since your last check'), h('ul', {}, ...changes.map((c) => h('li', {}, c)))) : null,
      h('ol', { class: 'steps' }, ...run.results.map(stepItem)),
      h('div', { class: 'actions' }, copyButton, saveButton),
      h('details', { class: 'mail-box' }, h('summary', {}, 'The alert email this check would send'), mailBox),
    ];
    results.replaceChildren(...parts.filter((p): p is Node => p !== null));
  }

  function renderHistory(): void {
    if (!runs.length) {
      historyBox.replaceChildren();
      return;
    }
    const clear = h('button', { type: 'button', class: 'link' }, 'Clear history');
    clear.addEventListener('click', () => {
      clearRuns(storage);
      runs = [];
      renderHistory();
    });
    historyBox.replaceChildren(
      h('h2', {}, 'Earlier checks on this device'),
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'When'), h('th', { scope: 'col' }, 'Site'), h('th', { scope: 'col' }, 'Result'))),
        h(
          'tbody',
          {},
          ...runs.slice(0, 10).map((r) =>
            h('tr', {}, h('td', {}, new Date(r.finishedAt).toLocaleString()), h('td', {}, r.demo ? 'Demo academy' : new URL(r.siteUrl).host), h('td', { class: summarize(r).tone }, summarize(r).headline)),
          ),
        ),
      ),
      clear,
    );
  }

  root.replaceChildren(
    h(
      'header',
      {},
      h('h1', {}, 'Student Journey Check'),
      h('p', { class: 'lede' }, 'A test student walks through your online course the way your real students do: log in, open the dashboard, a lesson and its video, a quiz, a certificate, and the price new customers see. You get a plain answer to one question: can my students still get in?'),
      h('p', { class: 'for' }, 'For coaches, tutors and small academies who sell courses from their own WordPress site with Tutor LMS. Run it right after every plugin update.'),
    ),
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Choose what to check' }, ...tabButtons),
    demoPanel,
    sitePanel,
    results,
    historyBox,
    limits(),
  );
  renderHistory();

  return {
    runDemo,
    runSite,
    get runs() {
      return runs;
    },
  };
}

function guide(): HTMLElement {
  return h(
    'details',
    { class: 'guide' },
    h('summary', {}, 'Set up a test student (3 minutes)'),
    h(
      'ol',
      {},
      h('li', {}, 'In WordPress, go to Users → Add New. Give it an email you own and the role ', h('strong', {}, 'Subscriber'), ' (or Tutor’s student role). Never use an administrator account.'),
      h('li', {}, 'Enroll it in one course: Tutor LMS → Students, or buy the course once with a 100% coupon.'),
      h('li', {}, 'Optional: finish that course as the test student so it has a certificate, and copy the certificate’s address.'),
      h('li', {}, 'If your login page has a CAPTCHA or two-factor login, turn them off for this one account. It can only see what students see.'),
      h('li', {}, 'Keep the test student out of leaderboards and reports if your theme shows them.'),
    ),
  );
}

function limits(): HTMLElement {
  return h(
    'section',
    { class: 'limits' },
    h('h2', {}, 'What this check cannot see'),
    h(
      'ul',
      {},
      h('li', {}, 'It reads each page the way your server sends it. It does not run the page’s scripts, so a problem that only appears after the page loads (a broken button, a popup added by a script) can be missed.'),
      h('li', {}, 'It checks that the video is on the lesson and set up correctly, not that it actually plays. A video deleted on YouTube or Vimeo still looks fine here.'),
      h('li', {}, 'It opens the quiz but never takes it, so your quiz reports stay clean, and it cannot tell whether results show after an attempt.'),
      h('li', {}, 'It runs when you press the button. Daily checks with an email alert are not part of this version: run it after every update, and keep the alert email for whoever looks after your site.'),
      h('li', {}, 'It knows Tutor LMS’s standard pages. Heavily customized themes or page builders may need the page addresses filled in.'),
    ),
  );
}
