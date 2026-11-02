/**
 * A made-up shop, "Fernhill Candles", recorded twice: last month (clean) and
 * today, after its Meta plugin updated from 3.7.5 to 3.7.6 and started setting
 * _fbp before consent. Used by the "Try the example" button and the tests.
 * The recordings are generated, not captured from a real site.
 */

export const SAMPLE_SITE = 'fernhill-candles.example';
const ORIGIN = `https://${SAMPLE_SITE}`;

interface EntrySpec {
  url: string;
  type: string;
  mime?: string;
  status?: number;
  sent?: Record<string, string>;
  set?: string[];
  /** Script URLs that caused this request, nearest first; 'parser' means the page HTML. */
  by?: string[] | 'parser';
  body?: string;
}

function entry(spec: EntrySpec, t: number, page: string): Record<string, unknown> {
  const headers = [{ name: 'Accept', value: '*/*' }];
  const sent = Object.entries(spec.sent ?? {});
  if (sent.length) headers.push({ name: 'Cookie', value: sent.map(([k, v]) => `${k}=${v}`).join('; ') });
  const initiator =
    spec.by === 'parser'
      ? { type: 'parser', url: page, lineNumber: 12 }
      : spec.by
        ? { type: 'script', stack: { callFrames: spec.by.map((url) => ({ functionName: '', url, lineNumber: 0, columnNumber: 0 })) } }
        : { type: 'other' };
  return {
    startedDateTime: new Date(Date.UTC(2026, 10, 2, 9, 0, 0) + t * 40).toISOString(),
    time: 30,
    _resourceType: spec.type,
    _initiator: initiator,
    request: { method: 'GET', url: spec.url, httpVersion: 'h2', headers, cookies: [], queryString: [], headersSize: -1, bodySize: 0 },
    response: {
      status: spec.status ?? 200,
      statusText: '',
      httpVersion: 'h2',
      headers: (spec.set ?? []).map((v) => ({ name: 'set-cookie', value: v })),
      cookies: [],
      content: { size: spec.body?.length ?? 0, mimeType: spec.mime ?? (spec.type === 'document' ? 'text/html' : 'application/javascript'), ...(spec.body ? { text: spec.body } : {}) },
      redirectURL: '',
      headersSize: -1,
      bodySize: -1,
    },
    cache: {},
    timings: { send: 0, wait: 20, receive: 10 },
  };
}

function har(specs: EntrySpec[], title: string): string {
  let page = specs[0].url;
  const entries = specs.map((s, i) => {
    if (s.type === 'document') page = s.url;
    return entry(s, i, page);
  });
  return JSON.stringify({
    log: {
      version: '1.2',
      creator: { name: 'Consent Leak Watch example', version: '1' },
      pages: [{ startedDateTime: entries[0].startedDateTime, id: 'page_1', title, pageTimings: {} }],
      entries,
    },
  });
}

const P = (slug: string, file: string, ver: string) => `${ORIGIN}/wp-content/plugins/${slug}/${file}?ver=${ver}`;

function pageHtml(updated: boolean): string {
  return `<!doctype html><html><head><title>Fernhill Candles</title>
<script id="cmplz-cookiebanner-js" src="${P('complianz-gdpr', 'cookiebanner/js/complianz.min.js', '7.1.4')}"></script>
<script id="google_gtagjs-js" src="https://www.googletagmanager.com/gtag/js?id=G-FERN123"></script>
<script id="google_gtagjs-js-after">gtag('consent','default',{ad_storage:'denied',analytics_storage:'denied'});gtag('config','G-FERN123');</script>
<script id="facebook-for-woocommerce-js-after">${updated ? "fbq('init','1234567890');fbq('track','PageView');" : "if(window.cmplz_has_consent&&cmplz_has_consent('marketing')){fbq('init','1234567890');}"}</script>
</head><body><h1>Hand-poured candles</h1></body></html>`;
}

const productHtml = `<!doctype html><html><head><title>Fernhill Candles: Cedar & Smoke</title></head><body>
<iframe id="product-video" src="https://www.youtube.com/embed/abc123"></iframe></body></html>`;

