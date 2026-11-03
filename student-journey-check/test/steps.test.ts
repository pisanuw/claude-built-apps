import { describe, expect, it } from 'vitest';
import { CheckError } from '../src/core/http';
import { runStep } from '../src/core/steps';
import { BASE, LOGGED_IN, LOGIN_FORM, ok, site, SITE, status, step, to, wp } from './helpers';

describe('home', () => {
  it('passes a WordPress site and notes when Tutor is not on the home page', async () => {
    const r = (await step('home', site({ '/': ok('<html><head><meta name="generator" content="WordPress 6.9"></head><body>Hi</body></html>') }))).result;
    expect(r.status).toBe('pass');
    expect(r.detail).toContain('Tutor LMS is not visible');
  });
  it('warns when the site is not WordPress', async () => {
    const r = (await step('home', site({ '/': ok('<html><body>Plain</body></html>') }))).result;
    expect(r.status).toBe('warn');
    expect(r.detail).toContain('does not look like a WordPress site');
  });
  it('flags a PHP warning printed on the page', async () => {
    const r = (await step('home', site({ '/': ok(wp('<b>Warning</b>: Undefined array key "x" in /var/www/wp-content/plugins/foo/a.php on line 12')) }))).result;
    expect(r.status).toBe('warn');
    expect(r.evidence).toContain('on line 12');
  });
  it('fails on a security challenge, maintenance, database error and server error', async () => {
    const challenge = (await step('home', site({ '/': ok('<html><head><title>Just a moment...</title></head><body></body></html>') }))).result;
    expect(challenge.headline).toContain('a Cloudflare security check');
    const maint = (await step('home', site({ '/': status(503, '<p>Briefly unavailable for scheduled maintenance. Check back in a minute.</p>') }))).result;
    expect(maint.headline).toContain('Briefly unavailable');
    expect(maint.advice).toContain('.maintenance');
    const db = (await step('home', site({ '/': status(500, '<h1>Error establishing a database connection</h1>') }))).result;
    expect(db.headline).toContain('database connection');
    const fatal = (await step('home', site({ '/': ok(wp('<b>Fatal error</b>: Uncaught Error: Call to undefined function tutor_x() in /a.php:3')) }))).result;
    expect(fatal.headline).toContain('critical error');
    const e500 = (await step('home', site({ '/': status(502, 'Bad gateway') }))).result;
    expect(e500.headline).toContain('HTTP 502');
  });
  it('fails on 403 (naming the CAPTCHA if any) and other 4xx', async () => {
    const r403 = (await step('home', site({ '/': status(403, '<div class="h-captcha"></div>') }))).result;
    expect(r403.headline).toContain('hCaptcha blocked it');
    const r410 = (await step('home', site({ '/': status(410, 'gone') }))).result;
    expect(r410.headline).toContain('HTTP 410');
  });
  it('reports a network failure and an unreadable site address in plain words', async () => {
    const down = (await step('home', async () => {
      throw new CheckError('The site took too long to answer.', 'timeout');
    })).result;
    expect(down.headline).toBe('The site took too long to answer.');
    expect(down.advice).toContain('slow site');
    const net = (await step('home', async () => {
      throw new CheckError('The site did not answer.', 'network');
    })).result;
    expect(net.advice).toContain('Check the address');
    const weird = (await step('home', async () => {
      throw new Error('boom');
    })).result;
    expect(weird.headline).toContain('unexpected problem: boom');
    const thrown = (await step('home', async () => {
      throw 'odd';
    })).result;
    expect(thrown.headline).toContain('odd');
    const bad = (await step('home', site({}), { siteUrl: 'nope' })).result;
    expect(bad.headline).toContain('does not look right');
  });
});

