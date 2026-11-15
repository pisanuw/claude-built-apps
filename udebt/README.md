# udebt (platform files only)

udebt lives in its own repository, pisanuw/understanding-debt. This folder holds
only what the Plabs session applies to the shared Supabase project with the
Supabase admin workflow:

- `supabase/migrations/`: copied byte for byte from that repository (commit a141646),
  applied with `migrate udebt`, then `expose-schema app_udebt` and `check-schema app_udebt`.
- `supabase/ops/<sample>.sql`: the three shared sample analyses (public repositories),
  each loaded with `sql`; idempotent.
- `supabase/ops/udebt-llm-caps.sql`: the gateway row (default model Sonnet, default caps), from understanding-debt ba647d7; run after the owner's yes.

Shared by design (`SHARED_TABLES` in platform/supabase-admin.mjs): app_udebt.repositories
and app_udebt.analyses, read by every signed-in person.
