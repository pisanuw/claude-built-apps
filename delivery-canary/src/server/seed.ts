/**
 * The seed inbox check: signs in to the shop's seed Gmail account over IMAP
 * with an app password, finds the newest delivery email from the shop's
 * sender (in All Mail and in Spam), reads where Gmail put it (Primary,
 * Promotions, Social, Updates, Forums, archived, Spam) and returns the raw
 * message for the delivery-email check.
 *
 * Only imap.gmail.com is ever contacted (the host is fixed, never taken from
 * the request). Nothing is changed in the mailbox: folders are opened with
 * EXAMINE (read-only) and the message is read with BODY.PEEK.
 */
import { connect as tlsConnect } from 'node:tls';
import type { Duplex } from 'node:stream';
import { WHERE_PLACEMENT, type SeedWhere } from '../core/seedwhere';
import type { Placement } from '../core/types';
import { fetchItems, ImapClient, ImapError, internalDate, listEntries, quote, searchIds, str, type Token } from './imap';

export const GMAIL_IMAP_HOST = 'imap.gmail.com';
export const GMAIL_IMAP_PORT = 993;
/** The most of one message read back; a delivery email is far smaller. */
export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_DAYS = 14;

export interface SeedQuery {
  address: string;
  password: string;
  /** The address or domain the delivery emails come from. */
  sender: string;
  /** Optional words from the subject, to tell the delivery email from other mail by the same sender. */
  subject: string;
  /** How far back to look, in days. */
  days: number;
}

export type { SeedWhere };

export interface SeedFound {
  found: true;
  where: SeedWhere;
  placement: Placement;
  /** When Gmail received it (INTERNALDATE), ISO. */
  receivedAt: string;
  /** Gmail labels other than the system ones, for the page to show. */
  labels: string[];
  size: number;
  /** True when the message was larger than MAX_MESSAGE_BYTES and only its start was read. */
  truncated: boolean;
  /** The message bytes, base64. */
  raw: string;
}

export interface SeedNotFound {
  found: false;
}

export type SeedResult = SeedFound | SeedNotFound;

export type SeedErrorCode = 'login-failed' | 'needs-app-password' | 'web-login' | 'imap-off' | 'unreachable' | 'timeout' | 'mailbox' | 'protocol';

