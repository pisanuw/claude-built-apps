/**
 * Point an existing Netlify site (one this repo does not deploy, such as a
 * pisan-labs repo built by Netlify's own Git integration) at a pisan.me
 * custom domain: create the Cloudflare CNAME if missing, set the site's
 * primary custom domain, and request its certificate.
 *
 *   node set-domain.mjs --site stepwise-pisan-labs --domain stepwise.pisan.me
 *
 * Needs NETLIFY_AUTH_TOKEN; CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ZONE_ID) to
 * create the DNS record. Run it from the "Set Netlify domain" workflow.
 */
import { ensureDomainDns } from "./cloudflare-dns.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const site = arg("site");
const domain = arg("domain");
if (!site || !domain)
  throw new Error(
    "usage: set-domain.mjs --site <netlify-site-name> --domain <host.pisan.me>",
  );
if (!/^[a-z0-9-]+$/.test(site)) throw new Error(`bad site name: ${site}`);
if (!/^[a-z0-9-]+\.pisan\.me$/.test(domain))
  throw new Error(`domain must be <host>.pisan.me: ${domain}`);
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

if (info.custom_domain === domain) {
  console.log(`Custom domain already ${domain}.`);
} else {
  await netlify(`/sites/${info.id}`, {
    method: "PATCH",
    body: JSON.stringify({ custom_domain: domain }),
  });
  console.log(`Set custom domain to ${domain}.`);
}
try {
  await netlify(`/sites/${info.id}/ssl`, { method: "POST" });
  console.log(`Requested a TLS certificate for ${domain}.`);
} catch (e) {
  console.log(
    `TLS request did not go through yet (Netlify retries on its own once DNS resolves): ${String(e).slice(0, 300)}`,
  );
}
