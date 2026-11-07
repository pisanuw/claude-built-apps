/**
 * Receipts and annual statements as simple documents: a list of blocks that
 * render the same way on screen, in a PDF and as plain email text.
 */
import { financialYear, fyLabel, fyRange, longDate, shortDate } from './dates';
import { amountInWords, formatMoney } from './money';
import { formatAbn, orgProblems, type Donor, type Gift, type Org, type Receipt } from './model';

export type Block =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'small'; text: string }
  | { kind: 'row'; left: string; right: string }
  | { kind: 'table'; head: string[]; rows: string[][]; foot?: string[] }
  | { kind: 'banner'; text: string }
  | { kind: 'rule' }
  | { kind: 'space' };

export interface Doc {
  title: string;
  filename: string;
  blocks: Block[];
}

/** Gifts of less than $2 are not deductible (ATO). */
export const MIN_DEDUCTIBLE_CENTS = 200;

export function receiptWording(org: Org, cents: number): string {
  const name = org.name.trim();
  if (!org.dgr) {
    return `This receipt acknowledges a gift of money. ${name} is not endorsed as a deductible gift recipient, so this gift is not tax deductible.`;
  }
  if (cents < MIN_DEDUCTIBLE_CENTS) {
    return `This receipt is for a gift of money to ${name}. Gifts of less than $2 are not tax deductible.`;
  }
  return `This receipt is for a gift of money to ${name}, which is endorsed as a deductible gift recipient. Gifts of $2 or more are tax deductible. No goods or services were provided in return for this gift.`;
}

function letterhead(org: Org): Block[] {
  const blocks: Block[] = [{ kind: 'title', text: org.name.trim() }];
  if (org.address.trim()) blocks.push({ kind: 'small', text: org.address.trim().replace(/\s*\n\s*/g, ', ') });
  const contact = [org.abn.trim() ? `ABN ${formatAbn(org.abn)}` : '', org.email.trim(), org.phone.trim()].filter(Boolean).join('   ·   ');
  if (contact) blocks.push({ kind: 'small', text: contact });
  blocks.push({ kind: 'rule' });
  return blocks;
}

function signature(org: Org): Block[] {
  if (!org.signatory.trim()) return [];
  const who = org.signatoryTitle.trim() ? `${org.signatory.trim()}, ${org.signatoryTitle.trim()}` : org.signatory.trim();
  return [{ kind: 'space' }, { kind: 'text', text: `Issued for ${org.name.trim()} by ${who}` }];
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'donor';
}

export function receiptDoc(org: Org, r: Receipt, donor: Donor | undefined): Doc {
  const deductible = org.dgr && r.amountCents >= MIN_DEDUCTIBLE_CENTS;
  const blocks: Block[] = [...letterhead(org)];
  if (r.status === 'void') blocks.push({ kind: 'banner', text: `VOID${r.voidReason ? `: ${r.voidReason}` : ''}` });
  blocks.push({ kind: 'heading', text: deductible ? 'Receipt for a tax deductible gift' : 'Donation receipt' });
  blocks.push(
    { kind: 'row', left: 'Receipt number', right: r.number },
    { kind: 'row', left: 'Date issued', right: longDate(r.issuedOn) },
    { kind: 'row', left: 'Received from', right: donor?.name.trim() || r.donorName },
  );
  const address = donor?.address.trim();
  if (address) blocks.push({ kind: 'row', left: '', right: address.replace(/\s*\n\s*/g, ', ') });
  blocks.push(
    { kind: 'row', left: 'Date of gift', right: longDate(r.giftDate) },
    { kind: 'row', left: 'Amount', right: formatMoney(r.amountCents) },
    { kind: 'row', left: '', right: `(${amountInWords(r.amountCents)})` },
    { kind: 'space' },
    { kind: 'text', text: receiptWording(org, r.amountCents) },
  );
  if (org.thankYou.trim()) blocks.push({ kind: 'text', text: org.thankYou.trim() });
  blocks.push(...signature(org));
  if (deductible) blocks.push({ kind: 'space' }, { kind: 'small', text: 'Please keep this receipt for your tax records.' });
  return {
    title: `Receipt ${r.number}`,
    filename: `receipt-${safeName(r.number)}-${safeName(r.donorName)}.pdf`,
    blocks,
  };
}

/** Problems that stop a receipt being issued for this gift, or [] when it is ready. */
export function giftProblems(org: Org, g: Gift): string[] {
  const out: string[] = [];
  if (g.excluded) out.push('Marked as not a donation.');
  if (g.receiptNo) out.push(`Already receipted (${g.receiptNo}).`);
  if (!g.donorId || !org.donors.some((d) => d.id === g.donorId)) out.push('Choose the donor first.');
  return out;
}

export function readyGifts(org: Org): Gift[] {
  return org.gifts.filter((g) => giftProblems(org, g).length === 0);
}

export function formatReceiptNo(org: Org, n: number): string {
  return `${org.receiptPrefix.trim()}${String(n).padStart(5, '0')}`;
}

/** Issue numbered receipts for the given gifts (only the ready ones), in date order. */
export function issueReceipts(org: Org, giftIds: string[], today: string): Receipt[] {
  const problems = orgProblems(org);
  if (problems.length) throw new Error(problems.join(' '));
  const wanted = new Set(giftIds);
  const issued: Receipt[] = [];
  for (const g of readyGifts(org).filter((x) => wanted.has(x.id))) {
    const donor = org.donors.find((d) => d.id === g.donorId)!;
    let number = formatReceiptNo(org, org.nextReceiptNo);
    while (org.receipts.some((r) => r.number === number)) {
      org.nextReceiptNo++;
      number = formatReceiptNo(org, org.nextReceiptNo);
    }
    org.nextReceiptNo++;
    const r: Receipt = {
      number,
      giftId: g.id,
      donorId: donor.id,
      donorName: donor.name.trim(),
      giftDate: g.date,
      amountCents: g.amountCents,
      issuedOn: today,
      status: 'issued',
    };
    g.receiptNo = number;
    org.receipts.push(r);
    issued.push(r);
  }
  return issued;
}

