/**
 * The one place that names the apps' base domain.
 *
 * Apps moved from <app>.pisan.me to <app>.hintwise.org in November 2026. The
 * target.yml files still say `customDomain: <app>.pisan.me` (changing one
 * deploys that app, and every Netlify deploy costs credits), so the deploy
 * runner maps that value through appDomainFor() instead.
 *
 * Only names under OLD_DOMAIN move. Any other domain, such as an app's own
 * domain, passes through unchanged.
 */
export const APP_DOMAIN = 'hintwise.org';
export const OLD_DOMAIN = 'pisan.me';

/**
 * Exceptions: old name label -> new name label, for an app whose hintwise
 * name differs from its pisan.me name. Everything that maps an old name to a
 * new one (deploy runner, migrate-domains.mjs, the redirect rule) reads this.
 */
export const HOST_RENAMES = Object.freeze({
  'daily-project-ideas': 'studio', // owner's decision, 8 Nov 2026
});
const RENAMED_FROM = Object.fromEntries(Object.entries(HOST_RENAMES).map(([a, b]) => [b, a]));

const clean = (d) => String(d ?? '').trim().toLowerCase().replace(/\.$/, '');

/** True when `domain` is a subdomain of `zone` (not the zone apex itself). */
export function isSubdomainOf(domain, zone) {
  const d = clean(domain);
  return d.endsWith(`.${zone}`) && d.length > zone.length + 1;
}

/**
 * "bombe-bench.pisan.me" -> "bombe-bench.hintwise.org", with HOST_RENAMES
 * applied ("daily-project-ideas.pisan.me" -> "studio.hintwise.org").
 * Other domains are returned unchanged.
 */
export function appDomainFor(domain) {
  const d = clean(domain);
  if (!d) return '';
  if (!isSubdomainOf(d, OLD_DOMAIN)) return d;
  const label = d.slice(0, -(OLD_DOMAIN.length + 1));
  return `${Object.hasOwn(HOST_RENAMES, label) ? HOST_RENAMES[label] : label}.${APP_DOMAIN}`;
}

/** The inverse: "bombe-bench.hintwise.org" -> "bombe-bench.pisan.me", "studio.hintwise.org" -> "daily-project-ideas.pisan.me". */
export function oldDomainFor(domain) {
  const d = clean(domain);
  if (!d) return '';
  if (!isSubdomainOf(d, APP_DOMAIN)) return d;
  const label = d.slice(0, -(APP_DOMAIN.length + 1));
  return `${Object.hasOwn(RENAMED_FROM, label) ? RENAMED_FROM[label] : label}.${OLD_DOMAIN}`;
}

/** The name before the zone: "pull-the-pin.pisan.me" -> "pull-the-pin". */
export function hostLabelOf(domain) {
  const d = clean(domain);
  for (const zone of [APP_DOMAIN, OLD_DOMAIN]) {
    if (isSubdomainOf(d, zone)) return d.slice(0, -(zone.length + 1));
  }
  return d.split('.')[0];
}
