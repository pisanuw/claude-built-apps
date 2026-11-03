import { parse, type HTMLElement } from 'node-html-parser';

/**
 * Reading a page the way a student would see it, from its HTML alone. These
 * checks look at what the server sends; they do not run the page's scripts.
 */
export interface Doc {
  root: HTMLElement;
  /** Visible text with whitespace collapsed (scripts and styles removed). */
  text: string;
  html: string;
}

export function readPage(html: string): Doc {
  const root = parse(html, { comment: false });
  const textRoot = parse(html, { comment: false });
  for (const el of textRoot.querySelectorAll('head, script, style, noscript, template, svg')) el.remove();
  // structuredText puts a line break between block elements, so "Academy" in
  // the title and "Warning:" in the body do not run together.
  const text = decodeEntities(textRoot.structuredText).replace(/\s+/g, ' ').trim();
  return { root, text, html };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', hellip: '…', ndash: '–', mdash: '—', euro: '€', pound: '£', yen: '¥' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Up to `radius` characters either side of the first match, for the report. */
export function snippet(text: string, pattern: RegExp, radius = 90): string | undefined {
  const m = pattern.exec(text);
  if (!m) return undefined;
  const start = Math.max(0, m.index - radius);
  const end = Math.min(text.length, m.index + m[0].length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export function excerpt(text: string, max = 180): string {
  return text.length <= max ? text : `${text.slice(0, max).trim()}…`;
}

/** A WordPress error screen: the site is down for everyone who sees this page. */
export function findSiteError(doc: Doc): { kind: string; evidence: string } | null {
  const checks: Array<[string, RegExp]> = [
    ['critical', /There has been a critical error on (?:this|your) website/i],
    ['database', /Error establishing a database connection/i],
    ['fatal', /(?:PHP )?(?:Fatal|Parse) error:[^.]{0,200}/i],
    ['maintenance', /Briefly unavailable for scheduled maintenance/i],
  ];
  for (const [kind, re] of checks) {
    const evidence = snippet(doc.text, re, 60);
    if (evidence) return { kind, evidence };
  }
  return null;
}

/** PHP warnings printed into the page: usually harmless to students, but a sign an update went wrong. */
export function findPhpWarning(doc: Doc): string | undefined {
  return snippet(doc.text, /\b(?:Warning|Notice|Deprecated): .{0,160}? on line \d+/i, 0);
}

/** A security check a script cannot get past. */
export function findCaptcha(doc: Doc): string | null {
  const h = doc.html;
  if (/cf-turnstile|challenges\.cloudflare\.com\/turnstile/i.test(h)) return 'Cloudflare Turnstile';
  if (/class=["'][^"']*\bh-captcha\b|hcaptcha\.com\/1\/api/i.test(h)) return 'hCaptcha';
  if (/class=["'][^"']*\bg-recaptcha\b|google\.com\/recaptcha\/api/i.test(h)) return 'Google reCAPTCHA';
  if (/<title>\s*Just a moment\.\.\.\s*<\/title>|cf-browser-verification|\/cdn-cgi\/challenge-platform\/h\/[bg]\/orchestrate/i.test(h)) {
    return 'a Cloudflare security check';
  }
  return null;
}

export function findNonceError(doc: Doc): string | undefined {
  return snippet(doc.text, /nonce (?:not matched|verification failed|is invalid)|The link you followed has expired|Are you sure you want to do this\?/i, 60);
}

export function findAccessDenied(doc: Doc): string | undefined {
  return snippet(
    doc.text,
    /you (?:have|need) to (?:enroll|enrol)|please (?:enroll|enrol) (?:in|to)|you are not enrolled|not enrolled in this course|you don['’]t have (?:access|permission)|access denied|sorry, you are not allowed|you must be logged in/i,
    60,
  );
}

/** A theme's "page not found" screen served with HTTP 200. */
export function looksNotFound(doc: Doc): boolean {
  const title = doc.root.querySelector('title')?.textContent ?? '';
  return /page not found|nothing found|\b404\b/i.test(title) || /That page can[’']t be found|Oops! That page/i.test(doc.text);
}

export interface LoginForm {
  action: string;
  fields: Record<string, string>;
  userField: string;
  passField: string;
}

/** The WordPress (or Tutor LMS) login form on a page, with its hidden fields. */
export function findLoginForm(doc: Doc, pageUrl: string): LoginForm | null {
  for (const form of doc.root.querySelectorAll('form')) {
    const pass = form.querySelector('input[type="password"]');
    if (!pass) continue;
    const fields: Record<string, string> = {};
    for (const input of form.querySelectorAll('input')) {
      const name = input.getAttribute('name');
      const type = (input.getAttribute('type') ?? 'text').toLowerCase();
      if (!name || type === 'password' || type === 'checkbox' || type === 'button') continue;
      if (type === 'hidden' || type === 'submit') fields[name] = decodeEntities(input.getAttribute('value') ?? '');
    }
    const userInput = form
      .querySelectorAll('input')
      .find((i) => ['text', 'email', ''].includes((i.getAttribute('type') ?? '').toLowerCase()) && i.getAttribute('name'));
    const action = decodeEntities(form.getAttribute('action') ?? '') || pageUrl;
    return {
      action: new URL(action, pageUrl).toString(),
      fields,
      userField: userInput?.getAttribute('name') ?? 'log',
      passField: pass.getAttribute('name') ?? 'pwd',
    };
  }
  return null;
}

/** The message WordPress shows under a failed login, without the "Lost your password?" link text. */
export function findLoginError(doc: Doc): string | undefined {
  const el = doc.root.querySelector('#login_error, .login-error, .tutor-alert-warning, .tutor-alert-danger');
  if (!el) return undefined;
  const t = decodeEntities(el.textContent).replace(/\s+/g, ' ').replace(/Lost your password\??/i, '').trim();
  return t || undefined;
}

/** A second login step (a code from an app or email) that a test account should not have. */
export function findSecondFactor(doc: Doc): boolean {
  return /name=["'](?:authcode|wfls-token|two-factor-totp-authcode|googleotp|2fa_code)["']|id=["']wfls-prompt/i.test(doc.html);
}

const POPUP_CLASS = /\b(?:modal|popup|pop-up|onboarding|lightbox)\b/i;
const OPEN_CLASS = /\b(?:is-active|tutor-is-active|is-open|is-visible|show|open|active|visible)\b/i;

/**
 * A dialog that is already open when the page arrives, such as the onboarding
 * popup that blocked student dashboards after a Tutor LMS update.
 */
export function findOpenPopup(doc: Doc): string | null {
  for (const el of doc.root.querySelectorAll('[class], [role="dialog"], dialog')) {
    const cls = el.getAttribute('class') ?? '';
    const style = (el.getAttribute('style') ?? '').replace(/\s/g, '').toLowerCase();
    if (style.includes('display:none') || el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') continue;
    const isDialog =
      el.tagName === 'DIALOG' ? el.hasAttribute('open') : el.getAttribute('aria-modal') === 'true' || (POPUP_CLASS.test(cls) && OPEN_CLASS.test(cls));
    if (!isDialog) continue;
    const heading = el.querySelector('h1, h2, h3, h4, .tutor-modal-title, [class*="title"]');
    const label = decodeEntities((heading?.textContent || el.textContent).replace(/\s+/g, ' ').trim());
    return excerpt(label || 'a popup', 80);
  }
  return null;
}

export type VideoProvider = 'youtube' | 'vimeo' | 'wistia' | 'bunny' | 'html5' | 'other';

export interface VideoInfo {
  provider: VideoProvider;
  src: string;
  /** A problem we can see from the HTML alone. */
  problem?: string;
}

function providerOf(src: string): VideoProvider {
  if (/youtube(?:-nocookie)?\.com|youtu\.be/i.test(src)) return 'youtube';
  if (/vimeo\.com/i.test(src)) return 'vimeo';
  if (/wistia\.(?:com|net)|wi\.st/i.test(src)) return 'wistia';
  if (/mediadelivery\.net|b-cdn\.net|bunnycdn/i.test(src)) return 'bunny';
  return 'other';
}

/** Lesson videos on the page and any problem visible in their markup. */
export function findVideos(doc: Doc): VideoInfo[] {
  const out: VideoInfo[] = [];
  const pagePolicy = doc.root.querySelector('meta[name="referrer"]')?.getAttribute('content')?.toLowerCase() ?? '';
  for (const frame of doc.root.querySelectorAll('iframe')) {
    const src = decodeEntities(frame.getAttribute('src') ?? frame.getAttribute('data-src') ?? '').trim();
    const provider = providerOf(src);
    if (!src || provider === 'other') {
      if (/video|player|embed/i.test(`${src} ${frame.getAttribute('class') ?? ''}`) && !src) {
        out.push({ provider: 'other', src, problem: 'A video frame on the lesson has no address, so it shows an empty box.' });
      }
      continue;
    }
    const info: VideoInfo = { provider, src };
    if (provider === 'youtube') {
      const policy = (frame.getAttribute('referrerpolicy') ?? pagePolicy).toLowerCase();
      if (policy === 'no-referrer') {
        info.problem =
          'The YouTube player is told to hide which site it is on (referrer policy "no-referrer"). YouTube now refuses that and shows "Error 153: video player configuration error".';
      } else if (!/\/embed\/[\w-]{6,}|[?&]v=[\w-]{6,}|youtu\.be\/[\w-]{6,}|\/embed\/videoseries/i.test(src)) {
        info.problem = 'The YouTube address on this lesson has no video ID, so the player cannot load a video.';
      }
    }
    out.push(info);
  }
  for (const v of doc.root.querySelectorAll('video')) {
    const src = (v.getAttribute('src') ?? v.querySelector('source')?.getAttribute('src') ?? '').trim();
    out.push(src ? { provider: 'html5', src } : { provider: 'html5', src, problem: 'A video player on the lesson has no video file attached.' });
  }
  // Tutor LMS's own player wrapper with nothing inside it.
  for (const wrap of doc.root.querySelectorAll('.tutor-video-player, .tutor-video-player-wrapper')) {
    if (!wrap.querySelector('iframe, video, [data-plyr-provider], [data-plyr-embed-id]')) {
      out.push({ provider: 'other', src: '', problem: 'The lesson video area is empty: Tutor LMS printed the player but no video inside it.' });
    }
  }
  for (const p of doc.root.querySelectorAll('[data-plyr-provider]')) {
    const provider = p.getAttribute('data-plyr-provider') === 'youtube' ? 'youtube' : 'vimeo';
    const id = p.getAttribute('data-plyr-embed-id') ?? '';
    out.push(id ? { provider, src: id } : { provider, src: '', problem: `The ${provider === 'youtube' ? 'YouTube' : 'Vimeo'} player on this lesson has no video ID.` });
  }
  return out;
}

/** Links on the page whose address looks like a Tutor LMS lesson. */
export function findLessonLinks(doc: Doc, pageUrl: string): string[] {
  const seen = new Set<string>();
  for (const a of doc.root.querySelectorAll('a[href]')) {
    const href = decodeEntities(a.getAttribute('href') ?? '');
    if (!/\/lessons?\/[^/?#]+/i.test(href)) continue;
    try {
      seen.add(new URL(href, pageUrl).toString());
    } catch {
      /* ignore broken links */
    }
  }
  return [...seen];
}

export function hasTutorMarkup(doc: Doc): boolean {
  return /\/wp-content\/plugins\/tutor(?:-pro)?\/|class=["'][^"']*\btutor-/i.test(doc.html);
}

export function isWordPress(doc: Doc): boolean {
  return /\/wp-content\/|\/wp-includes\/|<meta[^>]+generator[^>]+WordPress/i.test(doc.html);
}

/** What the course page says about the test student's enrolment. */
export function enrolmentState(doc: Doc): 'enrolled' | 'not-enrolled' | 'unknown' {
  const t = doc.text;
  if (/\b(?:Start Learning|Continue Learning|Retake (?:This )?Course|Complete Course|Course Progress|You enrolled in this course)\b/i.test(t)) return 'enrolled';
  if (/\b(?:Enroll Now|Enrol Now|Buy Now|Add to Cart|Get Enrolled|Enroll Course|Enrol in this course)\b/i.test(t) || /tutor-enroll-course-button|tutor-course-enroll-form/i.test(doc.html)) {
    return 'not-enrolled';
  }
  return 'unknown';
}

/** Text of the page with struck-through (old) prices removed, and the old prices on their own. */
export function priceText(doc: Doc): { current: string; old: string } {
  const copy = parse(doc.html, { comment: false });
  for (const el of copy.querySelectorAll('head, script, style, noscript, template, svg')) el.remove();
  const struck = copy.querySelectorAll('del, s, strike, .tutor-course-price-regular, .regular-price');
  const old = struck.map((el) => decodeEntities(el.textContent)).join(' ');
  for (const el of struck) el.remove();
  return { current: decodeEntities(copy.structuredText).replace(/\s+/g, ' '), old: old.replace(/\s+/g, ' ') };
}
