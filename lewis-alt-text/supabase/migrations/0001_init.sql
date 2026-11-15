-- lewis-alt-text stores nothing per user in Supabase: images, options and
-- alt text stay in the visitor's browser and go only to the model. This
-- creates the app's (empty) schema, so the Deploy workflow's expose-schema
-- and check-schema steps have something to act on, and registers the app
-- with the LLM gateway. Its caps are set by the owner through Plabs, not here.
create schema if not exists app_lewis_alt_text;
comment on schema app_lewis_alt_text is 'lewis-alt-text: no per-user tables; dropping the schema retires the app.';
grant usage on schema app_lewis_alt_text to authenticated;

insert into platform.llm_apps (slug) values ('lewis-alt-text') on conflict do nothing;