describe('login', () => {
  const loginOk = (req: { headers: Record<string, string>; body?: string }) => {
    const form = new URLSearchParams(req.body);
    expect(req.headers.cookie).toContain('wordpress_test_cookie');
    expect(form.get('testcookie')).toBe('1');
    return form.get('pwd') === 'pw' ? to(`${SITE}/dashboard/`, ['wordpress_logged_in_x=1; path=/']) : ok(wp('<div id="login_error">Unknown username. Check again or try your email address.</div>'));
  };
  it('logs in through wp-login.php and keeps the session', async () => {
    const t = site({ 'GET /wp-login.php': ok(wp(LOGIN_FORM)), 'POST /wp-login.php': loginOk, 'GET /dashboard/': ok(wp('<div class="tutor-dashboard">Hi</div>')) });
    const out = await step('login', t, {}, { cookies: [], loggedIn: false });
    expect(out.result.status).toBe('pass');
    expect(out.state.loggedIn).toBe(true);
    expect(out.state.cookies.map((c) => c.name)).toContain('wordpress_logged_in_x');
  });
  it('explains a wrong username', async () => {
    const t = site({ 'GET /wp-login.php': ok(wp(LOGIN_FORM)), 'POST /wp-login.php': loginOk });
    const r = (await step('login', t, { password: 'bad' }, { cookies: [], loggedIn: false })).result;
    expect(r.headline).toContain('wrong');
    expect(r.evidence).toBe('Unknown username. Check again or try your email address.');
  });
  it('reports other refusals, 2FA, missing forms and silent failures', async () => {
    const other = site({ 'GET /wp-login.php': ok(wp(LOGIN_FORM)), 'POST /wp-login.php': ok(wp('<div id="login_error">Your account is pending approval.</div>')) });
    expect((await step('login', other, {}, { cookies: [], loggedIn: false })).result.headline).toBe('The site refused the test student’s login.');
    const twofa = site({ 'GET /wp-login.php': ok(wp(LOGIN_FORM)), 'POST /wp-login.php': ok(wp('<input name="authcode">')) });
    expect((await step('login', twofa, {}, { cookies: [], loggedIn: false })).result.headline).toContain('second code');
    const noform = site({ 'GET /wp-login.php': ok(wp('<p>Welcome</p>')) });
    expect((await step('login', noform, {}, { cookies: [], loggedIn: false })).result.headline).toContain('no login form');
    const silent = site({ 'GET /wp-login.php': ok(wp(LOGIN_FORM)), 'POST /wp-login.php': ok(wp('<p>Hmm</p>')) });
    expect((await step('login', silent, {}, { cookies: [], loggedIn: false })).result.headline).toContain('did not end up logged in');
    const crash = site({ 'GET /wp-login.php': ok(wp(LOGIN_FORM)), 'POST /wp-login.php': status(500, 'There has been a critical error on this website.') });
    expect((await step('login', crash, {}, { cookies: [], loggedIn: false })).result.headline).toContain('page after login shows a WordPress critical error');
  });
  it('flags a crash right after a successful login', async () => {
    const t = site({
      'GET /wp-login.php': ok(wp(LOGIN_FORM)),
      'POST /wp-login.php': to(`${SITE}/dashboard/`, ['wordpress_logged_in_x=1; path=/']),
      'GET /dashboard/': status(500, 'There has been a critical error on this website.'),
    });
    const out = await step('login', t, {}, { cookies: [], loggedIn: false });
    expect(out.result.status).toBe('fail');
    expect(out.result.headline).toMatch(/^The student logged in, but then the page after login shows/);
    expect(out.state.loggedIn).toBe(true);
  });
  it('handles a moved login page, a CAPTCHA and no password', async () => {
    const moved = (await step('login', site({}), {}, { cookies: [], loggedIn: false })).result;
    expect(moved.headline).toBe('There is no login page at /wp-login.php.');
    const captcha = (await step('login', site({ 'GET /wp-login.php': ok(wp(`${LOGIN_FORM}<div class="cf-turnstile"></div>`)) }), {}, { cookies: [], loggedIn: false })).result;
    expect(captcha.headline).toContain('Cloudflare Turnstile');
    const nopw = (await step('login', site({}), { password: undefined }, { cookies: [], loggedIn: false })).result;
    expect(nopw.status).toBe('skip');
    const broken = (await step('login', site({ 'GET /wp-login.php': status(500, 'oops') }), {}, { cookies: [], loggedIn: false })).result;
    expect(broken.headline).toContain('HTTP 500');
  });
  it('uses a custom login page and its own hidden fields', async () => {
    const form = `<form action="/my-login/" method="post"><input type="email" name="user"><input type="password" name="pass"><input type="hidden" name="_nonce" value="a&amp;b"><input type="hidden" name="redirect_to" value="/x"><input type="submit" name="go" value="Go"></form>`;
    let posted = new URLSearchParams();
    const t = site({
      'GET /my-login/': ok(wp(form)),
      'POST /my-login/': (req) => {
        posted = new URLSearchParams(req.body);
        return to('/x', ['wordpress_logged_in_y=1']);
      },
      'GET /x': ok(wp('fine')),
    });
    const r = (await step('login', t, { loginPath: '/my-login/' }, { cookies: [], loggedIn: false })).result;
    expect(r.status).toBe('pass');
    expect(Object.fromEntries(posted)).toEqual({ _nonce: 'a&b', redirect_to: '/x', go: 'Go', user: 'test.student', pass: 'pw' });
  });
});

