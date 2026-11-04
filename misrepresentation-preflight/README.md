# Misrepresentation Preflight

**Before you ask Google to look at your store again, see every place your
store tells shoppers two different things.**

Google Merchant Center suspends your Shopping account for "Misrepresentation"
and does not say what it found. You fix the footer, rewrite a policy, request
a review, and it comes back rejected. Each rejection makes the next wait
longer. In the Shopify Community threads from July to October 2026, the same
answer comes up again and again: lots of small inconsistencies piled up
across the store, its policies, the product feed and the business details in
Merchant Center.

Misrepresentation Preflight reads your store's public pages the way a
reviewer would (home, contact, about, shipping, returns, terms, FAQ and up to
15 product pages) and compares what they say:

- **Who you are.** Business name, email, phone and address, on every page,
  and against what you told Merchant Center. Catches the old phone number on
  the contact page, the personal Gmail next to your store address, and the
  old brand name still in your theme settings.
- **Shipping.** How long you take to send an order, how long delivery takes,
  and the free-shipping minimum, across the shipping policy, FAQ, product
  pages and announcement bar. Express and international times are compared
  only with each other.
- **Returns.** The return window on the policy, the FAQ, product pages and in
  Merchant Center, and "all sales final" wording next to a return promise.
- **Prices and stock.** On each product page: the price shoppers see, the
  product data Google reads, and (if you add it) your product feed. Also
  flags two sets of product data on one page (a theme and an app both adding
  their own) and feed links to deleted products.
- **Wording reviewers distrust,** such as "official retailer", "clinically
  proven", "lowest price guaranteed" or "free, just pay shipping".
- **Missing pieces:** no contact details, no shipping or returns page, or
  footer links to policy pages that no longer exist.

Every finding says where it is (the page and the exact sentence), why a
reviewer would care, and what to change. The most important ones come first.

**Live:** https://misrepresentation-preflight.pisan.me · **Try it without a
store:** the sample shop, Fernhill Candle Co., is a made-up candle store with
the kind of contradictions real stores collect over time. Run the check, then
run it again "after fixes" to see the re-check log at work.

## How to use it

1. Type your store's address (for example `mystore.com`).
2. Optional but worth it: add your product feed. Download it from Merchant
   Center (**Products → All products → Download**) or from your feed app. It is
   read in your browser and never uploaded.
3. Optional: open **What you told Merchant Center** and copy in your business
   name, phone, email, postcode, return window and shipping times from
   Merchant Center's Business info and Shipping and returns settings.
4. Tick the box to confirm the store is yours, and press **Check my store**.
   A check takes about a minute.

Download the report to keep it or send it to whoever helps with your store.
Fix what you can, then run the check again: the **re-check log** lists every
check with its date, what was fixed and what is new, and you can add a note
on what you changed. Download it as a spreadsheet before you request your
review.

## Privacy

- The checker reads only public pages of the store you typed, at most 50 per
  check, two at a time, with a pause between pages.
- Pages are read on the checker's server (a web page cannot read another
  website). The server sends back only the details it found (contact details,
  shipping and return sentences, prices) and keeps nothing.
- Your feed file and Merchant Center details never leave your browser. The
  re-check log is stored in your browser too.
- robots.txt is respected for ordinary pages. Your contact and policy pages
  are read even if robots.txt asks search engines to skip them, because you
  confirmed the store is yours and those are the pages reviewers read. The
  report lists them.

## What it cannot tell you

- **It cannot tell you why Google suspended you.** Google does not say, and
  some suspensions have causes no website check can see (the account's
  history, payment details, things outside the website). Fixing everything
  here does not guarantee reinstatement.
- It reads each page as your store's server sends it, without running
  scripts. Text that an app adds after the page loads (some announcement bars,
  review widgets, chat popups) is not seen.
- It reads wording with patterns, not understanding. "Ships in 3-5 days" is
  read correctly; an unusual sentence may be missed or misread. Check each
  finding against the page before you change anything.
- It does not open the checkout, so shipping costs and taxes at checkout are
  not compared.
- Stores behind strong bot protection may refuse the checker. The report
  says which pages it could not read.

## For developers

TypeScript, Vite, no framework. `src/core` is the checker:

- `extract.ts` turns one page's HTML (parsed with `node-html-parser`) into
  facts: links, emails, phones, business names (`identity.ts`), shipping and
  return windows and free-shipping thresholds (`windows.ts`), product offers
  from JSON-LD, microdata, price meta tags and the visible price and cart
  button (`products.ts`), and risky wording (`claims.ts`).
- `scan.ts` reads robots.txt and the home page, picks pages to read
  (`discover.ts`, with each store builder's usual policy addresses), reads
  them a few at a time, and runs `checks.ts`, the cross-page comparison.
- `feed.ts` reads Merchant Center TSV/CSV exports, RSS/Atom XML feeds and a
  Shopify product export; `history.ts` is the re-check log; `report.ts` the
  Markdown report; `demo.ts` the sample shop.

`src/server` is the Netlify function: `POST /api/page` reads one page of the
store and returns its facts (never the page itself), `POST /api/robots`
returns robots.txt, `GET /api/health` answers the deploy's health check. One
page per call keeps each call inside Netlify's 10-second limit. Every host is
resolved and private, loopback, link-local and multicast addresses and
non-web ports are refused; redirects are followed by hand and must stay on
the store's own host. Residual risk: DNS can change between the check and the
connection; the host lock keeps any such request on the one host entered.

No AI or paid API is called anywhere. The idea suggested a crawler, a parsing
queue and a hosted database; the deterministic checks, a stateless function
and browser storage replace them.

```bash
npm ci
npm run dev        # page only (the sample shop works; real stores need the function)
npm run lint
npm run typecheck
npm run coverage   # vitest, 85% thresholds
npm run build      # dist/ plus netlify/functions/api.mjs
```

Deploys to Netlify from `deploy/target.yml` (static page plus the `api`
function).

## License

MIT. See [LICENSE](./LICENSE).
