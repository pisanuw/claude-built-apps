import { describe, expect, it } from 'vitest';
import { isNecessaryCookie, vendorForCookie, vendorForUrl } from '../src/core/catalog';

describe('catalog', () => {
  it('matches tracker URLs by host and path', () => {
    expect(vendorForUrl('https://connect.facebook.net/en_US/fbevents.js')?.id).toBe('meta');
    expect(vendorForUrl('https://www.facebook.com/tr/?id=1')?.id).toBe('meta');
    expect(vendorForUrl('https://www.facebook.com/somepage')).toBeNull();
    expect(vendorForUrl('https://region1.google-analytics.com/g/collect')?.id).toBe('google-analytics');
    expect(vendorForUrl('https://www.youtube-nocookie.com/embed/x')?.id).toBe('youtube');
    expect(vendorForUrl('https://shop.com/matomo.js')?.id).toBe('matomo');
    expect(vendorForUrl('https://shop.com/app.js')).toBeNull();
    expect(vendorForUrl('::')).toBeNull();
  });
  it('matches cookie names exactly or by prefix', () => {
    expect(vendorForCookie('_ga_ABC123')?.id).toBe('google-analytics');
    expect(vendorForCookie('_fbp')?.id).toBe('meta');
    expect(vendorForCookie('_fbpx')).toBeNull();
    expect(vendorForCookie('tk_ai')?.id).toBe('wc-tracks');
    expect(isNecessaryCookie('wp_woocommerce_session_abc')).toBe(true);
    expect(isNecessaryCookie('cmplz_marketing')).toBe(true);
    expect(isNecessaryCookie('mystery')).toBe(false);
  });
});