describe('dashboard', () => {
  it('fails when the student is sent back to log in', async () => {
    const t = site({ 'GET /dashboard/': to('/wp-login.php?redirect_to=x'), 'GET /wp-login.php': ok(wp(LOGIN_FORM)) });
    expect((await step('dashboard', t)).result.headline).toContain('back to the login page');
  });
  it('fails when a custom login page shows up instead', async () => {
    const t = site({ 'GET /dash/': to('/sign-in/'), 'GET /sign-in/': ok(wp('<p>Members</p>')) });
    expect((await step('dashboard', t, { dashboardPath: '/dash/', loginPath: '/sign-in/' })).result.headline).toContain('back to the login page');
  });
  it('warns about an open dialog, a non-Tutor page and a missing course', async () => {
    const dialog = site({ 'GET /dashboard/': ok(wp('<div class="tutor-dashboard"></div><dialog open><h2>Rate us!</h2></dialog>')) });
    expect((await step('dashboard', dialog)).result.headline).toContain('“Rate us!”');
    const closed = site({ 'GET /dashboard/': ok(wp('<div class="tutor-dashboard">Morning</div><div class="tutor-modal tutor-is-active" style="display: none"><h3>x</h3></div><div class="modal show" hidden></div><div role="dialog" aria-hidden="true"></div>')) });
    expect((await step('dashboard', closed)).result.status).toBe('pass');
    const aria = site({ 'GET /dashboard/': ok(wp('<div class="tutor-dashboard"></div><div role="dialog" aria-modal="true">Cookie choices</div>')) });
    expect((await step('dashboard', aria)).result.headline).toContain('“Cookie choices”');
    const other = site({ 'GET /dashboard/': ok('<html><body>Shop</body></html>') });
    expect((await step('dashboard', other)).result.headline).toContain('does not look like the Tutor LMS student dashboard');
    const missing = site({ 'GET /dashboard/': ok(wp('<div class="tutor-dashboard">Other course</div>')) });
    const r = (await step('dashboard', missing, { courseTitle: 'Yoga Basics' })).result;
    expect(r.status).toBe('warn');
    expect(r.headline).toContain('“Yoga Basics” is not listed');
  });
  it('is skipped when the student is not logged in', async () => {
    expect((await step('dashboard', site({}), {}, { cookies: [], loggedIn: false })).result.status).toBe('skip');
  });
});

