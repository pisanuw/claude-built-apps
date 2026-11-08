# Health Page Tracker Watch

**Which outside tools on your practice website send visitor information to other companies?**

Your website was put together from pieces: a booking widget, a chat box, an
accessibility tool, an analytics tag, maybe an ad pixel. Each one quietly
tells its maker which page a visitor is reading. On a page about anxiety
therapy, fertility or weight loss, that can count as health information. A
plugin update can add a new one without telling you.

Health Page Tracker Watch is for therapists, counseling and group practices,
small clinics, dental and physical-therapy offices, med spas and wellness
studios, and the people who run their websites. It:

1. lists every outside company your booking, intake and service pages contact;
2. says in plain words what each one receives, and whether its maker publicly
   says it signs a **Business Associate Agreement (BAA)**;
3. marks what to look at first, with options your web person can act on;
4. compares this month with last month, so you hear only about what is new.

Everything happens inside your browser tab. Nothing you add is uploaded.

**Live:** https://health-page-tracker-watch.hintwise.org · **Try it without your
own site:** click "Try the example practice" for a made-up counseling
practice where a plugin update put the Meta Pixel on the booking page.

## How to use it (about ten minutes, once a month)

1. Say what kind of practice you are (covered by HIPAA, a wellness business
   that is not, or not sure) and whether you serve people in Washington,
   Nevada or Connecticut, which have consumer health data laws.
2. Add your pages, one of two ways:
   - **Record them** (finds the most). In Chrome or Edge, open a private
     window, press F12, open the Network tab and tick "Preserve log". Load
     your home page, booking page, intake forms page and two or three service
     pages. Right-click the request list and choose "Save all as HAR". Drop
     the file in.
   - **Paste a page's source** (quicker). Open the page, press Ctrl+U
     (Mac: Cmd+Option+U), copy everything and paste it in with the page's
     address. This misses tools that load later, such as anything added
     through Google Tag Manager.
3. Read the report. Change a page's kind if the guess is wrong (for example a
   blog post about a condition is a service page).
4. Click **Save this check for next month** and **Add a monthly reminder**.
   Next month, drop the saved file in with a fresh recording to see what
   changed.

You can also download a summary to send to your web person, or print the
report or save it as a PDF for your privacy records.

## What the report means

| Mark | What it means |
|---|---|
| **Review now** | A tool that sees what visitors do or type (ad pixel, analytics, session recording, chat, accessibility widget, booking or forms) runs on a health page, and its maker does not sign a BAA or we could not confirm that it does. |
| **Confirm** | Something on a health page needs a quick check: the maker signs a BAA only on some plans, it is a file server such as Google Fonts, or the company is not in our table. |
| **Not on health pages** | Seen only on your home, about, contact or blog pages. |
| **Signs a BAA** | A tool whose maker signs a BAA, such as your practice-management system. Keep the signed copy. |

A tool is called out when it received the **full page address** (for example
`/services/anxiety-therapy`), because that tells the company which service the
visitor was reading about.

## The vendor table

The table covers 82 tools that turn up on small practice websites: ad pixels
(Meta, Google, TikTok, LinkedIn, Pinterest, Snap, X, Microsoft, Reddit),
analytics and session recording (Google Analytics, Hotjar, Clarity and
others), chat (tawk.to, Tidio, Intercom, Zendesk…), accessibility widgets
(UserWay, accessiBe, EqualWeb, AudioEye, Recite Me), booking and practice
systems (Jane, SimplePractice, TherapyNotes, IntakeQ, Healthie, Zocdoc,
Acuity, Calendly, Mindbody, Vagaro, Square, Boulevard), forms, email
marketing, call tracking, reviews, video, maps, fonts and payments.

For each it records what the maker says publicly about a BAA. Where we have
not confirmed what a vendor offers, the table says **Ask the vendor** rather
than guessing. The table was last reviewed in November 2026, and the date
appears on every report. Vendor plans change, so confirm with the vendor
before you rely on it.

## What it does not do

- **It is not legal advice.** It reports what your pages sent and what
  vendors say about themselves. Whether a page visit plus an IP address counts
  as protected health information is disputed: in 2024 a federal court set
  aside part of the US health department's guidance on tracking tools, while
  private lawsuits over pixels on booking pages continue.
- **No automatic monthly scans or email alerts.** The original idea was a
  hosted service that visits your site on a schedule. This version is the
  free, private core: you record, it reads. The calendar reminder brings you
  back each month.
- It only sees the pages you record or paste, and it does not look inside
  forms or chat conversations.
- The vendor table is kept by hand, and a company it does not know is listed
  by name so nothing is hidden, but not explained.

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
| `src/core/capture.ts` | HAR parsing (pages by `pageref` or navigation order, outside requests, page address in URL/body/Referer) and page-source reading |
| `src/core/vendors.ts` | The vendor table: host rules, kinds, BAA status and notes |
| `src/core/pages.ts` | Booking / intake / service / contact / home guesses from the address and title |
| `src/core/analyze.ts` | Findings per tool, levels, explanations, practice context |
| `src/core/check.ts` | Saved checks and the month-to-month comparison |
| `src/core/export.ts` | Markdown summary, monthly `.ics` reminder, disclaimer |
| `src/core/sample.ts` | Generated example recordings (`.example` domain, not a real practice) |
| `src/ui/` | DOM UI |

No environment variables (see `.env.example`). Deploys to Netlify via
`deploy/target.yml`.

Built with [Claude Code](https://claude.com/claude-code), guided by Yusuf Pisan.
Idea from [daily-project-ideas](https://github.com/pisanuw/daily-project-ideas)
(2026-11-04 #3). MIT licensed.
