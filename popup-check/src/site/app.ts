/** The Popup Check site: how to use the bookmark, the report view and past checks. */
import { compareReports, decodeReport, formatDate, hostOf, problemsOf, reportCounts, reportText, vendorMessage } from '../engine/report';
import { CHECK_TITLES, type Report } from '../engine/types';
import { hIn } from '../ui/h';
import { countsLine, findingList, overlayHeading } from '../ui/render';
import { addToHistory, loadHistory, previousFor, removeFromHistory } from './history';

export interface MountOptions {
  /** The bundled bookmark code (plain JavaScript). */
  bookmarkletCode: string;
  storage?: Storage | null;
  copy?: (text: string) => Promise<void>;
  print?: () => void;
}

export function bookmarkletHref(code: string): string {
  return `javascript:${encodeURIComponent(code)}`;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function mount(root: HTMLElement, opts: MountOptions): { showReport(r: Report): void; openCode(code: string): Promise<void> } {
  const doc = root.ownerDocument;
  const h = hIn(doc);
  const storage = opts.storage === undefined ? safeStorage() : opts.storage;
  const copy = opts.copy ?? ((t: string) => navigator.clipboard.writeText(t));
  const print = opts.print ?? (() => window.print());
  const href = bookmarkletHref(opts.bookmarkletCode);

  const reportSection = h('section', { id: 'report', class: 'report', 'aria-labelledby': 'report-title', hidden: true });
  const historySection = h('section', { id: 'history', 'aria-labelledby': 'history-title' });
  const status = h('p', { class: 'status', role: 'status' });

  function say(msg: string): void {
    status.textContent = msg;
  }

  async function copyText(text: string, done: string): Promise<void> {
    try {
      await copy(text);
      say(done);
    } catch {
      say('Could not copy automatically. Select the text and copy it yourself.');
    }
  }

  function renderHistory(): void {
    const list = loadHistory(storage);
    const items = list.map((r) => {
      const c = reportCounts(r);
      return h(
        'li',
        {},
        h('button', { type: 'button', class: 'linklike', onclick: () => showReport(r) }, `${hostOf(r.url)}, ${formatDate(r.checkedAt)}`),
        ` ${r.overlays.length} popup${r.overlays.length === 1 ? '' : 's'}, ${c.fail} problem${c.fail === 1 ? '' : 's'}. `,
        h(
          'button',
          {
            type: 'button',
            class: 'small',
            'aria-label': `Delete the check of ${hostOf(r.url)} from ${formatDate(r.checkedAt)}`,
            onclick: () => {
              removeFromHistory(storage, r);
              renderHistory();
              say('Deleted.');
            },
          },
          'Delete',
        ),
      );
    });
    historySection.replaceChildren(
      h('h2', { id: 'history-title' }, 'Your past checks'),
      list.length
        ? h('ul', { class: 'history' }, ...items)
        : h('p', {}, 'None yet. Each report you open is kept here, in this browser only, so you can compare a later check with an earlier one.'),
    );
  }

  function showReport(r: Report): void {
    const history = addToHistory(storage, r);
    const prev = previousFor(history, r);
    const c = reportCounts(r);
    const parts: Node[] = [
      h('h2', { id: 'report-title', tabindex: '-1' }, `Report for ${hostOf(r.url)}`),
      h('p', { class: 'meta' }, 'Page: ', h('span', { class: 'url' }, r.url), h('br', {}), `Checked: ${formatDate(r.checkedAt)}`),
      h(
        'p',
        { class: 'summary' },
        `${r.overlays.length} popup${r.overlays.length === 1 ? '' : 's'} checked. `,
        h('strong', {}, `${c.fail} problem${c.fail === 1 ? '' : 's'}`),
        `, ${c.warn} worth a look, ${c.pass} passed${c.notrun ? `, ${c.notrun} not tested` : ''}.`,
      ),
      h('p', { class: 'disclaimer' }, 'These are test results for the popups that were open when you ran the check. They are not a statement that your site meets the ADA or WCAG, and they do not cover the rest of your site.'),
    ];
    if (prev) {
      const cmp = compareReports(prev, r);
      const list = (title: string, xs: string[]): Node | null => (xs.length ? h('div', {}, h('h4', {}, title), h('ul', {}, ...xs.map((x) => h('li', {}, x)))) : null);
      parts.push(
        h(
          'div',
          { class: 'compare' },
          h('h3', {}, `Since your check on ${formatDate(prev.checkedAt)}`),
          !cmp.fixed.length && !cmp.newProblems.length && !cmp.newOverlays.length && !cmp.goneOverlays.length ? h('p', {}, 'No change.') : null,
          list('Fixed', cmp.fixed),
          list('New problems', cmp.newProblems),
          list('Still a problem', cmp.stillFailing),
          list('New popups', cmp.newOverlays),
          list('No longer seen', cmp.goneOverlays),
        ),
      );
    }
    r.overlays.forEach((o, i) => {
      const problems = problemsOf(o);
      const msg = vendorMessage(r, o);
      const msgId = `vendor-${i}`;
      parts.push(
        h(
          'article',
          { class: 'overlay-card' },
          h('h3', {}, overlayHeading(o)),
          h('p', { class: 'quote' }, `“${o.label}”`),
          h('p', { class: 'counts' }, countsLine(o)),
          findingList(h, o, true),
          problems.length
            ? h(
                'div',
                { class: 'who' },
                h('h4', {}, 'Whose fix is this?'),
                h('p', {}, o.app ? `This looks like ${o.app}. You usually cannot change its code: look in its settings first, and if there is no setting, send their support this message. If they cannot fix it, consider an app that passes these checks.` : 'This looks like part of your theme or a custom code snippet. Send this message, or the whole report, to whoever built or maintains your site; fixes like these are usually small.'),
                h('label', { for: msgId }, o.app ? `Message for ${o.app} support` : 'Message for your web developer'),
                h('textarea', { id: msgId, rows: '8', readonly: true }, msg),
                h('button', { type: 'button', onclick: () => void copyText(msg, 'Message copied.') }, 'Copy message'),
              )
            : null,
        ),
      );
    });
    if (!r.overlays.length) parts.push(h('p', {}, 'No open popup was found when this check ran.'));
    if (r.appsOnPage.length) parts.push(h('p', { class: 'apps' }, `Apps seen on the page: ${r.appsOnPage.join(', ')}.`));
    parts.push(
      h(
        'div',
        { class: 'actions no-print' },
        h('button', { type: 'button', class: 'primary', onclick: () => print() }, 'Print or save as PDF'),
        h('button', { type: 'button', onclick: () => void copyText(reportText(r), 'Report copied as text.') }, 'Copy as text'),
        h('a', { href: '#start', class: 'button' }, 'How to check again'),
      ),
    );
    reportSection.replaceChildren(...parts);
    reportSection.hidden = false;
    renderHistory();
    (reportSection.querySelector('h2') as HTMLElement).focus();
  }

  async function openCode(code: string): Promise<void> {
    try {
      showReport(await decodeReport(code));
      say('Report opened and kept in Your past checks.');
    } catch (e) {
      say((e as Error).message);
    }
  }

  const codeBox = h('textarea', { id: 'paste-code', rows: '3', placeholder: '1.…' });
  const checks = (Object.keys(CHECK_TITLES) as (keyof typeof CHECK_TITLES)[]).filter((k) => k !== 'frame');

  root.replaceChildren(
    h('a', { href: '#main', class: 'skip' }, 'Skip to content'),
    h(
      'header',
      {},
      h('h1', {}, 'Popup Check'),
      h('p', { class: 'lede' }, 'Find out whether the popups on your store lock out shoppers who use a keyboard or a screen reader, before someone else finds out for you.'),
      h('p', { class: 'privacy' }, 'It runs in your own browser, on your own store. Nothing is installed on your site and nothing is uploaded.'),
    ),
    h(
      'main',
      { id: 'main' },
      status,
      reportSection,
      h(
        'section',
        { id: 'start', 'aria-labelledby': 'start-title' },
        h('h2', { id: 'start-title' }, 'Why popups'),
        h('p', {}, 'Email sign-up popups, age gates, cookie banners and chat buttons are added through apps, and they often look fine to you while being a wall to a shopper using a keyboard or a screen reader: focus never reaches the popup, the × has no name, and Escape does nothing. Popups come up in website accessibility complaints, and most free checkers only test the page as it looks before the popup appears.'),
        h('h2', {}, '1. Try it on the practice shop'),
        h('p', {}, 'The practice shop has five sample popups, some built badly on purpose. Open one and see what Popup Check reports.'),
        h('p', {}, h('a', { href: './practice.html', class: 'button primary' }, 'Open the practice shop')),
        h('h2', {}, '2. Add the bookmark'),
        h('p', {}, 'On a computer (Chrome, Edge, Firefox or Safari), show your bookmarks bar (Ctrl+Shift+B, or Cmd+Shift+B on a Mac), then drag this button onto it:'),
        h('p', {}, h('a', { href, class: 'bookmarklet', title: 'Drag me to your bookmarks bar' }, 'Popup Check')),
        h(
          'details',
          {},
          h('summary', {}, 'Cannot drag it?'),
          h('p', {}, 'Copy the bookmark code, then add a new bookmark by hand: name it Popup Check and paste the code where it asks for the address (URL).'),
          h('button', { type: 'button', onclick: () => void copyText(href, 'Bookmark code copied. Paste it as the address of a new bookmark.') }, 'Copy bookmark code'),
        ),
        h('h2', {}, '3. Check your store'),
        h(
          'ol',
          { class: 'steps' },
          h('li', {}, 'Open your store in a private window, so popups that show once per visitor appear again.'),
          h('li', {}, 'Wait for your popup, scroll, or click whatever opens it.'),
          h('li', {}, 'Click the Popup Check bookmark. A panel opens in the corner and checks every popup that is open.'),
          h('li', {}, 'Press “Guided keyboard test” and follow it: you press Tab and Escape yourself, and it records where focus really goes.'),
          h('li', {}, 'Press “Open full report” for the dated report, advice, and a message you can send to the app’s support. Repeat for each popup.'),
        ),
        h('p', {}, 'Before you change or add a popup app, check again: the report shows what is fixed and what is new since the last check.'),
      ),
      h(
        'section',
        { id: 'open', 'aria-labelledby': 'open-title' },
        h('h2', { id: 'open-title' }, 'Open a report'),
        h('p', {}, 'If your browser blocked the report window, press “Copy report code” in the panel and paste it here.'),
        h('label', { for: 'paste-code' }, 'Report code'),
        codeBox,
        h('button', { type: 'button', onclick: () => void openCode(codeBox.value) }, 'Open report'),
      ),
      historySection,
      h(
        'section',
        { id: 'checks', 'aria-labelledby': 'checks-title' },
        h('h2', { id: 'checks-title' }, 'What it checks'),
        h('ul', { class: 'checklist' }, ...checks.map((k) => h('li', {}, CHECK_TITLES[k]))),
        h('p', {}, 'Each popup is also matched against about 35 well-known popup, cookie, chat and age-gate apps, so the report can say whose settings to look at.'),
        h('h2', {}, 'What it cannot do'),
        h(
          'ul',
          {},
          h('li', {}, 'It only checks popups that are open when you click the bookmark. It does not open them for you, and it does not re-check your store on a schedule.'),
          h('li', {}, 'A web page cannot press real keys, so the automatic Tab and Escape tests send the key presses a popup’s code listens for. The guided test, where you press the keys, is the one to trust.'),
          h('li', {}, 'Chat windows and some popups are drawn inside a frame from another company’s site, which a bookmark is not allowed to look inside. The report says when that happens.'),
          h('li', {}, 'It is not a full accessibility audit and not a certificate. Passing here means these checks passed on that day, nothing more.'),
          h('li', {}, 'Bookmarks like this work on computers, not on phones.'),
        ),
      ),
    ),
  );
  renderHistory();

  const hash = doc.location?.hash ?? '';
  const m = /^#report=(.+)$/.exec(hash);
  if (m) void openCode(m[1]);

  return { showReport, openCode };
}
