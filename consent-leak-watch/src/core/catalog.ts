/**
 * A fixed, hand-written catalog of the trackers, embeds and cookies that most
 * often show up on small WordPress and WooCommerce shops. Matching is plain
 * string rules, so the same recording always gives the same answer.
 */

/** marketing and analytics need consent; embed loads a third party that sets its own cookies; notice is worth knowing but not a leak by itself. */
export type Purpose = 'marketing' | 'analytics' | 'embed' | 'notice' | 'necessary';

export interface Vendor {
  id: string;
  name: string;
  purpose: Purpose;
  /** One plain sentence for a shop owner. */
  what: string;
}

export const VENDORS: Record<string, Vendor> = {
  meta: { id: 'meta', name: 'Meta Pixel (Facebook / Instagram)', purpose: 'marketing', what: 'Tells Meta who visited so it can target and measure ads.' },
  'google-analytics': { id: 'google-analytics', name: 'Google Analytics', purpose: 'analytics', what: 'Counts visitors and what they do, and sends it to Google.' },
  'google-ads': { id: 'google-ads', name: 'Google Ads / DoubleClick', purpose: 'marketing', what: 'Measures ad clicks and builds remarketing lists for Google Ads.' },
  'google-tag': { id: 'google-tag', name: 'Google tag loader (gtag.js / GTM)', purpose: 'notice', what: 'Loads other Google tags. Fine on its own if those tags wait for consent.' },
  tiktok: { id: 'tiktok', name: 'TikTok Pixel', purpose: 'marketing', what: 'Tells TikTok who visited so it can target and measure ads.' },
  'wc-tracks': { id: 'wc-tracks', name: 'WooCommerce / Jetpack Tracks', purpose: 'analytics', what: 'Automattic’s usage analytics, often added by WooCommerce or Jetpack.' },
  'wc-attribution': { id: 'wc-attribution', name: 'WooCommerce order attribution', purpose: 'analytics', what: 'Records where a visitor came from so orders can be credited to a campaign.' },
  jetpack: { id: 'jetpack', name: 'Jetpack Stats', purpose: 'analytics', what: 'Visitor statistics sent to WordPress.com.' },
  hotjar: { id: 'hotjar', name: 'Hotjar', purpose: 'analytics', what: 'Records clicks, scrolling and sessions for heatmaps.' },
  clarity: { id: 'clarity', name: 'Microsoft Clarity', purpose: 'analytics', what: 'Records sessions and heatmaps for Microsoft.' },
  'microsoft-ads': { id: 'microsoft-ads', name: 'Microsoft Ads (Bing UET)', purpose: 'marketing', what: 'Measures and retargets Microsoft / Bing ads.' },
  linkedin: { id: 'linkedin', name: 'LinkedIn Insight Tag', purpose: 'marketing', what: 'Measures and retargets LinkedIn ads.' },
  pinterest: { id: 'pinterest', name: 'Pinterest Tag', purpose: 'marketing', what: 'Measures and retargets Pinterest ads.' },
  snap: { id: 'snap', name: 'Snap Pixel', purpose: 'marketing', what: 'Measures and retargets Snapchat ads.' },
  x: { id: 'x', name: 'X (Twitter) Pixel', purpose: 'marketing', what: 'Measures and retargets X ads.' },
  hubspot: { id: 'hubspot', name: 'HubSpot tracking', purpose: 'marketing', what: 'Identifies visitors for HubSpot’s CRM and email marketing.' },
  klaviyo: { id: 'klaviyo', name: 'Klaviyo', purpose: 'marketing', what: 'Identifies visitors for Klaviyo email and SMS marketing.' },
  mailchimp: { id: 'mailchimp', name: 'Mailchimp site tracking', purpose: 'marketing', what: 'Identifies visitors for Mailchimp campaigns.' },
  matomo: { id: 'matomo', name: 'Matomo', purpose: 'analytics', what: 'Visitor statistics (can be set up cookieless; check its settings).' },
  mixpanel: { id: 'mixpanel', name: 'Mixpanel', purpose: 'analytics', what: 'Product analytics.' },
  segment: { id: 'segment', name: 'Segment', purpose: 'analytics', what: 'Collects analytics events and forwards them to other tools.' },
  youtube: { id: 'youtube', name: 'YouTube embed', purpose: 'embed', what: 'A YouTube video player. YouTube sets its own cookies as soon as it loads.' },
  vimeo: { id: 'vimeo', name: 'Vimeo embed', purpose: 'embed', what: 'A Vimeo video player, which sets its own cookies when it loads.' },
  'google-maps': { id: 'google-maps', name: 'Google Maps embed', purpose: 'embed', what: 'A Google map, which contacts Google as soon as the page loads.' },
  'google-fonts': { id: 'google-fonts', name: 'Google Fonts', purpose: 'notice', what: 'Fonts loaded from Google’s servers, which sends the visitor’s IP address to Google. A German court fined a site for this in 2022; hosting the fonts yourself avoids it.' },
  recaptcha: { id: 'recaptcha', name: 'Google reCAPTCHA', purpose: 'notice', what: 'Spam protection from Google. Often treated as necessary on forms, but loading it on every page is debatable.' },
};

