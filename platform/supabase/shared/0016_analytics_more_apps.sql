-- First-party analytics for the HintWise apps in their own repositories
-- (owner, 17 Nov 2026: "add analytics to the rest of the apps"). Each app's
-- branch `analytics` adds hw-events.js; its events are stored only from the
-- origins listed here. The apps in this repo are registered by the Deploy
-- workflow instead (scripts/site-analytics.mjs, analytics-register).
-- Registering an app that does not send yet stores nothing.
-- Idempotent: an existing row keeps its origins and gains these; enabled is
-- never changed.

insert into platform.analytics_apps (slug, origins) values
  ('udebt', array['https://udebt.hintwise.org']),
  ('upvoteme', array['https://upvoteme.hintwise.org']),
  ('paste-md', array['https://paste-md.hintwise.org']),
  ('photo2pgn', array['https://photo2pgn.hintwise.org']),
  ('chesstd', array['https://chesstd.hintwise.org', 'https://td.hintwise.org'])
on conflict (slug) do update
  set origins = (select array(select distinct o from unnest(platform.analytics_apps.origins || excluded.origins) o order by o));
