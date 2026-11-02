# Consent Leak Watch

**Does your cookie banner actually stop the trackers?**

You installed a cookie banner (Complianz, CookieYes, Cookiebot, Borlabs…) and
assumed it works. Then a plugin updates, and suddenly the Meta Pixel or a
YouTube video loads before the visitor has said yes. Nobody notices until a
complaint arrives. In October 2026, for example, shop owners reported that
Meta for WooCommerce started setting the `_fbp` cookie before consent, even
with Complianz installed.

Consent Leak Watch checks this for you in about five minutes:

1. You record two short visits to your shop in your own browser: one where
   you leave the banner alone, and one where you click **Reject all**.
2. You drop the two recordings into the page.
3. It tells you which advertising and analytics cookies and trackers fired
   when they should not have, **which plugin loaded each one**, and what to
   try next.
4. Save the check. Next time (say, after updating plugins) drop the old check
   in too, and it shows what is new and which plugin changed version in
   between. That plugin is usually the culprit.

Everything happens inside your browser tab. The recordings are never uploaded.

**Live:** https://consent-leak-watch.netlify.app · **Try it without recording:**
click "Try the example shop" for a made-up candle shop whose Meta plugin
update started tracking before consent.

## What it checks

- **Cookies** from about 25 advertising and analytics services (Meta, Google
  Analytics and Ads, TikTok, Pinterest, Snap, X, LinkedIn, Microsoft, Hotjar,
  Clarity, HubSpot, Klaviyo, Mailchimp, Matomo, WooCommerce Tracks and order
  attribution, Jetpack, YouTube, Vimeo and more), whether set by a script, by
  your own server, or by the third party.
- **Requests** to those services, including YouTube, Vimeo and Google Maps
  embeds that load before consent.
- **Google Consent Mode:** a Google Analytics hit sent with consent *denied*
  (`gcs=G100`) is shown as a note, not a leak: it carries no cookies, but
  Google still receives it, and whether that is acceptable is a legal question.
- **Your banner's own record** of the choice, read from its cookie, so the
  tool can tell what happened before your click and after it, and warn you if
  the second recording does not actually contain a Reject all.
- **Worth knowing:** Google Fonts loaded from Google, tag loaders, reCAPTCHA.

## How it names the plugin

WordPress serves plugin files from `/wp-content/plugins/<plugin-folder>/`,
usually with `?ver=<version>`. Chrome's recording also notes which script
caused each request. The tool follows that chain back from the tracker to the
first plugin or theme file it finds. If the tracker was pasted into the page
as an inline snippet, it looks for the snippet in the page HTML and reads the
id WordPress gave it (for example `facebook-for-woocommerce-js-after`).

When this is impossible it says so instead of guessing:

- **Speed plugins** (WP Rocket, Autoptimize, LiteSpeed Cache, WP Fastest
  Cache, SiteGround, Breeze, FlyingPress, W3 Total Cache) combine files into
  one bundle, which removes the plugin's folder name. The tool names the
  optimizer and suggests turning combining off for one recording.
- **Cookies set by your server** (PHP) have no script behind them.
- **Firefox recordings** do not include the script chain, so fewer leaks can
  be traced.

## Recording a visit (Chrome or Edge)

1. Open a new private (Incognito) window.
2. Press F12 (Mac: Cmd+Option+I), open the **Network** tab, tick **Preserve log**.
3. Once only: DevTools settings (gear) > Preferences > Network > tick
   **Allow to generate HAR with sensitive data**. Without it, Chrome removes the
   cookies from the file and only tracker requests can be checked (the tool
   warns you when this happens).
4. Load your shop, leave the banner alone, open a product page and one other
   page. Right-click the request list > **Save all as HAR (with sensitive data)**.
5. Close the window, open a fresh private window, and repeat, but click
   **Reject all** on the first page before browsing.

A HAR file contains everything the browser sent and received. Record in a
fresh private window where you are not logged in to anything.

## What it does not do

- **No automatic weekly scans or email alerts.** The original idea was a
  hosted service that loads your shop in a headless browser on a schedule.
  This version is the free, private, do-it-yourself core: you record, it
  analyzes. Re-check after each plugin update.
- No cart or checkout testing, no Shopify (its consent lives in checkout),
  no IAB TCF string or Global Privacy Control checks.
- The tracker list is fixed and hand-written. Unknown cookies set by your own
  site are listed so nothing is hidden, but not classified.
- **These are technical findings for the pages you recorded, not legal
  advice.** A clean result is not a certificate of compliance.

## For developers

Vanilla TypeScript + Vite, no runtime dependencies, no backend.

```bash
npm ci
npm run dev       # local dev server
npm run lint
npm run typecheck
npm run coverage  # vitest, 85% thresholds
npm run build     # static site in dist/
```

| File | Role |
|---|---|
| `src/core/har.ts` | HAR parsing: cookies, Set-Cookie, Chrome `_initiator` chains, page HTML |
| `src/core/catalog.ts` | Tracker hosts, cookie names, inline-snippet signatures |
| `src/core/cmp.ts` | Banner detection and stored-choice parsing (Complianz, CookieYes, Cookiebot, OneTrust, Borlabs, Real Cookie Banner) |
| `src/core/attribution.ts` | Plugin/theme/optimizer attribution and plugin inventory |
| `src/core/analyze.ts` | Findings per vendor, before-choice/after-reject phases, warnings |
| `src/core/diff.ts` | Comparison with a saved check, suspect plugins |
| `src/core/report.ts` | Advice, Markdown summary, save/load |
| `src/core/sample.ts` | Generated example recordings (not from a real shop) |
| `src/ui/` | DOM UI |

No environment variables (see `.env.example`). Deploys to Netlify via
`deploy/target.yml`.

Built with [Claude Code](https://claude.com/claude-code), guided by Yusuf Pisan.
Idea from [daily-project-ideas](https://github.com/pisanuw/daily-project-ideas)
(2026-11-02 #1). MIT licensed.