interface HostRule {
  vendor: string;
  /** Host equals this or ends with "." + this. */
  host: string;
  /** Optional path prefix the URL must start with. */
  path?: string;
}

const HOST_RULES: HostRule[] = [
  { vendor: 'meta', host: 'connect.facebook.net' },
  { vendor: 'meta', host: 'facebook.com', path: '/tr' },
  { vendor: 'google-tag', host: 'googletagmanager.com' },
  { vendor: 'google-analytics', host: 'google-analytics.com' },
  { vendor: 'google-analytics', host: 'analytics.google.com' },
  { vendor: 'google-ads', host: 'googleadservices.com' },
  { vendor: 'google-ads', host: 'doubleclick.net' },
  { vendor: 'google-ads', host: 'googlesyndication.com' },
  { vendor: 'google-ads', host: 'google.com', path: '/pagead' },
  { vendor: 'google-ads', host: 'google.com', path: '/ccm/collect' },
  { vendor: 'tiktok', host: 'analytics.tiktok.com' },
  { vendor: 'wc-tracks', host: 'pixel.wp.com', path: '/t.gif' },
  { vendor: 'jetpack', host: 'stats.wp.com' },
  { vendor: 'jetpack', host: 'pixel.wp.com', path: '/g.gif' },
  { vendor: 'hotjar', host: 'hotjar.com' },
  { vendor: 'hotjar', host: 'hotjar.io' },
  { vendor: 'clarity', host: 'clarity.ms' },
  { vendor: 'microsoft-ads', host: 'bat.bing.com' },
  { vendor: 'linkedin', host: 'snap.licdn.com' },
  { vendor: 'linkedin', host: 'px.ads.linkedin.com' },
  { vendor: 'pinterest', host: 'ct.pinterest.com' },
  { vendor: 'pinterest', host: 's.pinimg.com', path: '/ct/' },
  { vendor: 'snap', host: 'sc-static.net' },
  { vendor: 'snap', host: 'tr.snapchat.com' },
  { vendor: 'x', host: 'static.ads-twitter.com' },
  { vendor: 'x', host: 'analytics.twitter.com' },
  { vendor: 'x', host: 'ads-twitter.com' },
  { vendor: 'hubspot', host: 'hs-scripts.com' },
  { vendor: 'hubspot', host: 'hs-analytics.net' },
  { vendor: 'hubspot', host: 'hs-banner.com' },
  { vendor: 'klaviyo', host: 'klaviyo.com' },
  { vendor: 'mailchimp', host: 'chimpstatic.com' },
  { vendor: 'mixpanel', host: 'mxpnl.com' },
  { vendor: 'mixpanel', host: 'mixpanel.com' },
  { vendor: 'segment', host: 'cdn.segment.com' },
  { vendor: 'segment', host: 'api.segment.io' },
  { vendor: 'youtube', host: 'youtube.com', path: '/embed' },
  { vendor: 'youtube', host: 'youtube.com', path: '/iframe_api' },
  { vendor: 'youtube', host: 'youtube.com', path: '/s/player' },
  { vendor: 'youtube', host: 'youtube-nocookie.com', path: '/embed' },
  { vendor: 'vimeo', host: 'player.vimeo.com' },
  { vendor: 'google-maps', host: 'maps.googleapis.com' },
  { vendor: 'google-maps', host: 'google.com', path: '/maps/embed' },
  { vendor: 'google-fonts', host: 'fonts.googleapis.com' },
  { vendor: 'google-fonts', host: 'fonts.gstatic.com' },
  { vendor: 'recaptcha', host: 'google.com', path: '/recaptcha' },
  { vendor: 'recaptcha', host: 'recaptcha.net' },
];

