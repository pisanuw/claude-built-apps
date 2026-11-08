# Popup Check

**Live:** https://popup-check.hintwise.org

Find out whether the popups on your store lock out shoppers who use a
keyboard or a screen reader, before someone else finds out for you.

Popup Check is a free bookmark. You open your own store, wait for your
email sign-up popup, age gate, cookie banner or chat button to appear, and
click the bookmark. A panel opens in the corner, checks every popup that is
open, and gives you a dated report with plain advice and a message you can
send to the popup app's support.

Nothing is installed on your store and nothing is uploaded: the checks run in
your own browser, and the report stays there too.

## Who it is for

You run a small online shop on Shopify, WooCommerce, Squarespace or similar,
and you add popups, banners and chat widgets through apps. They look fine to
you. To a shopper using a screen reader they can be a wall: focus never
reaches the popup, the close button has no name (a bare × is read out as
"times"), and Escape does nothing. Popups come up in website accessibility
complaints, and most free checkers test the page as it looks before the popup
appears.

## How to use it

1. **Try the practice shop first.** It has five sample popups, some built
   badly on purpose. Open one and Popup Check runs on it, so you can see what
   a report looks like.
2. **Add the bookmark.** On a computer, show your bookmarks bar (Ctrl+Shift+B,
   or Cmd+Shift+B on a Mac) and drag the *Popup Check* button from the site
   onto it. If dragging does not work, copy the bookmark code and paste it as
   the address of a new bookmark.
3. **Check your store.** Open it in a private window (so once-per-visitor
   popups show again), wait for the popup, then click the bookmark.
4. **Run the guided keyboard test.** You press Tab about ten times and then
   Escape; Popup Check records where focus really went. This is the result to
   trust (see "What it cannot do").
5. **Open the full report.** It opens on the Popup Check site with the date,
   every check, what good looks like, whose fix it is, and a ready-to-send
   message for the app's support or your web developer. Print it or save it
   as PDF. If your browser blocks the window, use *Copy report code* in the
   panel and paste it under *Open a report*.
6. **Check again after changing an app.** Past reports are kept in your
   browser, and a new report for the same store lists what was fixed, what is
   new and what is still a problem.

## What it checks

For each open popup:

- Keyboard focus moves into it when it opens
- Tab stays inside it while it is open (Shift+Tab too)
- The Escape key closes it, and focus lands somewhere sensible afterwards
- The close button has a name a screen reader can read, and is at least
  24 × 24 pixels
- Screen readers are told a popup opened (a dialog), it has a title, and the
  page behind is hidden from them while it is open
- Form fields have labels (not just grey placeholder text)
- Buttons, links and images have names or descriptions
- Text contrast meets WCAG AA (4.5 to 1, or 3 to 1 for large text)
- Everything that looks clickable can be reached with the keyboard
- Cookie banners and chat buttons can be reached with the Tab key

It also recognises about 35 well-known popup, cookie-banner, chat and
age-gate apps (Klaviyo, Privy, OneTrust, Cookiebot, Tidio, Intercom, Shopify
Inbox and others), so the report can say "this comes from Klaviyo: look in
its settings or send their support this message" rather than "edit your
code", which you usually cannot do for an app.

## What it cannot do

- It checks only the popups that are open when you click the bookmark. It
  does not open popups for you, and it does not re-check your store on a
  schedule.
- A web page is not allowed to press real keys. The automatic Tab and Escape
  tests send the key presses a popup's own code listens for and work out
  where the browser would move focus; the guided test, where you press the
  keys, is the reliable one.
- Chat windows and some popups are drawn inside a frame from another
  company's site, which a bookmark is not allowed to look inside. The report
  says when this happens, so you can check that part by hand.
- It is not a full accessibility audit and not a certificate. The report is
  worded as test results on a given day, never as "meets the ADA" or "WCAG
  compliant".
- Bookmarks like this work in desktop browsers, not on phones.

## Privacy

The bookmark reads the page you are on, in your browser. Nothing is sent
anywhere until you press *Open full report*, and then the report travels
inside the page address (after the `#`, which browsers do not send to the
server) to the Popup Check site, which shows it and keeps a copy in your
browser's storage. There are no accounts, no analytics on report contents,
and no server that receives your results.

## For developers

TypeScript, Vite, no framework, no runtime dependencies.

```bash
npm ci
npm run dev        # site on http://localhost:5173, practice shop at /practice.html
npm run lint
npm run typecheck
npm run coverage   # vitest + jsdom, 85% thresholds
npm run build      # dist/ (index.html, practice.html, assets)
```

- `src/engine/`: the checks. `detect.ts` finds open overlays (dialogs, and
  `position: fixed` elements classified by text, size and known-app marks;
  site headers are skipped), `checks.ts` reads names, roles, labels, contrast
  and sizes, `keyboard.ts` runs the simulated Tab/Escape tests, `guided.ts`
  records real key presses, `report.ts` packs reports into a link and
  compares them. Layout goes through an `Env`, so tests supply boxes.
- `src/panel/`: the on-page panel (shadow DOM, ignored by every check).
  `scripts/bookmarklet.mjs` bundles `src/panel/entry.ts` with esbuild into one
  script, which the site exposes as a `javascript:` link
  (`virtual:bookmarklet`). Set `POPUP_CHECK_SITE_URL` at build time to point
  the bookmark's report link elsewhere.
- `src/site/`: the site (instructions, report view, history in
  localStorage) and the practice shop.

The original idea called for a headless-browser crawler that triggers popups
on its own and a weekly re-check service. This version keeps the checks in
the owner's browser instead: no server, no bot-protection problems, and no
store data leaving the owner's computer.

## Licence

MIT. See [LICENSE](./LICENSE).
