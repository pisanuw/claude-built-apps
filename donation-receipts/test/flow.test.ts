import { describe, expect, it } from 'vitest';
import { accountsIn, bankText, columnNames, donationAccount, extractLines, giftKey, guessMapping, importLines } from '../src/core/importer';
import { acceptStrongMatches, donorFromGift, identityText, linkGift, nameFromBankText, referenceId, suggestDonors } from '../src/core/matching';
import {
  docToText,
  donorYears,
  giftProblems,
  issueReceipts,
  mailtoLink,
  readyGifts,
  receiptDoc,
  receiptWording,
  statementDoc,
  voidReceipt,
  yearsWithGifts,
} from '../src/core/documents';
import { backupJson, giftsCsv, registerCsv, statementsCsv } from '../src/core/exports';
import { newOrg, type Gift, type Org } from '../src/core/model';
import { sampleCsv, sampleOrg } from '../src/core/sample';
import { parseCsv } from '../src/core/table';

function loadSample(): Org {
  const org = sampleOrg();
  const rows = parseCsv(sampleCsv());
  const m = guessMapping(rows);
  m.accountFilter = donationAccount(accountsIn(rows, m));
  importLines(org, extractLines(rows, m).lines);
  return org;
}

function gift(partial: Partial<Gift>): Gift {
  const g = { date: '2026-01-01', amountCents: 5000, payee: '', description: '', reference: '', account: '', ...partial };
  return { id: partial.id ?? 'g1', key: giftKey(g), ...g };
}

describe('import', () => {
  it('reads the Xero Account Transactions example', () => {
    const rows = parseCsv(sampleCsv());
    const m = guessMapping(rows);
    expect(m.headerRow).toBe(3);
    expect(m.columns.date).toBe(0);
    expect(m.columns.description).toBe(2);
    expect(m.columns.reference).toBe(3);
    expect(m.columns.debit).toBe(4);
    expect(m.columns.credit).toBe(5);
    expect(m.columns.amount).toBe(-1);
    expect(m.moneyIn).toBe('credit');
    expect(m.dayFirst).toBe(true);
    const accounts = accountsIn(rows, m);
    expect(accounts).toEqual(['Donations', 'Interest Income']);
    expect(donationAccount(accounts)).toBe('Donations');
    expect(donationAccount(['Donations', 'Gift Aid'])).toBe('');
    m.accountFilter = 'Donations';
    const ex = extractLines(rows, m);
    expect(ex.lines).toHaveLength(28);
    expect(ex.otherAccount).toBe(1);
    expect(ex.moneyOut).toBe(1);
    expect(ex.noDate).toBe(3);
    expect(ex.lines[0]).toEqual({
      date: '2025-07-03',
      amountCents: 5000,
      payee: '',
      description: 'OSKO PAYMENT FROM JANE CITIZEN',
      reference: 'PANTRY',
      account: 'Donations',
    });
    expect(columnNames(rows, m.headerRow).slice(0, 3)).toEqual(['A: Date', 'B: Source', 'C: Description']);
  });

  it('reads a headerless bank CSV with signed amounts and month-first dates', () => {
    const rows = parseCsv('11/25/2026,+50.00,"TRANSFER FROM J CITIZEN",+1050.00\n11/26/2026,-20.00,"BANK FEE",+1030.00\n12/01/2026,30.00,"OSKO S LEE",+1060.00');
    const m = guessMapping(rows);
    expect(m.headerRow).toBe(-1);
    expect(m.columns.date).toBe(0);
    expect(m.columns.amount).toBe(1);
    expect(m.columns.description).toBe(2);
    expect(m.dayFirst).toBe(false);
    expect(m.moneyIn).toBe('positive');
    const ex = extractLines(rows, m);
    expect(ex.lines.map((l) => [l.date, l.amountCents])).toEqual([
      ['2026-11-25', 5000],
      ['2026-12-01', 3000],
    ]);
    expect(ex.moneyOut).toBe(1);
    expect(columnNames(rows, -1)).toEqual(['Column A', 'Column B', 'Column C', 'Column D']);
    m.moneyIn = 'negative';
    expect(extractLines(rows, m).lines.map((l) => l.amountCents)).toEqual([2000]);
  });

  it('reads a bank export with named columns and an account column', () => {
    const rows = parseCsv('Date,Amount,Payee,Particulars,Code,Account\n01/07/2026,25,S Lee,,,Donations\n02/07/2026,10,Cafe,,,Sales\n03/07/2026,x,Bad,,,Donations');
    const m = guessMapping(rows);
    expect(m.columns.account).toBe(5);
    expect(m.columns.payee).toBe(2);
    expect(m.columns.reference).toBe(4);
    expect(accountsIn(rows, m)).toEqual(['Donations', 'Sales']);
    m.accountFilter = 'Donations';
    const ex = extractLines(rows, m);
    expect(ex.lines).toHaveLength(1);
    expect(ex.otherAccount).toBe(1);
    expect(ex.moneyOut).toBe(1);
    m.moneyIn = 'debit';
    expect(extractLines(rows, m).lines).toHaveLength(0);
    m.columns.date = -1;
    expect(extractLines(rows, m).noDate).toBe(3);
  });

  it('uses the debit column when the money in is a debit', () => {
    const rows = parseCsv('Date,Description,Debit,Credit\n1/7/2026,J CITIZEN,50.00,\n2/7/2026,FEE,,5.00');
    const m = guessMapping(rows);
    m.moneyIn = 'debit';
    expect(extractLines(rows, m).lines.map((l) => l.amountCents)).toEqual([5000]);
  });

  it('skips lines already imported but keeps identical lines within one file', () => {
    const org = newOrg('Test');
    const line = { date: '2026-01-05', amountCents: 5000, payee: 'J Citizen', description: '', reference: '', account: '' };
    const first = importLines(org, [line, { ...line }]);
    expect(first.added).toHaveLength(2);
    const again = importLines(org, [line, { ...line }, { ...line, payee: 'j  citizen!' }]);
    expect(again.added).toHaveLength(1);
    expect(again.duplicates).toBe(2);
    expect(bankText(" O'Brien, M ")).toBe('OBRIEN M');
  });
});