/** Matomo is self-hosted, so it is recognised by its script and endpoint names. */
const MATOMO_PATH = /\/(matomo|piwik)\.(js|php)(\?|$)/i;

/** Which vendor a request URL belongs to, or null. */
export function vendorForUrl(url: string): Vendor | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  for (const rule of HOST_RULES) {
    if (host !== rule.host && !host.endsWith('.' + rule.host)) continue;
    if (rule.path && !u.pathname.startsWith(rule.path)) continue;
    return VENDORS[rule.vendor];
  }
  if (MATOMO_PATH.test(u.pathname)) return VENDORS.matomo;
  return null;
}

interface CookieRule {
  vendor: string;
  /** Exact name, or a prefix when it ends with "*". */
  name: string;
}

const COOKIE_RULES: CookieRule[] = [
  { vendor: 'meta', name: '_fbp' },
  { vendor: 'meta', name: '_fbc' },
  { vendor: 'meta', name: 'fr' },
  { vendor: 'google-analytics', name: '_ga' },
  { vendor: 'google-analytics', name: '_ga_*' },
  { vendor: 'google-analytics', name: '_gid' },
  { vendor: 'google-analytics', name: '_gat*' },
  { vendor: 'google-ads', name: '_gcl_*' },
  { vendor: 'google-ads', name: 'IDE' },
  { vendor: 'google-ads', name: 'test_cookie' },
  { vendor: 'google-ads', name: 'DSID' },
  { vendor: 'tiktok', name: '_ttp' },
  { vendor: 'tiktok', name: '_tt_enable_cookie' },
  { vendor: 'tiktok', name: 'ttcsid*' },
  { vendor: 'wc-tracks', name: 'tk_ai' },
  { vendor: 'wc-tracks', name: 'tk_qs' },
  { vendor: 'wc-tracks', name: 'tk_lr' },
  { vendor: 'wc-tracks', name: 'tk_r3d' },
  { vendor: 'wc-tracks', name: 'tk_or' },
  { vendor: 'wc-attribution', name: 'sbjs_*' },
  { vendor: 'hotjar', name: '_hj*' },
  { vendor: 'clarity', name: '_clck' },
  { vendor: 'clarity', name: '_clsk' },
  { vendor: 'clarity', name: 'CLID' },
  { vendor: 'microsoft-ads', name: '_uetsid' },
  { vendor: 'microsoft-ads', name: '_uetvid' },
  { vendor: 'microsoft-ads', name: 'MUID' },
  { vendor: 'linkedin', name: 'li_fat_id' },
  { vendor: 'linkedin', name: 'bcookie' },
  { vendor: 'linkedin', name: 'lidc' },
  { vendor: 'linkedin', name: 'UserMatchHistory' },
  { vendor: 'pinterest', name: '_pin_unauth' },
  { vendor: 'pinterest', name: '_pinterest_ct_ua' },
  { vendor: 'pinterest', name: '_epik' },
  { vendor: 'snap', name: '_scid*' },
  { vendor: 'snap', name: '_sctr' },
  { vendor: 'x', name: '_twclid' },
  { vendor: 'x', name: 'muc_ads' },
  { vendor: 'x', name: 'personalization_id' },
  { vendor: 'hubspot', name: '__hstc' },
  { vendor: 'hubspot', name: '__hssc' },
  { vendor: 'hubspot', name: '__hssrc' },
  { vendor: 'hubspot', name: 'hubspotutk' },
  { vendor: 'klaviyo', name: '__kla_id' },
  { vendor: 'mailchimp', name: '_mcid' },
  { vendor: 'matomo', name: '_pk_id*' },
  { vendor: 'matomo', name: '_pk_ses*' },
  { vendor: 'mixpanel', name: 'mp_*' },
  { vendor: 'segment', name: 'ajs_*' },
  { vendor: 'youtube', name: 'YSC' },
  { vendor: 'youtube', name: 'VISITOR_INFO1_LIVE' },
  { vendor: 'youtube', name: 'VISITOR_PRIVACY_METADATA' },
  { vendor: 'youtube', name: '__Secure-YEC' },
  { vendor: 'youtube', name: '__Secure-ROLLOUT_TOKEN' },
  { vendor: 'vimeo', name: 'vuid' },
];

