import { emptyFleet, normalizeUrl, type Check, type Finding, type Fleet, type Impact, type Site } from './model';
import { buildStatement, statementText } from './statement';
import { criteriaForRule } from './wcag';

/**
 * A made-up agency with six made-up client sites and four months of checks,
 * dated relative to today so the demo always looks current. The businesses
 * and addresses are fictional (example.com/.org domains).
 */

const HELP: Record<string, [string, Impact]> = {
  'color-contrast': ['Elements must meet minimum color contrast ratio thresholds', 'serious'],
  'image-alt': ['Images must have alternative text', 'critical'],
  'link-name': ['Links must have discernible text', 'serious'],
  'button-name': ['Buttons must have discernible text', 'critical'],
  label: ['Form elements must have labels', 'critical'],
  'html-has-lang': ['<html> element must have a lang attribute', 'serious'],
  'document-title': ['Documents must have <title> element to aid in navigation', 'serious'],
  list: ['<ul> and <ol> must only directly contain <li>, <script> or <template> elements', 'serious'],
  'frame-title': ['Frames must have an accessible name', 'serious'],
  'aria-allowed-attr': ['Elements must only use supported ARIA attributes', 'critical'],
  'link-in-text-block': ['Links must be distinguishable without relying on color', 'serious'],
  'target-size': ['All touch targets must be 24px large, or leave sufficient space', 'serious'],
  'meta-viewport': ['Zooming and scaling must not be disabled', 'critical'],
  'select-name': ['Select element must have an accessible name', 'critical'],
  'autocomplete-valid': ['autocomplete attribute must be used correctly', 'serious'],
  'heading-order': ['Heading levels should only increase by one', 'moderate'],
  region: ['All page content should be contained by landmarks', 'moderate'],
};

function f(rule: string, count: number): Finding {
  const [help, impact] = HELP[rule];
  return { ruleId: rule, help, impact, criteria: criteriaForRule(rule), count };
}

type PagePlan = Record<string, [string, number][]>;

interface SitePlan {
  site: Omit<Site, 'id'>;
  /** Day offsets from today, oldest first, one per check. */
  days: number[];
  /** One plan per check: page path -> findings. */
  checks: PagePlan[];
  statementAfter?: number;
}

function iso(today: string, offset: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}

const BAKERY: PagePlan = {
  '/': [['color-contrast', 6], ['image-alt', 3], ['link-name', 2], ['region', 4]],
  '/menu': [['color-contrast', 9], ['list', 1]],
  '/order': [['label', 3], ['select-name', 1], ['button-name', 1]],
  '/contact': [['frame-title', 1], ['color-contrast', 2]],
};

