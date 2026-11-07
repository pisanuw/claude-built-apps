# Donation Receipts

**Live: https://donation-receipts.pisan.me**

Numbered donation receipts and 30 June statements for small Australian
charities, churches, parishes and community groups, made from the gifts
already in your Xero or bank export. No retyping, and no invoicing every gift
just to get a receipt out.

Built for volunteer treasurers and part-time finance officers, and for
bookkeepers who look after several organisations.

## What it does

1. **Your organisation.** Enter your legal name, ABN and whether you are a
   deductible gift recipient (DGR). The ABN is checked as you type, and a
   sample receipt shows exactly what donors will get.
2. **Import.** Drop in Xero's *Account Transactions* report (Export > Excel)
   or your bank's CSV statement. The app guesses which column is the date,
   the amount and the bank text, and you can fix any guess. Only money coming
   in is imported. If the Xero report covers several accounts, pick the
   donations account. Import as often as you like: lines you already
   imported are skipped.
3. **Gifts.** Link each gift to a donor. Bank lines rarely name the donor
   cleanly, so the app suggests one from the bank text ("OSKO PAYMENT FROM
   JANE CITIZEN", "T TRAN", an envelope number such as "ENV 042") and
   remembers what each donor's gifts look like. Next month those gifts link
   themselves with one click. A grant, refund or sale can be marked "not a
   donation".
4. **Receipts.** Issue numbered receipts for every ready gift in one go, then
   download them as one PDF (a page each) or one at a time, or open an email
   to the donor with the receipt in the message. A receipt with a mistake is
   voided with a reason. Its number is never reused, and the gift can be
   receipted again.
5. **Statements.** For any year to 30 June: one statement per donor listing
   every gift and its receipt number, with the total. Download them all as
   one PDF, or a list as a spreadsheet.
6. **Register and backup.** Download the receipt register (every number
   issued, void ones included) for your auditor, and a backup file of
   everything.

### Receipt wording

- **DGR, gift of $2 or more:** the receipt states it is for a gift of money
  to your organisation, that you are endorsed as a deductible gift recipient,
  that gifts of $2 or more are tax deductible, and that no goods or services
  were given in return. It shows your name and ABN, the donor, date and
  amount, as the ATO asks a deductible gift receipt to show.
- **DGR, gift under $2:** a receipt that says the gift is not deductible.
- **Not a DGR:** a thank-you receipt that says the gift is not tax
  deductible.

Check the wording against the ATO's current guidance for your organisation
before you send your first batch.

## Your data

Everything runs in your browser. Imported files, donors, gifts and receipts
are kept in this browser on this computer and are never uploaded. Download a
backup from the Backup tab after each session and keep it with your finance
records; restore it to carry on on another computer.

Bookkeepers can keep each client as its own organisation and switch between
them from the top of the page.

## Limits

- It reads exports; it does not connect to Xero directly, so each month you
  export and drop the file in.
- It opens an email for one donor at a time with the receipt in the message;
  you attach the PDF yourself. There is no bulk sending.
- Australian wording only. No US written acknowledgements, NZ signed
  receipts, Gift Aid, or gifts of goods.
- Records live in one browser. Clearing the browser's site data deletes them
  unless you have a backup.

## For developers

Vite + TypeScript, no framework and no server. Everything is deterministic:
no AI calls and no paid APIs.

- `src/core/importer.ts`: header detection (also headerless bank CSVs),
  Xero report sections, sign conventions, day/month order, duplicate-safe
  import.
- `src/core/xlsx.ts`: a small .xlsx reader (ZIP central directory plus
  `DecompressionStream('deflate-raw')`, shared strings, inline strings).
- `src/core/matching.ts`: donor suggestions from names, initials, learned
  bank text and envelope numbers.
- `src/core/documents.ts`: numbering, voiding, wording, statements.
- `src/core/pdf.ts`: a PDF writer using the built-in Helvetica fonts
  (WinAnsi encoding, real character widths for wrapping).

```bash
npm ci
npm run dev        # http://localhost:5173
npm run lint
npm run typecheck
npm run coverage   # vitest, 85% thresholds
npm run build
```

No environment variables are needed (see `.env.example`). Deploys to Netlify
from `deploy/target.yml`.

## License

MIT. See [LICENSE](LICENSE).
