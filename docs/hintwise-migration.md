# Moving the apps from pisan.me to hintwise.org

Owner's decisions (8 Nov 2026):
- **Scope:** move everything.
- **Footer:** HintWise as the company, with Yusuf Pisan as "Chief Education Officer". Links to the academic page and the AI projects page stay.
- **Email:** builder@hintwise.org.
- **DNS:** each `<x>.hintwise.org` and each `<x>.pisan.me` points straight at Netlify or Render, never at another of our names.
- **Old addresses:** a Cloudflare redirect rule on pisan.me sends `<x>.pisan.me/<path>` to `<x>.hintwise.org/<path>`.
- **Order:** code and documentation first, DNS after.

hintwise.org is already a zone in the owner's Cloudflare account.

## One constraint to know first

A Cloudflare redirect rule only runs on **proxied** (orange-cloud) records. A DNS-only record sends the browser straight to Netlify or Render, and Cloudflare never sees the request.

So each moved `<x>.pisan.me` record stays a direct CNAME to `<site>.netlify.app` or `<service>.onrender.com`, but is switched to proxied. Once it is proxied, Cloudflare answers with the 301 itself and never forwards the request. That is still no DNS chain: the record points straight at the host.

`<x>.hintwise.org` records stay DNS only, so Netlify and Render issue their own certificates for them.

## Inventory (from the List DNS workflow, 8 Nov)

**Apps in this repo: 60 Netlify sites.** Each is CNAME `<app>.pisan.me` to `<site>.netlify.app`. Four use a site name that differs from the app name:

| Name | Netlify site |
|---|---|
| accessibility-lens | accessibility-lens-pisanuw |
| emoji-lingua | emoji-lingua-pisan |
| pathfinding-playground | pathfinding-playground-pisanuw |
| pull-the-pin | pull-the-pin-lab |

**`mult-streak.pisan.me`** points at `mult-streak-edge-pisan`, and backend-hub serves the Render variant.

**Other Netlify sites, outside this repo:**

| Name | Netlify site | Built from |
|---|---|---|
| daily-project-ideas | daily-project-ideas | pisanuw/daily-project-ideas |
| meetme | meetme-2 | ? |
| ypai | chatwithdigitalme | ? |
| stepwise | stepwise-pisan-labs | pisan-labs |

**Render, Chess TD:**
- `chesstd.pisan.me` points at `chess-td-web.onrender.com`, the web app.
- `td.pisan.me` points at `chess-td-server.onrender.com`, the API. The web app calls it, and `WEB_ORIGINS` names the web origins it accepts.

**Not apps; they stay on pisan.me and are never redirected:**
- **Personal site:** the apex `pisan.me`, `www`, and the `g`, `yusuf` and `zoom` names with their `www.` forms (A records to 208.67.23.221).
- **Email:**
  - the Google MX records;
  - `_dmarc`;
  - the Resend and SES sending records: `send`, `reply`, `send.reply`, `resend._domainkey` and `resend._domainkey.reply`;
  - `mult-streak@pisan.me` keeps sending from pisan.me (Resend domain verification). It can move later.
- **Verification TXT records:** `verified-for-netlify`, `subdomain-owner-verification` and `microsoft-education`.
- **`ypdsa`:** a CNAME to digital-student-assistant.com, which is its own domain. Decision 4 below.

## Phase 0: owner setup (no code)

1. **A new Cloudflare API token** (dash.cloudflare.com, then My Profile, API Tokens, Create Token, Custom token):
   - Permissions:
     - Zone / Zone / Read;
     - Zone / DNS / Edit;
     - the redirect-rules permission. The token editor lists it as "Single Redirect" or "Dynamic Redirect"; I'm not sure of the current label.
   - Zone resources: Include, Specific zone, **pisan.me** and **hintwise.org**.
   - Then put it in GitHub (repo pisanuw/claude-built-apps, Settings, Secrets and variables, Actions) as **`CLOUDFLARE_API_TOKEN`**, replacing the old value.
   - Leave `CLOUDFLARE_ZONE_ID` as it is: the code looks zones up by name.
   - Check: run the "List DNS" workflow with zone `hintwise.org`. It should list the zone's records.
