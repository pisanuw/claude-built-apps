/**
 * A made-up counseling practice for the "Try the example" button. The site
 * uses the reserved .example domain, so it cannot be anyone's real website.
 *
 * Last month: Meta Pixel on the home and service pages only.
 * This month: a plugin update put the Meta Pixel on the booking page too,
 * and someone added Hotjar.
 */

export const SAMPLE_SITE = 'https://www.harborview-counseling.example';

interface Req {
  url: string;
  type: string;
  method?: string;
  body?: string;
}

const enc = encodeURIComponent;

function pageRequests(path: string, thisMonth: boolean): Req[] {
  const page = SAMPLE_SITE + path;
  const health = path !== '/' && path !== '/about';
  const reqs: Req[] = [
    { url: page, type: 'document' },
    { url: `${SAMPLE_SITE}/wp-content/themes/calm/style.css`, type: 'stylesheet' },
    { url: 'https://fonts.googleapis.com/css2?family=Lora:wght@400;700', type: 'stylesheet' },
    { url: 'https://fonts.gstatic.com/s/lora/v32/0QI6MX1D_JOuGQbT0gvTJPa787weuxJBkqg.woff2', type: 'font' },
    { url: 'https://www.googletagmanager.com/gtm.js?id=GTM-HCV123', type: 'script' },
    { url: 'https://www.googletagmanager.com/gtag/js?id=G-HCV456', type: 'script' },
    { url: `https://region1.google-analytics.com/g/collect?v=2&tid=G-HCV456&dl=${enc(page)}&dt=${enc('Harborview Counseling')}&en=page_view`, type: 'ping', method: 'POST' },
    { url: 'https://cdn.userway.org/widget.js', type: 'script' },
    { url: `https://api.userway.org/api/v1/w/settings?origin=${enc(SAMPLE_SITE)}`, type: 'xhr' },
  ];
  const metaPages = thisMonth ? ['/', '/services/anxiety-therapy', '/book'] : ['/', '/services/anxiety-therapy'];
  if (metaPages.includes(path)) {
    reqs.push(
      { url: 'https://connect.facebook.net/en_US/fbevents.js', type: 'script' },
      { url: `https://www.facebook.com/tr/?id=998877&ev=PageView&dl=${enc(page)}&rl=&if=false`, type: 'image' },
    );
  }
  if (path !== '/about') reqs.push({ url: 'https://embed.tawk.to/65hcv/default', type: 'script' }, { url: 'https://va.tawk.to/v1/session/start', type: 'xhr', method: 'POST', body: JSON.stringify({ p: page }) });
  if (thisMonth && health) reqs.push({ url: 'https://static.hotjar.com/c/hotjar-3456789.js?sv=6', type: 'script' }, { url: `https://in.hotjar.com/api/v2/client/sites/3456789/visit-data?url=${enc(page)}`, type: 'xhr', method: 'POST' });
  if (path === '/services/anxiety-therapy') reqs.push({ url: 'https://www.youtube.com/embed/abcHCV123', type: 'document' }, { url: 'https://i.ytimg.com/vi/abcHCV123/hqdefault.jpg', type: 'image' });
  if (path === '/book') reqs.push({ url: 'https://harborview.janeapp.com/embed/book', type: 'document' }, { url: 'https://harborview.janeapp.com/assets/embed.js', type: 'script' });
  if (path === '/new-client-forms') reqs.push({ url: 'https://form.jotform.com/23456789', type: 'document' }, { url: 'https://cdn.jotfor.ms/static/prototype.forms.js', type: 'script' }, { url: 'https://static.badgeworks.example/seal.js', type: 'script' });
  if (path === '/about') reqs.push({ url: 'https://www.google.com/maps/embed?pb=!1m18!harborview', type: 'document' }, { url: 'https://maps.gstatic.com/mapfiles/api-3/images/spotlight-poi3.png', type: 'image' });
  if (health) reqs.push({ url: 'https://www.google.com/recaptcha/api.js', type: 'script' });
  return reqs;
}

export const SAMPLE_PATHS = ['/', '/services/anxiety-therapy', '/book', '/new-client-forms', '/about'];

/** HAR text for one recording of the five example pages. */
export function sampleHar(thisMonth: boolean): string {
  const base = Date.parse(thisMonth ? '2026-11-06T16:00:00Z' : '2026-10-06T16:00:00Z');
  let t = 0;
  const pages: unknown[] = [];
  const entries: unknown[] = [];
  SAMPLE_PATHS.forEach((path, i) => {
    const id = `page_${i + 1}`;
    pages.push({ id, title: SAMPLE_SITE + path, startedDateTime: new Date(base + t).toISOString() });
    for (const r of pageRequests(path, thisMonth)) {
      t += 40;
      entries.push({
        pageref: id,
        startedDateTime: new Date(base + t).toISOString(),
        _resourceType: r.type,
        request: {
          method: r.method ?? 'GET',
          url: r.url,
          headers: [{ name: 'Referer', value: r.type === 'document' && i === 0 ? '' : SAMPLE_SITE + '/' }],
          ...(r.body ? { postData: { mimeType: 'application/json', text: r.body } } : {}),
        },
        response: { status: 200, headers: [], content: { mimeType: r.type === 'document' ? 'text/html' : 'text/plain' } },
      });
    }
    t += 3000;
  });
  return JSON.stringify({ log: { version: '1.2', creator: { name: 'Example', version: '1' }, pages, entries } });
}
