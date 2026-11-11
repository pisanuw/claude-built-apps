# Teacher Catalog Kit

**Live:** https://teacher-catalog-kit.hintwise.org

For teachers who sell their own lesson resources online. Teachers Pay Teachers
(TPT) changed its seller tiers: from 1 January 2027 an Exclusive seller may
sell digital teaching resources only on TPT, and a Basic seller must keep TPT
prices no higher than anywhere else. If you also sell on Payhip, Etsy, TES,
Shopify or your own website, Teacher Catalog Kit tells you, product by
product, what each tier would make you change.

## What you can do today

- Pick your tier, or "not decided yet" to see both side by side.
- Add a resource: its type (worksheet, clip art, course, Boom Cards...), its
  TPT price and the other stores it is on with their prices.
- See straight away whether it breaks the Exclusive rules, the Basic price
  rule, or neither, and what to change.
- Keep the catalog in this browser, or sign in (Google or an emailed link) to
  keep it in your account and use it on any device.

Coming next: importing your TPT Product Statistics download, a whole-catalog
matrix, Shopify and Payhip/TES listing packs, an email when TPT changes its
rules, and sales totals across stores.

## Your data

Without signing in, the catalog stays in your browser. After you sign in it is
stored in HintWise's database (Supabase, US East), visible only to your
account. To delete your account and everything in it, write to
builder@hintwise.org from the address you signed in with.

Teacher Catalog Kit is not made by, or affiliated with, Teachers Pay Teachers.
It explains TPT's published rules; it is not legal or tax advice.

## For developers

Vite + TypeScript, no framework; the rules are data in `src/core/rules.ts`.

```bash
npm ci && npm run lint && npm run typecheck && npm run coverage && npm run build
npm run dev   # http://localhost:5173 (browser storage only without .env)
PW_CHROMIUM=/opt/pw-browsers/chromium npm run e2e   # Playwright walkthrough
```
