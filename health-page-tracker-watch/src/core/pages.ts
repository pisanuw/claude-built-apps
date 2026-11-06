/**
 * Which pages are "health pages": pages whose address or title shows that
 * the visitor is booking care, filling in intake paperwork, or reading
 * about a condition or treatment. A visit to one of those, plus an IP
 * address, is the combination the privacy rules and lawsuits are about.
 *
 * The guess is by keywords. The owner can change any page's kind.
 */

export type PageKind = 'booking' | 'intake' | 'service' | 'contact' | 'home' | 'other';

export const PAGE_KINDS: Array<{ kind: PageKind; label: string; health: boolean }> = [
  { kind: 'booking', label: 'Booking', health: true },
  { kind: 'intake', label: 'Intake or forms', health: true },
  { kind: 'service', label: 'Service or condition', health: true },
  { kind: 'contact', label: 'Contact', health: false },
  { kind: 'home', label: 'Home page', health: false },
  { kind: 'other', label: 'Other (about, blog…)', health: false },
];

export function isHealthKind(kind: PageKind): boolean {
  return PAGE_KINDS.find((k) => k.kind === kind)?.health ?? false;
}

export function kindLabel(kind: PageKind): string {
  return PAGE_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

const BOOKING = /\b(book|booking|bookings|appointments?|schedul(e|ing)|reserve|reservations?|request-an?-appointment|consultation|get-started|availability)\b/;
const INTAKE = /\b(intake|new-(patient|client)s?|forms?|paperwork|questionnaire|patient-portal|client-portal|portal|registration|consent|telehealth)\b/;
const SERVICE = new RegExp(
  '\\b(' +
    [
      'services?', 'treatments?', 'conditions?', 'specialt(y|ies)', 'therap(y|ies|ist|ists)', 'counsel+ing', 'psychotherapy', 'psychiatry',
      'anxiety', 'depression', 'trauma', 'ptsd', 'emdr', 'grief', 'ocd', 'adhd', 'autism', 'bipolar', 'addiction', 'recovery', 'substance',
      'eating-disorders?', 'couples', 'marriage', 'family', 'sex', 'lgbtq', 'gender', 'fertility', 'ivf', 'pregnancy', 'prenatal', 'postpartum',
      'menopause', 'hormones?', 'hrt', 'weight-loss', 'semaglutide', 'tirzepatide', 'glp-1', 'botox', 'fillers?', 'injectables?', 'laser',
      'dental', 'implants?', 'orthodontics', 'invisalign', 'physical-therapy', 'physiotherapy', 'chiropractic', 'acupuncture', 'massage',
      'pelvic-floor', 'sports-injur(y|ies)', 'pain', 'sleep', 'nutrition', 'dietitian', 'iv-therapy', 'ketamine', 'testosterone', 'std', 'sti',
    ].join('|') +
    ')\\b',
);
const CONTACT = /\b(contact|contact-us|location|locations|directions|find-us)\b/;

/** Words from a URL path and page title, lower-cased and hyphen-joined. */
function words(url: string, title: string): string {
  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  const fromPath = decodeURIComponentSafe(path).toLowerCase().replace(/[_./]+/g, ' ');
  const fromTitle = title.toLowerCase().replace(/\s+/g, '-');
  return `${fromPath} ${fromTitle}`;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function pathOnly(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Best guess of a page's kind from its address and title. */
export function guessPageKind(url: string, title = ''): PageKind {
  const path = pathOnly(url);
  // Title words are checked only for health kinds; "Home" pages often carry the practice's specialty in the title.
  const pathWords = words(url, '');
  if (BOOKING.test(pathWords)) return 'booking';
  if (INTAKE.test(pathWords)) return 'intake';
  if (SERVICE.test(pathWords)) return 'service';
  if (CONTACT.test(pathWords)) return 'contact';
  if (path === '/' || path === '' || /^\/(index\.html?|home)\/?$/i.test(path)) return 'home';
  const all = words(url, title);
  if (BOOKING.test(all)) return 'booking';
  if (SERVICE.test(all)) return 'service';
  return 'other';
}