/** Cancel a receipt. Its number is never reused; the gift can be receipted again under a new number. */
export function voidReceipt(org: Org, number: string, reason: string, today: string): void {
  const r = org.receipts.find((x) => x.number === number);
  if (!r) throw new Error(`No receipt ${number}.`);
  if (r.status === 'void') throw new Error(`Receipt ${number} is already void.`);
  if (!reason.trim()) throw new Error('Say why the receipt is void; the auditor will ask.');
  r.status = 'void';
  r.voidReason = reason.trim();
  r.voidedOn = today;
  const g = org.gifts.find((x) => x.id === r.giftId);
  if (g && g.receiptNo === number) delete g.receiptNo;
}

export interface DonorYear {
  donor: Donor;
  gifts: Gift[];
  totalCents: number;
  deductibleCents: number;
}

/** Each donor's linked gifts in one financial year, by name. */
export function donorYears(org: Org, fy: number): DonorYear[] {
  const { start, end } = fyRange(fy);
  return org.donors
    .map((donor) => {
      const gifts = org.gifts.filter((g) => g.donorId === donor.id && !g.excluded && g.date >= start && g.date <= end);
      const totalCents = gifts.reduce((n, g) => n + g.amountCents, 0);
      const deductibleCents = org.dgr ? gifts.filter((g) => g.amountCents >= MIN_DEDUCTIBLE_CENTS).reduce((n, g) => n + g.amountCents, 0) : 0;
      return { donor, gifts, totalCents, deductibleCents };
    })
    .filter((y) => y.gifts.length > 0)
    .sort((a, b) => a.donor.name.localeCompare(b.donor.name));
}

/** Financial years that hold any gift, newest first. */
export function yearsWithGifts(org: Org): number[] {
  return [...new Set(org.gifts.map((g) => financialYear(g.date)))].sort((a, b) => b - a);
}

export function statementDoc(org: Org, fy: number, y: DonorYear, today: string): Doc {
  const { start, end } = fyRange(fy);
  const blocks: Block[] = [
    ...letterhead(org),
    { kind: 'heading', text: `Annual statement of gifts, ${fyLabel(fy)}` },
    { kind: 'row', left: 'Donor', right: y.donor.name.trim() },
  ];
  if (y.donor.address.trim()) blocks.push({ kind: 'row', left: '', right: y.donor.address.trim().replace(/\s*\n\s*/g, ', ') });
  blocks.push(
    { kind: 'row', left: 'Period', right: `${longDate(start)} to ${longDate(end)}` },
    { kind: 'row', left: 'Date issued', right: longDate(today) },
    { kind: 'space' },
    {
      kind: 'table',
      head: ['Date', 'Receipt', 'Amount'],
      rows: y.gifts.map((g) => [shortDate(g.date), g.receiptNo ?? '—', formatMoney(g.amountCents)]),
      foot: ['Total', '', formatMoney(y.totalCents)],
    },
    { kind: 'space' },
  );
  if (org.dgr) {
    const under = y.totalCents - y.deductibleCents;
    blocks.push({
      kind: 'text',
      text:
        `${org.name.trim()} is endorsed as a deductible gift recipient. Your gifts of $2 or more in this period total ${formatMoney(y.deductibleCents)} and are tax deductible.` +
        (under > 0 ? ` Gifts under $2 (${formatMoney(under)}) are not deductible.` : '') +
        ' No goods or services were provided in return for these gifts. You can use this statement with your tax return.',
    });
  } else {
    blocks.push({
      kind: 'text',
      text: `${org.name.trim()} is not endorsed as a deductible gift recipient, so these gifts are not tax deductible.`,
    });
  }
  if (org.thankYou.trim()) blocks.push({ kind: 'text', text: org.thankYou.trim() });
  blocks.push(...signature(org));
  return {
    title: `Statement ${fyLabel(fy)}: ${y.donor.name.trim()}`,
    filename: `statement-${fyLabel(fy)}-${safeName(y.donor.name)}.pdf`,
    blocks,
  };
}

/** A document as plain text, for an email body or the clipboard. */
export function docToText(doc: Doc): string {
  const out: string[] = [];
  for (const b of doc.blocks) {
    if (b.kind === 'title' || b.kind === 'heading') out.push(b.text.toUpperCase());
    else if (b.kind === 'text' || b.kind === 'small' || b.kind === 'banner') out.push(b.text);
    else if (b.kind === 'row') out.push(b.left ? `${b.left}: ${b.right}` : `  ${b.right}`);
    else if (b.kind === 'table') {
      out.push(b.head.join(' | '));
      for (const r of b.rows) out.push(r.join(' | '));
      if (b.foot) out.push(b.foot.filter(Boolean).join(': '));
    } else if (b.kind === 'rule') out.push('—'.repeat(24));
    else out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** A mailto: link with the document in the body; the PDF is attached by hand. */
export function mailtoLink(to: string, org: Org, doc: Doc): string {
  const subject = `${doc.title} from ${org.name.trim()}`;
  const body = `${docToText(doc)}\nA PDF copy is attached.\n`;
  return `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
