# Student Journey Check

**Can your students still get in after that plugin update?**

You update Tutor LMS or another plugin, your admin screen looks fine, and you
move on. Days later a student emails: they can't log in, the lesson video
shows an error, the certificate page is broken. By then other students have
hit the same wall and quietly given up. In August to October 2026 the Tutor
LMS support forum saw exactly these reports: login pages that died after
4.0.7, a welcome popup that blocked student dashboards after 4.1.1,
certificate pages showing "Nonce not matched", and YouTube lessons stuck on
"Error 153".

Student Journey Check walks your course site as a test student, the way your
real students do, and tells you in plain words which step would stop them:

1. **Your site opens:** no critical error, maintenance screen, database error
   or PHP warning on the page.
2. **Student can log in:** through `/wp-login.php` (or your own login page),
   with a clear message for a wrong password, a CAPTCHA or two-factor login.
3. **Student dashboard:** opens without bouncing back to the login page, has
   no popup already covering it, and lists your course.
4. **Course page:** opens and shows the student as enrolled, not "Enroll Now".
5. **Lesson and video:** the lesson opens without "please enroll", and its
   YouTube, Vimeo, Wistia, Bunny or uploaded video is set up correctly
   (including the `no-referrer` setting that makes YouTube show Error 153).
6. **Quiz page:** opens with its Start button. The quiz is never taken, so
   your reports stay clean.
7. **Certificate page:** opens without a security ("nonce") error.
8. **Price at checkout:** a logged-out visitor sees the price you expect, not
   a leftover sale price or no price at all.

Each step comes back as **Works**, **Look at this**, **Broken** or **Not
checked**, with what the page said and what to try. You also get the alert
email you could forward to whoever looks after your site, a text report to
download, and "since your last check" (new problems, fixed ones) for checks
run on the same device.

**Live:** https://student-journey-check.hintwise.org · **Try it without a site:**
the demo tab runs the real checker against Lotus Yoga Academy, a pretend
course site inside the page. Tick what to break and watch the test student
run into it.

## Setting up a test student (3 minutes)

1. In WordPress, go to **Users → Add New**, use an email you own and the role
   **Subscriber** (or Tutor's student role). Never use an administrator
   account.
2. Enroll it in one course (Tutor LMS → Students, or buy it once with a 100%
   coupon).
3. Optional: finish that course as the test student, and copy the
   certificate's address.
4. If your login page has a CAPTCHA or two-factor login, turn them off for
   this one account. It can only see what students see.

Then open **Check my site**, fill in the site, the test student's login, the
course page and (optionally) the price, and press **Run the check**.

## Privacy and safety

- The password is sent only with the login step and is never stored. Your
  other settings are remembered in your own browser, never the password.
- The server keeps nothing: the test student's session travels between your
  browser and the checker for the length of the run.
- The checker only ever opens pages on the site you typed in. It refuses
  private network addresses and non-web ports.
- You must confirm the site is yours or that you have permission to check it.

## What it cannot see

- It reads each page the way your server sends it. It does not run the page's
  scripts, so a problem that only appears after a script runs (a dead button,
  a popup a script opens) can be missed.
- It checks that a video is on the lesson and set up correctly, not that it
  plays. A video deleted on YouTube still looks fine here.
- It does not take quizzes, so it cannot see whether results show after an
  attempt.
- It runs when you press the button. Daily checks with automatic emails are
  not part of this version.
- It knows Tutor LMS's standard pages; heavily customized themes may need the
  page addresses filled in.

## For developers

TypeScript, Vite, no framework. `src/core` is the checker: a small cookie-
keeping HTTP session locked to one host (`http.ts`), page readers built on
`node-html-parser` (`html.ts`), the eight steps (`steps.ts`), price parsing
(`price.ts`), the run, summary and comparison (`journey.ts`, `report.ts`), and
browser-side history (`history.ts`). The same step code runs in the browser
against the demo academy (`demo.ts`) and on the server against real sites.

`src/server` is the one endpoint, `POST /api/step`, which runs a single step
and returns its result plus the session state. The browser calls it once per
step, so each call fits inside Netlify's 10-second function limit (each step
has an 8.5-second network budget). `transport.ts` resolves every host and
refuses private, loopback, link-local and multicast addresses and non-web
ports; redirects are followed by hand and re-checked. Residual risk: DNS can
change between the check and the connection; the host lock keeps any such
request on the one host the user entered. `GET /api/health` answers the
deploy's health check.

No AI or paid API is called anywhere.

```bash
npm ci
npm run dev        # page only (the demo works; "Check my site" needs the function)
npm run lint
npm run typecheck
npm run coverage   # vitest, 85% thresholds
npm run build      # dist/ plus netlify/functions/api.mjs
```

Tests cover each step against hand-written WordPress pages, every demo
breakage end to end, a real HTTP round trip through a local server, the API's
input checks, the address guard and the page itself (jsdom).

Deploys to Netlify from `deploy/target.yml` (static page plus the `api`
function).

## License

MIT. See [LICENSE](./LICENSE).
