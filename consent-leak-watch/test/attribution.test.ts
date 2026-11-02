import { describe, expect, it } from 'vitest';
import { attributeInline, attributeRequest, attributeUrl, handleFromId, pluginInventory, pluginLabel, scriptTags, slugForHandle } from '../src/core/attribution';
import { parseHar } from '../src/core/har';
import { makeHar } from './helpers';

describe('attributeUrl', () => {
  it('reads plugin, mu-plugin, theme and optimizer paths', () => {
    expect(attributeUrl('https://s.com/wp-content/plugins/pixelyoursite/js/p.js?ver=9.1')).toMatchObject({ kind: 'plugin', slug: 'pixelyoursite', label: 'PixelYourSite', version: '9.1' });
    expect(attributeUrl('https://s.com/wp-content/plugins/odd-one/x.js')).toMatchObject({ kind: 'plugin', label: 'odd-one' });
    expect(attributeUrl('https://s.com/wp-content/plugins/odd-one/x.js')?.version).toBeUndefined();
    expect(attributeUrl('https://s.com/wp-content/mu-plugins/track.php')).toMatchObject({ kind: 'plugin', slug: 'track' });
    expect(attributeUrl('https://s.com/wp-content/themes/astra/main.js?ver=4')).toMatchObject({ kind: 'theme', slug: 'astra', version: '4' });
    expect(attributeUrl('https://s.com/wp-content/themes/astra/main.js')?.version).toBeUndefined();
    expect(attributeUrl('https://s.com/wp-content/litespeed/js/1.js')).toMatchObject({ kind: 'optimizer', label: 'LiteSpeed Cache' });
    expect(attributeUrl('https://s.com/x.js')).toBeNull();
    expect(attributeUrl('/wp-content/plugins/a/b.js?ver=1')).toMatchObject({ slug: 'a' });
    expect(pluginLabel('leadin')).toBe('HubSpot');
  });
});

describe('handles', () => {
  it('strips WordPress id suffixes and maps to the longest matching slug', () => {
    expect(handleFromId('facebook-for-woocommerce-js-after')).toBe('facebook-for-woocommerce');
    expect(handleFromId('google_gtagjs-js')).toBe('google_gtagjs');
    expect(slugForHandle('elementor-pro-frontend', ['elementor', 'elementor-pro'])).toBe('elementor-pro');
    expect(slugForHandle('nothing', ['elementor'])).toBeUndefined();
    expect(scriptTags('<script id="a">x</script><iframe src="y"></iframe>')).toEqual([
      { tag: 'script', id: 'a', body: ' id="a"x' },
      { tag: 'iframe', id: '', body: ' src="y"' },
    ]);
  });
});

describe('attributeRequest', () => {
  it('follows the initiator chain back to a plugin', () => {
    const cap = parseHar(
      makeHar([
        { url: 'https://s.com/', type: 'document' },
        { url: 'https://s.com/wp-content/plugins/gtm-kit/gtm.js?ver=2', type: 'script' },
        { url: 'https://www.googletagmanager.com/gtm.js?id=GTM-1', type: 'script', by: ['https://s.com/wp-content/plugins/gtm-kit/gtm.js?ver=2'] },
        { url: 'https://www.google-analytics.com/g/collect', type: 'ping', by: ['https://www.googletagmanager.com/gtm.js?id=GTM-1'] },
        { url: 'https://bat.bing.com/bat.js', type: 'script', by: ['https://cdn.example/x.js'], parent: ['https://s.com/wp-content/cache/min/1/a.js'] },
        { url: 'https://px.ads.linkedin.com/x', type: 'image' },
      ]),
    );
    expect(attributeRequest(cap.requests[3], cap)).toMatchObject({ kind: 'plugin', slug: 'gtm-kit', version: '2' });
    expect(attributeRequest(cap.requests[4], cap)).toMatchObject({ kind: 'optimizer', label: 'WP Rocket' });
    expect(attributeRequest(cap.requests[5], cap)).toEqual({ kind: 'unknown', evidence: 'no initiator recorded' });
    expect(pluginInventory(cap)).toEqual([{ slug: 'gtm-kit', label: 'gtm-kit', kind: 'plugin', versions: ['2'] }]);
  });
});

describe('attributeInline', () => {
  const html = (id: string) => `<html><script${id}>fbq('init','1')</script></html>`;
  const cap = (body: string) =>
    parseHar(makeHar([{ url: 'https://s.com/', type: 'document', body }, { url: 'https://s.com/wp-content/plugins/pixelyoursite/a.js?ver=3', type: 'script' }]));
  it('names the plugin behind a handle id', () => {
    expect(attributeInline('meta', cap(html(' id="pixelyoursite-js-extra"')))).toMatchObject({ kind: 'plugin', slug: 'pixelyoursite', version: '3' });
  });
  it('reports unmatched handles and id-less snippets', () => {
    expect(attributeInline('meta', cap(html(' id="custom-pixel-js-after"')))).toMatchObject({ kind: 'inline', slug: 'custom-pixel' });
    expect(attributeInline('meta', cap(html('')))).toMatchObject({ kind: 'inline', element: 'script' });
    expect(attributeInline('meta', cap('<html></html>'))).toBeNull();
    expect(attributeInline('google-fonts', cap(html('')))).toBeNull();
  });
  it('recognises iframes and plugins without versions', () => {
    const c = parseHar(makeHar([{ url: 'https://s.com/', type: 'document', body: `<iframe id="v" src="https://www.youtube.com/embed/1"></iframe><script id="noversion-js">fbq(1)</script>` }, { url: 'https://s.com/wp-content/plugins/noversion/a.js', type: 'script' }]));
    expect(attributeInline('youtube', c)).toMatchObject({ kind: 'inline', element: 'iframe' });
    const meta = attributeInline('meta', c);
    expect(meta).toMatchObject({ kind: 'plugin', slug: 'noversion' });
    expect(meta?.version).toBeUndefined();
  });
});
