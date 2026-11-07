/**
 * Suggest which donor a bank line belongs to. Bank lines rarely carry a clean
 * contact, so the evidence is the text the bank passed on: a name, initials,
 * an envelope or member number, and bank text already linked to a donor.
 */
import { formatMoney } from './money';
import { bankText } from './importer';
import { newId, type Donor, type Gift, type Org } from './model';

/** Words banks add that say nothing about who paid. */
const NOISE = new Set(
  (
    'TRANSFER TFR TRF FROM TO DEPOSIT DEP DIRECT CREDIT CR DR OSKO NPP PAYID BPAY PAYMENT PMT PAY INTERNET ONLINE ' +
    'MOBILE BANKING FAST FASTER RECEIPT RECEIVED DONATION DONATIONS DONATE GIFT GIFTS TITHE TITHES OFFERING OFFERINGS ' +
    'REF REFERENCE THE AND FOR VIA ANZ CBA NAB WESTPAC WBC BOQ BENDIGO ING MACQUARIE SUNCORP STGEORGE COMMBANK ' +
    'BANK BANKS EFT EFTPOS ATM CASH CHEQUE CHQ ACCOUNT ACC AC MONTHLY WEEKLY AUTO RECURRING SALARY PTY LTD LIMITED ' +
    'MR MRS MS MISS DR REV FR SR PROF'
  ).split(' '),
);

const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'DR', 'REV', 'FR', 'SR', 'PROF', 'AND', 'PTY', 'LTD', 'LIMITED', 'INC', 'THE']);

export interface Suggestion {
  donorId: string;
  name: string;
  score: number;
  reason: string;
  /** Confident enough to link without a second look. */
  strong: boolean;
}

function words(s: string): string[] {
  return bankText(s).split(' ').filter(Boolean);
}

/** The part of a bank line that says who paid: payee if present, else the description, without bank noise. */
export function identityText(g: Pick<Gift, 'payee' | 'description'>): string {
  const source = g.payee.trim() ? g.payee : g.description;
  return words(source)
    .filter((w) => !NOISE.has(w) && !/^\d{1,2}$/.test(w))
    .join(' ');
}

/** An envelope, member or donor number in the reference ("ENV 042", "M1234"); plain words are ignored. */
export function referenceId(g: Pick<Gift, 'reference'>): string {
  const t = words(g.reference)
    .filter((w) => !NOISE.has(w))
    .join(' ');
  return /\d/.test(t) && /[A-Z0-9]{3,}/.test(t.replace(/ /g, '')) ? t : '';
}

function nameParts(name: string): string[] {
  return words(name).filter((w) => !TITLES.has(w));
}

function hasPhrase(haystack: string, needle: string): boolean {
  return needle.length > 0 && ` ${haystack} `.includes(` ${needle} `);
}

function scoreDonor(d: Donor, g: Gift, all: string, id: string, ref: string, linked: Gift[]): Suggestion | null {
  let score = 0;
  let reason = '';
  for (const alias of d.aliases) {
    if (alias === id || alias === ref || (alias.length >= 6 && hasPhrase(all, alias))) {
      score = 100;
      reason = `“${alias}” was linked to ${d.name} before`;
      break;
    }
  }
  if (!score) {
    const parts = nameParts(d.name);
    const tokens = new Set(all.split(' '));
    if (parts.length >= 2 && parts.every((p) => tokens.has(p))) {
      score = 90;
      reason = 'Full name in the bank text';
    } else if (parts.length >= 2) {
      const surname = parts[parts.length - 1]!;
      const first = parts[0]!;
      if (surname.length >= 2 && tokens.has(surname)) {
        if (tokens.has(first[0]!)) {
          score = 80;
          reason = 'Initial and surname in the bank text';
        } else {
          score = 45;
          reason = 'Surname in the bank text';
        }
      } else if (tokens.has(first) && first.length >= 3) {
        score = 30;
        reason = 'First name in the bank text';
      }
    } else if (parts.length === 1 && parts[0]!.length >= 3 && tokens.has(parts[0]!)) {
      score = 60;
      reason = 'Name in the bank text';
    }
  }
  if (!score) return null;
  const sameAmount = linked.filter((x) => x.donorId === d.id && x.amountCents === g.amountCents).length;
  if (sameAmount && score < 100) {
    score += 10;
    reason += `; gave ${formatMoney(g.amountCents)} ${sameAmount === 1 ? 'once' : `${sameAmount} times`} before`;
  }
  return { donorId: d.id, name: d.name, score, reason, strong: score >= 80 };
}

/** Best donor matches for one gift, most likely first. */
export function suggestDonors(org: Org, g: Gift, limit = 3): Suggestion[] {
  const all = words(`${g.payee} ${g.description} ${g.reference}`).join(' ');
  const id = identityText(g);
  const ref = referenceId(g);
  const linked = org.gifts.filter((x) => x.donorId && x.id !== g.id);
  return org.donors
    .map((d) => scoreDonor(d, g, all, id, ref, linked))
    .filter((s): s is Suggestion => s !== null)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Remember the bank text a gift arrived with, so the next gift from the same payer links itself. */
export function learnAliases(d: Donor, g: Gift): void {
  for (const a of [identityText(g), referenceId(g)]) {
    if (a.length >= 3 && !d.aliases.includes(a)) d.aliases.push(a);
  }
}

export function linkGift(org: Org, giftId: string, donorId: string | undefined): void {
  const g = org.gifts.find((x) => x.id === giftId);
  if (!g || g.receiptNo) return;
  g.donorId = donorId;
  const d = org.donors.find((x) => x.id === donorId);
  if (d) learnAliases(d, g);
}

/** Link every open gift whose best match is strong and unambiguous. Returns how many were linked. */
export function acceptStrongMatches(org: Org): number {
  let n = 0;
  for (const g of org.gifts) {
    if (g.donorId || g.excluded || g.receiptNo) continue;
    const s = suggestDonors(org, g).filter((x) => x.strong);
    if (s.length === 1 || (s.length > 1 && s[0]!.score > s[1]!.score)) {
      linkGift(org, g.id, s[0]!.donorId);
      n++;
    }
  }
  return n;
}

/** Turn bank text into a likely donor name: "J CITIZEN" -> "J Citizen". */
export function nameFromBankText(g: Gift): string {
  return identityText(g)
    .split(' ')
    .filter((w) => w && !/\d/.test(w))
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' ');
}

/** Create a donor from a gift's bank text and link the gift to them. */
export function donorFromGift(org: Org, giftId: string, name?: string): Donor | null {
  const g = org.gifts.find((x) => x.id === giftId);
  if (!g) return null;
  const d: Donor = { id: newId('d'), name: (name ?? nameFromBankText(g)) || 'New donor', email: '', address: '', aliases: [] };
  org.donors.push(d);
  linkGift(org, g.id, d.id);
  return d;
}
