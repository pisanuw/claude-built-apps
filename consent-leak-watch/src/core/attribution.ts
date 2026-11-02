/**
 * Working out which WordPress plugin (or theme) put a tracker on the page.
 *
 * WordPress serves plugin files from /wp-content/plugins/<slug>/...?ver=<x>,
 * and prints enqueued inline scripts with ids like "<handle>-js-after". When
 * those clues survive we can name the plugin. When a speed plugin has
 * combined and minified the files, or the cookie was set by PHP on the server,
 * the clue is gone and we say so instead of guessing.
 */
import type { Capture, Request } from './har';
import { INLINE_SIGNATURES } from './catalog';

export type AttributionKind = 'plugin' | 'theme' | 'inline' | 'optimizer' | 'server' | 'unknown';

export interface Attribution {
  kind: AttributionKind;
  /** Plugin or theme slug, or the inline script handle. */
  slug?: string;
  /** Friendly plugin name when we know the slug. */
  label?: string;
  /** Version from ?ver= when present. */
  version?: string;
  /** For inline attributions: whether the clue was a <script> or an <iframe>. */
  element?: 'script' | 'iframe';
  /** The URL or HTML id the attribution rests on. */
  evidence: string;
}

/** Friendly names for plugins that commonly add trackers. Unknown slugs are shown as-is. */
export const PLUGIN_NAMES: Record<string, string> = {
  'facebook-for-woocommerce': 'Meta for WooCommerce',
  'official-facebook-pixel': 'Meta Pixel for WordPress',
  pixelyoursite: 'PixelYourSite',
  'pixelyoursite-pro': 'PixelYourSite Pro',
  'google-site-kit': 'Site Kit by Google',
  'woocommerce-google-analytics-integration': 'Google Analytics for WooCommerce',
  'google-listings-and-ads': 'Google for WooCommerce',
  'duracelltomi-google-tag-manager': 'GTM4WP',
  'google-analytics-for-wordpress': 'MonsterInsights',
  'google-analytics-dashboard-for-wp': 'ExactMetrics',
  'tiktok-for-business': 'TikTok for WooCommerce',
  'pinterest-for-woocommerce': 'Pinterest for WooCommerce',
  'snapchat-for-woocommerce': 'Snapchat for WooCommerce',
  'insert-headers-and-footers': 'WPCode',
  'header-footer-code-manager': 'Header Footer Code Manager',
  'wp-headers-and-footers': 'Headers & Footers',
  'leadin': 'HubSpot',
  'klaviyo': 'Klaviyo',
  'mailchimp-for-woocommerce': 'Mailchimp for WooCommerce',
  'jetpack': 'Jetpack',
  'woocommerce': 'WooCommerce',
  'woocommerce-payments': 'WooPayments',
  'elementor': 'Elementor',
  'elementor-pro': 'Elementor Pro',
  'buddyboss-platform': 'BuddyBoss Platform',
  'complianz-gdpr': 'Complianz',
  'complianz-gdpr-premium': 'Complianz Premium',
  'cookie-law-info': 'CookieYes',
  'cookiebot': 'Cookiebot',
  'borlabs-cookie': 'Borlabs Cookie',
  'real-cookie-banner': 'Real Cookie Banner',
  'hotjar': 'Hotjar',
  'microsoft-clarity': 'Microsoft Clarity',
  'matomo': 'Matomo',
  'wp-google-maps': 'WP Go Maps',
  'contact-form-7': 'Contact Form 7',
  'smart-slider-3': 'Smart Slider 3',
  'revslider': 'Slider Revolution',
};

