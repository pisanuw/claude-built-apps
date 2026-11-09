/**
 * Point an existing Netlify site (one this repo does not deploy, such as a
 * pisan-labs repo built by Netlify's own Git integration) at a hintwise.org
 * (or pisan.me) custom domain: create the Cloudflare CNAME if missing, set the site's
 * primary custom domain, and request its certificate.
 *
 *   node set-domain.mjs --site stepwise-pisan-labs --domain stepwise.hintwise.org
 *   node set-domain.mjs --site paste-md --domain paste-md.hintwise.org --alias
 *
 * --alias adds the domain as an extra name and leaves the primary as it is, so
 * an app that names its own address (sign-in callbacks, APP_URL) keeps working
 * on both until it is ready to switch; run again without --alias to make it the
 * primary, which also makes the .netlify.app address redirect to it.
 *
 * Needs NETLIFY_AUTH_TOKEN; CLOUDFLARE_API_TOKEN (CLOUDFLARE_ZONE_ID only as a fallback) to
 * create the DNS record. Run it from the "Set Netlify domain" workflow.
 */
import { ensureDomainDns } from "./cloudflare-dns.mjs";
import { APP_DOMAIN, OLD_DOMAIN } from "../../scripts/domains.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const site = arg("site");
const domain = arg("domain");
const aliasOnly = process.argv.includes("--alias");
if (!site || !domain)
  throw new Error(
    `usage: set-domain.mjs --site <netlify-site-name> --domain <host.${APP_DOMAIN}>`,
  );
if (!/^[a-z0-9-]+$/.test(site)) throw new Error(`bad site name: ${site}`);
if (
  ![APP_DOMAIN, OLD_DOMAIN].some(
    (z) =>
      domain.endsWith(`.${z}`) &&
      /^[a-z0-9-]+$/.test(domain.slice(0, -(z.length + 1))),
  )
)
  throw new Error(
    `domain must be <host>.${APP_DOMAIN} or <host>.${OLD_DOMAIN}: ${domain}`,
  );
const token = process.env.NETLIFY_AUTH_TOKEN;
if (!token) throw new Error("NETLIFY_AUTH_TOKEN is not set");

async function netlify(route, init = {}) {
  const res = await fetch(`https://api.netlify.com/api/v1${route}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `Netlify ${init.method || "GET"} ${route} -> HTTP ${res.status}: ${text.slice(0, 300)}`,
    );
  return text ? JSON.parse(text) : {};
}

const target = `${site}.netlify.app`;
const info = await netlify(`/sites/${target}`);
console.log(
  `Site ${info.name} (${info.id}), custom domain now: ${info.custom_domain || "none"}`,
);

const dns = await ensureDomainDns({ domain, target });
console.log(dns.message);
if (!dns.ready) process.exit(1);

const aliases = info.domain_aliases || [];
if (aliasOnly) {
  if (info.custom_domain === domain || aliases.includes(domain)) {
    console.log(`${domain} is already on the site.`);
  } else {
    await netlify(`/sites/${info.id}`, {
      method: "PATCH",
      body: JSON.stringify({ domain_aliases: [...aliases, domain] }),
    });
    console.log(`Added ${domain} as an alias; the primary stays ${info.custom_domain || target}.`);
  }
} else if (info.custom_domain === domain) {
  console.log(`Custom domain already ${domain}.`);
} else {
  await netlify(`/sites/${info.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      custom_domain: domain,
      domain_aliases: aliases.filter((d) => d !== domain),
    }),
  });
  console.log(`Set custom domain to ${domain}.`);
}
try {
  try {
    await netlify(`/sites/${info.id}/ssl`, { method: "POST" });
    console.log(`Requested a TLS certificate for ${domain}.`);
  } catch (e) {
    // A site with a Let's Encrypt certificate already answers 422 "existing
    // certificate"; adding a name then needs the renew endpoint.
    if (!String(e.message).includes("existing certificate")) throw e;
    await netlify(`/sites/${info.id}/ssl/renew`, { method: "POST" });
    console.log(`Certificate renewal requested (adds ${domain}).`);
  }
} catch (e) {
  console.log(
    `TLS request did not go through yet (Netlify retries on its own once DNS resolves): ${String(e).slice(0, 300)}`,
  );
}
// Wait until the name answers over https, so the run says whether it worked.
for (let i = 0; i < 30; i++) {
  try {
    const r = await fetch(`https://${domain}/`, { redirect: "manual" });
    console.log(`https://${domain}/ answers HTTP ${r.status}.`);
    process.exit(0);
  } catch {
    await new Promise((ok) => setTimeout(ok, 10000));
  }
}
console.log(`::warning::https://${domain}/ does not answer yet after 5 minutes (certificate still pending?).`);