2. **Email Routing on hintwise.org** (Cloudflare dashboard, hintwise.org, Email, Email Routing): add `builder@hintwise.org` and forward it to your inbox. Cloudflare adds the MX records itself.
   - Check: send a test message to builder@hintwise.org.
3. **Netlify:** nothing to do. The deploy token already reaches every site in the account.

## Phase 1: code and documentation (prepared on a branch; nothing changes for visitors)

All work goes on branch `hintwise` in each repo. Each branch is merged in Phase 3, after the hintwise names answer, so no link ever points at an address that doesn't work yet.

**claude-built-apps**

1. **One base domain** in `scripts/domains.mjs`: `APP_DOMAIN = 'hintwise.org'` and `OLD_DOMAIN = 'pisan.me'`.
   - The deploy runner derives each app's address from it, replacing the `customDomain` value in every `target.yml`.
   - This way the 60 `target.yml` files need not change. A push that changes `target.yml` deploys that app (about 60 paid deploys); a change to the runner deploys nothing.
2. **deploy.mjs:**
   - It creates `<app>.hintwise.org`, DNS only.
   - It makes that the site's primary domain, with no pisan.me alias, because Cloudflare answers pisan.me.
   - The `.netlify.app` redirect it writes points at hintwise.org.
3. **cloudflare-dns.mjs, attach-domain.mjs, set-domain.mjs, set-cname.mjs, remove-domain.mjs:**
   - Accept both zones, looking each zone up by name.
   - attach-domain stops keeping the old primary as an alias when the old one is on pisan.me.
4. **New `migrate-domains.mjs` and workflow,** run in Phase 2. Per app it can:
   - create the hintwise CNAME;
   - add the hintwise name to the Netlify site;
   - wait for the certificate;
   - make hintwise the primary and remove the pisan.me alias;
   - proxy the pisan.me record.

   It has `--dry-run`, a single-app mode and batch mode. Every step is idempotent and logs before and after.
5. **New `redirect-rule.mjs`:** creates or updates one Single Redirect rule on the pisan.me zone.
   - It matches an explicit list of the moved hosts, not `*.pisan.me`, so the personal site and email names are never caught.
   - Target: `https://<x>.hintwise.org<path>`, 301, query string kept.
   - It lives in code so a new app can be added by re-running it.
6. **Footer (`scripts/site-footer.mjs`):**
   - New text, builder@hintwise.org, and the academic-page link.
   - It keeps the line-break rules (four lines, then the name line; "free :-)" never splits; the email kept together).
   - Tests updated.
   - Ships on each app's next deploy, as the owner set on 7 Nov.
7. **Hard-coded pisan.me in app code** (about 15 files, among them popup-check, mult-streak-edge, health-page-tracker-watch, student-journey-check, misrepresentation-preflight, accessibility-lens and backend-hub):
   - Change these to hintwise.org, tests included.
   - Each app picks the change up on its next deploy. The redirect covers the gap.
8. **Documentation:**
   - root README, PROJECTS.md, every app README;
   - CLAUDE.md (the rule "every app's primary address is `<app>.pisan.me`");
   - BUILD_ROUTINE.md, HANDOFF.md, docs/launch-drafts.md (not yet posted).
9. **Checks:** each package's lint, typecheck, coverage and build; the footer and DNS tests; CI green on the branch.

**daily-project-ideas** (branch `hintwise`):
- the site's own address and the showcase links (`web/showcase.json`);
- ROUTINE.md and any pisan.me in pages or notes;
- pushes carry `[skip netlify]` until merge, then one Netlify build.

**pisanorg/yusuf** (branch `hintwise`):
- the aiprojects page links to `<app>.hintwise.org`.

**chess-tournament-director** (its own repo and session; PR there):
- `WEB_ORIGINS` gains `https://chesstd.hintwise.org`, keeping the old origin;
- the web app's API address moves to `td.hintwise.org`;
- docs updated.

**Not reachable from this session:** stepwise (pisan-labs), meetme and ypai (unknown repos). Their DNS and Netlify domain can still be moved from here in Phase 2, but any links inside them won't change.

## Phase 2: DNS and hosts (after Phase 0 and Phase 1 are ready)

For each app, in this order, so no address is ever dead:

