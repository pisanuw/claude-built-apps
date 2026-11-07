/**
 * A made-up community pantry and the Account Transactions report its treasurer
 * would export from Xero (saved as CSV). Every name and number is fictional.
 */
import { parseDate } from './dates';
import { newId, newOrg, type Org } from './model';

export const SAMPLE_FILE_NAME = 'Riverbend Pantry - Account Transactions (example).csv';

interface SampleLine {
  date: string;
  description: string;
  reference: string;
  debit?: string;
  credit?: string;
}

const months = ['Jul 2025', 'Aug 2025', 'Sep 2025', 'Oct 2025', 'Nov 2025', 'Dec 2025', 'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026'];

function donationLines(): SampleLine[] {
  const lines: SampleLine[] = months.map((m) => ({ date: `3 ${m}`, description: 'OSKO PAYMENT FROM JANE CITIZEN', reference: 'PANTRY', credit: '50.00' }));
  for (const m of ['Aug 2025', 'Nov 2025', 'Feb 2026', 'May 2026']) {
    lines.push({ date: `14 ${m}`, description: 'TRANSFER FROM T TRAN', reference: 'DONATION', credit: '100.00' });
  }
  lines.push(
    { date: '12 Dec 2025', description: 'SMITH PLUMBING PTY LTD', reference: 'XMAS APPEAL', credit: '500.00' },
    { date: '9 Sep 2025', description: 'DIRECT CREDIT M OBRIEN', reference: 'GIFT', credit: '25.00' },
    { date: '9 Dec 2025', description: 'DIRECT CREDIT M OBRIEN', reference: 'GIFT', credit: '25.00' },
    { date: '9 Mar 2026', description: 'DIRECT CREDIT M OBRIEN', reference: 'GIFT', credit: '25.00' },
    { date: '21 Oct 2025', description: 'CASH DEPOSIT', reference: 'ENV 042', credit: '20.00' },
    { date: '18 Feb 2026', description: 'CASH DEPOSIT', reference: 'ENV 042', credit: '40.00' },
    { date: '2 Nov 2025', description: 'TRANSFER FROM A KOWALSKI', reference: 'FOOD DRIVE', credit: '200.00' },
    { date: '17 Jan 2026', description: 'ROUND UP R PATEL', reference: '', credit: '1.50' },
    { date: '30 Apr 2026', description: 'COUNCIL COMMUNITY GRANT', reference: 'CG-2026-14', credit: '2,000.00' },
    { date: '5 May 2026', description: 'REFUND DUPLICATE GIFT J CITIZEN', reference: 'PANTRY', debit: '50.00' },
    { date: '3 Jul 2026', description: 'OSKO PAYMENT FROM JANE CITIZEN', reference: 'PANTRY', credit: '50.00' },
    { date: '3 Aug 2026', description: 'OSKO PAYMENT FROM JANE CITIZEN', reference: 'PANTRY', credit: '50.00' },
    { date: '14 Aug 2026', description: 'TRANSFER FROM T TRAN', reference: 'DONATION', credit: '100.00' },
  );
  return lines.sort((a, b) => parseDate(a.date)!.localeCompare(parseDate(b.date)!));
}

function csvLine(cells: string[]): string {
  return cells.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',');
}

/** The example export: a report title block, then a "Donations" section and an "Interest Income" section. */
export function sampleCsv(): string {
  const out = [
    'Account Transactions',
    'Riverbend Community Pantry Inc.',
    'For the period 1 July 2025 to 31 August 2026',
    '',
    'Date,Source,Description,Reference,Debit,Credit,Gross,GST',
    'Donations',
    'Opening Balance,,,,,,,',
  ];
  for (const l of donationLines()) {
    out.push(csvLine([l.date, l.debit ? 'Spend Money' : 'Receive Money', l.description, l.reference, l.debit ?? '', l.credit ?? '', '', 'GST Free']));
  }
  out.push('Total Donations,,,,50.00,"4,036.50",,');
  out.push('Interest Income');
  out.push('30 Jun 2026,Receive Money,INTEREST,,,3.12,,GST Free');
  out.push('Total Interest Income,,,,,3.12,,');
  return out.join('\r\n') + '\r\n';
}

export function sampleOrg(): Org {
  const org = newOrg('Riverbend Community Pantry Inc. (example)');
  Object.assign(org, {
    abn: '50 007 181 234',
    dgr: true,
    address: '12 Example Street\nRiverbend NSW 2999',
    email: 'treasurer@riverbend-pantry.example',
    phone: '',
    signatory: 'Alex Morgan',
    signatoryTitle: 'Treasurer',
    receiptPrefix: 'RCP-',
    nextReceiptNo: 101,
    thankYou: 'Thank you. Your gift kept our shelves stocked for local families this year.',
  });
  org.donors.push(
    { id: newId('d'), name: 'Jane Citizen', email: 'jane@example.com', address: '4 Wattle Close\nRiverbend NSW 2999', aliases: [] },
    { id: newId('d'), name: 'Thomas Tran', email: 'tom.tran@example.com', address: '', aliases: [] },
    { id: newId('d'), name: "Margaret O'Brien", email: '', address: '88 Creek Road\nRiverbend NSW 2999', aliases: [] },
    { id: newId('d'), name: 'Smith Plumbing Pty Ltd', email: 'accounts@smithplumbing.example', address: '', aliases: [] },
    { id: newId('d'), name: 'Peter Nguyen', email: '', address: '', aliases: ['ENV 042'] },
  );
  return org;
}