/** Cookies a shop needs to work, or that a consent banner sets to remember the choice. */
const NECESSARY_COOKIES = [
  'woocommerce_*', 'wp_woocommerce_session_*', 'wordpress_*', 'wp-settings-*', 'wp_lang', 'PHPSESSID',
  'cmplz_*', 'complianz_*', 'cookieyes-consent', 'CookieConsent', 'CookieConsentBulkSetting-*', 'borlabs-cookie',
  'real_cookie_banner*', 'OptanonConsent', 'OptanonAlertBoxClosed', 'cookielawinfo-*', 'viewed_cookie_policy',
  'moove_gdpr_popup', 'catAccCookies', 'iubenda_consent_*', '_iub_cs-*', 'euconsent-v2', 'usprivacy',
  '__cf_bm', 'cf_clearance', '_cfuvid', '__cflb', 'wp-wpml_current_language', '_icl_*', 'pll_language',
  'sucuri_cloudproxy_*', 'wordfence_*', 'wfwaf-authcookie-*', 'mailpoet_*',
];

function nameMatches(pattern: string, name: string): boolean {
  return pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
}

/** Which vendor a cookie name belongs to, or null if it is not a known tracking cookie. */
export function vendorForCookie(name: string): Vendor | null {
  for (const rule of COOKIE_RULES) if (nameMatches(rule.name, name)) return VENDORS[rule.vendor];
  return null;
}

/** True for cookies the shop needs or that store the consent choice itself. */
export function isNecessaryCookie(name: string): boolean {
  return NECESSARY_COOKIES.some((p) => nameMatches(p, name));
}

/** Text a vendor's snippet usually contains, used to find it in the page HTML. */
export const INLINE_SIGNATURES: Record<string, RegExp> = {
  meta: /fbq\(|connect\.facebook\.net/,
  'google-analytics': /gtag\(\s*['"]config['"]\s*,\s*['"]G-|google-analytics\.com\/analytics\.js/,
  'google-ads': /gtag\(\s*['"]config['"]\s*,\s*['"]AW-/,
  'google-tag': /googletagmanager\.com\/(gtag\/js|gtm\.js)/,
  tiktok: /analytics\.tiktok\.com|ttq\.load/,
  hotjar: /static\.hotjar\.com|hjid/,
  clarity: /clarity\.ms\/tag/,
  'microsoft-ads': /bat\.bing\.com/,
  linkedin: /snap\.licdn\.com|_linkedin_partner_id/,
  pinterest: /pintrk\(/,
  snap: /snaptr\(/,
  x: /twq\(/,
  hubspot: /js\.hs-scripts\.com/,
  klaviyo: /static\.klaviyo\.com/,
  matomo: /_paq\.push/,
  youtube: /youtube(-nocookie)?\.com\/embed/,
  vimeo: /player\.vimeo\.com/,
  'google-maps': /google\.com\/maps\/embed|maps\.googleapis\.com/,
};
