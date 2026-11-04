import type { PageKind } from './types';

/**
 * Which kind of page an address points at. Shopify, WooCommerce, Wix and
 * Squarespace all use predictable addresses for policies and products, and
 * link text fills the gaps ("Shipping & Delivery" -> shipping).
 */
const PATH_RULES: Array<[PageKind, RegExp]> = [
  ['product', /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:collections\/[^/]+\/)?products?\/[^/]+|^\/shop\/p\/|^\/item\/|^\/p\/[^/]+|^\/product-page\//],
  ['listing', /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:collections(?:\/[^/]+)?|shop|store|catalog|product-category\/[^/]+|category\/[^/]+)\/?$/],
  ['shipping', /shipping|delivery|versand|livraison|envio|spedizion|postage/],
  ['returns', /return|refund|exchange|widerruf|retour|cancellation|money-back/],
  ['contact', /contact|kontakt|impressum|imprint|get-in-touch|reach-us|legal-notice/],
  ['terms', /terms|conditions|\btos\b|\bagb\b|legal(?!-notice)/],
  ['privacy', /privacy|datenschutz|cookie-policy|gdpr/],
  ['about', /about|our-story|who-we-are|ueber-uns|uber-uns/],
  ['faq', /faq|help|questions|support/],
];

const TEXT_RULES: Array<[PageKind, RegExp]> = [
  ['shipping', /\b(shipping|delivery|postage)\b/i],
  ['returns', /\b(returns?|refunds?|exchanges?)\b/i],
  ['contact', /\b(contact|impressum|imprint|get in touch)\b/i],
  ['terms', /\b(terms|conditions)\b/i],
  ['privacy', /\bprivacy\b/i],
  ['about', /\b(about|our story)\b/i],
  ['faq', /\b(faq|help|questions)\b/i],
];

export function classify(url: string, text = ''): PageKind {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return 'other';
  }
  if (path === '/' || path === '') return 'home';
  for (const [kind, re] of PATH_RULES) if (re.test(path)) return kind;
  for (const [kind, re] of TEXT_RULES) if (re.test(text)) return kind;
  return 'other';
}

export const KIND_LABEL: Record<PageKind, string> = {
  home: 'Home page',
  contact: 'Contact',
  about: 'About',
  shipping: 'Shipping policy',
  returns: 'Returns policy',
  terms: 'Terms',
  privacy: 'Privacy',
  faq: 'FAQ / help',
  product: 'Product',
  listing: 'Product list',
  other: 'Other page',
};
