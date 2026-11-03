import { CheckError, Session, type Page, type Transport } from './http';
import {
  enrolmentState,
  excerpt,
  findAccessDenied,
  findCaptcha,
  findLessonLinks,
  findLoginError,
  findLoginForm,
  findNonceError,
  findOpenPopup,
  findPhpWarning,
  findSecondFactor,
  findSiteError,
  findVideos,
  hasTutorMarkup,
  isWordPress,
  looksNotFound,
  priceText,
  readPage,
  type Doc,
} from './html';
import { findPrices, parseExpectedPrice, samePrice } from './price';
import type { JourneyConfig, JourneyState, StepId, StepOutcome, StepResult, StepStatus } from './types';
import { ConfigError, DEFAULT_DASHBOARD_PATH, DEFAULT_LOGIN_PATH, normalizeSiteUrl, resolveOnSite, shortUrl } from './urls';

export const STEP_ORDER: StepId[] = ['home', 'login', 'dashboard', 'course', 'lesson', 'quiz', 'certificate', 'price'];

export const STEP_LABELS: Record<StepId, string> = {
  home: 'Your site opens',
  login: 'Student can log in',
  dashboard: 'Student dashboard',
  course: 'Course page',
  lesson: 'Lesson and video',
  quiz: 'Quiz page',
  certificate: 'Certificate page',
  price: 'Price at checkout',
};

/** Steps that only make sense once the test student is logged in. */
export const NEEDS_LOGIN: ReadonlySet<StepId> = new Set(['dashboard', 'lesson', 'quiz', 'certificate']);

type Draft = Omit<StepResult, 'id' | 'ms'>;

function result(status: StepStatus, headline: string, extra: Partial<Draft> = {}): Draft {
  return { status, headline, ...extra };
}

interface Ctx {
  config: JourneyConfig;
  site: string;
  session: Session;
  transport: Transport;
  state: JourneyState;
}

/** Problems every logged-in page can have. Returns null when the page is fine so far. */
function commonProblems(page: Page, doc: Doc, what: string): Draft | null {
  const at = { url: page.url, httpStatus: page.status };
  const err = findSiteError(doc);
  if (err) {
    const headline =
      err.kind === 'maintenance'
        ? `The ${what} shows "Briefly unavailable for scheduled maintenance". An update did not finish.`
        : err.kind === 'database'
          ? `The ${what} shows "Error establishing a database connection". Nobody can use the site.`
          : `The ${what} shows a WordPress critical error instead of the page.`;
    return result('fail', headline, {
      ...at,
      evidence: err.evidence,
      advice:
        err.kind === 'maintenance'
          ? 'Delete the .maintenance file in your WordPress folder (your host’s file manager can do it), then run the update again.'
          : 'This often starts right after a plugin or theme update. Your host’s error log names the plugin; rolling it back to the previous version usually fixes it.',
    });
  }
  if (page.status >= 500) {
    return result('fail', `The ${what} answered with a server error (HTTP ${page.status}).`, {
      ...at,
      evidence: excerpt(doc.text),
      advice: 'Check your host’s error log; a recent plugin update is the usual cause.',
    });
  }
  if (page.status === 404 || looksNotFound(doc)) {
    return result('fail', `The ${what} is not found (${page.status === 404 ? 'HTTP 404' : '“page not found”'}).`, {
      ...at,
      advice: 'Check the address under “Page addresses”. If it used to work, an update may have reset your permalinks: open Settings → Permalinks and press Save.',
    });
  }
  if (page.status === 401 || page.status === 403) {
    const captcha = findCaptcha(doc);
    return result('fail', `The ${what} refused the test student (HTTP ${page.status})${captcha ? `: ${captcha} blocked it` : ''}.`, {
      ...at,
      evidence: excerpt(doc.text),
      advice: 'A security plugin or firewall may be blocking the checker. Allow the test student’s account or turn off the challenge for logged-in users.',
    });
  }
  if (page.status >= 400) {
    return result('fail', `The ${what} answered with an error (HTTP ${page.status}).`, { ...at, evidence: excerpt(doc.text) });
  }
  return null;
}