describe('matching', () => {
  it('pulls the payer out of bank text', () => {
    expect(identityText({ payee: '', description: 'OSKO PAYMENT FROM JANE CITIZEN 03' })).toBe('JANE CITIZEN');
    expect(identityText({ payee: 'Mrs J Citizen', description: 'ignored' })).toBe('J CITIZEN');
    expect(referenceId({ reference: 'ENV 042' })).toBe('ENV 042');
    expect(referenceId({ reference: 'DONATION' })).toBe('');
    expect(referenceId({ reference: '7' })).toBe('');
    expect(nameFromBankText(gift({ description: 'TRANSFER FROM A KOWALSKI 1234' }))).toBe('A Kowalski');
  });

  it('suggests donors by name, initial, alias and amount', () => {
    const org = loadSample();
    const byDesc = (s: string) => org.gifts.find((g) => g.description === s)!;
    const jane = suggestDonors(org, byDesc('OSKO PAYMENT FROM JANE CITIZEN'));
    expect(jane[0]).toMatchObject({ name: 'Jane Citizen', score: 90, strong: true, reason: 'Full name in the bank text' });
    expect(suggestDonors(org, byDesc('TRANSFER FROM T TRAN'))[0]).toMatchObject({ name: 'Thomas Tran', score: 80 });
    expect(suggestDonors(org, byDesc('DIRECT CREDIT M OBRIEN'))[0]).toMatchObject({ name: "Margaret O'Brien", strong: true });
    expect(suggestDonors(org, byDesc('SMITH PLUMBING PTY LTD'))[0]).toMatchObject({ name: 'Smith Plumbing Pty Ltd', score: 90 });
    expect(suggestDonors(org, byDesc('CASH DEPOSIT'))[0]).toMatchObject({ name: 'Peter Nguyen', score: 100 });
    expect(suggestDonors(org, byDesc('TRANSFER FROM A KOWALSKI'))).toEqual([]);
    expect(suggestDonors(org, byDesc('COUNCIL COMMUNITY GRANT'))).toEqual([]);

    // Weak evidence: surname only, first name only, single-word names.
    const o = newOrg('Weak');
    o.donors.push(
      { id: 'a', name: 'Sam Lee', email: '', address: '', aliases: [] },
      { id: 'b', name: 'Priya Shah', email: '', address: '', aliases: [] },
      { id: 'c', name: 'Bjorn', email: '', address: '', aliases: [] },
      { id: 'e', name: 'Mr', email: '', address: '', aliases: [] },
    );
    expect(suggestDonors(o, gift({ description: 'K LEE' }))[0]).toMatchObject({ donorId: 'a', score: 45, strong: false });
    expect(suggestDonors(o, gift({ description: 'PRIYA S' }))[0]).toMatchObject({ donorId: 'b', score: 30 });
    expect(suggestDonors(o, gift({ description: 'FROM BJORN' }))[0]).toMatchObject({ donorId: 'c', score: 60 });
    o.gifts.push({ ...gift({ id: 'old', description: 'K LEE' }), donorId: 'a' }, { ...gift({ id: 'old2', description: 'K LEE' }), donorId: 'a' });
    expect(suggestDonors(o, gift({ id: 'new', description: 'K LEE' }))[0]!.reason).toContain('2 times before');
    o.gifts.pop();
    expect(suggestDonors(o, gift({ id: 'new', description: 'K LEE' }))[0]!.reason).toContain('once before');
  });

  it('learns bank text when a gift is linked and links strong matches in bulk', () => {
    const org = loadSample();
    const kow = org.gifts.find((g) => g.description === 'TRANSFER FROM A KOWALSKI')!;
    const d = donorFromGift(org, kow.id)!;
    expect(d.name).toBe('A Kowalski');
    expect(d.aliases).toEqual(['A KOWALSKI']);
    expect(kow.donorId).toBe(d.id);
    expect(donorFromGift(org, 'missing')).toBeNull();
    const n = acceptStrongMatches(org);
    // 14 Jane + 5 Tran + 3 O'Brien + 1 Smith + 2 envelope; Patel (no donor) and the grant stay open.
    expect(n).toBe(25);
    expect(org.gifts.filter((g) => !g.donorId).map((g) => g.description)).toEqual(['ROUND UP R PATEL', 'COUNCIL COMMUNITY GRANT']);
    const jane = org.donors.find((x) => x.name === 'Jane Citizen')!;
    expect(jane.aliases).toContain('JANE CITIZEN');
    // A learned alias now matches a line that names nobody.
    const g = gift({ id: 'later', payee: 'Jane Citizen', description: 'whatever' });
    expect(suggestDonors(org, g)[0]).toMatchObject({ score: 100 });
    linkGift(org, 'nope', jane.id);
    const named = donorFromGift(org, org.gifts.find((x) => x.description === 'ROUND UP R PATEL')!.id, 'Raj Patel')!;
    expect(named.name).toBe('Raj Patel');
  });

  it('does not bulk-link when two donors tie', () => {
    const o = newOrg('Tie');
    o.donors.push(
      { id: 'a', name: 'Sam Lee', email: '', address: '', aliases: [] },
      { id: 'b', name: 'Sue Lee', email: '', address: '', aliases: [] },
    );
    o.gifts.push(gift({ description: 'S LEE' }));
    expect(acceptStrongMatches(o)).toBe(0);
  });
});