const PLANS: SitePlan[] = [
  {
    site: { name: 'Harbor Street Bakery', client: 'Harbor Street Bakery Ltd', url: 'https://harborstreetbakery.example.com', owner: 'Harbor Street Bakery Ltd', contactEmail: 'hello@harborstreetbakery.example.com', jurisdiction: 'both', target: '2.1', manualReview: '', knownLimits: 'Our online ordering form is provided by a third-party service. We have asked the provider to fix the problems listed above.' },
    days: [-96, -66, -36, -6],
    checks: [
      BAKERY,
      { ...BAKERY, '/': [['color-contrast', 6], ['link-name', 2], ['region', 4]] },
      { '/': [['color-contrast', 2], ['region', 4]], '/menu': [['color-contrast', 3]], '/order': [['label', 3], ['select-name', 1]], '/contact': [] },
      { '/': [['region', 4]], '/menu': [], '/order': [['label', 2]], '/contact': [], '/gift-cards': [['button-name', 1], ['color-contrast', 1]] },
    ],
    statementAfter: 2,
  },
  {
    site: { name: 'Lindqvist Physiotherapy', client: 'Lindqvist Physio', url: 'https://lindqvist-physio.example.org', owner: 'Lindqvist Physiotherapie GmbH', contactEmail: 'praxis@lindqvist-physio.example.org', jurisdiction: 'eu', target: '2.1', manualReview: '', knownLimits: '' },
    days: [-94, -64, -34, -4],
    checks: [
      { '/': [['html-has-lang', 1], ['image-alt', 5], ['color-contrast', 4]], '/termine': [['label', 4], ['autocomplete-valid', 3]], '/team': [['image-alt', 6]] },
      { '/': [['image-alt', 2], ['color-contrast', 4]], '/termine': [['label', 4], ['autocomplete-valid', 3]], '/team': [] },
      { '/': [['color-contrast', 1]], '/termine': [['autocomplete-valid', 3]], '/team': [] },
      { '/': [], '/termine': [], '/team': [], '/impressum': [] },
    ],
    statementAfter: 3,
  },
  {
    site: { name: 'Corner Hardware', client: 'Okafor & Sons Hardware', url: 'https://cornerhardware.example.com', owner: 'Okafor & Sons Hardware LLC', contactEmail: 'store@cornerhardware.example.com', jurisdiction: 'us', target: '2.1', manualReview: '', knownLimits: '' },
    days: [-97, -67, -37, -7],
    checks: [
      { '/': [['meta-viewport', 1], ['link-name', 7], ['color-contrast', 12]], '/shop': [['button-name', 14], ['image-alt', 22], ['target-size', 18]], '/cart': [['label', 2], ['button-name', 3]] },
      { '/': [['meta-viewport', 1], ['link-name', 7], ['color-contrast', 12]], '/shop': [['button-name', 14], ['image-alt', 22], ['target-size', 18]], '/cart': [['label', 2], ['button-name', 3]] },
      { '/': [['link-name', 5], ['color-contrast', 12]], '/shop': [['button-name', 14], ['image-alt', 20], ['target-size', 18]], '/cart': [['label', 2]] },
      { '/': [['link-name', 5], ['color-contrast', 10], ['aria-allowed-attr', 2]], '/shop': [['button-name', 14], ['image-alt', 20], ['target-size', 18]], '/cart': [['label', 2], ['button-name', 3]] },
    ],
  },
  {
    site: { name: 'Bright Paws Grooming', client: 'Bright Paws', url: 'https://brightpaws.example.com', owner: 'Bright Paws Grooming', contactEmail: 'book@brightpaws.example.com', jurisdiction: 'us', target: '2.2', manualReview: '', knownLimits: '' },
    days: [-100, -70, -48],
    checks: [
      { '/': [['color-contrast', 3], ['link-in-text-block', 2]], '/book': [['label', 5], ['target-size', 6]] },
      { '/': [['color-contrast', 3], ['link-in-text-block', 2]], '/book': [['label', 1], ['target-size', 6]] },
      { '/': [['link-in-text-block', 2]], '/book': [['target-size', 4]] },
    ],
    statementAfter: 0,
  },
  {
    site: { name: 'Studio Nord Yoga', client: 'Studio Nord', url: 'https://studionord.example.org', owner: 'Studio Nord UG', contactEmail: 'kontakt@studionord.example.org', jurisdiction: 'eu', target: '2.2', manualReview: '', knownLimits: '' },
    days: [-90, -60, -30, -2],
    checks: [
      { '/': [['heading-order', 2]], '/kurse': [['color-contrast', 2]], '/preise': [] },
      { '/': [['heading-order', 2]], '/kurse': [], '/preise': [] },
      { '/': [['heading-order', 2]], '/kurse': [], '/preise': [] },
      { '/': [['heading-order', 2]], '/kurse': [['color-contrast', 1]], '/preise': [] },
    ],
    statementAfter: 2,
  },
  {
    site: { name: 'Mesa Family Dental', client: 'Mesa Family Dental', url: 'https://mesadental.example.com', owner: 'Mesa Family Dental PC', contactEmail: 'frontdesk@mesadental.example.com', jurisdiction: 'us', target: '2.1', manualReview: '', knownLimits: '' },
    days: [-33, -3],
    checks: [
      { '/': [['document-title', 1], ['image-alt', 4]], '/new-patients': [['label', 9], ['color-contrast', 3]], '/insurance': [['list', 2]] },
      { '/': [['image-alt', 1]], '/new-patients': [['label', 9]], '/insurance': [] },
    ],
  },
];

export function sampleFleet(today: string): Fleet {
  const fleet = emptyFleet();
  fleet.agency = { name: 'Lakeside Web Studio', email: 'care@lakesideweb.example.com', website: 'lakesideweb.example.com', color: '#1f5f8b', reportFooter: 'Questions about this report? Reply to your monthly care-plan email.' };
  PLANS.forEach((plan, si) => {
    const site: Site = { id: `demo-${si + 1}`, ...plan.site };
    if (si === 1) site.manualReview = iso(today, -20);
    fleet.sites.push(site);
    plan.checks.forEach((pages, ci) => {
      const check: Check = {
        id: `demo-${si + 1}-${ci + 1}`,
        siteId: site.id,
        date: iso(today, plan.days[ci]),
        engine: ci % 2 === 0 ? 'axe-core 4.11.0' : 'axe-core 4.10.3',
        pages: Object.entries(pages).map(([p, list]) => ({ url: normalizeUrl(site.url + p), findings: list.map(([r, n]) => f(r, n)) })),
      };
      fleet.checks.push(check);
      if (plan.statementAfter === ci) {
        const date = check.date;
        const asOf: Fleet = { ...fleet, checks: fleet.checks.filter((c) => c.date <= date) };
        fleet.statements.push({ siteId: site.id, date, text: statementText(buildStatement(asOf, site, date)) });
      }
    });
  });
  fleet.notes['demo-1|https://harborstreetbakery.example.com/order|label'] = 'Ordering form is a third-party widget; vendor ticket open.';
  return fleet;
}