function loginWall(page: Page, doc: Doc, ctx: Ctx): boolean {
  const login = ctx.config.loginPath ? resolveOnSite(ctx.site, ctx.config.loginPath) : '';
  return (
    /\/wp-login\.php/i.test(page.url) ||
    (login !== '' && page.url.split('?')[0] === login.split('?')[0]) ||
    (findLoginForm(doc, page.url) !== null && !/tutor-dashboard|logout|log out/i.test(doc.html))
  );
}

async function home(ctx: Ctx): Promise<Draft> {
  const page = await ctx.session.get(ctx.site + '/');
  const doc = readPage(page.html);
  const problem = commonProblems(page, doc, 'home page');
  if (problem) return problem;
  const captcha = findCaptcha(doc);
  if (captcha) {
    return result('fail', `Your home page shows ${captcha} before anything else, so the checker cannot get in.`, {
      url: page.url,
      httpStatus: page.status,
      advice: 'Lower the firewall’s challenge level, or allow the checker, so it can see what students see.',
    });
  }
  const notes: string[] = [];
  if (!isWordPress(doc)) notes.push('It does not look like a WordPress site; the later steps expect WordPress with Tutor LMS.');
  else if (!hasTutorMarkup(doc)) notes.push('Tutor LMS is not visible on the home page. That is fine if courses live on other pages.');
  const warning = findPhpWarning(doc);
  if (warning) {
    return result('warn', 'Your site opens, but a PHP warning is printed on the page for visitors to see.', {
      url: page.url,
      httpStatus: page.status,
      evidence: warning,
      advice: 'Turn off WP_DEBUG_DISPLAY in wp-config.php, and check which plugin the warning names.',
    });
  }
  return result(notes.length && !isWordPress(doc) ? 'warn' : 'pass', 'Your site opens for visitors.', {
    url: page.url,
    httpStatus: page.status,
    detail: notes.join(' ') || undefined,
  });
}

async function login(ctx: Ctx): Promise<Draft> {
  const loginUrl = resolveOnSite(ctx.site, ctx.config.loginPath || DEFAULT_LOGIN_PATH);
  if (!ctx.config.password) return result('skip', 'No password was given, so the login was not tried.');
  const page = await ctx.session.get(loginUrl);
  const doc = readPage(page.html);
  const problem = commonProblems(page, doc, 'login page');
  if (problem) {
    if (page.status === 404 || looksNotFound(doc)) {
      problem.headline = `There is no login page at ${shortUrl(loginUrl)}.`;
      problem.advice = 'If a security plugin moved your login page (for example to /my-login), type its address under “Page addresses”.';
    }
    return problem;
  }
  const captcha = findCaptcha(doc);
  if (captcha) {
    return result('fail', `The login page asks for ${captcha}, which an automatic check cannot answer.`, {
      url: page.url,
      httpStatus: page.status,
      advice: 'Students can still log in. To let the checker in, exclude the test student’s account or the login page from the CAPTCHA in your security plugin.',
    });
  }
  const form = findLoginForm(doc, page.url);
  if (!form) {
    return result('fail', 'The login page opened, but it has no login form on it.', {
      url: page.url,
      httpStatus: page.status,
      evidence: excerpt(doc.text),
      advice: 'A theme or plugin update may have broken the login page. Open it yourself in a private window to see what students see.',
    });
  }
  ctx.session.setCookie({ name: 'wordpress_test_cookie', value: 'WP%20Cookie%20check', path: '/' });
  const dashboard = resolveOnSite(ctx.site, ctx.config.dashboardPath || DEFAULT_DASHBOARD_PATH);
  const fields: Record<string, string> = {
    ...form.fields,
    [form.userField]: ctx.config.username,
    [form.passField]: ctx.config.password,
  };
  if (!('redirect_to' in fields)) fields.redirect_to = dashboard;
  if (!('testcookie' in fields) && /wp-login\.php/.test(form.action)) fields.testcookie = '1';
  const after = await ctx.session.post(form.action, fields, page.url);
  const afterDoc = readPage(after.html);
  const loggedIn = ctx.session.hasCookie('wordpress_logged_in_');
  if (loggedIn) {
    ctx.state.loggedIn = true;
    const problem2 = commonProblems(after, afterDoc, 'page after login');
    if (problem2) {
      problem2.headline = `The student logged in, but then ${problem2.headline.charAt(0).toLowerCase()}${problem2.headline.slice(1)}`;
      return problem2;
    }
    return result('pass', 'The test student logged in.', { url: after.url, httpStatus: after.status });
  }
  if (findSecondFactor(afterDoc)) {
    return result('fail', 'The login asks for a second code (two-factor login), which the checker cannot type.', {
      url: after.url,
      advice: 'Turn off two-factor login for the test student only. It is a low-privilege account, so this is safe.',
    });
  }
  const message = findLoginError(afterDoc);
  if (message) {
    const wrongPassword = /incorrect|not registered|unknown (?:username|email)|invalid/i.test(message);
    return result('fail', wrongPassword ? 'The site says the test student’s username or password is wrong.' : 'The site refused the test student’s login.', {
      url: after.url,
      httpStatus: after.status,
      evidence: message,
      advice: wrongPassword
        ? 'Check the test student’s details. If they are right, an update may have broken logins: try logging in yourself in a private window.'
        : undefined,
    });
  }
  const problem3 = commonProblems(after, afterDoc, 'page after login');
  if (problem3) return problem3;
  return result('fail', 'The login form was sent, but the student did not end up logged in.', {
    url: after.url,
    httpStatus: after.status,
    evidence: excerpt(afterDoc.text),
    advice: 'Log in yourself as the test student in a private window. If it works for you, a security plugin may be blocking automatic logins.',
  });
}