1. Create CNAME `<x>.hintwise.org` to `<site>.netlify.app` (or `.onrender.com`), DNS only.
2. Add `<x>.hintwise.org` to the Netlify site and wait for its certificate.
   - Render: add the custom domain to the service, by API with `RENDER_API_KEY` or in the dashboard.
3. Check that `https://<x>.hintwise.org/` answers 200.

Batches:
- **Pilot:** one app, `bombe-bench`, through all of Phases 2 to 4. Check it, then continue.
- **Then:** the remaining Netlify apps in batches of 10, then daily-project-ideas, meetme, ypai and stepwise.
- **Then Chess TD:** `chesstd` and `td` on Render, after the Chess TD PR has added the new origin and API address.

No Netlify deploys are needed in this phase. Everything is done through the API.

## Phase 3: switch the links

1. Merge the `hintwise` branches: claude-built-apps, daily-project-ideas (one Netlify build), yusuf, and the Chess TD PR.
   - Merging claude-built-apps deploys nothing by itself, because no `target.yml` changes.
2. New apps built from now on start at `<app>.hintwise.org`.

## Phase 4: redirect pisan.me

1. **Primary domain.** For each moved Netlify site, make `<x>.hintwise.org` the primary, then remove the `<x>.pisan.me` alias so the site's certificate covers hintwise only.
   - The pisan.me alias has to go: once the record is proxied, Netlify can no longer renew a certificate that includes that name.
2. **Proxy the record.** Switch the `<x>.pisan.me` record to proxied. Its target stays `<site>.netlify.app`.
3. **Redirect rule.** Add the host to the redirect rule, in the same run as step 2, so there is no gap.
4. **Checks:**
   - `curl -sI https://<x>.pisan.me/some/path?q=1` shows `301` and `location: https://<x>.hintwise.org/some/path?q=1`.
   - `curl -sI https://<x>.hintwise.org/` shows `200`.
5. **`td.pisan.me` (the API) is not redirected.** A 301 turns POST requests into GET and breaks CORS preflight. It stays DNS only, still served by Render under both names, until the Chess TD web app is live on td.hintwise.org. Only then is it added to the rule.
6. **Google Search Console:** add hintwise.org and use the change-of-address tool.

## Known side effects
- **Browser-saved data.** About 30 apps keep users' work in the browser (localStorage or IndexedDB). That data belongs to the exact address, so work saved at `<x>.pisan.me` won't show at `<x>.hintwise.org`. Accepted, unless the owner wants an export notice.
- **Old `.netlify.app` links.** Until an app is next deployed, its `.netlify.app` address still 301s to pisan.me, which then 301s to hintwise.org: two redirect hops, not a DNS chain. Each app's next deploy makes it one hop.
- **Footer.** The new footer appears app by app as each is deployed. A mix of old and new footers is expected for a while.
- **Keep pisan.me registered** for as long as the redirects should work.

## Open decisions
1. **Academic page:** the URL for the footer link.
2. **Footer wording:** the draft below; change anything.
3. **meetme, ypai and stepwise:** move them too? (Default: yes, DNS and Netlify domain only.)
4. **ypdsa:** leave it as a CNAME to digital-student-assistant.com, or give it a hintwise name? (Default: leave it.)
5. **Personal-site names** (`pisan.me`, `www`, `g`, `yusuf`, `zoom`): stay on pisan.me. (Default: yes.)
6. **Email sending** (`mult-streak@pisan.me` through Resend): stay on pisan.me for now. (Default: yes.)

Footer draft:

```
HintWise builds tools like this for small businesses, startups and educators. Built with Claude.
Want something like this for your own work? Email builder@hintwise.org.
Paid projects welcome, interesting ones may be done for free :-)
More apps: pisanorg.github.io/yusuf/aiprojects · Academic page
Yusuf Pisan, Chief Education Officer, HintWise
```

## Showcase site decisions (owner, 8 Nov)
- The daily-project-ideas Netlify site becomes the HintWise company showcase. hintwise.org stops forwarding to digital-student-assistant.com and serves the showcase (answer 1: yes; answer 2: "HintWise at hintwise.org"). Correction (owner, 8 Nov): the showcase lives at **studio.hintwise.org**, named HintWise Studio. The apex hintwise.org stops forwarding to digital-student-assistant.com and 301s to studio.hintwise.org (default; open to change). daily-project-ideas.pisan.me 301s to studio.hintwise.org.
- The daily ideas stay public, renamed "Next up".
- Featured apps: StepWise, Poincare Paint, Digital Student Assistant, Bombe Bench, Cache Miss Theater, Health Page Tracker Watch.