/** A seed check that could not finish, with a plain-words message for the shop owner. */
export class SeedError extends Error {
  constructor(
    readonly code: SeedErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const SENDER_RE = /^(?:[A-Za-z0-9._%+-]{1,64}@)?[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)+$/;
const ADDRESS_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const SUBJECT_RE = /^[A-Za-z0-9 .,:;!?'&#$%*/+=@_-]{0,100}$/;

/** Normalises and checks a query's fields; returns the first problem in plain words, or ''. */
export function seedQueryProblem(q: SeedQuery): string {
  if (!ADDRESS_RE.test(q.address) || q.address.length > 254) return 'Enter the seed Gmail address (for example canary.myshop@gmail.com).';
  if (!SENDER_RE.test(q.sender) || q.sender.length > 254) return 'Enter the address or domain your download emails come from (for example orders@myshop.com or myshop.com).';
  if (!SUBJECT_RE.test(q.subject)) return 'Subject words may use letters, digits, spaces and simple punctuation only (no quotes or brackets), at most 100 characters.';
  if (!/^[\x21-\x7e]{8,64}$/.test(q.password)) return 'Paste the 16-letter app password from your Google Account (spaces are fine).';
  if (!Number.isInteger(q.days) || q.days < 1 || q.days > 60) return 'Look back between 1 and 60 days.';
  return '';
}

/** App passwords are shown as four groups of four letters; spaces are not part of them. */
export function cleanPassword(p: string): string {
  return p.replace(/\s+/g, '');
}

/** The Gmail search for the query (X-GM-RAW syntax). */
export function gmailSearch(q: Pick<SeedQuery, 'sender' | 'subject' | 'days'>): string {
  const words = q.subject.trim().split(/\s+/).filter(Boolean);
  return [`from:${q.sender}`, `newer_than:${q.days}d`, words.length ? `subject:(${words.join(' ')})` : ''].filter(Boolean).join(' ');
}

/** Maps a refused LOGIN to what the shop owner should do. */
export function loginError(e: ImapError): SeedError {
  const text = `${e.response?.code ?? ''} ${e.response?.text ?? e.message}`;
  if (/application-specific password|app password/i.test(text)) {
    return new SeedError('needs-app-password', 'Gmail wants an app password, not the account\'s normal password. Turn on 2-Step Verification for the seed account, then create an app password at myaccount.google.com/apppasswords and paste it here.');
  }
  if (/web ?browser|WEBALERT/i.test(text)) {
    return new SeedError('web-login', 'Google blocked this sign-in as unusual. Sign in to the seed account once in a browser, confirm it was you, then check again.');
  }
  if (/not enabled for IMAP|IMAP access/i.test(text)) {
    return new SeedError('imap-off', 'IMAP is turned off for the seed account. In Gmail, open Settings, "Forwarding and POP/IMAP", turn on IMAP, then check again.');
  }
  return new SeedError('login-failed', 'Gmail did not accept this address and app password. Check the address, create a new app password at myaccount.google.com/apppasswords, and paste it here.');
}

interface Mailboxes {
  all: string;
  spam: string;
}

/** Finds All Mail and Spam by their special-use flags, whatever language the account uses. */
export function findMailboxes(entries: Array<{ flags: string[]; name: string }>): Mailboxes {
  const by = (flag: string, fallback: RegExp) =>
    entries.find((e) => e.flags.some((f) => f.toLowerCase() === flag))?.name ?? entries.find((e) => fallback.test(e.name))?.name ?? '';
  return { all: by('\\all', /^\[(Gmail|Google Mail)\]\/All Mail$/i), spam: by('\\junk', /^\[(Gmail|Google Mail)\]\/Spam$/i) };
}

const SYSTEM_LABELS = new Set(['\\inbox', '\\important', '\\starred', '\\sent', '\\draft', '\\drafts', '\\spam', '\\trash']);
const CATEGORIES: Array<Exclude<SeedWhere, 'primary' | 'archived' | 'spam'>> = ['promotions', 'social', 'updates', 'forums'];

interface Candidate {
  box: 'all' | 'spam';
  uid: number;
  receivedAt: string;
}

/** The newest matching message in the open folder, by UID, with its arrival time. */
async function newestIn(c: ImapClient, box: Candidate['box'], search: string): Promise<Candidate | null> {
  const ids = searchIds((await c.command(`UID SEARCH X-GM-RAW ${quote(search)}`)).untagged);
  if (!ids.length) return null;
  const uid = Math.max(...ids);
  const res = await c.command(`UID FETCH ${uid} (UID INTERNALDATE)`);
  const item = res.untagged.map(fetchItems).find((m) => Number(str(m.get('UID'))) === uid);
  return { box, uid, receivedAt: internalDate(str(item?.get('INTERNALDATE'))) };
}

async function examine(c: ImapClient, name: string): Promise<void> {
  try {
    await c.command(`EXAMINE ${quote(name)}`);
  } catch (e) {
    if (e instanceof ImapError && (e.kind === 'no' || e.kind === 'bad')) throw new SeedError('mailbox', `Could not open the folder "${name}" in the seed mailbox.`);
    throw e;
  }
}

/** The steps after LOGIN, on a signed-in client. */
export async function findDelivery(c: ImapClient, q: SeedQuery): Promise<SeedResult> {
  const boxes = findMailboxes(listEntries((await c.command('LIST "" "*"')).untagged));
  if (!boxes.all) throw new SeedError('mailbox', 'This does not look like a Gmail mailbox: it has no All Mail folder. The seed account must be a Gmail or Google Workspace account.');
  const search = gmailSearch(q);

  const candidates: Candidate[] = [];
  if (boxes.spam) {
    await examine(c, boxes.spam);
    const s = await newestIn(c, 'spam', search);
    if (s) candidates.push(s);
  }
  await examine(c, boxes.all);
  const a = await newestIn(c, 'all', search);
  if (a) candidates.push(a);
  if (!candidates.length) return { found: false };
  // Newest by arrival; a spam copy wins a tie (a buyer would not see it).
  candidates.sort((x, y) => (x.receivedAt < y.receivedAt ? 1 : x.receivedAt > y.receivedAt ? -1 : x.box === 'spam' ? -1 : 1));
  const pick = candidates[0];
  if (pick.box === 'spam') await examine(c, boxes.spam); // All Mail is open; go back to Spam to read it

  const res = await c.command(`UID FETCH ${pick.uid} (UID INTERNALDATE RFC822.SIZE X-GM-LABELS BODY.PEEK[]<0.${MAX_MESSAGE_BYTES}>)`);
  const item = res.untagged.map(fetchItems).find((m) => Number(str(m.get('UID'))) === pick.uid);
  const body = item ? [...item.entries()].find(([k]) => k.startsWith('BODY[]'))?.[1] : undefined;
  if (!item || !Buffer.isBuffer(body)) throw new SeedError('protocol', 'Gmail found the email but did not send it. Try again in a minute.');
  const labelTokens = item.get('X-GM-LABELS');
  const labels = (Array.isArray(labelTokens) ? labelTokens : []).map((t: Token) => str(t));
  const size = Number(str(item.get('RFC822.SIZE'))) || body.length;

  let where: SeedWhere;
  if (pick.box === 'spam') where = 'spam';
  else if (!labels.some((l) => l.toLowerCase() === '\\inbox')) where = 'archived';
  else {
    where = 'primary';
    for (const cat of CATEGORIES) {
      const hit = searchIds((await c.command(`UID SEARCH UID ${pick.uid} X-GM-RAW ${quote(`category:${cat}`)}`)).untagged);
      if (hit.includes(pick.uid)) {
        where = cat;
        break;
      }
    }
  }
  return {
    found: true,
    where,
    placement: WHERE_PLACEMENT[where],
    receivedAt: internalDate(str(item.get('INTERNALDATE'))) || pick.receivedAt,
    labels: labels.filter((l) => !SYSTEM_LABELS.has(l.toLowerCase())).slice(0, 20).map((l) => l.slice(0, 100)),
    size,
    truncated: size > body.length,
    raw: body.toString('base64'),
  };
}

/** Signs in on a connected stream and runs the check; always logs out. */
export async function runSeedCheck(socket: Duplex, q: SeedQuery, deadline: number, now: () => number = Date.now): Promise<SeedResult> {
  const c = new ImapClient(socket, { deadline, now });
  try {
    await c.greeting();
    try {
      await c.command(`LOGIN ${quote(q.address)} ${quote(q.password)}`);
    } catch (e) {
      if (e instanceof ImapError && e.kind === 'no') throw loginError(e);
      throw e;
    }
    return await findDelivery(c, q);
  } catch (e) {
    if (e instanceof SeedError) throw e;
    if (e instanceof ImapError && e.kind === 'timeout') throw new SeedError('timeout', 'Gmail took too long to answer. Try again in a minute.');
    if (e instanceof ImapError && e.kind === 'closed') throw new SeedError('unreachable', 'The connection to Gmail closed before the check finished. Try again in a minute.');
    throw new SeedError('protocol', 'Gmail answered in a way this check did not expect. Try again in a minute.');
  } finally {
    await c.logout();
  }
}

/** Reads the greeting only (no sign-in): proves the function can reach the IMAP server. */
export async function greetingOnly(socket: Duplex, deadline: number, now: () => number = Date.now): Promise<boolean> {
  const c = new ImapClient(socket, { deadline, now });
  try {
    await c.greeting();
    return true;
  } catch {
    return false;
  } finally {
    socket.destroy();
  }
}

/* v8 ignore start -- the live connection; tests drive runSeedCheck with a scripted server */
async function connectGmail(budgetMs: number): Promise<Duplex> {
  return new Promise<Duplex>((resolve, reject) => {
    const s = tlsConnect({ host: GMAIL_IMAP_HOST, port: GMAIL_IMAP_PORT, servername: GMAIL_IMAP_HOST, timeout: budgetMs });
    s.once('secureConnect', () => resolve(s));
    s.once('timeout', () => {
      s.destroy();
      reject(new SeedError('timeout', 'Gmail took too long to answer. Try again in a minute.'));
    });
    s.once('error', () => reject(new SeedError('unreachable', 'Could not reach Gmail. Try again in a minute.')));
  });
}

/** True when imap.gmail.com:993 answers with a greeting within budgetMs. */
export async function gmailReachableLive(budgetMs = 4000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  try {
    return await greetingOnly(await connectGmail(budgetMs), deadline);
  } catch {
    return false;
  }
}

/** Opens TLS to imap.gmail.com:993 and runs the check, within budgetMs. */
export async function seedCheckLive(q: SeedQuery, budgetMs = 7500): Promise<SeedResult> {
  const deadline = Date.now() + budgetMs;
  return runSeedCheck(await connectGmail(budgetMs), q, deadline);
}
/* v8 ignore stop */