async function dashboard(ctx: Ctx): Promise<Draft> {
  const url = resolveOnSite(ctx.site, ctx.config.dashboardPath || DEFAULT_DASHBOARD_PATH);
  const page = await ctx.session.get(url);
  const doc = readPage(page.html);
  const problem = commonProblems(page, doc, 'student dashboard');
  if (problem) return problem;
  if (loginWall(page, doc, ctx)) {
    return result('fail', 'The dashboard sends the logged-in student back to the login page.', {
      url: page.url,
      httpStatus: page.status,
      advice: 'The login is not being remembered. A caching plugin serving logged-out pages, or a changed site address, are the usual causes.',
    });
  }
  const popup = findOpenPopup(doc);
  if (popup) {
    return result('warn', `A popup is already open when the dashboard loads (“${popup}”). If its buttons do not work, students are stuck behind it.`, {
      url: page.url,
      httpStatus: page.status,
      advice: 'Open the dashboard as the test student and try to close the popup. After Tutor LMS 4.1.1 a stuck welcome popup blocked dashboards on some sites.',
    });
  }
  if (!/tutor-dashboard/i.test(doc.html)) {
    return result('warn', 'A page opened, but it does not look like the Tutor LMS student dashboard.', {
      url: page.url,
      httpStatus: page.status,
      evidence: excerpt(doc.text),
      advice: 'If your dashboard lives at another address, type it under “Page addresses”.',
    });
  }
  const title = ctx.config.courseTitle?.trim();
  if (title && !doc.text.toLowerCase().includes(title.toLowerCase())) {
    return result('warn', `The dashboard opened, but “${title}” is not listed on it.`, {
      url: page.url,
      httpStatus: page.status,
      advice: 'Check that the test student is still enrolled in the course (Tutor LMS → Students).',
    });
  }
  return result('pass', 'The student dashboard opens.', { url: page.url, httpStatus: page.status });
}

async function course(ctx: Ctx): Promise<Draft> {
  if (!ctx.config.coursePath.trim()) return result('skip', 'No course page was given.');
  const page = await ctx.session.get(resolveOnSite(ctx.site, ctx.config.coursePath));
  const doc = readPage(page.html);
  const problem = commonProblems(page, doc, 'course page');
  if (problem) return problem;
  const lessons = findLessonLinks(doc, page.url);
  ctx.state.lessonUrl = lessons[0];
  const enrol = ctx.state.loggedIn ? enrolmentState(doc) : 'unknown';
  ctx.state.enrolled = enrol === 'enrolled';
  const at = { url: page.url, httpStatus: page.status };
  if (enrol === 'not-enrolled') {
    return result('warn', 'The course page opens, but it offers the test student “Enroll” or “Buy”, as if they were not enrolled.', {
      ...at,
      advice: 'If the test student should be enrolled, a paid student may have lost access too. Check Tutor LMS → Students and recent orders.',
    });
  }
  const title = ctx.config.courseTitle?.trim();
  if (title && !doc.text.toLowerCase().includes(title.toLowerCase())) {
    return result('warn', `The page opens, but the course title “${title}” is not on it.`, {
      ...at,
      advice: 'Check the course page address under “Page addresses”.',
    });
  }
  return result('pass', enrol === 'enrolled' ? 'The course page opens and shows the student as enrolled.' : 'The course page opens.', {
    ...at,
    detail: lessons.length ? `Found ${lessons.length} lesson link${lessons.length === 1 ? '' : 's'}.` : 'No lesson links were found on the course page.',
  });
}

