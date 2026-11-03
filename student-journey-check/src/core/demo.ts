import type { RawRequest, RawResponse, Transport } from './http';
import type { JourneyConfig } from './types';

/**
 * Lotus Yoga Academy: a pretend Tutor LMS course site that lives in the page.
 * The demo runs the real checker against it, and each switch breaks the site
 * the way a real update broke real course sites in 2026.
 */
export type DemoBreak = 'critical' | 'popup' | 'cache' | 'unenrolled' | 'video' | 'nonce' | 'sale';

export const DEMO_BREAKS: Array<{ id: DemoBreak; label: string; story: string }> = [
  { id: 'critical', label: 'A plugin update crashes the login page', story: 'After an update, the login page shows “There has been a critical error on this website”.' },
  { id: 'cache', label: 'A caching plugin forgets who is logged in', story: 'The dashboard is served from a logged-out cache, so students land back on the login page.' },
  { id: 'popup', label: 'A welcome popup covers the dashboard', story: 'An onboarding popup opens on every dashboard visit and its buttons do nothing.' },
  { id: 'unenrolled', label: 'The test student loses their enrolment', story: 'An order sync glitch removes the enrolment, so lessons say “please enroll”.' },
  { id: 'video', label: 'Lesson videos show YouTube Error 153', story: 'A privacy plugin adds referrerpolicy="no-referrer" to video embeds; YouTube refuses to play.' },
  { id: 'nonce', label: 'The certificate page says “Nonce not matched”', story: 'After a Tutor 4.x update, the certificate add-on fails its security check for everyone.' },
  { id: 'sale', label: 'A sale price was left on', story: 'Last month’s $39 promotion is still running, so new customers pay half price.' },
];

export const DEMO_HOST = 'lotus-yoga-academy.example';
const SITE = `https://${DEMO_HOST}`;
const USER = 'maya.test';
const PASS = 'stretch-daily-7';
const SESSION = 'wordpress_logged_in_5f1a9c=maya.test%7C1767225600%7Cdemo';

export const DEMO_CONFIG: JourneyConfig = {
  siteUrl: SITE,
  username: USER,
  password: PASS,
  coursePath: '/courses/morning-flow/',
  courseTitle: 'Morning Flow',
  quizPath: '/courses/morning-flow/quizzes/week-1-check-in/',
  certificatePath: '/tutor-certificate/?cert_hash=8c41e0d2a7',
  expectedPrice: '$79.00',
};

function page(title: string, body: string, extraHead = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} – Lotus Yoga Academy</title>
<meta name="generator" content="WordPress 6.9">
<link rel="stylesheet" href="${SITE}/wp-content/plugins/tutor/assets/css/tutor.min.css">${extraHead}</head>
<body class="wp-theme-lotus"><header><a href="/">Lotus Yoga Academy</a> <nav><a href="/courses/">Courses</a> <a href="/dashboard/">My learning</a></nav></header>
<main>${body}</main><footer>© Lotus Yoga Academy</footer><script src="${SITE}/wp-content/plugins/tutor/assets/js/tutor.min.js"></script></body></html>`;
}

const CRITICAL = `<!doctype html><html><head><title>WordPress › Error</title></head><body id="error-page"><div class="wp-die-message"><p>There has been a critical error on this website.</p><p><a href="https://wordpress.org/documentation/article/faq-troubleshooting/">Learn more about troubleshooting WordPress.</a></p></div></body></html>`;

function loginPage(error = ''): string {
  return page(
    'Log In',
    `${error ? `<div id="login_error"><strong>Error:</strong> ${error} <a href="/wp-login.php?action=lostpassword">Lost your password?</a></div>` : ''}
