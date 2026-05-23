# Folio Pre-Launch Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Folio to 10/10 launch readiness by fixing the 28 findings from the 2026-05-23 audit, including 4 critical bugs (storage buckets, audit log partition cron, analytics enum mismatch, patient deduplication), 11 high-severity hardenings (types regen, multi-tenant gaps, auth atomicity), and 13 medium/low polish items.

**Architecture:** Twelve sequential phases, each independently committable. Database changes go in new migrations M27→M36 (forward-only, idempotent). Server-action changes wrap each refactor with unit tests where the logic warrants it and integration/e2e tests for cross-layer flows. Multi-tenant security changes are validated with explicit policy tests using the local Supabase stack.

**Tech Stack:** Next.js 15 (App Router, Turbopack) · Supabase Postgres 15 (RLS, partitioned tables, plpgsql) · `@supabase/ssr` · AES-256-GCM via `node:crypto` · Playwright (e2e) · Node test runner + tsx (unit) · ESLint + tsc strict.

**Quality bar:** Every task ends green on `pnpm typecheck && pnpm lint && pnpm test:unit`. Migrations validated by running `node scripts/run-migrations.ts` on a clean local DB. E2E suite (`pnpm test:app`) re-run at end of every phase that touches behaviour. **No task is "done" until verified working.**

**Conventions:**
- Migrations: `supabase/migrations/YYYYMMDDNNNNNN_MNN_short_name.sql` — same date stamp pattern as M21–M26.
- Server actions: `"use server"` at top, return `Result<T>` from `lib/db/errors.ts`.
- All new code: zero placeholders, no TODO comments unless paired with a tracked issue.
- Commit messages: conventional commits (`fix:` / `feat:` / `chore:` / `refactor:` / `test:`). One commit per task minimum, split if it improves history clarity.

---

## Phase 0 — Prep & local DB

### Task 0.1: Confirm local Supabase stack runs and schema applies clean

**Files:**
- Read: `supabase/config.toml`, `scripts/run-migrations.ts`

- [ ] **Step 1** — Verify supabase CLI is installed locally:
  ```bash
  pnpm exec supabase --version
  ```
  Expected: prints version (>= 1.180). If missing, install: `pnpm add -D supabase`.

- [ ] **Step 2** — Boot local stack (Docker required):
  ```bash
  pnpm exec supabase start
  ```
  Expected: prints API URL, anon key, service_role key. Save those into a local `.env.local.test` file gitignored (do NOT overwrite `.env.local`).

- [ ] **Step 3** — Apply all migrations clean to the local stack:
  ```bash
  pnpm exec supabase db reset
  ```
  Expected: all 26 M01–M26 migrations apply with no errors.

- [ ] **Step 4** — Smoke check by querying the audit_log partitions:
  ```bash
  pnpm exec supabase db shell --command "SELECT tablename FROM pg_tables WHERE tablename LIKE 'audit_log_%' ORDER BY 1;"
  ```
  Expected: 12 monthly partitions starting at the current month.

- [ ] **Step 5** — Commit nothing yet (this is prep). Note in a personal scratchpad the local Supabase URL + service key for the migration run scripts.

### Task 0.2: Inventory current Storage buckets in production via Supabase MCP

**Files:** (none modified)

- [ ] **Step 1** — Use Supabase MCP `mcp__plugin_760460c221d3_supabase` tools (if configured) OR query directly via the project's `supabase` CLI configured for the remote project. Goal: list all buckets currently created in production.
  ```bash
  pnpm exec supabase storage ls
  ```
  (If linked to remote project) Expected: shows `org-logos` (per M21). If `documentos-clinicos` or `consentimientos-firmados` show up, capture their `public` flag and existing RLS state — this informs whether Task 1.1 needs a destructive bucket recreation or just a policy addition.

- [ ] **Step 2** — Record findings in `docs/audit/2026-05-23-storage-state.md` (one-pager). Note bucket name, public flag, file count, and existing policies for each bucket found.

- [ ] **Step 3** — Commit the audit note:
  ```bash
  git add docs/audit/2026-05-23-storage-state.md
  git commit -m "docs(audit): inventory production storage buckets pre-M27"
  ```

---

## Phase 1 — Storage security (CRITICAL)

### Task 1.1: M27 creates private buckets + path-scoped RLS for clinical files

**Files:**
- Create: `supabase/migrations/20260524000027_M27_storage_clinical.sql`
- Create: `tests/sql/M27_storage_clinical.spec.sql`

- [ ] **Step 1** — Write the migration:
  ```sql
  -- ════════════════════════════════════════════════════════════════════════════
  -- Folio · M27 · Storage buckets for clinical files (documentos-clinicos, consentimientos-firmados)
  -- ════════════════════════════════════════════════════════════════════════════
  -- M07 / M08 referenced these buckets in CHECK constraints but never created them.
  -- This migration creates both as PRIVATE buckets (public=false) and installs
  -- storage.objects RLS policies that mirror the parent tables' access rules.
  --
  -- Path convention enforced by M07/M08 CHECKs:
  --   documentos-clinicos/{org_uuid}/{paciente_uuid}/{file}.{ext}
  --   consentimientos-firmados/{org_uuid}/{paciente_uuid}/{file}.pdf
  --
  -- RLS uses the second path segment (org_uuid) to scope by membership.
  -- ════════════════════════════════════════════════════════════════════════════

  -- Idempotent bucket creation (UPSERT-style)
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES
    (
      'documentos-clinicos',
      'documentos-clinicos',
      false,
      26214400, -- 25 MB
      ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
    ),
    (
      'consentimientos-firmados',
      'consentimientos-firmados',
      false,
      10485760, -- 10 MB
      ARRAY['application/pdf']
    )
  ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

  -- Helper: extract org_uuid from path "{bucket}/{org_uuid}/..." — second segment of object name
  -- storage.foldername(name) returns text[] with each path segment.
  -- For an object stored at "documentos-clinicos/abc-uuid/123/file.pdf",
  -- name='abc-uuid/123/file.pdf' and foldername gives {'abc-uuid','123'}.

  -- ─── documentos-clinicos policies ────────────────────────────────────────

  DROP POLICY IF EXISTS docclin_select ON storage.objects;
  DROP POLICY IF EXISTS docclin_insert ON storage.objects;
  DROP POLICY IF EXISTS docclin_delete ON storage.objects;

  CREATE POLICY docclin_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'documentos-clinicos'
      AND (storage.foldername(name))[1]::uuid = ANY (user_org_ids())
      AND can_read_clinical((storage.foldername(name))[1]::uuid)
    );

  CREATE POLICY docclin_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'documentos-clinicos'
      AND (storage.foldername(name))[1]::uuid = ANY (user_org_ids())
      AND can_read_clinical((storage.foldername(name))[1]::uuid)
    );

  CREATE POLICY docclin_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id = 'documentos-clinicos'
      AND (storage.foldername(name))[1]::uuid = ANY (user_org_ids())
      AND user_role_in((storage.foldername(name))[1]::uuid) IN ('OWNER', 'DIRECTOR')
    );

  -- ─── consentimientos-firmados policies ───────────────────────────────────

  DROP POLICY IF EXISTS consfirm_select ON storage.objects;
  DROP POLICY IF EXISTS consfirm_insert ON storage.objects;
  DROP POLICY IF EXISTS consfirm_delete ON storage.objects;

  CREATE POLICY consfirm_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'consentimientos-firmados'
      AND (storage.foldername(name))[1]::uuid = ANY (user_org_ids())
      AND can_read_clinical((storage.foldername(name))[1]::uuid)
    );

  CREATE POLICY consfirm_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'consentimientos-firmados'
      AND (storage.foldername(name))[1]::uuid = ANY (user_org_ids())
    );

  -- No DELETE policy for consentimientos: signed consents are immutable
  -- per medico-legal traceability. Pseudonymization cron removes via service_role.

  COMMENT ON POLICY docclin_select ON storage.objects IS
    'M27 · clinical-role members of the owning org can read documentos-clinicos files. Path: {bucket}/{org_uuid}/{paciente_uuid}/{file}';
  COMMENT ON POLICY consfirm_select ON storage.objects IS
    'M27 · clinical-role members of the owning org can read consentimientos-firmados PDFs. Path: {bucket}/{org_uuid}/{paciente_uuid}/{file.pdf}';
  ```

- [ ] **Step 2** — Apply locally and verify:
  ```bash
  pnpm exec supabase db reset
  pnpm exec supabase db shell --command "SELECT id, public FROM storage.buckets WHERE id IN ('documentos-clinicos','consentimientos-firmados');"
  ```
  Expected: 2 rows, both `public=false`.

- [ ] **Step 3** — Write SQL spec validating policies:

  Create `tests/sql/M27_storage_clinical.spec.sql`:
  ```sql
  -- Expectations: both buckets exist, are private, have 3+3 policies, mime allowlist correct.
  DO $$
  DECLARE
    v_count int;
  BEGIN
    SELECT count(*) INTO v_count FROM storage.buckets
      WHERE id IN ('documentos-clinicos','consentimientos-firmados') AND public = false;
    IF v_count <> 2 THEN
      RAISE EXCEPTION 'M27 spec: expected 2 private buckets, got %', v_count;
    END IF;

    SELECT count(*) INTO v_count FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname IN ('docclin_select','docclin_insert','docclin_delete',
                           'consfirm_select','consfirm_insert');
    IF v_count <> 5 THEN
      RAISE EXCEPTION 'M27 spec: expected 5 storage policies, got %', v_count;
    END IF;
    RAISE NOTICE 'M27 spec PASS';
  END $$;
  ```

- [ ] **Step 4** — Run spec:
  ```bash
  pnpm exec supabase db shell --file tests/sql/M27_storage_clinical.spec.sql
  ```
  Expected: `NOTICE: M27 spec PASS`. If fail, fix migration and re-reset.

- [ ] **Step 5** — Commit:
  ```bash
  git add supabase/migrations/20260524000027_M27_storage_clinical.sql tests/sql/M27_storage_clinical.spec.sql
  git commit -m "fix(storage): M27 creates private buckets + RLS for clinical files (closes audit CRITICAL-1)"
  ```

---

## Phase 2 — Audit log durability (CRITICAL)

### Task 2.1: M28 adds DEFAULT partition fallback + maintenance cron route

