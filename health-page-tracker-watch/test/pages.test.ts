import { describe, expect, it } from 'vitest';
import { guessPageKind, isHealthKind, kindLabel } from '../src/core/pages';

describe('page kinds', () => {
  it.each([
    ['https://x.test/', 'home'],
    ['https://x.test/index.html', 'home'],
    ['https://x.test/book-an-appointment', 'booking'],
    ['https://x.test/schedule', 'booking'],
    ['https://x.test/new-client-forms', 'intake'],
    ['https://x.test/patient-portal', 'intake'],
    ['https://x.test/services/anxiety-therapy', 'service'],
    ['https://x.test/treatments/botox', 'service'],
    ['https://x.test/weight-loss', 'service'],
    ['https://x.test/contact-us', 'contact'],
    ['https://x.test/about', 'other'],
    ['https://x.test/%E0%A4%A', 'other'],
  ])('%s is %s', (url, kind) => {
    expect(guessPageKind(url)).toBe(kind);
  });

  it('uses the title when the address says nothing', () => {
    expect(guessPageKind('https://x.test/p?id=4', 'Book a Session')).toBe('booking');
    expect(guessPageKind('https://x.test/p?id=5', 'Couples Counseling')).toBe('service');
    expect(guessPageKind('not a url')).toBe('other');
  });

  it('labels kinds and knows which are health pages', () => {
    expect(isHealthKind('booking')).toBe(true);
    expect(isHealthKind('home')).toBe(false);
    expect(kindLabel('intake')).toBe('Intake or forms');
    expect(kindLabel('mystery' as never)).toBe('mystery');
    expect(isHealthKind('mystery' as never)).toBe(false);
  });
});