async function lesson(ctx: Ctx): Promise<Draft> {
  const target = ctx.config.lessonPath?.trim() ? resolveOnSite(ctx.site, ctx.config.lessonPath) : ctx.state.lessonUrl;
  if (!target) {
    return result('skip', 'No lesson to open: the course page had no lesson links and no lesson address was given.', {
      advice: 'Type one lesson’s address under “Page addresses” to check it.',
    });
  }
  const page = await ctx.session.get(target);
  const doc = readPage(page.html);
  const problem = commonProblems(page, doc, 'lesson');
  if (problem) return problem;
  const at = { url: page.url, httpStatus: page.status };
  if (loginWall(page, doc, ctx)) {
    return result('fail', 'The lesson sends the logged-in student to the login page.', at);
  }
  const denied = findAccessDenied(doc);
  if (denied) {
    return result('fail', 'The lesson tells the test student they have no access to it.', {
      ...at,
      evidence: denied,
      advice: 'Students who paid may be locked out too. Check the student’s enrolment, and the course’s content drip or prerequisite settings.',
    });
  }
  const videos = findVideos(doc);
  const broken = videos.find((v) => v.problem);
  if (broken) {
    return result('fail', 'The lesson opens, but its video will not play.', {
      ...at,
      detail: broken.problem,
      advice:
        broken.provider === 'youtube' && /153/.test(broken.problem ?? '')
          ? 'Remove the no-referrer setting (it is often added by a security or privacy plugin), or switch the lesson to a Vimeo or uploaded video.'
          : 'Edit the lesson in Tutor LMS and add the video again.',
    });
  }
  if (!videos.length) {
    return result('pass', 'The lesson opens. It has no video.', { ...at, detail: 'If this lesson should have a video, it is missing from the page.' });
  }
  const names = [...new Set(videos.map((v) => ({ youtube: 'YouTube', vimeo: 'Vimeo', wistia: 'Wistia', bunny: 'Bunny', html5: 'uploaded', other: 'embedded' })[v.provider]))];
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return result('pass', `The lesson opens and its ${list} video${videos.length > 1 ? 's are' : ' is'} on the page.`, {
    ...at,
    detail: 'The checker reads the page, not the video itself: a video the provider removed would still look fine here.',
  });
}

async function quiz(ctx: Ctx): Promise<Draft> {
  if (!ctx.config.quizPath?.trim()) return result('skip', 'No quiz address was given.');
  const page = await ctx.session.get(resolveOnSite(ctx.site, ctx.config.quizPath));
  const doc = readPage(page.html);
  const problem = commonProblems(page, doc, 'quiz page');
  if (problem) return problem;
  const at = { url: page.url, httpStatus: page.status };
  if (loginWall(page, doc, ctx)) return result('fail', 'The quiz sends the logged-in student to the login page.', at);
  const denied = findAccessDenied(doc);
  if (denied) return result('fail', 'The quiz tells the test student they have no access to it.', { ...at, evidence: denied });
  if (!/start[_-]quiz|tutor-quiz|Start Quiz|quiz-attempt|tutor-start-quiz/i.test(doc.html)) {
    return result('warn', 'A page opened, but there is no “Start Quiz” button on it.', { ...at, evidence: excerpt(doc.text) });
  }
  return result('pass', 'The quiz page opens with its Start button.', {
    ...at,
    detail: 'The checker does not take the quiz, so your quiz reports stay clean. It cannot see whether the results page works after an attempt.',
  });
}

