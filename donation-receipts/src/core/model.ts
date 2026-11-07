/** Everything the app keeps, per organisation. Saved in this browser and in backup files. */

export interface Donor {
  id: string;
  name: string;
  email: string;
  address: string;
  /** Bank text this donor's gifts arrive with ("J CITIZEN", "ENV 042"); learned when a gift is linked. */
  aliases: string[];
}

export interface Gift {
  id: string;
  /** Same date, amount and bank text: used to skip lines already imported. */
  key: string;
  date: string;
  amountCents: number;
  payee: string;
  description: string;
  reference: string;
  account: string;
  donorId?: string;
  /** Marked "not a donation" (a grant, refund, sale or transfer). */
  excluded?: boolean;
  /** The receipt currently covering this gift, if any. */
  receiptNo?: string;
}

export interface Receipt {
  number: string;
  giftId: string;
  donorId: string;
  /** Copied at issue time, so the register still reads right if the donor is renamed later. */
  donorName: string;
  giftDate: string;
  amountCents: number;
  issuedOn: string;
  status: 'issued' | 'void';
  voidReason?: string;
  voidedOn?: string;
}

export interface Org {
  id: string;
  name: string;
  abn: string;
  /** Endorsed by the ATO as a deductible gift recipient. */
  dgr: boolean;
  address: string;
  email: string;
  phone: string;
  signatory: string;
  signatoryTitle: string;
  receiptPrefix: string;
  nextReceiptNo: number;
  thankYou: string;
  donors: Donor[];
  gifts: Gift[];
  receipts: Receipt[];
}

export interface AppData {
  version: 1;
  activeOrgId: string;
  orgs: Org[];
}

let counter = 0;
/** Short unique id; deterministic enough for tests that only compare structure. */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, '0')}`;
}

export function newOrg(name = 'My organisation'): Org {
  return {
    id: newId('o'),
    name,
    abn: '',
    dgr: true,
    address: '',
    email: '',
    phone: '',
    signatory: '',
    signatoryTitle: 'Treasurer',
    receiptPrefix: 'R',
    nextReceiptNo: 1,
    thankYou: 'Thank you for your generous gift. It makes our work possible.',
    donors: [],
    gifts: [],
    receipts: [],
  };
}

export function emptyData(): AppData {
  const org = newOrg();
  return { version: 1, activeOrgId: org.id, orgs: [org] };
}

export function activeOrg(data: AppData): Org {
  return data.orgs.find((o) => o.id === data.activeOrgId) ?? data.orgs[0]!;
}

export function donorById(org: Org, id: string | undefined): Donor | undefined {
  return id ? org.donors.find((d) => d.id === id) : undefined;
}

/** Australian Business Number check: 11 digits, weighted sum (first digit minus one) divisible by 89. */
export function isValidAbn(raw: string): boolean {
  const digits = raw.replace(/\s/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += (Number(digits[i]) - (i === 0 ? 1 : 0)) * weights[i]!;
  return sum % 89 === 0;
}

/** "51824753556" -> "51 824 753 556" */
export function formatAbn(raw: string): string {
  const d = raw.replace(/\s/g, '');
  return /^\d{11}$/.test(d) ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : raw.trim();
}

/** What is missing before receipts can be issued in this organisation's name. */
export function orgProblems(org: Org): string[] {
  const out: string[] = [];
  if (!org.name.trim() || org.name === 'My organisation') out.push("Enter your organisation's legal name.");
  if (org.dgr && !org.abn.trim()) out.push('A deductible gift receipt must show your ABN.');
  else if (org.abn.trim() && !isValidAbn(org.abn)) out.push('The ABN does not pass the ATO check digit test. Check for a typo.');
  if (!Number.isInteger(org.nextReceiptNo) || org.nextReceiptNo < 1) out.push('The next receipt number must be a whole number of 1 or more.');
  return out;
}

/** Check a backup file and bring it to the current shape. Throws a readable error. */
export function validateData(raw: unknown): AppData {
  const d = raw as Partial<AppData> | null;
  if (!d || typeof d !== 'object' || d.version !== 1 || !Array.isArray(d.orgs) || d.orgs.length === 0) {
    throw new Error('This is not a Donation Receipts backup file.');
  }
  const base = newOrg();
  const orgs = d.orgs.map((o) => {
    if (!o || typeof o !== 'object' || typeof o.id !== 'string') throw new Error('The backup file is damaged.');
    return {
      ...base,
      ...o,
      donors: Array.isArray(o.donors) ? o.donors.map((x) => ({ ...x, aliases: Array.isArray(x.aliases) ? x.aliases : [] })) : [],
      gifts: Array.isArray(o.gifts) ? o.gifts : [],
      receipts: Array.isArray(o.receipts) ? o.receipts : [],
    };
  });
  const activeOrgId = orgs.some((o) => o.id === d.activeOrgId) ? (d.activeOrgId as string) : orgs[0]!.id;
  return { version: 1, activeOrgId, orgs };
}