function baseEntries(updated: boolean): EntrySpec[] {
  const fbVer = updated ? '3.7.6' : '3.7.5';
  const fbJs = P('facebook-for-woocommerce', 'assets/js/frontend/pixel.js', fbVer);
  return [
    { url: `${ORIGIN}/`, type: 'document', body: pageHtml(updated), set: ['woocommerce_cart_hash=; path=/'] },
    { url: P('complianz-gdpr', 'cookiebanner/js/complianz.min.js', '7.1.4'), type: 'script', by: 'parser' },
    { url: P('woocommerce', 'assets/js/frontend/woocommerce.min.js', '9.3.3'), type: 'script', by: 'parser' },
    { url: P('google-site-kit', 'dist/assets/js/googlesitekit-consent-mode.js', '1.139.0'), type: 'script', by: 'parser' },
    { url: 'https://fonts.googleapis.com/css2?family=Lora', type: 'stylesheet', mime: 'text/css', by: 'parser' },
    { url: 'https://www.googletagmanager.com/gtag/js?id=G-FERN123', type: 'script', by: 'parser' },
    { url: 'https://region1.google-analytics.com/g/collect?v=2&tid=G-FERN123&gcs=G100&en=page_view', type: 'ping', mime: 'text/plain', by: ['https://www.googletagmanager.com/gtag/js?id=G-FERN123'] },
    { url: fbJs, type: 'script', by: 'parser' },
    { url: `${ORIGIN}/wp-content/cache/autoptimize/js/autoptimize_6f1e.js`, type: 'script', by: 'parser' },
  ];
}

function updatedExtras(sent: Record<string, string>): EntrySpec[] {
  const fbJs = P('facebook-for-woocommerce', 'assets/js/frontend/pixel.js', '3.7.6');
  return [
    { url: 'https://connect.facebook.net/en_US/fbevents.js', type: 'script', by: [fbJs] },
    { url: 'https://www.facebook.com/tr/?id=1234567890&ev=PageView', type: 'image', mime: 'image/gif', by: ['https://connect.facebook.net/en_US/fbevents.js'] },
    { url: 'https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=FERN', type: 'script', by: [`${ORIGIN}/wp-content/cache/autoptimize/js/autoptimize_6f1e.js`] },
    { url: `${ORIGIN}/?wc-ajax=get_refreshed_fragments`, type: 'xhr', mime: 'application/json', sent },
  ];
}

const COMPLIANZ_REJECT = { cmplz_marketing: 'deny', cmplz_statistics: 'deny', cmplz_preferences: 'deny', 'cmplz_banner-status': 'dismissed' };

function productVisit(sent: Record<string, string>, withVideo: boolean): EntrySpec[] {
  const out: EntrySpec[] = [{ url: `${ORIGIN}/product/cedar-smoke/`, type: 'document', body: productHtml, sent }];
  if (withVideo) out.push({ url: 'https://www.youtube.com/embed/abc123', type: 'document', by: 'parser', set: ['YSC=x1; Domain=.youtube.com; Secure'] });
  return out;
}

/** Recording before any banner click. `updated` is today's shop (leaking), otherwise last month's. */
export function sampleNoChoice(updated: boolean): string {
  const specs = baseEntries(updated);
  const cookies: Record<string, string> = { woocommerce_cart_hash: '' };
  if (updated) {
    specs.push(...updatedExtras({ ...cookies, _fbp: 'fb.1.1793610000.123', _ttp: 'tt.x' }));
    Object.assign(cookies, { _fbp: 'fb.1.1793610000.123', _ttp: 'tt.x' });
  }
  specs.push(...productVisit(cookies, updated));
  return har(specs, 'Fernhill Candles (no choice)');
}

/** Recording with Reject all clicked on the first page, then a product page. */
export function sampleRejected(updated: boolean): string {
  const specs = baseEntries(updated);
  const cookies: Record<string, string> = { woocommerce_cart_hash: '', ...COMPLIANZ_REJECT };
  specs.push({ url: `${ORIGIN}/wp-admin/admin-ajax.php?action=cmplz_track_status`, type: 'xhr', mime: 'application/json', sent: COMPLIANZ_REJECT });
  if (updated) Object.assign(cookies, { _fbp: 'fb.1.1793610000.123' });
  specs.push(...productVisit(cookies, false));
  if (updated) specs.push({ url: 'https://www.facebook.com/tr/?id=1234567890&ev=ViewContent', type: 'image', mime: 'image/gif', by: ['https://connect.facebook.net/en_US/fbevents.js'] });
  return har(specs, 'Fernhill Candles (rejected)');
}
