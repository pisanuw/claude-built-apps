import type { PageFacts } from '../src/core/types';

/** A page's facts with everything empty, for checks tests. */
export function facts(url: string, over: Partial<PageFacts> = {}): PageFacts {
  return {
    url, status: 200, kind: 'other', title: '', links: [], emails: [], phones: [], names: [], addresses: [],
    shipping: [], returns: [], freeShipping: [], offers: [], structuredPrices: [], productSchemaCount: 0, risky: [], ...over,
  };
}

/** A store that passes every page check, to add one problem at a time to. */
export function cleanStore(): PageFacts[] {
  const S = 'https://shop.com';
  const contact = { emails: ['hi@shop.com'], phones: [{ digits: '285550147', text: '(828) 555-0147' }], names: [{ name: 'Shop Co', source: 'copyright line' }], addresses: [{ text: '1 Main Street, Town 12345', postcode: '12345', source: 'page text' }] };
  return [
    facts(`${S}/`, { kind: 'home', ...contact }),
    facts(`${S}/pages/contact`, { kind: 'contact', ...contact }),
    facts(`${S}/policies/shipping-policy`, { kind: 'shipping', shipping: [{ min: 1, max: 2, business: true, stage: 'processing', speed: 'standard', text: 'Ships in 1-2 business days.' }, { min: 3, max: 5, business: true, stage: 'delivery', speed: 'standard', text: 'Arrives in 3-5 business days.' }] }),
    facts(`${S}/policies/refund-policy`, { kind: 'returns', returns: [{ days: 30, noReturns: false, text: '30-day returns.' }] }),
    facts(`${S}/policies/terms-of-service`, { kind: 'terms' }),
  ];
}