describe('course', () => {
  it('passes an enrolled course and remembers the first lesson', async () => {
    const t = site({ 'GET /courses/c/': ok(wp('<h1>Yoga</h1><a href="/courses/c/lesson/one/">1</a><a href="/courses/c/lesson/one/">1 again</a><a href="/courses/c/lesson/two/">2</a> Continue Learning')) });
    const out = await step('course', t, { courseTitle: 'yoga' });
    expect(out.result.headline).toBe('The course page opens and shows the student as enrolled.');
    expect(out.result.detail).toBe('Found 2 lesson links.');
    expect(out.state.lessonUrl).toBe(`${SITE}/courses/c/lesson/one/`);
    expect(out.state.enrolled).toBe(true);
  });
  it('warns when not enrolled or the title is missing, and skips without an address', async () => {
    const t = site({ 'GET /courses/c/': ok(wp('<h1>Yoga</h1><a href="/lessons/x/">x</a> <button>Enroll Now</button>')) });
    expect((await step('course', t)).result.headline).toContain('as if they were not enrolled');
    const logged = site({ 'GET /courses/c/': ok(wp('<h1>Yoga</h1>')) });
    const r = (await step('course', logged, { courseTitle: 'Pilates' })).result;
    expect(r.headline).toContain('“Pilates” is not on it');
    expect((await step('course', site({}), { coursePath: '  ' })).result.status).toBe('skip');
    const one = site({ 'GET /courses/c/': ok(wp('<a href="/lesson/a/">a</a>')) });
    expect((await step('course', one)).result.detail).toBe('Found 1 lesson link.');
    const none = site({ 'GET /courses/c/': ok(wp('<h1>Yoga</h1>')) });
    expect((await step('course', none)).result.detail).toBe('No lesson links were found on the course page.');
  });
  it('runs for a logged-out visitor without judging enrolment', async () => {
    const t = site({ 'GET /courses/c/': ok(wp('<h1>Yoga</h1><button>Enroll Now</button>')) });
    const r = (await step('course', t, {}, { cookies: [], loggedIn: false })).result;
    expect(r.status).toBe('pass');
    expect(r.headline).toBe('The course page opens.');
  });
  it('fails a missing course', async () => {
    const r = (await step('course', site({ 'GET /courses/c/': ok(wp('<h1>Oops! That page can’t be found.</h1>')) }))).result;
    expect(r.headline).toContain('“page not found”');
    expect(r.advice).toContain('Permalinks');
  });
});

describe('lesson', () => {
  const lesson = (body: string, head = '') => site({ 'GET /l/': ok(wp(body, head)) });
  const run = (t: ReturnType<typeof site>) => step('lesson', t, { lessonPath: '/l/' });

  it('passes a lesson with a video and one without', async () => {
    expect((await run(lesson('<iframe src="https://player.vimeo.com/video/123"></iframe><video src="a.mp4"></video>'))).result.headline).toBe(
      'The lesson opens and its Vimeo and uploaded videos are on the page.',
    );
    expect((await run(lesson('<p>Read this</p><iframe src="https://maps.example/x"></iframe>'))).result.headline).toBe('The lesson opens. It has no video.');
  });
  it('catches YouTube Error 153 from a page-wide referrer policy', async () => {
    const r = (await run(lesson('<iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe>', '<meta name="referrer" content="no-referrer">'))).result;
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('Error 153');
  });
  it('catches videos with no ID or no file', async () => {
    const cases = [
      '<iframe src="https://www.youtube.com/embed/"></iframe>',
      '<video><source src=""></video>',
      '<div class="tutor-video-player"></div>',
      '<div data-plyr-provider="youtube"></div>',
      '<div data-plyr-provider="vimeo"></div>',
      '<iframe class="video-embed"></iframe>',
    ];
    for (const c of cases) {
      const r = (await run(lesson(c))).result;
      expect(r.status, c).toBe('fail');
      expect(r.advice, c).toContain('add the video again');
    }
  });
  it('accepts Tutor’s Plyr player with an ID, Wistia and Bunny', async () => {
    const r = (await run(lesson('<div class="tutor-video-player"><div data-plyr-provider="youtube" data-plyr-embed-id="abc"></div></div><iframe data-src="https://fast.wistia.net/embed/iframe/x"></iframe><iframe src="https://iframe.mediadelivery.net/embed/1/2"></iframe>'))).result;
    expect(r.status).toBe('pass');
    expect(r.headline).toBe('The lesson opens and its Wistia, Bunny and YouTube videos are on the page.');
  });
  it('fails on no access and on a login wall', async () => {
    expect((await run(lesson('<div>You have to enroll in this course to see this lesson.</div>'))).result.headline).toContain('no access');
    const wall = site({ 'GET /l/': to('/wp-login.php'), 'GET /wp-login.php': ok(wp(LOGIN_FORM)) });
    expect((await run(wall)).result.headline).toContain('login page');
  });
  it('uses the lesson found on the course page, or skips', async () => {
    const t = site({ 'GET /found/': ok(wp('<p>hello</p>')) });
    expect((await step('lesson', t, {}, { ...LOGGED_IN, lessonUrl: `${SITE}/found/` })).result.status).toBe('pass');
    expect((await step('lesson', t)).result.status).toBe('skip');
    expect((await step('lesson', site({ 'GET /l/': status(404) }), { lessonPath: '/l/' })).result.status).toBe('fail');
  });
});

