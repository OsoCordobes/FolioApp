# CLAUDE.md — Folio

Folio is a **medical-practice SaaS for Argentina** (patient management, scheduling, clinical records, public booking, MercadoPago subscriptions). It stores **PHI/PII** — treat data and production with care.

## Stack
- **Next.js 15** (App Router) + **React 19** + TypeScript.
- **Supabase**: Postgres (multi-tenant via RLS) + Auth. Production project: `grkpayhxndztlfwxobnt` (region `sa-east-1`).
- **Styling: hand-written `public/folio.css`** (~13.6k lines, brass/cream theme). **No Tailwind, no shadcn/Radix.** Tokens live in `:root` — colors (`--accent`, `--ink-*`, `--surface-*`, status `--green/amber/red/slate(-soft)`), radii (`--r-sm/md/lg/xl`), spacing (`--space-*`). Reuse tokens; don't introduce off-theme hex.
- **MercadoPago** subscriptions. **Vercel** hosting (functions pinned to `gru1`).

## Commands (pnpm)
- `pnpm dev` — local dev (port 3010)
- `pnpm typecheck` — `tsc --noEmit` — run after any TS change
- `pnpm lint` — eslint
- `pnpm test:unit` — `node:test` over `tests/unit/**` — run after logic changes
- `pnpm build` — `next build`

⚠️ The Supabase client is typed `<any>`, so **`tsc` does NOT catch DB schema mismatches** (wrong column/table/RPC names). Verify those by hand against `supabase/migrations/`.

## Database & migrations
- Numbered SQL migrations in `supabase/migrations/` (`M01`…`Mnn`, timestamp-prefixed). **Append-only for schema changes — never edit an already-applied migration to change what it creates; add a new one.** (Non-schema parse directives like `set check_function_bodies = off` are fine to add retroactively — they don't alter the resulting schema or cause drift, which `diff-migrations.mjs` tracks by version, not content.)
- **Migrations must replay on vanilla `postgres:16` with DEFAULT settings**, not just under the pgTAP CI wrapper. A migration that defines a `LANGUAGE sql` function referencing a table created in a *later* migration (e.g. the RLS helpers in M01 reference `member` from M02) fails at `CREATE` under Postgres's default `check_function_bodies = on`. Such migrations must `set check_function_bodies = off;` at the top of the file — otherwise they pass pgTAP (which sets it off per-file) but break the **Supabase preview branch** and local `supabase db reset`. The full chain is verified to replay clean under default settings; keep it that way.
- **CI (`.github/workflows/pgtap.yml`) replays ALL migrations on vanilla `postgres:16`** with minimal Supabase stubs — a migration must apply there. Known gotchas: functions in index/`EXCLUDE` expressions must be `IMMUTABLE` (wrap `timestamptz + interval`, which is STABLE); the `storage.buckets` CI stub only has the columns its setup declares.
- Apply to prod via the **Supabase MCP** (`apply_migration`) when available; otherwise the repo's `scripts/*.mjs` connect through `.env.local` (`POSTGRES_URL_NON_POOLING`/`DATABASE_URL`). Always record the **canonical** repo version in `supabase_migrations.schema_migrations` so `scripts/diff-migrations.mjs` stays accurate.

## Deploy discipline (important)
- **`master` auto-deploys to production** (Vercel). PRs are **squash-merged**; conventional-commit titles.
- **Migrations the code depends on must be applied to prod BEFORE the code merges/deploys.** Otherwise the deployed code hits a missing column/RPC and fails silently (the `<any>` client gives no compile-time guard).
- For **coupled DB + code** changes, use a **staged rollout** to avoid a broken window: additive migration (nullable columns / new functions) → deploy code → enforcing constraint last. **Pre-check prod data** before any constraint that validates on install (`EXCLUDE`, `CHECK`).

## Conventions
- `lib/db/*` returns a **`Result`** (`ok` / `err`) — don't throw past that contract; map Postgres SQLSTATEs in `lib/db/errors.ts`.
- **Multi-tenancy = RLS**, scoped by `public.user_org_ids()` / `can_read_clinical()`. Privileged/cross-tenant ops run in `SECURITY DEFINER` functions called by `service_role` (BYPASSRLS).
- The billing/grace gate is bypassed per-org via `organization.is_internal_account` (auditable) — use it for comp/internal/demo accounts; never insert fake `suscripcion` rows.
- Medical/PHI repo: keep secrets in `.env.local` (gitignored); don't point third-party tooling/skills at external services with repo code.
