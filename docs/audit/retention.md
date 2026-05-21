# Folio · Retention Policy (Ley 26.529 art. 18)

Argentine clinical records must be retained **for 10 years** (120 months) past the last contact with the patient. Folio's schema is engineered for this from day 1.

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

## Patient erasure under retention (the dual constraint)

Ley 25.326 art. 16 (right of erasure) + Ley 26.529 art. 18 (10-year retention) appear contradictory: how do you delete a patient's data while keeping their clinical record for 10 years?

**Folio's answer**: pseudonymization. The patient's **identity** (PII) is destroyed; their **clinical record** (PHI) is retained but disconnected from identity.

Implementation: `pseudonimizar_paciente()` (M13 + M25 extension):
1. Save SHA-256 of original DNI + nombre to `pseudonimizacion_event` (M25 audit row).
2. DELETE the `paciente_identidad` row.
3. SET `paciente.identidad_id = NULL`, `paciente.pseudonimizado_en = now()`.
4. `sesion`, `documento_clinico`, `turno`, `pago` rows are orphaned (referenced only by `paciente.id`, an opaque UUID).

After pseudonymization, the only way to re-identify the patient is the HMAC blind-index lookup using the original DNI + the org's HMAC key. This requires both the original DNI (which the patient or a legitimate inquirer knows) AND the org's `FOLIO_ENC_HMAC_KEY` (held only by Folio).

## Account-level retention

Profile-level deletion (via `/configuracion/datos`) cascades through every owned org. Per Lautaro's sign-off in `known-gaps.md`, the cron is currently in DRY-RUN. To activate:

```env
ACCOUNT_PURGE_ENABLED=1
```

The cron at `/api/cron/account-purge`:
1. Waits the 30-day grace.
2. Pseudonimizes every paciente.
3. Soft-deletes member + organization rows.
4. Hard-deletes profile + auth.users.

The pseudonymization step ensures clinical records survive the cascading account delete — they remain in the database as orphaned PHI, satisfying the 10-year retention obligation.

## Backup + recovery

Supabase Pro tier provides:
- **Daily logical backups** (last 7 days)
- **Point-in-time recovery** (last 7 days)
- **Geo-redundant storage** for the database

For the audit-prep sprint, no additional backup config is needed. Post-launch:
- Snapshot the DB before any encryption-key rotation (`scripts/rotate-enc-key.ts`).
- Pre-cron-purge snapshot once `ACCOUNT_PURGE_ENABLED=1`.

## Verification

The retention policy is verifiable end-to-end:

```sql
-- 1. Confirm append-only on every clinical table
SELECT tablename, policyname FROM pg_policies
 WHERE schemaname = 'public'
   AND cmd = 'DELETE' AND qual = 'false'
 ORDER BY tablename;

-- 2. Confirm partition pattern
SELECT relname FROM pg_class WHERE relname LIKE 'audit_log_%' ORDER BY relname;

-- 3. Confirm pseudonymization preserves the event
SELECT performed_at, motivo FROM pseudonimizacion_event ORDER BY performed_at DESC LIMIT 5;
```

E2E coverage: `tests/e2e/security-headers.spec.ts` confirms HSTS preload + frame-ancestors none (prevents off-domain frame embedding of clinical UIs); `supabase/tests/10_M22_rls_hardening.sql` + `11_M25_pseudonimizacion_audit.sql` cover the policy + trigger + audit-event landscape.