## Google sign-in (owner, 8 Nov: "will also need to update google auth")
- Chess TD's API (chess-td-server) has "Continue with Google". Its OAuth redirect URI is `<PUBLIC_URL>/api/auth/google/callback`.
- Owner steps in Google Cloud Console (APIs & Services, Credentials, the Chess TD OAuth client), done in Phase 2 before the switch:
  - add `https://td.hintwise.org/api/auth/google/callback` as an authorized redirect URI, keeping the td.pisan.me one;
  - add `https://chesstd.hintwise.org` as an authorized JavaScript origin;
  - add hintwise.org to the OAuth consent screen's authorized domains (Google may ask you to verify the domain in Search Console first).
- Then set PUBLIC_URL on Render to the td.hintwise.org address.
- The web app and the API must change domain together: the server only accepts same-site web origins (its session cookie), so chesstd.hintwise.org cannot talk to td.pisan.me.
- No app in claude-built-apps uses Google sign-in (the .env.example entries are unused templates); agent-blast-radius only mentions accounts.google.com in its analysis rules.

## Email sending through Resend (owner, 8 Nov: "Resend will need to send all emails from hintwise.org")
This replaces open decision 6: sending moves to hintwise.org.
- **Senders today, all on pisan.me:**
  - mult-streak (backend-hub on Render): `mult-streak@pisan.me`;
  - mult-streak-edge (Netlify): `mult-streak-edge@pisan.me`;
  - Chess TD server: `td@pisan.me`;
  - daily-project-ideas digest: the `FROM_EMAIL` GitHub secret in that repo.
  - DNS shows the Resend and SES records `send`, `reply` and `send.reply` on pisan.me. `reply.pisan.me` takes inbound mail, and no code in these repos refers to it; find out what uses it before it changes.
- **Owner steps first (Phase 0):**
  - In Resend, Domains, Add Domain `hintwise.org`, in the same region as pisan.me (us-east-1).
  - Resend shows the DNS records: a DKIM TXT at `resend._domainkey`, plus an MX and an SPF TXT at `send`. Use Resend's "Auto configure" with Cloudflare, or send me the values and I'll add them with the token. These records don't clash with the Email Routing MX records on the hintwise.org apex.
  - Add a DMARC record `_dmarc.hintwise.org`, copied from pisan.me's.
  - Wait until Resend shows the domain as Verified.
- **Code (branch hintwise-apps):**
  - The defaults in mult-streak and mult-streak-edge are now `mult-streak@hintwise.org` (4b27991).
  - The `target.yml` FROM_EMAIL values for backend-hub and mult-streak-edge are in a separate commit, fcb3044, marked DEPLOYS ON MERGE. Merging it redeploys backend-hub (Render) and mult-streak-edge (Netlify, paid), so it is merged only once hintwise.org is verified and with the owner's yes.
- **Chess TD:** `td@hintwise.org`, on its hintwise branch. The Render env var changes after verification.
- **daily-project-ideas:** the owner sets the `FROM_EMAIL` secret to an @hintwise.org address after verification.
- **Rule:** never switch a sender before Resend shows hintwise.org as verified, or that app's email will fail.

## Owner answers (8 Nov, ~09:50 CET)
1. The apex hintwise.org and `www` 301 to studio.hintwise.org. They no longer forward to digital-student-assistant.com.
2. The footer's "More apps" link goes to studio.hintwise.org (done on hintwise-apps, 77d4714).
3. Resend: the owner adds hintwise.org as a sending domain.
4. `reply.pisan.me` (Resend inbound): the owner is checking. It may be pisanuw/cagent. It stays on pisan.me until we know.
5. meetme moves to meetme.hintwise.org (DNS and Netlify domain only).
6. ypdsa stays on pisan.me for now.
7. Rename the Netlify site `daily-project-ideas` to `hintwise`. Do this in Phase 2 at the same moment the DNS records are repointed, because `daily-project-ideas.pisan.me` currently points at `daily-project-ideas.netlify.app` and would break the moment the old name disappears.
8. The showcase lists all apps, with audience filters.