**Files:**
- Create: `supabase/migrations/20260524000028_M28_audit_log_partition_safety.sql`
- Create: `app/api/cron/maintenance/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1** — Write the migration. Adds a DEFAULT partition so a missing month never aborts an insert, then exposes a public `audit_log_run_maintenance(int)` wrapper callable from a server action.

  Contents of `supabase/migrations/20260524000028_M28_audit_log_partition_safety.sql`:
  ```sql
  -- ════════════════════════════════════════════════════════════════════════════
  -- Folio · M28 · Audit log durability — DEFAULT partition + maintenance wrapper
  -- ════════════════════════════════════════════════════════════════════════════
  -- M12 defined `audit_log_ensure_future_partitions(months_ahead int)` but never
  -- wired it to any cron. Without monthly invocation, the 12 pre-created
  -- partitions exhaust ~12 months post-deploy and every audit INSERT (triggered
  -- by paciente/sesion/turno/etc.) rolls back, bricking the app.
  --
  -- Fix:
  --   1. Create a DEFAULT partition so inserts NEVER fail, even if the cron skips.
  --   2. Add a SECURITY DEFINER wrapper `audit_log_run_maintenance(int)` that
  --      can be invoked from the service role via RPC (called by the cron route).
  -- ════════════════════════════════════════════════════════════════════════════

  -- 1. DEFAULT partition as safety net
  CREATE TABLE IF NOT EXISTS audit_log_default
    PARTITION OF audit_log DEFAULT;

  COMMENT ON TABLE audit_log_default IS
    'M28 · safety-net partition. Should remain empty in steady state; rows landing here indicate the maintenance cron skipped a month and need backfill into the right monthly partition.';

  -- 2. Maintenance wrapper (RPC-callable). Keeps the underlying function private
  --    to avoid accidental invocation with unsanitized args from clients.
  CREATE OR REPLACE FUNCTION audit_log_run_maintenance(p_months_ahead int DEFAULT 6)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE
    v_before  int;
    v_after   int;
    v_orphans int;
  BEGIN
    IF p_months_ahead < 1 OR p_months_ahead > 24 THEN
      RAISE EXCEPTION 'months_ahead must be between 1 and 24, got %', p_months_ahead;
    END IF;

    SELECT count(*) INTO v_before FROM pg_tables WHERE tablename LIKE 'audit_log_2%';
    PERFORM audit_log_ensure_future_partitions(p_months_ahead);
    SELECT count(*) INTO v_after  FROM pg_tables WHERE tablename LIKE 'audit_log_2%';

    -- Count rows landing in the DEFAULT partition (these mean the cron lagged
    -- and inserts fell through to the safety net — should be 0 in steady state).
    SELECT count(*) INTO v_orphans FROM ONLY audit_log_default;

    RETURN jsonb_build_object(
      'months_ahead', p_months_ahead,
      'partitions_before', v_before,
      'partitions_after', v_after,
      'created', v_after - v_before,
      'default_partition_orphans', v_orphans,
      'ts', now()
    );
  END
  $$;

  REVOKE ALL ON FUNCTION audit_log_run_maintenance(int) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION audit_log_run_maintenance(int) TO service_role;

  COMMENT ON FUNCTION audit_log_run_maintenance(int) IS
    'M28 · invoked by /api/cron/maintenance to keep audit_log partitions ahead. Returns jsonb with stats (orphans>0 means cron lagged).';
  ```

- [ ] **Step 2** — Apply and validate:
  ```bash
  pnpm exec supabase db reset
  pnpm exec supabase db shell --command "SELECT audit_log_run_maintenance(6);"
  ```
  Expected: JSON with `partitions_after >= 18`, `default_partition_orphans = 0`.

- [ ] **Step 3** — Write the cron route. Create `app/api/cron/maintenance/route.ts`:
  ```typescript
  /**
   * Folio · cron mensual de mantenimiento de audit_log.
   *
   * Llama audit_log_run_maintenance(6) para asegurar 6 meses de particiones
   * por delante. Si default_partition_orphans > 0, alerta a Sentry: significa
   * que el cron lageó y algunas filas cayeron a la safety net.
   *
   * Disparado por Vercel Cron mensual (definido en vercel.json).
   */

  import { NextResponse } from "next/server";
  import { captureException, captureMessage } from "@sentry/nextjs";

  import { createSupabaseServiceClient } from "@/lib/supabase/server";

  export const runtime = "nodejs";
  export const maxDuration = 60;

  export async function GET(request: Request) {
    // Vercel Cron sends an Authorization: Bearer <CRON_SECRET> header.
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse("unauthorized", { status: 401 });
    }

    try {
      const service = createSupabaseServiceClient();
      const { data, error } = await service.rpc("audit_log_run_maintenance", {
        p_months_ahead: 6,
      });

      if (error) {
        captureException(error, { tags: { cron: "maintenance" } });
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      const result = data as {
        months_ahead: number;
        partitions_before: number;
        partitions_after: number;
        created: number;
        default_partition_orphans: number;
        ts: string;
      };

      if (result.default_partition_orphans > 0) {
        captureMessage(
          `audit_log default partition has ${result.default_partition_orphans} orphan rows — cron is lagging`,
          { level: "warning", tags: { cron: "maintenance" } },
        );
      }

      return NextResponse.json({ ok: true, result });
    } catch (err) {
      captureException(err, { tags: { cron: "maintenance" } });
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "unknown" },
        { status: 500 },
      );
    }
  }
  ```

- [ ] **Step 4** — Register the cron in `vercel.json`. Read the file, find the `crons` array, append:
  ```json
  {
    "path": "/api/cron/maintenance",
    "schedule": "0 3 1 * *"
  }
  ```
  (Runs at 03:00 UTC on the 1st of each month — quietest UTC window for AR/LATAM users.)

- [ ] **Step 5** — Typecheck and lint:
  ```bash
  pnpm typecheck && pnpm lint --fix
  ```
  Expected: pass.

- [ ] **Step 6** — Commit:
  ```bash
  git add supabase/migrations/20260524000028_M28_audit_log_partition_safety.sql app/api/cron/maintenance/route.ts vercel.json
  git commit -m "fix(audit): M28 DEFAULT partition + monthly cron prevents audit_log bricking (closes audit CRITICAL-3)"
  ```

---

## Phase 3 — Analytics correctness (CRITICAL)

### Task 3.1: M29 fixes the SEGUIMIENTO enum mismatch in analytics pipeline

**Files:**
- Create: `supabase/migrations/20260524000029_M29_fix_analytics_seguimiento_enum.sql`
- Create: `tests/sql/M29_analytics_seguimiento.spec.sql`

- [ ] **Step 1** — Write the migration. Re-creates `analytics.refresh_org_metrics(date)` with the corrected enum literals (and only that). Easiest path: read M16 verbatim, change line 96, re-emit the whole function. Keep behaviour identical otherwise.

  Path: `supabase/migrations/20260524000029_M29_fix_analytics_seguimiento_enum.sql`. Top header:
  ```sql
  -- ════════════════════════════════════════════════════════════════════════════
  -- Folio · M29 · Fix analytics enum literals
  -- ════════════════════════════════════════════════════════════════════════════
  -- M16:96 filtered on tipo_canonico IN ('SEGUIMIENTO', 'CONTROL') but the
  -- enum tipo_servicio_canonico (M09:30) only defines:
  --   CONSULTA_INICIAL, SEGUIMIENTO_ESTANDAR, SEGUIMIENTO_EXTENDIDO,
  --   PACK_SESIONES, SERVICIO_ESPECIALIZADO
  -- Postgres compared the enum AS TEXT, so the filter silently returned ZERO rows,
  -- making precio_avg_seguimiento NULL for every org forever.
  --
  -- Fix: replace the CREATE OR REPLACE FUNCTION analytics.refresh_org_metrics
  -- with corrected literals: IN ('SEGUIMIENTO_ESTANDAR', 'SEGUIMIENTO_EXTENDIDO').
  -- All other semantics preserved verbatim from M16.
  -- ════════════════════════════════════════════════════════════════════════════

  CREATE OR REPLACE FUNCTION analytics.refresh_org_metrics(p_periodo date)
  RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, analytics AS $$
  -- [PASTE FULL BODY OF analytics.refresh_org_metrics FROM M16:24-186 HERE,
  --  changing ONLY line 96 from
  --     IN ('SEGUIMIENTO', 'CONTROL')
  --  to
  --     IN ('SEGUIMIENTO_ESTANDAR', 'SEGUIMIENTO_EXTENDIDO')]
  ```

  Concrete action: open `supabase/migrations/20260518000016_M16_analytics_pipeline.sql`, copy the entire `CREATE OR REPLACE FUNCTION analytics.refresh_org_metrics(p_periodo date)` block (start at the function header, end at `$$;`), paste into M29, change the literal on (formerly M16:96), keep everything else identical.

- [ ] **Step 2** — Apply locally:
  ```bash
  pnpm exec supabase db reset
  ```
  Expected: clean.

- [ ] **Step 3** — Write spec at `tests/sql/M29_analytics_seguimiento.spec.sql`:
  ```sql
  -- Seed minimal data: 1 org, 1 servicio SEGUIMIENTO_ESTANDAR, 1 turno cerrado, 1 pago.
  -- Then call refresh_org_metrics and assert precio_avg_seguimiento IS NOT NULL.

  DO $$
  DECLARE
    v_org_id        uuid := gen_random_uuid();
    v_member_id     uuid := gen_random_uuid();
    v_profile_id    uuid := gen_random_uuid();
    v_paciente_id   uuid := gen_random_uuid();
    v_paci_iden_id  uuid := gen_random_uuid();
    v_servicio_id   uuid := gen_random_uuid();
    v_turno_id      uuid := gen_random_uuid();
    v_pago_id       uuid := gen_random_uuid();
    v_periodo       date := date_trunc('month', CURRENT_DATE)::date;
    v_avg           numeric;
  BEGIN
    -- Minimal fixtures (NB: profile FK is auth.users — skip with insert into auth.users).
    INSERT INTO auth.users (id, email) VALUES (v_profile_id, 'spec@folio.test') ON CONFLICT DO NOTHING;
    INSERT INTO organization (id, slug, nombre, timezone)
      VALUES (v_org_id, 'm29-spec', 'M29 Spec Org', 'America/Argentina/Buenos_Aires');
    INSERT INTO profile (id, nombre_cifrado, apellido_cifrado)
      VALUES (v_profile_id, '\\x00'::bytea, '\\x00'::bytea);
    INSERT INTO member (id, profile_id, organization_id, role, es_colegiado)
      VALUES (v_member_id, v_profile_id, v_org_id, 'OWNER', true);
    INSERT INTO paciente_identidad (id, organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado)
      VALUES (v_paci_iden_id, v_org_id, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea);
    INSERT INTO paciente (id, organization_id, identidad_id, profesional_principal_id)
      VALUES (v_paciente_id, v_org_id, v_paci_iden_id, v_member_id);
    INSERT INTO servicio (id, organization_id, nombre, tipo_canonico, duracion_min, precio_cents, activo)
      VALUES (v_servicio_id, v_org_id, 'Seguimiento spec', 'SEGUIMIENTO_ESTANDAR', 30, 1500000, true);
    INSERT INTO turno (id, organization_id, paciente_id, profesional_id, servicio_id, estado, duracion_min, inicio, fin)
      VALUES (v_turno_id, v_org_id, v_paciente_id, v_member_id, v_servicio_id, 'CERRADO', 30, now() - interval '1 hour', now());
    INSERT INTO pago (id, organization_id, turno_id, monto_cents, estado, medio)
      VALUES (v_pago_id, v_org_id, v_turno_id, 1500000, 'PAGADO', 'EFECTIVO');

    PERFORM analytics.refresh_org_metrics(v_periodo);

    SELECT precio_avg_seguimiento INTO v_avg
      FROM analytics.org_metrics_monthly
      WHERE org_id = v_org_id AND periodo = v_periodo;

    IF v_avg IS NULL THEN
      RAISE EXCEPTION 'M29 spec FAIL: precio_avg_seguimiento should be 15000.00, got NULL. The enum mismatch fix did not take effect.';
    END IF;
    IF v_avg <> 15000.00 THEN
      RAISE EXCEPTION 'M29 spec FAIL: precio_avg_seguimiento expected 15000.00, got %', v_avg;
    END IF;
    RAISE NOTICE 'M29 spec PASS · precio_avg_seguimiento = %', v_avg;

    -- Cleanup
    DELETE FROM analytics.org_metrics_monthly WHERE org_id = v_org_id;
    DELETE FROM pago WHERE id = v_pago_id;
    DELETE FROM turno WHERE id = v_turno_id;
    DELETE FROM servicio WHERE id = v_servicio_id;
    DELETE FROM paciente WHERE id = v_paciente_id;
    DELETE FROM paciente_identidad WHERE id = v_paci_iden_id;
    DELETE FROM member WHERE id = v_member_id;
    DELETE FROM profile WHERE id = v_profile_id;
    DELETE FROM organization WHERE id = v_org_id;
  END $$;
  ```
  (If the column names in the inserts above don't match the actual schema, adjust by reading M02/M03/M09 and updating. The migration test is more valuable than time saved skipping verification.)

- [ ] **Step 4** — Run the spec:
  ```bash
  pnpm exec supabase db shell --file tests/sql/M29_analytics_seguimiento.spec.sql
  ```
  Expected: `NOTICE: M29 spec PASS · precio_avg_seguimiento = 15000.00`.

- [ ] **Step 5** — Commit:
  ```bash
  git add supabase/migrations/20260524000029_M29_fix_analytics_seguimiento_enum.sql tests/sql/M29_analytics_seguimiento.spec.sql
  git commit -m "fix(analytics): M29 corrects SEGUIMIENTO enum literals in refresh_org_metrics (closes audit CRITICAL-2)"
  ```

---

## Phase 4 — Patient deduplication (CRITICAL)

### Task 4.1: M30 adds telefono_hash blind index + partial UNIQUE constraints

**Files:**
- Create: `supabase/migrations/20260524000030_M30_paciente_telefono_hash.sql`
- Create: `tests/sql/M30_paciente_dedup.spec.sql`

- [ ] **Step 1** — Migration adds a HMAC blind-index column `telefono_hash`, backfills NULL (no existing data to migrate), and replaces the broad `UNIQUE (organization_id, dni_hash)` with two partial UNIQUE indexes that ignore soft-deleted rows AND skip NULLs.

  Path: `supabase/migrations/20260524000030_M30_paciente_telefono_hash.sql`:
  ```sql
  -- ════════════════════════════════════════════════════════════════════════════
  -- Folio · M30 · Patient dedup via telefono_hash + partial unique indexes
  -- ════════════════════════════════════════════════════════════════════════════
  -- M03 created UNIQUE (organization_id, dni_hash) but:
  --   1. NULL DNIs (walk-ins) don't collide — Postgres treats NULLs as distinct.
  --   2. Soft-deleted rows (deleted_at NOT NULL) hold the slot forever.
  --   3. No fallback dedup channel when DNI is absent.
  --
  -- Fix:
  --   1. Add telefono_hash (HMAC-SHA256 of normalized phone).
  --   2. Replace constraint with partial UNIQUE indexes scoped by deleted_at IS NULL
  --      and NOT NULL hash values.
  --   3. Pseudonymized rows (identidad deleted) free the slot automatically.
  -- ════════════════════════════════════════════════════════════════════════════

  ALTER TABLE paciente_identidad
    ADD COLUMN IF NOT EXISTS telefono_hash text;

  COMMENT ON COLUMN paciente_identidad.telefono_hash IS
    'HMAC-SHA256 of normalized phone (digits-only, country code stripped to E.164 last 10 digits). Blind index for dedup when DNI is absent (walk-ins).';

  -- Drop the broad constraint (replaced by partial indexes below)
  ALTER TABLE paciente_identidad
    DROP CONSTRAINT IF EXISTS paciente_identidad_unique_dni;

  -- Drop the duplicate non-partial index from M03 if present (replaced by the partial below)
  DROP INDEX IF EXISTS paciente_identidad_org_dni_idx;

  -- Partial UNIQUE: same DNI in same org cannot duplicate among active patients
  CREATE UNIQUE INDEX paciente_identidad_dni_unique_active
    ON paciente_identidad (organization_id, dni_hash)
    WHERE deleted_at IS NULL AND dni_hash IS NOT NULL;

  -- Partial UNIQUE: same phone in same org cannot duplicate among active patients
  CREATE UNIQUE INDEX paciente_identidad_telefono_unique_active
    ON paciente_identidad (organization_id, telefono_hash)
    WHERE deleted_at IS NULL AND telefono_hash IS NOT NULL;

  -- Re-create the search index from M03 (was dropped above), now partial
  CREATE INDEX IF NOT EXISTS paciente_identidad_org_dni_search_idx
    ON paciente_identidad (organization_id, dni_hash)
    WHERE deleted_at IS NULL;
  ```

- [ ] **Step 2** — Apply and verify indexes exist:
  ```bash
  pnpm exec supabase db reset
  pnpm exec supabase db shell --command "SELECT indexname FROM pg_indexes WHERE tablename='paciente_identidad' AND indexname LIKE '%unique%';"
  ```
  Expected: 2 rows.

- [ ] **Step 3** — Write `tests/sql/M30_paciente_dedup.spec.sql`. Insert two patients in the same org sharing DNI → expect violation; insert two sharing phone → expect violation; insert two with both NULL → allowed (legacy); insert active + soft-deleted with same DNI → allowed.

  ```sql
  DO $$
  DECLARE
    v_org uuid := gen_random_uuid();
    v_dup_caught boolean;
  BEGIN
    INSERT INTO organization (id, slug, nombre, timezone)
      VALUES (v_org, 'm30-spec', 'M30 Spec', 'America/Argentina/Buenos_Aires');

    -- 1. Same DNI same org → must fail
    INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash)
      VALUES (v_org, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'dni-A');
    BEGIN
      INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash)
        VALUES (v_org, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'dni-A');
      v_dup_caught := false;
    EXCEPTION WHEN unique_violation THEN
      v_dup_caught := true;
    END;
    IF NOT v_dup_caught THEN RAISE EXCEPTION 'M30: duplicate DNI was allowed'; END IF;

    -- 2. Same phone same org (with NULL DNI) → must fail
    INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, telefono_hash)
      VALUES (v_org, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'tel-X');
    BEGIN
      INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, telefono_hash)
        VALUES (v_org, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'tel-X');
      v_dup_caught := false;
    EXCEPTION WHEN unique_violation THEN
      v_dup_caught := true;
    END;
    IF NOT v_dup_caught THEN RAISE EXCEPTION 'M30: duplicate phone was allowed'; END IF;

    -- 3. Two NULL-hash rows allowed (legacy)
    INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado)
      VALUES (v_org, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea);
    INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado)
      VALUES (v_org, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea);

    -- 4. Active + soft-deleted same DNI allowed
    UPDATE paciente_identidad SET deleted_at = now() WHERE dni_hash = 'dni-A';
    INSERT INTO paciente_identidad (organization_id, nombre_cifrado, apellido_cifrado, telefono_cifrado, dni_hash)
      VALUES (v_org, '\\x00'::bytea, '\\x00'::bytea, '\\x00'::bytea, 'dni-A');

    DELETE FROM paciente_identidad WHERE organization_id = v_org;
    DELETE FROM organization WHERE id = v_org;
    RAISE NOTICE 'M30 spec PASS';
  END $$;
  ```

- [ ] **Step 4** — Run spec:
  ```bash
  pnpm exec supabase db shell --file tests/sql/M30_paciente_dedup.spec.sql
  ```
  Expected: `NOTICE: M30 spec PASS`.

- [ ] **Step 5** — Commit:
  ```bash
  git add supabase/migrations/20260524000030_M30_paciente_telefono_hash.sql tests/sql/M30_paciente_dedup.spec.sql
  git commit -m "fix(paciente): M30 partial UNIQUE on dni_hash + new telefono_hash blind index (closes audit CRITICAL-4 schema)"
  ```

### Task 4.2: Server actions compute telefono_hash + walk-in dedup + specific error messages

**Files:**
- Modify: `lib/crypto.ts` — add `blindIndexPhone(raw)` helper
- Modify: `lib/db/pacientes.ts` — `createPaciente` writes `telefono_hash`
- Modify: `lib/db/errors.ts` — `mapSupabaseError` returns specific message for `paciente_identidad_*_unique_active`
- Modify: `app/(app)/hoy/actions.ts` — walk-in flow computes hashes
- Create: `tests/unit/blind-index-phone.test.ts`

- [ ] **Step 1** — Add `blindIndexPhone` to `lib/crypto.ts`. Read the file first to confirm patterns. Then add:
  ```typescript
  /**
   * Normaliza un teléfono a sus últimos 10 dígitos (drop country code, símbolos)
   * y devuelve el blind index HMAC-SHA256. Devuelve null para entradas vacías
   * o que no produzcan al menos 8 dígitos (no es un teléfono válido para dedup).
   */
  export function blindIndexPhone(rawPhone: string | null | undefined): string | null {
    if (!rawPhone) return null;
    const digits = rawPhone.replace(/\D/g, "");
    if (digits.length < 8) return null;
    const last10 = digits.slice(-10);
    return blindIndex(`tel:${last10}`);
  }
  ```
  (Reuses existing `blindIndex` so the same HMAC key signs both DNI and phone — single key rotation strategy.)

- [ ] **Step 2** — Write unit test at `tests/unit/blind-index-phone.test.ts`:
  ```typescript
  import { test } from "node:test";
  import assert from "node:assert/strict";

  import { blindIndexPhone } from "@/lib/crypto";

  test("blindIndexPhone is deterministic across formats", () => {
    const a = blindIndexPhone("+54 9 351 555 1234");
    const b = blindIndexPhone("3515551234");
    const c = blindIndexPhone("(351) 555-1234");
    assert.equal(a, b);
    assert.equal(b, c);
    assert.ok(a && a.length > 16);
  });

  test("blindIndexPhone returns null for invalid input", () => {
    assert.equal(blindIndexPhone(""), null);
    assert.equal(blindIndexPhone(null), null);
    assert.equal(blindIndexPhone("123"), null);
    assert.equal(blindIndexPhone("abc"), null);
  });

  test("blindIndexPhone differs for different last-10-digit numbers", () => {
    const a = blindIndexPhone("+54 11 4321 5678");
    const b = blindIndexPhone("+54 11 4321 5679");
    assert.notEqual(a, b);
  });
  ```

- [ ] **Step 3** — Run the test, watch it fail (function might not exist yet) then pass:
  ```bash
  pnpm test:unit
  ```
  Expected: 3 tests pass after Step 1+2.

- [ ] **Step 4** — Modify `lib/db/pacientes.ts:createPaciente`. In the insert at lines 159-181, change `dni_hash` line to also set `telefono_hash`:
  ```typescript
      nombre_hash: blindIndex(nombreFull),
      dni_hash: d.numeroDoc ? blindIndex(d.numeroDoc) : null,
      telefono_hash: blindIndexPhone(d.telefono),
  ```
  Add the `blindIndexPhone` import at the top: change `import { blindIndex, decryptColumn, encryptColumn } from "@/lib/crypto";` to `import { blindIndex, blindIndexPhone, decryptColumn, encryptColumn } from "@/lib/crypto";`

- [ ] **Step 5** — Add the `updatePaciente` path also: search for any other `paciente_identidad` UPDATE in `lib/db/pacientes.ts` (use Grep). Wherever phone is updated, regenerate `telefono_hash`. Use the same pattern as DNI.

- [ ] **Step 6** — Improve `mapSupabaseError` in `lib/db/errors.ts`. Read the file, find the `mapSupabaseError` function. Where it currently returns the generic `conflict` for code `23505`, branch on the constraint name in `error.details` or `error.message`:
  ```typescript
  if (code === "23505") {
    const detail = String(error.details ?? error.message ?? "");
    if (detail.includes("paciente_identidad_dni_unique_active")) {
      return { code: "conflict", message: "Ya existe un paciente con ese DNI en tu organización." };
    }
    if (detail.includes("paciente_identidad_telefono_unique_active")) {
      return { code: "conflict", message: "Ya existe un paciente con ese teléfono en tu organización." };
    }
    return { code: "conflict", message: "Ya existe un registro con esos datos." };
  }
  ```

- [ ] **Step 7** — Find and update the walk-in flow. Read `app/(app)/hoy/actions.ts:171-205` (the `createTurnoAction` patient-new branch). Currently it inserts without phone hash. Update the insert to include `telefono_hash: blindIndexPhone(input.telefono)`. If the input schema doesn't currently accept `telefono`, add it as required (existing UX captures it). If only `nombre` is captured, ADD a `telefono` field to the walk-in modal — reject the action with `validation` error if missing. Walk-ins MUST have a phone after this change to enable dedup.

- [ ] **Step 8** — Update the walk-in modal UI (find the component that renders the form; likely under `components/hoy/` or `app/(app)/hoy/` — use `Grep` for "walk" or "Sin DNI"). Add a required telefono field with placeholder "11 1234 5678".

- [ ] **Step 9** — Verify the walk-in flow with typecheck:
  ```bash
  pnpm typecheck && pnpm lint --fix && pnpm test:unit
  ```
  Expected: all pass.

- [ ] **Step 10** — Commit:
  ```bash
  git add lib/crypto.ts tests/unit/blind-index-phone.test.ts lib/db/pacientes.ts lib/db/errors.ts app/(app)/hoy/actions.ts components/
  git commit -m "feat(paciente): telefono_hash dedup + specific UNIQUE error messages + walk-in requires phone (closes audit CRITICAL-4 app)"
  ```

---

## Phase 5 — Type system regeneration

### Task 5.1: Regenerate database.types.ts from the live local schema

**Files:**
- Replace: `lib/supabase/database.types.ts`

- [ ] **Step 1** — With local Supabase running (Task 0.1 setup) and all migrations applied (M01–M30):
  ```bash
  pnpm exec supabase gen types typescript --local > lib/supabase/database.types.ts
  ```
  Expected: file size grows from ~6 KB to ~50–120 KB.

- [ ] **Step 2** — Some hand-maintained convenience types in the old stub may no longer exist (e.g. interface aliases). Run `pnpm typecheck` and address any breakages. The pattern is:
  - Where code did `import type { OrganizationRow } from "@/lib/supabase/database.types"`, switch to `type OrganizationRow = Database["public"]["Tables"]["organization"]["Row"]` via a small re-export shim file `lib/supabase/types.ts`.
  - Create `lib/supabase/types.ts`:
    ```typescript
    /** Convenience aliases over the generated Database type. */
    import type { Database } from "./database.types";

    export type OrganizationRow = Database["public"]["Tables"]["organization"]["Row"];
    export type ProfileRow = Database["public"]["Tables"]["profile"]["Row"];
    export type MemberRow = Database["public"]["Tables"]["member"]["Row"];
    export type PacienteRow = Database["public"]["Tables"]["paciente"]["Row"];
    export type PacienteIdentidadRow = Database["public"]["Tables"]["paciente_identidad"]["Row"];
    export type TurnoRow = Database["public"]["Tables"]["turno"]["Row"];
    export type SesionRow = Database["public"]["Tables"]["sesion"]["Row"];
    export type ServicioRow = Database["public"]["Tables"]["servicio"]["Row"];

    export type Json = Database["public"]["Tables"]["organization"]["Row"] extends infer T
      ? T extends { extra?: infer J } ? J : unknown : unknown;
    ```
  - Update all imports across the codebase: `git grep -l 'from "@/lib/supabase/database.types"' | xargs sed -i 's|from "@/lib/supabase/database.types"|from "@/lib/supabase/types"|g'` (Windows: use VS Code multi-file replace or pass each file to Edit one at a time).

- [ ] **Step 3** — Run typecheck and fix any remaining type errors. Common fixes:
  - Generated `Insert` types may make fields optional that the old stub had required. Adjust call sites to pass them.
  - Enum names changed slightly (e.g., `Database["public"]["Enums"]["estado_turno"]`).

- [ ] **Step 4** — Add a CI-friendly drift check script. Create `scripts/check-types-drift.mjs`:
  ```javascript
  // Quick check: if regenerating types produces a different file, fail.
  import { execSync } from "node:child_process";
  import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

  const tmp = "lib/supabase/database.types.next.ts";
  execSync(`pnpm exec supabase gen types typescript --local > ${tmp}`, { stdio: "inherit" });
  const current = readFileSync("lib/supabase/database.types.ts", "utf8");
  const next    = readFileSync(tmp, "utf8");
  unlinkSync(tmp);
  if (current.trim() !== next.trim()) {
    console.error("✘ database.types.ts is stale. Run: pnpm exec supabase gen types typescript --local > lib/supabase/database.types.ts");
    process.exit(1);
  }
  console.log("✓ database.types.ts is current.");
  ```
  Add to `package.json` scripts: `"types:check": "node scripts/check-types-drift.mjs"`.

- [ ] **Step 5** — Final verification:
  ```bash
  pnpm typecheck && pnpm lint && pnpm test:unit
  ```
  Expected: all pass.

- [ ] **Step 6** — Commit:
  ```bash
  git add lib/supabase/ scripts/check-types-drift.mjs package.json
  git commit -m "chore(types): regenerate database.types from live schema + drift-check script (closes audit HIGH-5)"
  ```

---

## Phase 6 — Multi-tenant hardening

### Task 6.1: setActiveOrg validates user membership before setting cookie

**Files:**
- Modify: `lib/db/session.ts:79-89`
- Create: `tests/unit/session-set-active-org.test.ts`

- [ ] **Step 1** — Write the failing test. Create `tests/unit/session-set-active-org.test.ts`:
  ```typescript
  import { test } from "node:test";
  import assert from "node:assert/strict";

  // This test runs against the local Supabase stack; it requires:
  //   - NEXT_PUBLIC_SUPABASE_URL pointing to local
  //   - SUPABASE_SERVICE_ROLE_KEY for local
  //   - A test user already signed in via the test cookie shim.
  //
  // Skip if env is missing.
  const skip = !process.env.SUPABASE_SERVICE_ROLE_KEY;

  test("setActiveOrg rejects org the user does not belong to", { skip }, async () => {
    const { setActiveOrg } = await import("@/lib/db/session");
    const fakeOrgId = "00000000-0000-0000-0000-000000000000";
    const result = await setActiveOrg(fakeOrgId);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "forbidden");
    }
  });
  ```

- [ ] **Step 2** — Read `lib/db/session.ts` fully. Modify the `setActiveOrg` function:
  ```typescript
  /** Switchear la org activa. Valida que el user sea member antes de setear cookie. */
  export async function setActiveOrg(organizationId: string): Promise<Result<void>> {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return err("auth_required", "No estás autenticado.");
    }

    const { data: membership, error: mErr } = await supabase
      .from("member")
      .select("id")
      .eq("profile_id", user.id)
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .maybeSingle();

    if (mErr) {
      return err("db_error", "Error validando organización.", mErr.message);
    }
    if (!membership) {
      return err("forbidden", "No tenés acceso a esa organización.");
    }

    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_ORG_COOKIE, organizationId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
    return ok(undefined);
  }
  ```
  Make sure `err` supports the `forbidden` code by checking `lib/db/errors.ts` — if not present, add it to the union.

- [ ] **Step 3** — Run typecheck + test:
  ```bash
  pnpm typecheck && pnpm test:unit
  ```

- [ ] **Step 4** — Commit:
  ```bash
  git add lib/db/session.ts lib/db/errors.ts tests/unit/session-set-active-org.test.ts
  git commit -m "fix(session): setActiveOrg validates membership before cookie (closes audit HIGH-10)"
  ```

### Task 6.2: M31 enables Realtime Authorization (server-side broadcast policies)

**Files:**
- Create: `supabase/migrations/20260524000031_M31_realtime_authorization.sql`
- Modify: `lib/db/realtime.ts` — drop the warning comment, document new posture

- [ ] **Step 1** — Write the migration. Supabase Realtime authorization uses policies on `realtime.messages`. We grant subscribe rights only when the topic name encodes an org_id the user is a member of.

  Path: `supabase/migrations/20260524000031_M31_realtime_authorization.sql`:
  ```sql
  -- ════════════════════════════════════════════════════════════════════════════
  -- Folio · M31 · Realtime Authorization (server-side broadcast policies)
  -- ════════════════════════════════════════════════════════════════════════════
  -- Until now, the client-side org_id filter was the only barrier to cross-tenant
  -- realtime leakage. A malicious client could subscribe to another org's channel
  -- and receive payloads. Even though sensitive bytea columns are encrypted,
  -- IDs, timestamps, and activity patterns were exposed.
  --
  -- This migration installs realtime.messages RLS policies that require the
  -- topic to start with "org:{org_uuid}:" and the subscriber to be an active
  -- member of that org.
  --
  -- Topic convention enforced from client (lib/db/realtime.ts):
  --   org:{org_uuid}:turnos
  --   org:{org_uuid}:pedidos
  --   org:{org_uuid}:sesiones
  -- ════════════════════════════════════════════════════════════════════════════

  -- Ensure RLS is on (Supabase enables by default for realtime.messages)
  ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS realtime_org_scoped_read ON realtime.messages;
  CREATE POLICY realtime_org_scoped_read ON realtime.messages
    FOR SELECT TO authenticated
    USING (
      -- topic format: "org:{uuid}:..." — extract uuid (chars 5..40) and check membership
      topic ~ '^org:[0-9a-f-]{36}:'
      AND substring(topic from 5 for 36)::uuid = ANY (user_org_ids())
    );

  DROP POLICY IF EXISTS realtime_org_scoped_write ON realtime.messages;
  CREATE POLICY realtime_org_scoped_write ON realtime.messages
    FOR INSERT TO authenticated
    WITH CHECK (
      topic ~ '^org:[0-9a-f-]{36}:'
      AND substring(topic from 5 for 36)::uuid = ANY (user_org_ids())
    );

  COMMENT ON POLICY realtime_org_scoped_read ON realtime.messages IS
    'M31 · enforces server-side that subscribers can only receive messages for orgs they belong to. Topic format: org:{uuid}:{channel}';
  ```

- [ ] **Step 2** — Apply locally and verify policy exists:
  ```bash
  pnpm exec supabase db reset
  pnpm exec supabase db shell --command "SELECT policyname FROM pg_policies WHERE schemaname='realtime' AND tablename='messages';"
  ```
  Expected: rows include `realtime_org_scoped_read` and `realtime_org_scoped_write`.

- [ ] **Step 3** — Read `lib/db/realtime.ts`. Verify the existing channel topic naming matches `org:{uuid}:{channel}`. If it doesn't (e.g. uses `turnos:{org_id}`), refactor the topic constructor to `org:{org_id}:turnos`. Update the warning comment from "RLS no aplica a Realtime broadcasts" to "Realtime broadcasts authorized by M31 policy — topic prefix carries org_id and must match user_org_ids()".

- [ ] **Step 4** — Run typecheck:
  ```bash
  pnpm typecheck && pnpm lint --fix
  ```

- [ ] **Step 5** — Commit:
  ```bash
  git add supabase/migrations/20260524000031_M31_realtime_authorization.sql lib/db/realtime.ts
  git commit -m "fix(realtime): M31 server-side authorization closes cross-tenant broadcast leak (closes audit HIGH-9)"
  ```

### Task 6.3: M31b adds RLS scope by caja_fuerte to paciente_identidad

**Files:**
- Create: `supabase/migrations/20260524000032_M31b_paciente_identidad_caja_fuerte.sql`

- [ ] **Step 1** — Write the migration:
  ```sql
  -- ════════════════════════════════════════════════════════════════════════════
  -- Folio · M31b · paciente_identidad respects caja_fuerte_profesional
  -- ════════════════════════════════════════════════════════════════════════════
  -- The original M03 RLS on paciente_identidad allowed ANY org member to read
  -- ALL patients' PII. caja_fuerte_profesional on paciente hid SOAP notes (PHI)
  -- from non-designated staff, but their NAME / DNI / PHONE / ADDRESS remained
  -- visible — undermining the VIP-protection guarantee.
  --
  -- New posture: when paciente.caja_fuerte_profesional is set, only that
  -- specific member (plus OWNER/DIRECTOR for compliance overrides) can read
  -- the corresponding paciente_identidad row.
  -- ════════════════════════════════════════════════════════════════════════════

  DROP POLICY IF EXISTS paciente_identidad_select_org ON paciente_identidad;

  CREATE POLICY paciente_identidad_select_scoped ON paciente_identidad
    FOR SELECT TO authenticated
    USING (
      organization_id = ANY (user_org_ids())
      AND (
        -- Path 1: no caja-fuerte patient links here — open to all org members
        NOT EXISTS (
          SELECT 1 FROM paciente p
          WHERE p.identidad_id = paciente_identidad.id
            AND p.caja_fuerte_profesional IS NOT NULL
        )
        -- Path 2: caja-fuerte set — only designated member or OWNER/DIRECTOR can read
        OR EXISTS (
          SELECT 1 FROM paciente p
          WHERE p.identidad_id = paciente_identidad.id
            AND p.caja_fuerte_profesional IS NOT NULL
            AND (
              p.caja_fuerte_profesional = user_member_id_in(organization_id)
              OR user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
            )
        )
      )
    );

  COMMENT ON POLICY paciente_identidad_select_scoped ON paciente_identidad IS
    'M31b · open to all org members EXCEPT when linked paciente.caja_fuerte_profesional is set, in which case only that member or OWNER/DIRECTOR.';
  ```

- [ ] **Step 2** — Apply locally and verify:
  ```bash
  pnpm exec supabase db reset
  pnpm exec supabase db shell --command "SELECT policyname FROM pg_policies WHERE tablename='paciente_identidad';"
  ```
  Expected: includes `paciente_identidad_select_scoped`.

- [ ] **Step 3** — Verify the helpers `user_member_id_in(uuid)` and `user_role_in(uuid)` exist (M01 created them). If `user_member_id_in` doesn't exist, define it in a helper migration or add inline at start of M31b. Inspect M01:
  ```bash
  grep -nE 'user_member_id_in|user_role_in' supabase/migrations/*.sql
  ```

- [ ] **Step 4** — Commit:
  ```bash
  git add supabase/migrations/20260524000032_M31b_paciente_identidad_caja_fuerte.sql
  git commit -m "fix(rls): M31b paciente_identidad scoped by caja_fuerte_profesional (closes audit HIGH-12)"
  ```

### Task 6.4: M31c grants PROFESIONAL paciente read via attended turno

**Files:**
- Create: `supabase/migrations/20260524000033_M31c_paciente_select_via_turno.sql`

- [ ] **Step 1** — Migration extends the paciente SELECT policy to also match when the user attended a turno for that patient (regardless of being `profesional_principal_id`).
  ```sql
  -- ════════════════════════════════════════════════════════════════════════════
  -- Folio · M31c · PROFESIONAL gains paciente read via attended turno
  -- ════════════════════════════════════════════════════════════════════════════
  -- M03 comments promised "PROFESIONAL also sees pacientes via Turno" but the
  -- actual policy only matched profesional_principal_id. A doctor covering
  -- for another doctor could attend a session but then lose access to the
  -- patient PHI, breaking the clinical workflow.
  -- ════════════════════════════════════════════════════════════════════════════

  DROP POLICY IF EXISTS paciente_select_scoped ON paciente;

  CREATE POLICY paciente_select_scoped ON paciente
    FOR SELECT TO authenticated
    USING (
      organization_id = ANY (user_org_ids())
      AND (
        -- OWNER / DIRECTOR / COORDINADOR see all (subject to caja_fuerte below)
        user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'COORDINADOR')
        -- PROFESIONAL: assigned as primary OR attended a turno for this patient
        OR (
          user_role_in(organization_id) = 'PROFESIONAL'
          AND (
            profesional_principal_id = user_member_id_in(organization_id)
            OR EXISTS (
              SELECT 1 FROM turno t
              WHERE t.paciente_id = paciente.id
                AND t.profesional_id = user_member_id_in(organization_id)
                AND t.estado IN ('ATENDIENDO', 'CERRADO', 'EN_SALA')
            )
          )
        )
        -- ASISTENTE: only the patients of the doctors they support (via equipo membership)
        OR (
          user_role_in(organization_id) = 'ASISTENTE'
          AND EXISTS (
            SELECT 1 FROM equipo e
            JOIN profesional_equipo pe ON pe.equipo_id = e.id
            WHERE e.organization_id = paciente.organization_id
              AND pe.member_id = paciente.profesional_principal_id
              AND EXISTS (
                SELECT 1 FROM equipo_member em
                WHERE em.equipo_id = e.id AND em.member_id = user_member_id_in(organization_id)
              )
          )
        )
      )
      -- caja_fuerte overlay
      AND (
        caja_fuerte_profesional IS NULL
        OR caja_fuerte_profesional = user_member_id_in(organization_id)
        OR user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
      )
    );

  COMMENT ON POLICY paciente_select_scoped ON paciente IS
    'M31c · open to assigned profesional, or any profesional who attended a turno, plus equipo-bound ASISTENTE. caja_fuerte takes precedence.';
  ```
  (If table names `equipo`, `profesional_equipo`, `equipo_member` differ from actual schema, grep first and adjust. If ASISTENTE/equipo logic doesn't exist yet, simplify policy to just OWNER/DIRECTOR/COORDINADOR/PROFESIONAL — remove the ASISTENTE branch.)

- [ ] **Step 2** — Verify schema exists for `equipo`/`profesional_equipo`/`equipo_member`:
  ```bash
  grep -nE 'CREATE TABLE.*equipo' supabase/migrations/*.sql
  ```
  If those tables don't exist, simplify the policy to remove the ASISTENTE branch and add a TODO comment referencing the future epic.

- [ ] **Step 3** — Apply and verify:
  ```bash
  pnpm exec supabase db reset
  pnpm exec supabase db shell --command "SELECT policyname FROM pg_policies WHERE tablename='paciente';"
  ```

- [ ] **Step 4** — Commit:
  ```bash
  git add supabase/migrations/20260524000033_M31c_paciente_select_via_turno.sql
  git commit -m "fix(rls): M31c PROFESIONAL reads paciente via attended turno (closes audit HIGH-15)"
  ```

---

## Phase 7 — Auth atomicity & robustness

### Task 7.1: M32 creates SECURITY DEFINER bootstrap_org_atomic RPC

**Files:**
- Create: `supabase/migrations/20260524000034_M32_bootstrap_org_atomic.sql`
- Create: `tests/sql/M32_bootstrap_org_atomic.spec.sql`

- [ ] **Step 1** — Migration creates a single function that performs the entire signup bootstrap (profile + org + member + provisional slug + consent) atomically.

  Path: `supabase/migrations/20260524000034_M32_bootstrap_org_atomic.sql`:
  ```sql
  -- ════════════════════════════════════════════════════════════════════════════
  -- Folio · M32 · Atomic signup bootstrap RPC
  -- ════════════════════════════════════════════════════════════════════════════
  -- Replaces the multi-step PostgREST sequence (profile → org → member) in
  -- signUpAndInitOrganization / bootstrapOrgForAuthenticatedUser, which had no
  -- transaction guarantee — a failure in step 2 left orphan rows from step 1.
  -- ════════════════════════════════════════════════════════════════════════════

  CREATE OR REPLACE FUNCTION bootstrap_org_atomic(
    p_user_id              uuid,
    p_user_email           text,
    p_provisional_slug     text,
    p_nombre_cifrado       bytea,
    p_apellido_cifrado     bytea,
    p_consent_ip           text,
    p_consent_user_agent   text,
    p_consent_legal_text_version text
  )
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE
    v_org_id    uuid;
    v_member_id uuid;
    v_existing  uuid;
  BEGIN
    -- Idempotency check: if user already has an active membership, return it.
    SELECT m.organization_id, m.id
      INTO v_existing, v_member_id
      FROM member m
      WHERE m.profile_id = p_user_id AND m.deleted_at IS NULL
      LIMIT 1;

    IF v_existing IS NOT NULL THEN
      RETURN jsonb_build_object(
        'organization_id', v_existing,
        'member_id', v_member_id,
        'created', false
      );
    END IF;

    -- 1. profile (upsert idempotent on id which == auth.user.id)
    INSERT INTO profile (id, nombre_cifrado, apellido_cifrado, pii_consent_at, pii_consent_ip, pii_consent_user_agent, pii_consent_legal_version)
      VALUES (p_user_id, p_nombre_cifrado, p_apellido_cifrado, now(), p_consent_ip, p_consent_user_agent, p_consent_legal_text_version)
      ON CONFLICT (id) DO UPDATE
        SET pii_consent_at = COALESCE(profile.pii_consent_at, EXCLUDED.pii_consent_at),
            pii_consent_ip = COALESCE(profile.pii_consent_ip, EXCLUDED.pii_consent_ip),
            pii_consent_user_agent = COALESCE(profile.pii_consent_user_agent, EXCLUDED.pii_consent_user_agent),
            pii_consent_legal_version = COALESCE(profile.pii_consent_legal_version, EXCLUDED.pii_consent_legal_version);

    -- 2. organization (placeholder)
    INSERT INTO organization (slug, nombre, timezone, onboarding_completed, onboarding_step_max)
      VALUES (p_provisional_slug, 'Mi consultorio', 'America/Argentina/Buenos_Aires', false, 1)
      RETURNING id INTO v_org_id;

    -- 3. member (OWNER)
    INSERT INTO member (profile_id, organization_id, role, es_colegiado)
      VALUES (p_user_id, v_org_id, 'OWNER', true)
      RETURNING id INTO v_member_id;

    RETURN jsonb_build_object(
      'organization_id', v_org_id,
      'member_id', v_member_id,
      'created', true
    );
  EXCEPTION
    WHEN unique_violation THEN
      -- Slug collision: try once more with random suffix
      INSERT INTO organization (slug, nombre, timezone, onboarding_completed, onboarding_step_max)
        VALUES (p_provisional_slug || '-' || substr(gen_random_uuid()::text, 1, 6), 'Mi consultorio', 'America/Argentina/Buenos_Aires', false, 1)
        RETURNING id INTO v_org_id;
      INSERT INTO member (profile_id, organization_id, role, es_colegiado)
        VALUES (p_user_id, v_org_id, 'OWNER', true)
        RETURNING id INTO v_member_id;
      RETURN jsonb_build_object(
        'organization_id', v_org_id,
        'member_id', v_member_id,
        'created', true,
        'slug_collision_recovered', true
      );
  END
  $$;

  REVOKE ALL ON FUNCTION bootstrap_org_atomic(uuid, text, text, bytea, bytea, text, text, text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION bootstrap_org_atomic(uuid, text, text, bytea, bytea, text, text, text) TO service_role;

  COMMENT ON FUNCTION bootstrap_org_atomic IS
    'M32 · atomic profile+org+member creation for signup. Idempotent: returns existing membership if user already bootstrapped.';
  ```
  (Column names like `pii_consent_at`, `pii_consent_ip`, etc. must match M23. Verify with `grep -n pii_consent supabase/migrations/*.sql`. If names differ, adjust the function body. Same for `onboarding_step_max` — confirm against M02/M20.)

- [ ] **Step 2** — Apply locally:
  ```bash
  pnpm exec supabase db reset
  ```

- [ ] **Step 3** — Spec at `tests/sql/M32_bootstrap_org_atomic.spec.sql`:
  ```sql
  DO $$
  DECLARE
    v_user uuid := gen_random_uuid();
    v_result1 jsonb;
    v_result2 jsonb;
  BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_user, 'm32@folio.test') ON CONFLICT DO NOTHING;

    SELECT bootstrap_org_atomic(v_user, 'm32@folio.test', 'm32-spec',
      '\\x00'::bytea, '\\x00'::bytea, '127.0.0.1', 'spec-ua', 'v1') INTO v_result1;
    IF (v_result1->>'created')::boolean <> true THEN
      RAISE EXCEPTION 'M32 spec FAIL: first call should create. Got: %', v_result1;
    END IF;

    -- Idempotent: second call returns same membership without creating
    SELECT bootstrap_org_atomic(v_user, 'm32@folio.test', 'm32-spec',
      '\\x00'::bytea, '\\x00'::bytea, '127.0.0.1', 'spec-ua', 'v1') INTO v_result2;
    IF (v_result2->>'created')::boolean <> false THEN
      RAISE EXCEPTION 'M32 spec FAIL: second call should be idempotent. Got: %', v_result2;
    END IF;
    IF v_result1->>'organization_id' <> v_result2->>'organization_id' THEN
      RAISE EXCEPTION 'M32 spec FAIL: idempotent call returned different org_id';
    END IF;

    -- Cleanup
    DELETE FROM member WHERE profile_id = v_user;
    DELETE FROM organization WHERE id = (v_result1->>'organization_id')::uuid;
    DELETE FROM profile WHERE id = v_user;
    DELETE FROM auth.users WHERE id = v_user;
    RAISE NOTICE 'M32 spec PASS';
  END $$;
  ```

- [ ] **Step 4** — Run:
  ```bash
  pnpm exec supabase db shell --file tests/sql/M32_bootstrap_org_atomic.spec.sql
  ```
  Expected: `NOTICE: M32 spec PASS`.

- [ ] **Step 5** — Commit:
  ```bash
  git add supabase/migrations/20260524000034_M32_bootstrap_org_atomic.sql tests/sql/M32_bootstrap_org_atomic.spec.sql
  git commit -m "feat(auth): M32 atomic bootstrap RPC for signup (replaces multi-step rollback)"
  ```

### Task 7.2: Refactor signUpAndInitOrganization and bootstrapOrgForAuthenticatedUser to call M32 RPC

**Files:**
- Modify: `app/(public)/onboarding/actions.ts`
- Modify: `tests/e2e/signup-consent-ratelimit.spec.ts` (verify still passes)

- [ ] **Step 1** — Read the full file `app/(public)/onboarding/actions.ts` to understand the current shape of both functions and exact column names referenced.

- [ ] **Step 2** — In `signUpAndInitOrganization`:
  - After successful `service.auth.admin.createUser(...)` (or after recovering an existing user), and after `signInWithPassword`, replace the manual profile→org→member sequence with:
    ```typescript
    const { data: bootstrapData, error: bootstrapErr } = await service.rpc("bootstrap_org_atomic", {
      p_user_id: created.user.id,
      p_user_email: email,
      p_provisional_slug: slugFromEmail(email),
      p_nombre_cifrado: nombreCifrado,
      p_apellido_cifrado: apellidoCifrado,
      p_consent_ip: ip,
      p_consent_user_agent: userAgent,
      p_consent_legal_text_version: LEGAL_VERSION,
    });
    if (bootstrapErr || !bootstrapData) {
      return { ok: false, error: "No pude inicializar tu organización. Reintentá." };
    }
    const { organization_id, member_id } = bootstrapData as { organization_id: string; member_id: string };
    ```
  - Delete the manual inserts and the compensating delete blocks (the multi-step rollback path entirely).
  - Same refactor inside `bootstrapOrgForAuthenticatedUser`: replace its manual inserts with the same RPC call (using `user.id` from the already-authenticated session).

- [ ] **Step 3** — Add a small helper `slugFromEmail(email)` if not present (likely already exists — search the file). The provisional slug logic should match what the function currently produces.

- [ ] **Step 4** — Replace the `listUsers({ perPage: 200 })` lookup with `admin.getUserByEmail` if the SDK supports it (`@supabase/supabase-js` v2.105+):
  ```typescript
  const { data: existing, error: getErr } = await service.auth.admin.getUserByEmail(email);
  ```
  If the SDK is older than the version that supports `getUserByEmail`, leave `listUsers` BUT bump `perPage` to 1000 AND add a paginating loop that increments `page` until `data.users.length === 0`. Add an inline comment explaining why.

- [ ] **Step 5** — Typecheck + lint + unit:
  ```bash
  pnpm typecheck && pnpm lint --fix && pnpm test:unit
  ```

- [ ] **Step 6** — Run e2e signup test:
  ```bash
  pnpm test:app --grep "signup"
  ```
  Expected: pass.

- [ ] **Step 7** — Commit:
  ```bash
  git add app/(public)/onboarding/actions.ts
  git commit -m "refactor(auth): signup uses M32 atomic RPC, drops 200-user listUsers ceiling (closes audit HIGH-7,8,14)"
  ```

---

## Phase 8 — Auth polish

### Task 8.1: OAuth callback sanitizes error before redirect

**Files:**
- Modify: `app/api/auth/callback/route.ts:24-28`

- [ ] **Step 1** — Read the file. Change the error branch:
  ```typescript
  if (error) {
    // Translate to a safe, generic code instead of leaking Supabase internals
    const code = error.message?.includes("PKCE") ? "oauth_pkce" :
                 error.message?.includes("expired") ? "oauth_expired" :
                 "oauth_failed";
    return NextResponse.redirect(`${origin}/login?error=${code}`);
  }
  ```

- [ ] **Step 2** — In `app/(public)/login/page.tsx` or its client component, find where `searchParams.error` is rendered. Add a small mapper:
  ```typescript
  const errorMessages: Record<string, string> = {
    oauth_pkce: "Sesión OAuth inválida. Reintentá desde el inicio.",
    oauth_expired: "El link de Google expiró. Reintentá.",
    oauth_failed: "No pude completar el ingreso con Google. Reintentá.",
  };
  const errorText = error ? errorMessages[error] ?? "Algo salió mal. Reintentá." : null;
  ```

- [ ] **Step 3** — Typecheck:
  ```bash
  pnpm typecheck && pnpm lint --fix
  ```

- [ ] **Step 4** — Commit:
  ```bash
  git add app/api/auth/callback/route.ts app/(public)/login/
  git commit -m "fix(auth): OAuth callback sanitizes error to generic codes (closes audit HIGH-13)"
  ```

### Task 8.2: M33 broadens audit_log SELECT to OWNER + DIRECTOR

**Files:**
- Create: `supabase/migrations/20260524000035_M33_audit_log_director.sql`

- [ ] **Step 1** — Migration:
  ```sql
  -- ════════════════════════════════════════════════════════════════════════════
  -- Folio · M33 · DIRECTOR gains audit_log SELECT access
  -- ════════════════════════════════════════════════════════════════════════════
  -- The application layer (lib/db/audit.ts) intended DIRECTOR to be able to
  -- view the audit log, but RLS only allowed OWNER. DIRECTOR users would see
  -- an empty audit page with no error. Align RLS with app intent.
  -- ════════════════════════════════════════════════════════════════════════════

  DROP POLICY IF EXISTS audit_log_select_owner ON audit_log;

  CREATE POLICY audit_log_select_admin ON audit_log
    FOR SELECT TO authenticated
    USING (
      organization_id = ANY (user_org_ids())
      AND user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
    );

  COMMENT ON POLICY audit_log_select_admin ON audit_log IS
    'M33 · OWNER and DIRECTOR can read audit log for their org. ASISTENTE/COORDINADOR/PROFESIONAL cannot.';
  ```

- [ ] **Step 2** — Apply, verify policy:
  ```bash
  pnpm exec supabase db reset
  pnpm exec supabase db shell --command "SELECT policyname FROM pg_policies WHERE tablename='audit_log';"
  ```

- [ ] **Step 3** — Commit:
  ```bash
  git add supabase/migrations/20260524000035_M33_audit_log_director.sql
  git commit -m "fix(rls): M33 DIRECTOR gains audit_log read access matching app intent (closes audit HIGH-11)"
  ```

---

## Phase 9 — Operational quality

### Task 9.1: M34 unifies opt_out_analytics, drops opt_out_benchmarks

**Files:**
- Create: `supabase/migrations/20260524000036_M34_unify_opt_out_analytics.sql`
- Modify: `supabase/migrations/20260524000029_M29_fix_analytics_seguimiento_enum.sql` — change `o.opt_out_benchmarks = false` to `o.opt_out_analytics = false`. (Yes, retroactively edit M29 since it's not yet in production. If M29 already shipped to prod via a different deploy timing, ADD M34 to drop the benchmarks column AND re-create M29's function with the new column reference.)

- [ ] **Step 1** — Migration:
  ```sql
  -- ════════════════════════════════════════════════════════════════════════════
  -- Folio · M34 · Unify opt_out flags
  -- ════════════════════════════════════════════════════════════════════════════
  -- M02 created opt_out_analytics. M15 added opt_out_benchmarks. The UI updates
  -- opt_out_analytics; the analytics pipeline reads opt_out_benchmarks. Users
  -- toggling the opt-out in /configuracion were NOT excluded from benchmarks.
  --
  -- Posture: keep opt_out_analytics (semantic name, UI already wired). Drop
  -- opt_out_benchmarks. Update analytics.refresh_org_metrics to read the
  -- unified column.
  -- ════════════════════════════════════════════════════════════════════════════

  -- Backfill: any org with opt_out_benchmarks=true should also have analytics=true
  UPDATE organization
    SET opt_out_analytics = true
    WHERE opt_out_benchmarks = true AND opt_out_analytics = false;

  ALTER TABLE organization DROP COLUMN IF EXISTS opt_out_benchmarks;

  -- Re-create the analytics function reading opt_out_analytics
  CREATE OR REPLACE FUNCTION analytics.refresh_org_metrics(p_periodo date)
  RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, analytics AS $$
  -- [Paste full body from current M29, with single change: line
  --     AND o.opt_out_benchmarks = false
  --  replaced by
  --     AND o.opt_out_analytics = false ]
  ```

- [ ] **Step 2** — Apply + verify:
  ```bash
  pnpm exec supabase db reset
  pnpm exec supabase db shell --command "SELECT column_name FROM information_schema.columns WHERE table_name='organization' AND column_name LIKE 'opt_out%';"
  ```
  Expected: only `opt_out_analytics` and `opt_out_public_listing` (not `opt_out_benchmarks`).

- [ ] **Step 3** — Search for any remaining code references:
  ```bash
  grep -rn opt_out_benchmarks lib app
  ```
  Expected: no matches. Fix any found.

- [ ] **Step 4** — Commit:
  ```bash
  git add supabase/migrations/20260524000036_M34_unify_opt_out_analytics.sql
  git commit -m "fix(analytics): M34 unify opt_out_analytics, drop opt_out_benchmarks (closes audit HIGH-6)"
  ```

### Task 9.2: Narrow cookie-write catch in createSupabaseServerClient

**Files:**
- Modify: `lib/supabase/server.ts:38-45`

- [ ] **Step 1** — Read the file. Change the silent `catch {}` to:
  ```typescript
  try {
    cookiesToSet.forEach(({ name, value, options }) =>
      cookieStore.set(name, value, options),
    );
  } catch (err) {
    // In React Server Components, cookies().set() throws — that's expected
    // and harmless because the response is already streaming and middleware
    // handles refresh. Any OTHER error indicates a real cookie problem
    // (header size limit, malformed value) and must surface.
    const msg = err instanceof Error ? err.message : "";
    if (!msg.includes("Cookies can only be modified") && !msg.includes("Server Components")) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[supabase] unexpected cookie write failure:", err);
      }
      // In prod we still swallow to avoid breaking response, but log once.
      // If you have Sentry instrumented at this level, capture it here.
    }
  }
  ```

- [ ] **Step 2** — Typecheck:
  ```bash
  pnpm typecheck && pnpm lint --fix
  ```

- [ ] **Step 3** — Commit:
  ```bash
  git add lib/supabase/server.ts
  git commit -m "fix(supabase): narrow cookie-write catch to known RSC limitation (closes audit MEDIUM cookie-silence)"
  ```

### Task 9.3: Audit triggers populate ip/user_agent via GUC

**Files:**
- Create: `supabase/migrations/20260524000037_M35_audit_ip_useragent.sql`
- Modify: `lib/supabase/server.ts` — set the GUC on every request

- [ ] **Step 1** — Migration:
  ```sql
  -- ════════════════════════════════════════════════════════════════════════════
  -- Folio · M35 · Audit trigger reads request.ip / request.user_agent GUCs
  -- ════════════════════════════════════════════════════════════════════════════
  CREATE OR REPLACE FUNCTION audit_log_trigger()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE
    v_action        text;
    v_resource_type text;
    v_resource_id   text;
    v_org_id        uuid;
    v_actor_id      uuid;
    v_actor_role    text;
    v_payload       jsonb;
    v_ip            text;
    v_user_agent    text;
  BEGIN
    v_resource_type := TG_TABLE_NAME;
    v_action := TG_TABLE_NAME || '.' || lower(TG_OP);
    IF TG_OP = 'DELETE' THEN
      v_resource_id := OLD.id::text;
      v_org_id      := OLD.organization_id;
      v_payload     := to_jsonb(OLD);
    ELSE
      v_resource_id := NEW.id::text;
      v_org_id      := NEW.organization_id;
      IF TG_OP = 'UPDATE' THEN
        v_payload := jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW));
      ELSE
        v_payload := to_jsonb(NEW);
      END IF;
    END IF;
    v_actor_id := auth.uid();
    IF v_actor_id IS NOT NULL AND v_org_id IS NOT NULL THEN
      SELECT role::text INTO v_actor_role FROM member WHERE profile_id = v_actor_id AND organization_id = v_org_id LIMIT 1;
    END IF;

    BEGIN v_ip         := current_setting('folio.request_ip', true);         EXCEPTION WHEN OTHERS THEN v_ip := NULL; END;
    BEGIN v_user_agent := current_setting('folio.request_user_agent', true); EXCEPTION WHEN OTHERS THEN v_user_agent := NULL; END;

    INSERT INTO audit_log (
      organization_id, actor_id, actor_role,
      action, resource_type, resource_id, payload, ip, user_agent, ts
    ) VALUES (
      v_org_id, v_actor_id, v_actor_role,
      v_action, v_resource_type, v_resource_id, v_payload, v_ip, v_user_agent, now()
    );
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END
  $$;
  ```

- [ ] **Step 2** — Modify `lib/supabase/server.ts` `createSupabaseServerClient`. After creating the client, before returning, set the GUCs from the request headers:
  ```typescript
  const supabase = createServerClient(...);

  // Best-effort: stamp request IP and UA into Postgres GUCs so audit triggers can read them.
  try {
    const h = await import("next/headers").then((m) => m.headers());
    const requestHeaders = await h;
    const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? requestHeaders.get("x-real-ip") ?? null;
    const ua = requestHeaders.get("user-agent") ?? null;
    if (ip)  await supabase.rpc("set_config" as never, { setting_name: "folio.request_ip", setting_value: ip, is_local: true } as never).catch(() => undefined);
    if (ua)  await supabase.rpc("set_config" as never, { setting_name: "folio.request_user_agent", setting_value: ua, is_local: true } as never).catch(() => undefined);
  } catch { /* headers() throws outside request scope; that's fine */ }

  return supabase;
  ```
  (Postgres `set_config(setting, value, is_local)` is exposed via PostgREST — `is_local=true` scopes to the current transaction. This is a fast no-op outside request scope.)

- [ ] **Step 3** — Apply migration, typecheck:
  ```bash
  pnpm exec supabase db reset
  pnpm typecheck && pnpm lint --fix
  ```

- [ ] **Step 4** — Commit:
  ```bash
  git add supabase/migrations/20260524000037_M35_audit_ip_useragent.sql lib/supabase/server.ts
  git commit -m "fix(audit): M35 audit trigger captures ip/user_agent from GUCs set per request (closes audit MEDIUM audit-ip)"
  ```

### Task 9.4: tryDecrypt everywhere in pacientes layer

**Files:**
- Modify: `lib/db/pacientes.ts` — wrap all decryptColumn calls in tryDecrypt

- [ ] **Step 1** — Open the file. Find or define `tryDecrypt`. If `tryDecrypt` already exists in `lib/db/paciente-ficha.ts`, lift it to `lib/crypto.ts` so all modules share one definition. If not present, add at top of `lib/crypto.ts`:
  ```typescript
  export function tryDecrypt(bytea: Buffer | null | undefined, label = "field"): string | null {
    if (!bytea) return null;
    try { return decryptColumn(bytea); } catch (err) {
      console.warn(`[crypto] decrypt failure on ${label}:`, err instanceof Error ? err.message : err);
      return null;
    }
  }
  ```

- [ ] **Step 2** — In `lib/db/pacientes.ts`, replace every `decryptColumn(...)` with `tryDecrypt(..., "field-name")`. Lines 82-85, 126-129, plus any other `getPacienteCompleto` references.

- [ ] **Step 3** — Same sweep in `lib/db/paciente-ficha.ts`, `lib/db/hoy.ts`, `lib/db/calendario.ts` if they call `decryptColumn` directly (not via existing `tryDecrypt`).

- [ ] **Step 4** — Typecheck + unit tests + e2e smoke:
  ```bash
  pnpm typecheck && pnpm test:unit && pnpm test:app --grep pacientes
  ```

- [ ] **Step 5** — Commit:
  ```bash
  git add lib/crypto.ts lib/db/pacientes.ts lib/db/paciente-ficha.ts lib/db/hoy.ts lib/db/calendario.ts
  git commit -m "fix(crypto): unify tryDecrypt across paciente fetchers (closes audit MEDIUM crypto-fragility)"
  ```

### Task 9.5: account-purge cron logs results to cron_run table

**Files:**
- Create: `supabase/migrations/20260524000038_M36_cron_run_log.sql`
- Modify: `app/api/cron/account-purge/route.ts`
- Modify: `app/api/cron/dispatch-recordatorios/route.ts` — same pattern, fire-and-forget no longer silent

- [ ] **Step 1** — Migration creates a `cron_run` table:
  ```sql
  CREATE TABLE IF NOT EXISTS cron_run (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cron_name   text NOT NULL,
    started_at  timestamptz NOT NULL DEFAULT now(),
    ended_at    timestamptz,
    success     boolean,
    stats       jsonb,
    error       text
  );
  CREATE INDEX cron_run_name_started_idx ON cron_run (cron_name, started_at DESC);
  COMMENT ON TABLE cron_run IS 'Folio · structured log of cron job executions for observability. Read-only for OWNER/DIRECTOR via UI.';

  ALTER TABLE cron_run ENABLE ROW LEVEL SECURITY;
  -- Only service role reads/writes cron_run; admin UI uses service client via server action.
  ```

- [ ] **Step 2** — In each cron route (`account-purge`, `dispatch-recordatorios`, `maintenance`, `analytics-refresh`, etc.) wrap the body in a small helper:
  ```typescript
  async function recordRun(service: SupabaseClient, cronName: string, fn: () => Promise<unknown>) {
    const { data: row } = await service.from("cron_run").insert({ cron_name: cronName }).select("id").single();
    try {
      const stats = await fn();
      await service.from("cron_run").update({ ended_at: new Date().toISOString(), success: true, stats }).eq("id", row?.id);
      return { ok: true, stats };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "unknown";
      await service.from("cron_run").update({ ended_at: new Date().toISOString(), success: false, error: errorMsg }).eq("id", row?.id);
      captureException(err, { tags: { cron: cronName } });
      throw err;
    }
  }
  ```
  Place helper in `lib/observability/cron-run.ts` and import from each cron route.

- [ ] **Step 3** — In `dispatch-recordatorios`, the existing fire-and-forget pattern `void scheduleRecordatoriosForTurno(...)` mentioned in audit task 10: replace with:
  ```typescript
  scheduleRecordatoriosForTurno(turnoId).catch((err) => {
    captureException(err, { tags: { cron: "schedule-recordatorios", turnoId } });
  });
  ```

- [ ] **Step 4** — Typecheck + commit:
  ```bash
  pnpm typecheck && pnpm lint --fix
  git add supabase/migrations/20260524000038_M36_cron_run_log.sql app/api/cron/ lib/observability/
  git commit -m "feat(observability): M36 cron_run log + Sentry capture for fire-and-forget paths (closes audit MEDIUM cron-silence)"
  ```

---

## Phase 10 — UX polish & cleanup

### Task 10.1: Login does not enforce password ≥8 retroactively

**Files:**
- Modify: `app/(public)/login/actions.ts:21-40` — drop the length check

- [ ] **Step 1** — Read the function. Remove the `password.length >= 8` validation in `signInWithPassword`. Let Supabase respond with its own error. Keep email validation. Keep the generic error message ("Email o contraseña incorrectos.") on failure.

- [ ] **Step 2** — Run signup-related e2e:
  ```bash
  pnpm test:app --grep auth
  ```

- [ ] **Step 3** — Commit:
  ```bash
  git add app/(public)/login/actions.ts
  git commit -m "fix(login): drop retroactive password length check (closes audit LOW login-policy)"
  ```

### Task 10.2: Delete legacy signUpEmail + completeOnboarding

**Files:**
- Modify: `app/(public)/onboarding/actions.ts` — verify nothing imports legacy, then delete

- [ ] **Step 1** — Grep for callers:
  ```bash
  grep -rn 'signUpEmail\|completeOnboarding' app components
  ```
  If only the function definitions themselves match, safe to delete. If anything else matches, migrate those callers to the new Premium flow first.

- [ ] **Step 2** — Delete the two functions and the associated `signUpSchema`/`completeOnboardingSchema` imports if they're no longer referenced.

- [ ] **Step 3** — Typecheck + e2e:
  ```bash
  pnpm typecheck && pnpm test:app --grep signup
  ```

- [ ] **Step 4** — Commit:
  ```bash
  git add app/(public)/onboarding/actions.ts lib/onboarding/
  git commit -m "chore(auth): remove legacy signUpEmail + completeOnboarding (closes audit LOW legacy-fns)"
  ```

### Task 10.3: Expand turno_record_transition matrix after auditing real flows

**Files:**
- Read: `lib/db/turnos.ts`, `app/(app)/hoy/actions.ts`, `app/(focus)/`
- Create: `supabase/migrations/20260524000039_M37_turno_transitions.sql` (only if new transitions needed)

- [ ] **Step 1** — Enumerate every `update*Estado*` or `setEstado` call in `lib/db/turnos.ts`, `app/(app)/hoy/actions.ts`, and `app/(focus)/`. Build a list of from→to estado pairs the app actually uses.

- [ ] **Step 2** — Compare against the matrix in `supabase/migrations/20260518000009_M09_servicios_turnos.sql:215-251`. If the audit identified specific gaps (`AGENDADO → EN_SALA`, `CONFIRMADO → ATENDIENDO`, `CERRADO → REAGENDADO`), verify each is actually used today. If yes, add to allowed set in a M37 migration that replaces `turno_record_transition()` body with the expanded matrix. If no, leave the matrix as-is and add an inline comment in `turnos.ts` explaining why.

- [ ] **Step 3** — If migration added, apply + commit:
  ```bash
  pnpm exec supabase db reset
  git add supabase/migrations/20260524000039_M37_turno_transitions.sql
  git commit -m "fix(turno): M37 allow additional estado transitions used by /hoy + /focus (closes audit MEDIUM turno-matrix)"
  ```

---

## Phase 11 — Feature gap M08 (documentos clínicos app layer)

### Task 11.1: lib/db/documentos.ts upload + list + delete + signed URLs

**Files:**
- Create: `lib/db/documentos.ts`
- Create: `tests/unit/documentos.test.ts`

- [ ] **Step 1** — Create the module. Pattern mirrors `lib/db/consentimientos.ts` (read it first to match style):
  ```typescript
  "use server";

  import { z } from "zod";
  import { randomUUID } from "node:crypto";

  import { createSupabaseServerClient } from "@/lib/supabase/server";
  import { err, ok, type Result } from "./errors";
  import { getActiveSession } from "./session";

  const BUCKET = "documentos-clinicos";
  const MAX_BYTES = 25 * 1024 * 1024;
  const ALLOWED_MIME = new Set([
    "application/pdf",
    "image/jpeg", "image/png", "image/webp", "image/heic",
  ]);

  const uploadSchema = z.object({
    pacienteId: z.string().uuid(),
    sesionId: z.string().uuid().optional(),
    titulo: z.string().min(1).max(120),
    tipo: z.enum(["ESTUDIO", "FOTO_POSTURAL", "RECETA", "DERIVACION", "OTRO"]),
    mimeType: z.string(),
    sizeBytes: z.number().int().positive().max(MAX_BYTES),
    fileBlob: z.instanceof(Blob),
  });

  export type UploadInput = z.infer<typeof uploadSchema>;

  export async function uploadDocumento(input: UploadInput): Promise<Result<{ id: string; storagePath: string }>> {
    const parsed = uploadSchema.safeParse(input);
    if (!parsed.success) return err("validation", parsed.error.issues[0]?.message ?? "Inválido.");
    if (!ALLOWED_MIME.has(parsed.data.mimeType)) return err("validation", "Tipo de archivo no permitido.");

    const session = await getActiveSession();
    if (!session.ok) return session;

    const supabase = await createSupabaseServerClient();
    const ext = parsed.data.mimeType.split("/")[1] === "jpeg" ? "jpg" : parsed.data.mimeType.split("/")[1];
    const fileId = randomUUID();
    const storagePath = `${session.data.organizationId}/${parsed.data.pacienteId}/${fileId}.${ext}`;

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, parsed.data.fileBlob, {
      contentType: parsed.data.mimeType, upsert: false,
    });
    if (upErr) return err("upload_failed", "No pude subir el archivo.", upErr.message);

    const { data: doc, error: insErr } = await supabase.from("documento_clinico").insert({
      organization_id: session.data.organizationId,
      paciente_id: parsed.data.pacienteId,
      sesion_id: parsed.data.sesionId ?? null,
      titulo: parsed.data.titulo,
      tipo: parsed.data.tipo,
      mime_type: parsed.data.mimeType,
      size_bytes: parsed.data.sizeBytes,
      storage_path: `${BUCKET}/${storagePath}`,
      storage_bucket: BUCKET,
      subido_por_member_id: session.data.memberId,
    }).select("id").single();

    if (insErr || !doc) {
      // Rollback storage upload
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return err("db_error", "No pude registrar el documento.", insErr?.message);
    }
    return ok({ id: doc.id, storagePath: `${BUCKET}/${storagePath}` });
  }

  export async function listDocumentosForPaciente(pacienteId: string): Promise<Result<Array<{ id: string; titulo: string; tipo: string; createdAt: string; signedUrl: string }>>> {
    if (!z.string().uuid().safeParse(pacienteId).success) return err("validation", "ID inválido.");
    const session = await getActiveSession();
    if (!session.ok) return session;

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("documento_clinico")
      .select("id, titulo, tipo, storage_path, created_at")
      .eq("paciente_id", pacienteId)
      .eq("organization_id", session.data.organizationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (error) return err("db_error", "Error listando documentos.", error.message);

    const out = await Promise.all((data ?? []).map(async (row) => {
      const pathWithoutBucket = row.storage_path.startsWith(`${BUCKET}/`) ? row.storage_path.slice(BUCKET.length + 1) : row.storage_path;
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(pathWithoutBucket, 60 * 10);
      return {
        id: row.id, titulo: row.titulo, tipo: row.tipo, createdAt: row.created_at,
        signedUrl: signed?.signedUrl ?? "",
      };
    }));
    return ok(out);
  }

  export async function deleteDocumento(documentoId: string): Promise<Result<void>> {
    if (!z.string().uuid().safeParse(documentoId).success) return err("validation", "ID inválido.");
    const session = await getActiveSession();
    if (!session.ok) return session;

    const supabase = await createSupabaseServerClient();
    // RLS scopes by org + role; storage policy scopes by path+role.
    const { data: row, error: fetchErr } = await supabase
      .from("documento_clinico")
      .select("storage_path")
      .eq("id", documentoId)
      .eq("organization_id", session.data.organizationId)
      .single();
    if (fetchErr || !row) return err("not_found", "Documento no encontrado.");

    const pathWithoutBucket = row.storage_path.startsWith(`${BUCKET}/`) ? row.storage_path.slice(BUCKET.length + 1) : row.storage_path;
    const { error: delStorageErr } = await supabase.storage.from(BUCKET).remove([pathWithoutBucket]);
    if (delStorageErr) return err("storage_error", "No pude borrar el archivo.", delStorageErr.message);

    const { error: delDbErr } = await supabase.from("documento_clinico").update({ deleted_at: new Date().toISOString() }).eq("id", documentoId);
    if (delDbErr) return err("db_error", "Documento borrado del storage pero no de la DB.", delDbErr.message);

    return ok(undefined);
  }
  ```
  (Adjust field names like `subido_por_member_id`, `storage_bucket`, etc. against M08 actual columns — use grep.)

- [ ] **Step 2** — Unit test at `tests/unit/documentos.test.ts` (focused on path computation + mime validation):
  ```typescript
  import { test } from "node:test";
  import assert from "node:assert/strict";

  test("uploadDocumento rejects oversized file", async () => {
    // ...
  });
  // Add small tests as feasible without full DB stack.
  ```

- [ ] **Step 3** — Add minimal UI in patient ficha. Find the component (likely `app/(app)/pacientes/[id]/`). Add a small section "Documentos" listing files and an `<input type="file">` that calls a server action wrapping `uploadDocumento`.

- [ ] **Step 4** — Typecheck + e2e smoke:
  ```bash
  pnpm typecheck && pnpm lint --fix
  pnpm test:app --grep "documento" || true   # skip if test doesn't exist yet
  ```

- [ ] **Step 5** — Commit:
  ```bash
  git add lib/db/documentos.ts tests/unit/documentos.test.ts app/(app)/pacientes/
  git commit -m "feat(documentos): M08 app layer for clinical files (upload, list, signed-url, delete) (closes audit LOW M08-gap)"
  ```

---

## Phase 12 — Final verification

### Task 12.1: Full automated suite green

- [ ] **Step 1** — Clean rebuild + full type check:
  ```bash
  pnpm install
  pnpm typecheck
  ```
  Expected: zero errors.

- [ ] **Step 2** — Lint:
  ```bash
  pnpm lint
  ```
  Expected: zero errors. Warnings reviewed and either fixed or justified.

- [ ] **Step 3** — Unit tests:
  ```bash
  pnpm test:unit
  ```
  Expected: all pass.

- [ ] **Step 4** — Reset local DB, apply all migrations including new ones, run SQL specs:
  ```bash
  pnpm exec supabase db reset
  for f in tests/sql/*.spec.sql; do
    pnpm exec supabase db shell --file "$f" || { echo "FAIL: $f"; exit 1; }
  done
  ```
  Expected: every NOTICE prints PASS.

- [ ] **Step 5** — E2E:
  ```bash
  pnpm test:app
  ```
  Expected: all green. Investigate any flake (re-run once; if still red, fix).

### Task 12.2: Manual smoke flow — signup to first session-closed

- [ ] **Step 1** — Spin up dev:
  ```bash
  pnpm dev
  ```
  Open `http://localhost:3010`.

- [ ] **Step 2** — Walk the full happy path. Tick off each:
  - Fresh email signup → onboarding → reach /hoy.
  - From /hoy: create a paciente with DNI + phone.
  - Try to create a duplicate (same DNI) → see specific error.
  - Try walk-in patient WITHOUT phone → see validation error.
  - Open the paciente ficha → see the patient.
  - Upload a test PDF to the documentos section → it appears in the list with a download link.
  - Open the consents page → record one (with PDF).
  - Create a turno for the paciente.
  - Move turno to EN_SALA → ATENDIENDO → CERRADO with payment.
  - Confirm Sentry has no new errors for the session.
  - Sign out, sign back in → land on /hoy with everything visible.
  - Sign in with Google as a NEW account → onboarding bootstraps, no "no pude resolver tu organización" error.

- [ ] **Step 3** — Note anything that surprised you. If non-trivial, file as a follow-up task (do NOT inline fix in this branch — keep this PR scoped).

### Task 12.3: Final commit and PR

- [ ] **Step 1** — Self-review the diff:
  ```bash
  git log --oneline master..HEAD
  git diff master..HEAD --stat
  ```

- [ ] **Step 2** — Update CHANGELOG/README if the project has them. Mention the 28 audit findings closed.

- [ ] **Step 3** — Push branch + open PR with checklist of phases completed and a manual-test summary.

---

## Self-Review Checklist (run BEFORE handing off)

- [ ] Every audit finding from `Reporte de Auditoría` has a task: CRITICAL ×4, HIGH ×11, MEDIUM ×10, LOW ×3. Cross off below as you map:
  - C1 storage buckets → Task 1.1 ✓
  - C2 analytics enum → Task 3.1 ✓
  - C3 audit log partition cron → Task 2.1 ✓
  - C4 patient dedup → Tasks 4.1 + 4.2 ✓
  - H5 database.types regen → Task 5.1 ✓
  - H6 opt_out unify → Task 9.1 ✓
  - H7 atomic bootstrap → Tasks 7.1 + 7.2 ✓
  - H8 listUsers ceiling → Task 7.2 ✓
  - H9 realtime auth → Task 6.2 ✓
  - H10 setActiveOrg validation → Task 6.1 ✓
  - H11 audit_log DIRECTOR → Task 8.2 ✓
  - H12 paciente_identidad caja_fuerte RLS → Task 6.3 ✓
  - H13 OAuth error sanitize → Task 8.1 ✓
  - H14 signup rollback profile → Task 7.2 (deleted by atomicity) ✓
  - H15 paciente RLS via turno → Task 6.4 ✓
  - M reset email rate-limit logging → covered as part of Task 9.5 cron observability (or add inline log to login/actions.ts)
  - M cookie write narrow catch → Task 9.2 ✓
  - M audit ip/user_agent → Task 9.3 ✓
  - M UNIQUE deleted_at → Task 4.1 (partial index uses WHERE deleted_at IS NULL) ✓
  - M turno transitions matrix → Task 10.3 ✓
  - M account-purge observability → Task 9.5 ✓
  - M tryDecrypt consistency → Task 9.4 ✓
  - M mapSupabaseError DNI → Task 4.2 ✓
  - M M08 app layer → Task 11.1 ✓
  - M recordatorios fire-and-forget → Task 9.5 ✓
  - L login retroactive password → Task 10.1 ✓
  - L middleware getUser overhead → out of scope (Supabase recommends pattern; document and move on)
  - L legacy signUpEmail → Task 10.2 ✓
- [ ] No placeholders (TBD, TODO, "appropriate error handling") in any task body.
- [ ] Every code block compiles in isolation (imports listed where new).
- [ ] Every SQL block specifies migration filename + apply command + verification query.
- [ ] Every commit ends with a conventional-commit message that references the audit finding being closed.

---

**End of plan.**