describe('quiz and certificate', () => {
  it('quiz: passes, warns without a Start button, fails on walls and errors, skips without address', async () => {
    const q = (body: string) => site({ 'GET /q/': ok(wp(body)) });
    expect((await step('quiz', q('<button name="start_quiz_btn">Start Quiz</button>'), { quizPath: '/q/' })).result.status).toBe('pass');
    expect((await step('quiz', q('<p>Nothing</p>'), { quizPath: '/q/' })).result.status).toBe('warn');
    expect((await step('quiz', q('Please enroll in this course to view it'), { quizPath: '/q/' })).result.headline).toContain('no access');
    const wall = site({ 'GET /q/': to('/wp-login.php'), 'GET /wp-login.php': ok(wp(LOGIN_FORM)) });
    expect((await step('quiz', wall, { quizPath: '/q/' })).result.headline).toContain('login page');
    expect((await step('quiz', site({}), { quizPath: '/q/' })).result.status).toBe('fail');
    expect((await step('quiz', site({}))).result.status).toBe('skip');
  });
  it('certificate: passes, warns, fails on nonce and errors, skips without address', async () => {
    const c = (r: ReturnType<typeof ok>) => site({ 'GET /cert/': r });
    expect((await step('certificate', c(ok(wp('<img alt="certificate">'))), { certificatePath: '/cert/' })).result.status).toBe('pass');
    expect((await step('certificate', c(ok('<p>Hi</p>')), { certificatePath: '/cert/' })).result.status).toBe('warn');
    expect((await step('certificate', c(ok(wp('Are you sure you want to do this?'))), { certificatePath: '/cert/' })).result.headline).toContain('Nonce');
    expect((await step('certificate', c(status(500, 'There has been a critical error on this website.')), { certificatePath: '/cert/' })).result.headline).toContain('critical error');
    expect((await step('certificate', site({}))).result.status).toBe('skip');
  });
});

describe('price', () => {
  const priced = (body: string) => site({ 'GET /courses/c/': ok(wp(body)), 'GET /checkout/': ok(wp(body)) });
  it('passes the expected price, as a logged-out visitor', async () => {
    const t = priced('<span class="price">$79.00</span>');
    const r = (await step('price', t, { expectedPrice: '79' })).result;
    expect(r.status).toBe('pass');
    expect(t.log[0].headers.cookie).toBeUndefined();
  });
  it('fails a different price, a missing price and a free course', async () => {
    expect((await step('price', priced('$99.00 or $89.00'), { expectedPrice: '$79' })).result.headline).toBe('New customers see $99.00, $89.00, not the $79 you expect.');
    const none = (await step('price', priced('<button>Enroll</button>'), { expectedPrice: '$79' })).result;
    expect(none.headline).toContain('No price');
    expect(none.detail).toBeUndefined();
    expect((await step('price', priced('This course is Free'), { expectedPrice: '$79' })).result.detail).toContain('free');
  });
  it('reads a separate checkout page and a crossed-out price', async () => {
    const r = (await step('price', priced('<s>€79,00</s> €59,00'), { expectedPrice: '€79,00', pricePath: '/checkout/' })).result;
    expect(r.headline).toBe('Your price €79,00 is crossed out; customers see €59,00 instead.');
    const noNew = (await step('price', priced('<del>$79</del> Free'), { expectedPrice: '$79' })).result;
    expect(noNew.headline).toContain('customers see another price');
  });
  it('skips without a readable expected price, and fails when the page is down', async () => {
    expect((await step('price', priced(''), {})).result.status).toBe('skip');
    expect((await step('price', priced(''), { expectedPrice: 'lots' })).result.headline).toContain('not a price');
    expect((await step('price', site({ 'GET /checkout/': status(500) }), { expectedPrice: '$1', pricePath: '/checkout/' })).result.headline).toContain('checkout page');
  });
});

describe('runStep', () => {
  it('times steps and copies state rather than changing it', async () => {
    let t = 1000;
    const state = { cookies: [{ name: 'a', value: '1', path: '/' }], loggedIn: false };
    const out = await runStep('home', BASE, state, site({ '/': ok(wp('x')) }), () => (t += 250));
    expect(out.result.ms).toBe(250);
    expect(out.state).not.toBe(state);
    expect(out.state.cookies).not.toBe(state.cookies);
  });
});
