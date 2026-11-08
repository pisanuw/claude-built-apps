# US Duty Price Sheet

**Live:** https://us-duty-price-sheet.hintwise.org

For UK makers who sell handmade goods to US customers through Folksy, Shopify, Big Cartel, Squarespace or their own website, and post with Royal Mail duty paid.

Since the US ended duty-free entry for small parcels, every US order has to go duty paid, and every product needs its own 10-digit US code (UK codes are not accepted). Working the duty out once is hard enough. Redoing your whole catalogue every time a US rate moves is what makes many makers stop offering US postage. This sheet keeps the codes, does the sums, and tells you which prices to change.

## What it does for you

- **A US code for every product, chosen with help.** Pick what you make (silver jewellery, cotton totes, stoneware mugs, knitted hats, candles, soap, cards, soft toys and about 40 more) and you get the codes makers usually choose between, a plain note on when each applies, and the official wording to check against. If nothing fits, search the wording of the US tariff, or type in a code you already have. You confirm each code yourself.
- **The duty, worked out.** Each code's own US rate, plus the extra 10% on goods made in the UK, plus any per-kilo or per-item part some codes add (wool hats, for example).
- **Two ways to pass it on.**
  - *In the postage:* one price for everyone, and US postage covers the label, the duty and Royal Mail's handling fee. There's also an "each extra item" amount, the shape Folksy postage profiles use.
  - *In the price:* a separate US item price that covers the duty on itself, so you still keep your UK price after duty. In pounds and dollars, rounded the way you like.
- **Tables to copy into your shop.** A postage table, a US price list and the full sheet as CSV, or print it.
- **"Which of my prices are now wrong?"** Once your shop matches the sheet, save it. When US duty changes, your postage prices change or you edit a product, the *What changed* page lists every product to update, with the old and new figure and the reason.
- **What-if.** Type a different UK duty rate and see what it would do to every price before it happens.
- **Warnings where the US looks harder,** such as toys and children's products, cosmetics and soap, food, some wooden goods, textile labelling, and parcels over Royal Mail's $2,500 duty-paid limit.

## Private by design

Everything stays in your browser. Nothing is uploaded and there is no account. Download a backup from *Postage and settings* now and then, and to move to another computer.

## Getting started

1. Open the site and click **Try a sample shop** to see it working, or **Add a product** to start on your own.
2. For each product, enter the UK price and weight, then choose a US code and confirm it.
3. In **Postage and settings**, replace the example postage prices with what Click & Drop charges you for a US duty-paid parcel at each weight. The example prices are not Royal Mail's.
4. Open **US price sheet**, choose how you pass duty on, and download the table for your shop.
5. Once your shop shows those prices, click **My shop now shows these prices**. Come back to **What changed** when you hear US duty has moved, or add the monthly calendar reminder.

Already have a Shopify export or a spreadsheet? **Import a product CSV** reads the product name, price and weight columns, plus any HS code and country of origin columns.

## Where the numbers come from

- **US rates:** the official US tariff schedule published by the US International Trade Commission (hts.usitc.gov). The app carries the 6,800 or so lines in the chapters handmade goods fall into, with their full legal wording. The data's revision and date are shown at the top of every page. It is refreshed when the app is updated, not live.
- **The UK layer:** 10% on goods made in the UK under heading 9903.05.81 (Section 301, in force since 24 July 2026). Checked by hand against the official schedule; the history this year is shown on the *What changed* page.
- **Royal Mail:** the handling fee defaults to the 50p Royal Mail publishes for duty-paid US parcels. Postage prices are yours to enter.

## Limits

- Estimates, not a binding customs ruling. As the sender of a duty-paid parcel you are responsible for the code and value you declare.
- Only goods made in the UK and posted with Royal Mail duty paid. For goods made elsewhere, set the rate by hand.
- The tariff data updates when the app does, not the moment the US publishes a change, and it does not email you.
- It does not file anything with US Customs or Royal Mail, and it does not cover the EU's per-parcel duty.

---

## For developers

Vite + TypeScript, no framework and no server. `src/core` holds the logic (rate parsing, pricing, change tracking, CSV import and export, storage), `src/ui` the plain-DOM interface, and `src/data/hts.json` the bundled tariff slice, which loads as its own lazy chunk (about 140 KB gzipped).

```bash
npm ci
npm run dev          # local server
npm run lint && npm run typecheck && npm run coverage && npm run build
npm run refresh-hts  # re-download the tariff chapters from hts.usitc.gov
```

The USITC service does not allow cross-site calls from a browser, so the data is fetched at development time by `scripts/fetch-hts.mjs`. A refresh records every changed general rate in `src/data/rate-history.json`, which drives the "tariff data updated" notice for returning makers. If a refresh changes the UK layer, a test fails until `src/core/layer.ts` is updated to match. Every suggested code in `src/core/categories.ts` is also checked against the data by a test.

No environment variables (see `.env.example`). Deployed to Netlify by the monorepo's deploy workflow (`deploy/target.yml`).