<form name="loginform" id="loginform" action="${SITE}/wp-login.php" method="post">
<label for="user_login">Username or Email Address</label><input type="text" name="log" id="user_login">
<label for="user_pass">Password</label><input type="password" name="pwd" id="user_pass">
<input name="rememberme" type="checkbox" id="rememberme" value="forever">
<input type="submit" name="wp-submit" id="wp-submit" value="Log In">
<input type="hidden" name="redirect_to" value="${SITE}/dashboard/"><input type="hidden" name="testcookie" value="1"></form>`,
  );
}

function html(status: number, text: string, setCookies: string[] = []): RawResponse {
  return { status, headers: { 'content-type': 'text/html; charset=UTF-8' }, setCookies, text };
}

function redirect(to: string, setCookies: string[] = []): RawResponse {
  return { status: 302, headers: { location: to }, setCookies, text: '' };
}

const LESSONS = [
  ['day-1-breathing', 'Day 1: Breathing into the day', 'kX9pQ2rLw0s'],
  ['day-2-sun-salutation', 'Day 2: A slow sun salutation', 'Rb7mT4nVz1e'],
];

export function demoAcademy(breaks: Iterable<DemoBreak> = []): Transport {
  const on = new Set(breaks);
  return async (req: RawRequest): Promise<RawResponse> => {
    const url = new URL(req.url);
    const path = url.pathname;
    const loggedIn = (req.headers.cookie ?? '').includes('wordpress_logged_in_5f1a9c=');
    const enrolled = loggedIn && !on.has('unenrolled');

    if (path === '/' ) {
      return html(200, page('Home', `<h1>Yoga that fits a busy morning</h1><p>Thirty days, thirty minutes. Start any time.</p><a class="tutor-btn" href="/courses/morning-flow/">See the course</a>`));
    }
    if (path === '/wp-login.php') {
      if (on.has('critical')) return html(500, CRITICAL);
      if (req.method === 'GET') return html(200, loginPage());
      const form = new URLSearchParams(req.body ?? '');
      if (!(req.headers.cookie ?? '').includes('wordpress_test_cookie')) {
        return html(200, loginPage('Cookies are blocked or not supported by your browser.'));
      }
      if (form.get('log') !== USER || form.get('pwd') !== PASS) {
        return html(200, loginPage(`The password you entered for the username <strong>${form.get('log') ?? ''}</strong> is incorrect.`));
      }
      return redirect(form.get('redirect_to') || `${SITE}/dashboard/`, [`${SESSION}; path=/; secure; HttpOnly`]);
    }
    if (path === '/dashboard/') {
      if (!loggedIn || on.has('cache')) return redirect(`${SITE}/wp-login.php?redirect_to=${encodeURIComponent(`${SITE}/dashboard/`)}`);
      const popup = on.has('popup')
        ? `<div class="tutor-modal tutor-is-active tutor-onboarding-modal" aria-modal="true"><div class="tutor-modal-window"><h3 class="tutor-modal-title">Welcome to your new dashboard!</h3><button class="tutor-btn" disabled>Get started</button></div></div>`
        : '';
      const courses = enrolled ? `<div class="tutor-course-card"><a href="/courses/morning-flow/">Morning Flow: 30 Days of Yoga</a> <span>2 of 30 lessons done</span></div>` : '<p>You have not enrolled in any courses yet.</p>';
      return html(200, page('Dashboard', `<div class="tutor-dashboard"><h2>Hello, Maya</h2><h3>Enrolled Courses</h3>${courses}</div>${popup}`));
    }
    if (path === '/courses/morning-flow/') {
      const price = on.has('sale')
        ? `<div class="tutor-course-price"><del><span class="amount">$79.00</span></del> <ins><span class="amount">$39.00</span></ins></div>`
        : `<div class="tutor-course-price"><span class="amount">$79.00</span></div>`;
      const action = enrolled
        ? `<a class="tutor-btn" href="/courses/morning-flow/lessons/${LESSONS[0][0]}/">Continue Learning</a>`
        : `${price}<form class="tutor-course-enroll-form"><button class="tutor-enroll-course-button tutor-btn">Enroll Now</button></form>`;
      const list = LESSONS.map(([slug, title]) => `<li><a href="/courses/morning-flow/lessons/${slug}/">${title}</a></li>`).join('');
      return html(200, page('Morning Flow: 30 Days of Yoga', `<h1 class="tutor-course-title">Morning Flow: 30 Days of Yoga</h1>${action}<h3>Course content</h3><ul class="tutor-course-topics">${list}</ul>`));
    }
    const lesson = LESSONS.find(([slug]) => path === `/courses/morning-flow/lessons/${slug}/`);
    if (lesson) {
      if (!loggedIn) return redirect(`${SITE}/wp-login.php`);
      if (!enrolled) return html(200, page(lesson[1], `<div class="tutor-alert">Please enroll in this course to view course content.</div>`));
      const policy = on.has('video') ? ' referrerpolicy="no-referrer"' : '';
      return html(200, page(lesson[1], `<h1>${lesson[1]}</h1><div class="tutor-video-player"><iframe src="https://www.youtube-nocookie.com/embed/${lesson[2]}?rel=0" title="${lesson[1]}"${policy} allowfullscreen></iframe></div><p>Find a quiet corner and a mat.</p>`));
    }
    if (path === '/courses/morning-flow/quizzes/week-1-check-in/') {
      if (!enrolled) return html(200, page('Week 1 check-in', `<div class="tutor-alert">Please enroll in this course to view course content.</div>`));
      return html(200, page('Week 1 check-in', `<div class="tutor-quiz-wrapper"><h2>Week 1 check-in</h2><p>5 questions · no time limit</p><button class="tutor-btn start-quiz-btn" name="start_quiz_btn">Start Quiz</button></div>`));
    }
    if (path === '/tutor-certificate/') {
      if (on.has('nonce')) return html(403, page('Certificate', `<p>Nonce not matched. Action failed!</p>`));
      return html(200, page('Certificate', `<div class="tutor-certificate-demo"><img src="${SITE}/wp-content/uploads/tutor-certificates/8c41e0d2a7.jpg" alt="Certificate of completion: Morning Flow, Maya Test"></div>`));
    }
    return html(404, page('Page not found', `<h1>Oops! That page can’t be found.</h1>`));
  };
}