/** Speed plugins that combine files and so hide which plugin a script came from. */
const OPTIMIZERS: Array<{ re: RegExp; name: string }> = [
  { re: /\/wp-content\/cache\/autoptimize\//, name: 'Autoptimize' },
  { re: /\/wp-content\/cache\/min\//, name: 'WP Rocket' },
  { re: /\/wp-content\/litespeed\//, name: 'LiteSpeed Cache' },
  { re: /\/wp-content\/cache\/wpfc-minified\//, name: 'WP Fastest Cache' },
  { re: /\/wp-content\/uploads\/siteground-optimizer-assets\//, name: 'SiteGround Speed Optimizer' },
  { re: /\/wp-content\/cache\/breeze-minification\//, name: 'Breeze' },
  { re: /\/wp-content\/cache\/flying-press\//, name: 'FlyingPress' },
  { re: /\/wp-content\/cache\/w3tc\/|\/wp-content\/cache\/minify\//, name: 'W3 Total Cache' },
];

export function pluginLabel(slug: string): string {
  return PLUGIN_NAMES[slug] ?? slug;
}

function verOf(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get('ver') ?? undefined;
  } catch {
    return undefined;
  }
}

/** Attribution from one URL alone, or null if the URL carries no WordPress clue. */
export function attributeUrl(url: string): Attribution | null {
  const plugin = /\/wp-content\/plugins\/([^/?#]+)\//.exec(url);
  if (plugin) {
    const slug = decodeURIComponent(plugin[1]);
    const a: Attribution = { kind: 'plugin', slug, label: pluginLabel(slug), evidence: url };
    const v = verOf(url);
    if (v) a.version = v;
    return a;
  }
  const mu = /\/wp-content\/mu-plugins\/([^/?#]+)/.exec(url);
  if (mu) return { kind: 'plugin', slug: mu[1].replace(/\.php$/, ''), label: `${mu[1]} (must-use plugin)`, evidence: url };
  const theme = /\/wp-content\/themes\/([^/?#]+)\//.exec(url);
  if (theme) {
    const a: Attribution = { kind: 'theme', slug: theme[1], label: `${theme[1]} (theme)`, evidence: url };
    const v = verOf(url);
    if (v) a.version = v;
    return a;
  }
  for (const o of OPTIMIZERS) {
    if (o.re.test(url)) return { kind: 'optimizer', label: o.name, evidence: url };
  }
  return null;
}

export interface PluginSighting {
  slug: string;
  label: string;
  kind: 'plugin' | 'theme';
  versions: string[];
}

/** Every plugin and theme whose files the capture loaded, with the ?ver= strings seen. */
export function pluginInventory(capture: Capture): PluginSighting[] {
  const map = new Map<string, PluginSighting>();
  for (const r of capture.requests) {
    const a = attributeUrl(r.url);
    if (!a || (a.kind !== 'plugin' && a.kind !== 'theme') || !a.slug) continue;
    const key = `${a.kind}:${a.slug}`;
    let s = map.get(key);
    if (!s) {
      s = { slug: a.slug, label: a.label ?? a.slug, kind: a.kind, versions: [] };
      map.set(key, s);
    }
    if (a.version && !s.versions.includes(a.version)) s.versions.push(a.version);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

interface ScriptTag {
  tag: 'script' | 'iframe';
  id: string;
  body: string;
}

/** The <script> and <iframe> tags in an HTML document with their id attribute. */
export function scriptTags(html: string): ScriptTag[] {
  const out: ScriptTag[] = [];
  const re = /<(script|iframe)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(m[2])?.[1] ?? '';
    out.push({ tag: m[1].toLowerCase() === 'iframe' ? 'iframe' : 'script', id, body: m[2] + m[3] });
  }
  return out;
}

/** WordPress names inline script ids "<handle>-js", "<handle>-js-after", "-js-before" or "-js-extra". */
export function handleFromId(id: string): string {
  return id.replace(/-js(-after|-before|-extra|-translations)?$/, '');
}

/** Guess the plugin slug behind a script handle by matching against plugins seen in the capture. */
export function slugForHandle(handle: string, known: string[]): string | undefined {
  const h = handle.toLowerCase();
  let best: string | undefined;
  for (const slug of known) {
    if (h === slug || h.startsWith(slug + '-') || h.startsWith(slug + '_')) {
      if (!best || slug.length > best.length) best = slug;
    }
  }
  return best;
}

/** Look for a vendor's snippet in the page HTML and name the script tag it sits in. */
export function attributeInline(vendorId: string, capture: Capture): Attribution | null {
  const sig = INLINE_SIGNATURES[vendorId];
  if (!sig) return null;
  const known = pluginInventory(capture).filter((p) => p.kind === 'plugin').map((p) => p.slug);
  let unnamed: Attribution | null = null;
  for (const r of capture.requests) {
    if (r.resourceType !== 'document' || !r.body) continue;
    for (const tag of scriptTags(r.body)) {
      if (!sig.test(tag.body)) continue;
      if (tag.tag === 'iframe') {
        return { kind: 'inline', element: 'iframe', evidence: `<iframe${tag.id ? ` id="${tag.id}"` : ''}> in ${r.url}` };
      }
      if (!tag.id) {
        unnamed ??= { kind: 'inline', element: 'script', evidence: `an inline snippet with no id in ${r.url}` };
        continue;
      }
      const handle = handleFromId(tag.id);
      const slug = slugForHandle(handle, known);
      const a: Attribution = { kind: 'inline', element: 'script', slug: handle, evidence: `<script id="${tag.id}"> in ${r.url}` };
      if (slug) {
        a.kind = 'plugin';
        a.slug = slug;
        a.label = pluginLabel(slug);
        const v = pluginInventory(capture).find((p) => p.slug === slug)?.versions[0];
        if (v) a.version = v;
      } else {
        a.label = `script handle "${handle}"`;
      }
      return a;
    }
  }
  return unnamed;
}

/**
 * Attribute one request: first by its own URL, then by walking the chain of
 * scripts that caused it (following each initiator back to its own request).
 */
export function attributeRequest(req: Request, capture: Capture): Attribution {
  const byUrl = new Map<string, Request>();
  for (const r of capture.requests) if (!byUrl.has(r.url)) byUrl.set(r.url, r);

  const seen = new Set<string>();
  const queue: string[] = [req.url];
  let optimizer: Attribution | null = null;
  while (queue.length && seen.size < 40) {
    const url = queue.shift() as string;
    if (seen.has(url)) continue;
    seen.add(url);
    const a = attributeUrl(url);
    if (a && (a.kind === 'plugin' || a.kind === 'theme')) return a;
    if (a?.kind === 'optimizer') optimizer ??= a;
    const r = byUrl.get(url);
    if (r) queue.push(...r.initiatorUrls);
  }
  return optimizer ?? { kind: 'unknown', evidence: req.initiatorUrls[0] ?? 'no initiator recorded' };
}
