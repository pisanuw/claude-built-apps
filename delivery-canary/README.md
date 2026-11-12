# Delivery Canary

**For shops that sell digital files on Shopify** (patterns, ebooks, presets,
templates, printables): find out whether your download email reaches the
buyer's Gmail inbox, lands in Promotions or Spam, and whether its link still
opens the right file, before a customer writes to say nothing arrived.

Live: https://delivery-canary.hintwise.org

## What it does today

1. Place a test order in your shop (a 100% off code is fine) using a Gmail
   address you keep for testing.
2. In that Gmail account, open the download email, note where it landed, and
   choose More (three dots), then "Download message".
3. Drop the `.eml` file into Delivery Canary. It tells you, in plain words:
   - where it landed (Inbox, Promotions or Spam) and what to change;
   - whether the email passed the sender checks Gmail uses (SPF, DKIM,
     DMARC) and whether it is signed with your own domain;
   - how long it took to arrive;
   - which delivery app sent it;
   - whether the download link works, what file it gives, and whether that
     file is the same as the one you saved as your baseline.

Try it first with the sample email on the page; no account needed.

## What is stored

Signed out, nothing leaves the page: the email is read in your browser.
Signed in (Google or an email link), your shop's name, its delivery app, the
size and fingerprint of your baseline file, and each check's result are kept
in your account (Supabase, US East). The raw email and the full download link
are never stored, only the link's website name. To test a link on another
site, the link is sent to our server, which opens it once and returns the
file's size and fingerprint; the file itself is not kept.

To delete everything: "Delete my account" under Sign out.

## Coming next

Unfulfilled digital order scan, a connected seed mailbox, automatic canary
orders, and a weekly email summary (see `docs/PLAN.md`).

---

For developers: `npm ci && npm run lint && npm run typecheck && npm run
coverage && npm run build`; `npm run e2e` for the walkthrough. Build state is
in `HANDOFF.md`.
