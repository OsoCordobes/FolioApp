# Folio · Retention Policy (Ley 26.529 art. 18)

The retention policy uses a **10-year** (120-month) clinical-record horizon as its documented baseline, with Ley 26.529 art. 18 as a legal reference. The responsible clinical custodian must validate the applicable period, its starting event, any longer obligations and the authorized delivery process. Repository safeguards alone do not prove legal compliance, continuous availability or recovery in production.

## Append-only by design

Clinical write-paths are append-only:

| Table | Append-only mechanism |
|---|---|
| `sesion` | `prevent_locked_sesion_update()` trigger blocks field changes post-lock; `sesion_lock_immutable_trg` (M22) blocks unlock; `prevent_locked_sesion_delete()` trigger blocks DELETE when locked |
| `sesion_enmienda` | `prevent_sesion_enmienda_mutation()` blocks ALL UPDATE + DELETE |
| `audit_log` | RLS policies `audit_log_no_direct_insert` + `audit_log_no_update` + `audit_log_no_delete` + SECURITY DEFINER trigger as the only writer |
| `consentimiento` | `consentimiento_prevent_critical_update()` post-sign + policy `consentimiento_no_delete` |
| `pseudonimizacion_event` (M25) | Policies `_no_direct_insert` + `_no_update` + `_no_delete` — SECURITY DEFINER insertion only |
| `pago` (M22) | `pago_no_delete` policy. Refunds = INSERT with monto negativo. |
| `post_visita`, `cobertura_paciente`, `cargo_suscripcion`, `suscripcion`, `seguro_profesional` (M22) | `_no_delete` policies |

## Partitioning + archival (audit_log)

`audit_log` is partitioned by month (M12). Each partition's name is `audit_log_YYYY_MM`. Partition creation is automated via trigger when a row arrives for a future month.

**Retention enforcement**: partitions older than 120 months should be detached + dumped to cold storage (`audit-archive` Supabase Storage bucket) + dropped. The cron route `app/api/cron/audit-archive` is **NOT yet implemented** during the audit window — see `known-gaps.md` for the manual procedure.

**Why deferred**: at current data volumes (4 auth users, ~150 audit rows), the oldest partition is from `audit_log_2026_05` (this month). The 120-month boundary is 2036-05. Manual archival in 2036+ is acceptable interim.

**Manual archival procedure (for ~2036+)**:
```sql
-- 1. Identify partitions older than 120 months
SELECT relname FROM pg_class
 WHERE relname LIKE 'audit_log_%'
   AND relname < 'audit_log_' || to_char(now() - interval '120 months', 'YYYY_MM');

-- 2. For each: pg_dump to S3 / Supabase Storage
\COPY (SELECT * FROM audit_log_2026_05) TO '/tmp/audit_log_2026_05.csv';
-- upload to bucket audit-archive/2026/05.csv

-- 3. Detach + drop
ALTER TABLE audit_log DETACH PARTITION audit_log_2026_05;
DROP TABLE audit_log_2026_05;
```

## Patient erasure requests and clinical retention

An erasure request requires human review of the applicable retention obligations, identity verification, clinical custody and authorized delivery. Destroying a patient's identity link while retaining clinical rows is not treated as proof that those responsibilities have been fulfilled. This document does not authorize that operation or establish a replacement clinical deletion workflow.

M116 retires `public.pseudonimizar_paciente(uuid, text, boolean)` through an additive migration: it preserves the signature, replaces the body with an unconditional SQLSTATE `42501` rejection before any mutation, and revokes execution from application roles and `PUBLIC`. Both execution and dry-run arguments reject. Historical migrations and existing `pseudonimizacion_event` records remain historical evidence; they are not instructions to repeat the former destructive operation.

The rejection depends on M116 being applied in the target database. Production application has not been established by this document. See `data-rights.md` for the account-data boundary and rollout verification requirements.

## Account-level retention

`/mis-datos` and `/configuracion/datos` let the verified user register or withdraw a closure request. The standalone `/mis-datos` page remains available outside the clinic billing gate and still requires authentication and applicable MFA. Request and withdrawal actions report success only after updating the matching user's profile row; they set or clear the request marker and reason, then revalidate both pages.

The pending state requires human review. No 30-day deadline or other elapsed period triggers account or patient deletion. Review must resolve clinical custody, preservation, continuity of access and authorized delivery before any separately approved closure procedure; the request markers themselves do not implement that procedure.

The compatibility endpoint `/api/cron/account-purge` is read-only: it counts pending requests and reports `manual_review_required` with `automatic_purge: false`. It has no schedule in `vercel.json`, and `ACCOUNT_PURGE_ENABLED` cannot activate deletion. It does not remove profiles, Auth users, memberships or organizations, and it does not pseudonymize patients. Repository configuration does not verify a deployed build or external scheduler.

The shared personal export in `lib/me/personal-export.ts` returns format v2 for the page action and `/api/me/export`. Its explicit personal categories exclude patient identities and clinical records. A personal account download is therefore not a clinical-record handover; the UI provides a support contact to coordinate separately authorized delivery. This retirement adds no replacement clinical export workflow.

## Backup + recovery

The current provider plan, backup frequency, retention window, point-in-time recovery settings and geographic redundancy must be verified against the target project's configuration. This document does not confirm that any particular backup feature is enabled or that a restore has succeeded.

Operational evidence should identify the backup owner, protected data and attachments, retained recovery points, encryption-key recovery requirements, and the result of a restore exercise. Database recovery alone does not establish recovery of externally stored clinical attachments or the keys needed to decrypt retained records.

Before encryption-key rotation or any separately approved destructive maintenance, preserve a verified recovery path and follow the current rotation runbook in `../ROTACION-CLAVES.md`. There is no account-purge activation step in this policy.

## Verification

The following read-only inspections provide partial technical evidence. They do not establish the applicable legal period, provider backup configuration, successful recovery or production application of M116:

```sql
-- 1. Confirm append-only on every clinical table
SELECT tablename, policyname FROM pg_policies
 WHERE schemaname = 'public'
   AND cmd = 'DELETE' AND qual = 'false'
 ORDER BY tablename;

-- 2. Confirm partition pattern
SELECT relname FROM pg_class WHERE relname LIKE 'audit_log_%' ORDER BY relname;

-- 3. Inspect historical pseudonymization events (not an active erasure flow)
SELECT performed_at, motivo FROM pseudonimizacion_event ORDER BY performed_at DESC LIMIT 5;
```

`tests/e2e/security-headers.spec.ts` covers response-header behavior, and `supabase/tests/10_M22_rls_hardening.sql` covers policy/trigger behavior; neither proves clinical retention end-to-end. SQL retirement checks, including updated historical pseudonymization suites, must assert rejection and preserved data after M116. `tests/unit/account-purge-review-only.test.ts` checks that the compatibility endpoint cannot mutate data or gain a schedule through the legacy flag. Live migration state, custody decisions and recovery evidence require separate verification.