async function certificate(ctx: Ctx): Promise<Draft> {
  if (!ctx.config.certificatePath?.trim()) return result('skip', 'No certificate address was given.');
  const page = await ctx.session.get(resolveOnSite(ctx.site, ctx.config.certificatePath));
  const doc = readPage(page.html);
  const nonce = findNonceError(doc);
  if (nonce) {
    return result('fail', 'The certificate page shows a security error (“Nonce not matched”) instead of the certificate.', {
      url: page.url,
      httpStatus: page.status,
      evidence: nonce,
      advice: 'After Tutor LMS 4.x updates, the Certificate Builder add-on showed this error on some sites. Update the add-on, then clear your page cache.',
    });
  }
  const problem = commonProblems(page, doc, 'certificate page');
  if (problem) return problem;
  if (!/certificate/i.test(doc.html)) {
    return result('warn', 'A page opened, but it does not look like a certificate.', { url: page.url, httpStatus: page.status, evidence: excerpt(doc.text) });
  }
  return result('pass', 'The certificate page opens.', { url: page.url, httpStatus: page.status });
}

async function price(ctx: Ctx): Promise<Draft> {
  const raw = ctx.config.expectedPrice?.trim() ?? '';
  if (!raw) return result('skip', 'No expected price was given.');
  const expected = parseExpectedPrice(raw);
  if (!expected) return result('skip', `“${raw}” is not a price the checker can read. Try something like $79 or 79.00.`);
  const path = ctx.config.pricePath?.trim() || ctx.config.coursePath;
  // A logged-out visitor sees the price a new customer sees.
  const visitor = new Session(ctx.transport, ctx.site);
  const page = await visitor.get(resolveOnSite(ctx.site, path));
  const doc = readPage(page.html);
  const problem = commonProblems(page, doc, ctx.config.pricePath ? 'checkout page' : 'course page');
  if (problem) return problem;
  const { current, old } = priceText(doc);
  const shown = findPrices(current);
  const struck = findPrices(old);
  const at = { url: page.url, httpStatus: page.status };
  if (shown.some((p) => samePrice(p, expected))) {
    return result('pass', `New customers see the price you expect (${expected.raw}).`, at);
  }
  if (struck.some((p) => samePrice(p, expected))) {
    return result('fail', `Your price ${expected.raw} is crossed out; customers see ${shown[0]?.raw ?? 'another price'} instead.`, {
      ...at,
      advice: 'A sale price may have been left on, or an update changed it. Check the course’s pricing settings.',
    });
  }
  if (!shown.length) {
    return result('fail', 'No price is shown to new customers on this page.', {
      ...at,
      detail: /\bfree\b/i.test(current) ? 'The page says the course is free.' : undefined,
      advice: 'The course may have switched to free, or the price box failed to load. Open the page logged out to check.',
    });
  }
  const list = [...new Set(shown.map((p) => p.raw))].slice(0, 3).join(', ');
  return result('fail', `New customers see ${list}, not the ${expected.raw} you expect.`, {
    ...at,
    advice: 'If you did not change the price, check the course settings and any currency or tax plugin you updated recently.',
  });
}

const RUNNERS: Record<StepId, (ctx: Ctx) => Promise<Draft>> = { home, login, dashboard, course, lesson, quiz, certificate, price };

function plainError(e: unknown): Draft {
  if (e instanceof CheckError) {
    return result('fail', e.message, {
      advice:
        e.kind === 'timeout'
          ? 'A slow site loses students too. Try again; if it keeps happening, ask your host why.'
          : e.kind === 'network'
            ? 'Check the address, and open the site yourself to see whether it is up.'
            : undefined,
    });
  }
  if (e instanceof ConfigError) return result('fail', e.message);
  return result('fail', `The checker hit an unexpected problem: ${e instanceof Error ? e.message : String(e)}`);
}

/**
 * Run one step of the student journey. The same code runs in the browser for
 * the demo academy and on the server for a real site; only the transport differs.
 */
export async function runStep(step: StepId, config: JourneyConfig, state: JourneyState, transport: Transport, now: () => number = Date.now): Promise<StepOutcome> {
  const started = now();
  const next: JourneyState = { ...state, cookies: state.cookies.map((c) => ({ ...c })) };
  let draft: Draft;
  try {
    const site = normalizeSiteUrl(config.siteUrl);
    if (NEEDS_LOGIN.has(step) && !next.loggedIn) {
      draft = result('skip', 'Not checked, because the test student is not logged in.');
    } else {
      const session = new Session(transport, site, next.cookies);
      draft = await RUNNERS[step]({ config, site, session, transport, state: next });
      next.cookies = session.cookies;
    }
  } catch (e) {
    draft = plainError(e);
  }
  return { result: { id: step, ms: Math.max(0, Math.round(now() - started)), ...draft }, state: next };
}