describe('receipts and statements', () => {
  function ready(): Org {
    const org = loadSample();
    acceptStrongMatches(org);
    return org;
  }

  it('words receipts by DGR status and amount', () => {
    const org = newOrg('Hall Trust');
    expect(receiptWording(org, 5000)).toContain('Gifts of $2 or more are tax deductible');
    expect(receiptWording(org, 150)).toContain('less than $2 are not tax deductible');
    org.dgr = false;
    expect(receiptWording(org, 5000)).toContain('not endorsed as a deductible gift recipient');
  });

  it('issues numbered receipts only for ready gifts, never reusing a number', () => {
    const org = ready();
    const grant = org.gifts.find((g) => g.description === 'COUNCIL COMMUNITY GRANT')!;
    grant.excluded = true;
    expect(giftProblems(org, grant)).toEqual(['Marked as not a donation.', 'Choose the donor first.']);
    expect(readyGifts(org)).toHaveLength(25);
    const first = issueReceipts(org, readyGifts(org).slice(0, 2).map((g) => g.id), '2026-11-07');
    expect(first.map((r) => r.number)).toEqual(['RCP-00101', 'RCP-00102']);
    expect(giftProblems(org, org.gifts.find((g) => g.id === first[0]!.giftId)!)).toEqual(['Already receipted (RCP-00101).']);
    voidReceipt(org, 'RCP-00101', 'Wrong donor', '2026-11-08');
    expect(() => voidReceipt(org, 'RCP-00101', 'again', '2026-11-08')).toThrow('already void');
    expect(() => voidReceipt(org, 'RCP-00999', 'x', '2026-11-08')).toThrow('No receipt');
    expect(() => voidReceipt(org, 'RCP-00102', ' ', '2026-11-08')).toThrow('Say why');
    org.nextReceiptNo = 102; // someone typed an old number back in
    const again = issueReceipts(org, [first[0]!.giftId], '2026-11-08');
    expect(again[0]!.number).toBe('RCP-00103');
    expect(org.nextReceiptNo).toBe(104);
    const bad = newOrg();
    expect(() => issueReceipts(bad, [], '2026-11-07')).toThrow("legal name");
  });

  it('builds receipt documents, text and email links', () => {
    const org = ready();
    const [r] = issueReceipts(org, [org.gifts[0]!.id], '2026-11-07');
    const donor = org.donors.find((d) => d.id === r!.donorId)!;
    const doc = receiptDoc(org, r!, donor);
    expect(doc.filename).toBe('receipt-RCP-00101-Jane-Citizen.pdf');
    const text = docToText(doc);
    expect(text).toContain('RECEIPT FOR A TAX DEDUCTIBLE GIFT');
    expect(text).toContain('Receipt number: RCP-00101');
    expect(text).toContain('ABN 50 007 181 234');
    expect(text).toContain('Amount: $50.00');
    expect(text).toContain('(fifty dollars)');
    expect(text).toContain('4 Wattle Close, Riverbend NSW 2999');
    expect(text).toContain('Issued for Riverbend Community Pantry Inc. (example) by Alex Morgan, Treasurer');
    const link = mailtoLink(donor.email, org, doc);
    expect(link.startsWith('mailto:jane%40example.com?subject=Receipt%20RCP-00101%20from')).toBe(true);
    expect(decodeURIComponent(link)).toContain('A PDF copy is attached.');

    voidReceipt(org, r!.number, 'Typo', '2026-11-08');
    const voided = docToText(receiptDoc(org, r!, undefined));
    expect(voided).toContain('VOID: Typo');
    org.signatory = 'Alex';
    org.signatoryTitle = '';
    org.thankYou = '';
    org.address = '';
    org.email = '';
    org.abn = '';
    org.dgr = false;
    const plain = docToText(receiptDoc(org, { ...r!, status: 'issued' }, { ...donor, name: ' ' }));
    expect(plain).toContain('DONATION RECEIPT');
    expect(plain).toContain('by Alex\n');
    expect(plain).toContain('Received from: Jane Citizen');
    org.signatory = '';
    expect(docToText(receiptDoc(org, r!, donor))).not.toContain('Issued for');
  });

  it('totals each donor per financial year and writes statements', () => {
    const org = ready();
    expect(yearsWithGifts(org)).toEqual([2027, 2026]);
    issueReceipts(org, [org.gifts[0]!.id], '2026-11-07');
    const patel = org.gifts.find((g) => g.description === 'ROUND UP R PATEL')!;
    const raj = donorFromGift(org, patel.id, 'Raj Patel')!;
    org.gifts.push({ ...patel, id: 'p2', key: 'p2', amountCents: 1000 });
    const years = donorYears(org, 2026);
    expect(years.map((y) => [y.donor.name, y.totalCents])).toEqual([
      ['Jane Citizen', 60000],
      ["Margaret O'Brien", 7500],
      ['Peter Nguyen', 6000],
      ['Raj Patel', 1150],
      ['Smith Plumbing Pty Ltd', 50000],
      ['Thomas Tran', 40000],
    ]);
    const rajYear = years.find((y) => y.donor.id === raj.id)!;
    expect(rajYear.deductibleCents).toBe(1000);
    const text = docToText(statementDoc(org, 2026, rajYear, '2026-11-07'));
    expect(text).toContain('ANNUAL STATEMENT OF GIFTS, 2025-26');
    expect(text).toContain('Period: 1 July 2025 to 30 June 2026');
    expect(text).toContain('Gifts under $2 ($1.50) are not deductible.');
    expect(text).toContain('Total: $11.50');
    const janeText = docToText(statementDoc(org, 2026, years[0]!, '2026-11-07'));
    expect(janeText).toContain('3 Jul 2025 | RCP-00101 | $50.00');
    expect(janeText).toContain('3 Aug 2025 | — | $50.00');
    expect(janeText).toContain('4 Wattle Close');
    expect(janeText).not.toContain('Gifts under $2');
    org.dgr = false;
    org.thankYou = '';
    const nonDgr = docToText(statementDoc(org, 2026, years[0]!, '2026-11-07'));
    expect(nonDgr).toContain('not tax deductible');
    expect(donorYears(org, 2026)[0]!.deductibleCents).toBe(0);
  });

  it('exports the register, statements, gifts and a backup', () => {
    const org = ready();
    issueReceipts(org, readyGifts(org).slice(0, 3).map((g) => g.id), '2026-11-07');
    voidReceipt(org, 'RCP-00102', 'Duplicate, gift refunded', '2026-11-08');
    const reg = parseCsv(registerCsv(org));
    expect(reg[0]![0]).toBe('Receipt number');
    expect(reg[1]).toEqual(['RCP-00101', '2026-11-07', '2025-07-03', 'Jane Citizen', '50.00', 'issued', '', '']);
    expect(reg[2]!.slice(5)).toEqual(['void', 'Duplicate, gift refunded', '2026-11-08']);
    expect(reg.find((r) => r[0] === 'Issued receipts')).toEqual(['Issued receipts', '2', '', 'Total', '150.00']);
    expect(parseCsv(registerCsv(org, 2027)).find((r) => r[0] === 'Issued receipts')![1]).toBe('0');
    org.abn = '';
    expect(parseCsv(registerCsv(org)).at(-1)).toEqual(['Organisation', 'Riverbend Community Pantry Inc. (example)', '']);
    const st = parseCsv(statementsCsv(org, 2026));
    expect(st[1]).toEqual(['Jane Citizen', 'jane@example.com', '12', '600.00', '600.00', 'RCP-00101']);
    const gifts = parseCsv(giftsCsv(org));
    expect(gifts).toHaveLength(org.gifts.length + 1);
    org.gifts[0]!.excluded = true;
    expect(parseCsv(giftsCsv(org))[1]!.at(-1)).toBe('yes');
    expect(JSON.parse(backupJson({ version: 1, activeOrgId: org.id, orgs: [org] })).orgs[0].name).toContain('Riverbend');
  });
});
