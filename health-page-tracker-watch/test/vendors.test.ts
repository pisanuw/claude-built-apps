import { describe, expect, it } from 'vitest';
import { BAA_LABEL, hostRules, isBareBigTechHost, KINDS, VENDORS, vendorForUrl, vendorList } from '../src/core/vendors';

describe('vendor table', () => {
  it('matches hosts, subdomains and paths', () => {
    expect(vendorForUrl('https://connect.facebook.net/en_US/fbevents.js')?.id).toBe('meta-pixel');
    expect(vendorForUrl('https://www.facebook.com/tr?id=1')?.id).toBe('meta-pixel');
    expect(vendorForUrl('https://www.facebook.com/plugins/page.php')?.id).toBe('facebook-embed');
    expect(vendorForUrl('https://www.facebook.com/clinic')).toBeNull();
    expect(vendorForUrl('https://harbor.janeapp.com/embed')?.id).toBe('jane');
    expect(vendorForUrl('https://www.google.com/recaptcha/api.js')?.id).toBe('recaptcha');
    expect(vendorForUrl('https://www.google.com/maps/embed?pb=1')?.id).toBe('google-maps');
    expect(vendorForUrl('https://docs.google.com/forms/d/e/1/viewform')?.id).toBe('google-forms');
    expect(vendorForUrl('https://notgoogle-analytics.com/x')).toBeNull();
    expect(vendorForUrl('not a url')).toBeNull();
  });

  it('is internally consistent', () => {
    for (const r of hostRules()) expect(VENDORS[r.vendor], r.vendor).toBeDefined();
    const used = new Set(hostRules().map((r) => r.vendor));
    for (const id of Object.keys(VENDORS)) expect(used.has(id), id).toBe(true);
    for (const v of Object.values(VENDORS)) {
      expect(KINDS[v.kind]).toBeDefined();
      expect(BAA_LABEL[v.baa]).toBeDefined();
      expect(v.baaNote.length).toBeGreaterThan(20);
    }
    expect(Object.keys(VENDORS).length).toBeGreaterThanOrEqual(50);
  });

  it('lists vendors sorted by kind then name', () => {
    const list = vendorList();
    expect(list).toHaveLength(Object.keys(VENDORS).length);
    for (let i = 1; i < list.length; i++) {
      const a = KINDS[list[i - 1].kind].label;
      const b = KINDS[list[i].kind].label;
      expect(a.localeCompare(b) < 0 || (a === b && list[i - 1].name.localeCompare(list[i].name) <= 0)).toBe(true);
    }
  });

  it('knows generic big-tech hosts', () => {
    expect(isBareBigTechHost('www.google.com')).toBe(true);
    expect(isBareBigTechHost('cdn.example.com')).toBe(false);
  });
});
