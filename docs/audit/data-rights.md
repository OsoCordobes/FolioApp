# Folio · Data Rights (Habeas Data §15 + §16)

How users exercise their portability + erasure rights, and how the system enforces them.

## §15 · Right of access + portability

**Entry point**: `/configuracion/datos` → "Descargar mis datos" button.

**Server action**: `exportMyDataAction()` in `app/(app)/configuracion/datos/actions.ts`.

**Flow**:
1. Authenticated user clicks the button.
2. Server action calls `auth.getUser()` to confirm session.
3. Service-role fetches:
   - **Profile** (own row, decrypted nombre + apellido via `decryptColumn`)
   - **Members** rows + linked organizations
   - For each org **the user OWNS**:
     - All `paciente_identidad` rows (decrypted: nombre, apellido, numero_doc, email, telefono, domicilio_calle, domicilio_numero)
     - All `turno` rows
     - All `sesion` rows (decrypted: soap_s, soap_o, soap_a, soap_p, notas)
4. Server action returns the assembled JSON.
5. Client wraps it in a `Blob` + triggers download as `folio-export-<user-id>-<YYYY-MM-DD>.json`.

**What's NOT in the export**:
- Other users' data
- Data from orgs the user does NOT own
- Encrypted-only fields where decryption would expose other users' info (none currently)
- Audit log entries (separately readable via `/admin/audit` for OWNER)

**Format**: pretty-printed JSON. Auditors can re-read it via any JSON viewer.

## §16 · Right of erasure (account deletion)

**Entry point**: `/configuracion/datos` → "Quiero eliminar mi cuenta".

**Flow**:
1. User clicks "Quiero eliminar mi cuenta" → form expands with optional "Motivo" textarea.
2. User clicks "Programar eliminación en 30 días" → `window.confirm()` confirms intent.
3. Server action `requestAccountDeletionAction(reason?)`:
   - Auth check via `auth.getUser()`
   - Sets `profile.deletion_requested_at = now()`, `profile.deletion_reason = reason ?? null`
4. UI updates: shows "Eliminación programada · solicitada el X · se ejecuta el X+30d". A "Cancelar solicitud" button lets the user withdraw at any time within the 30-day grace window.

**Cron-driven hard-delete**:
- Route: `/api/cron/account-purge` (bearer-token CRON_SECRET).
- Schedule: daily at 03:00 UTC.
- **Default mode**: DRY-RUN. Lists due profiles, performs no deletions. Enable hard-delete with `ACCOUNT_PURGE_ENABLED=1` in production env.

**Hard-delete cascade** (per profile whose `deletion_requested_at < now() - 30 days`):
1. List orgs the profile OWNS.
2. For each org: list all pacientes; call `pseudonimizar_paciente(p.id, 'account_purge cron after 30-day deletion grace')` for each.
3. Soft-delete `member` rows for the profile (`deleted_at = now()`).
4. Soft-delete owned `organization` rows.
5. Hard-delete the `profile` row (ON DELETE CASCADE handles FK children).
6. Hard-delete the `auth.users` row via service-role `admin.deleteUser(profileId)`.

**Idempotent**: each profile is wrapped in a try/catch; one failing profile does not block others.

**Reversibility**: within the 30-day grace window the user can call `cancelAccountDeletionAction()`, which resets `deletion_requested_at = null`. After the cron purges, the deletion is irreversible.

## Pseudonymization (per-patient §16 erasure)

Separate flow at the **paciente** level. Triggered manually (no UI yet — `pseudonimizar_paciente()` SQL function only). OWNER/DIRECTOR can call:

```sql
SELECT pseudonimizar_paciente(
  p_paciente_id := '<paciente-uuid>',
  p_motivo      := 'patient requested erasure per Ley 25.326 art. 16',
  p_dry_run     := false
);
```

**What happens**:
1. Function checks `auth.uid()` + verifies the actor is OWNER/DIRECTOR of the paciente's org.
2. Reads the existing `nombre_hash` + `dni_hash` HMAC blind indexes.
3. INSERTs into `pseudonimizacion_event` (M25 append-only):
   - `organization_id`, `paciente_id`, `dni_sha256`, `nombre_sha256`, `performed_at`, `performed_by`, `motivo`
4. DELETEs the `paciente_identidad` row (PII removed forever).
5. UPDATEs `paciente.identidad_id = NULL`, `paciente.pseudonimizado_en = now()`.

**What's preserved**: all `sesion`, `documento_clinico`, `turno`, `pago` rows linked to `paciente.id` remain — Ley 26.529 art. 18 demands 10-year retention. The records are now orphaned in identity-space.

**What's destroyed**: nombre, apellido, numero_doc, email, telefono, domicilio_* — all of `paciente_identidad`.

**Auditor verification**:
```sql
SELECT performed_at, performed_by, motivo
  FROM pseudonimizacion_event
 WHERE organization_id = '<org-uuid>'
 ORDER BY performed_at DESC;
```

If a dispute arises (e.g. "did Folio pseudonimize the patient with DNI 12345678 on date X?"):
```sql
SELECT pe.* FROM pseudonimizacion_event pe
 WHERE pe.dni_sha256 = encode(hmac('12345678', '<HMAC-key>', 'sha256'), 'hex');
```
Only the org's HMAC key can verify membership.

## E2E coverage

- `tests/e2e/security-headers.spec.ts` (covers /api/health + /login)
- `tests/e2e/signup-consent-ratelimit.spec.ts` (covers /reset-password)
- `tests/unit/crypto-roundtrip.test.ts` (covers HMAC blind-index determinism)

The `/configuracion/datos` page itself does NOT have an E2E spec yet because the route is auth-gated. Manual smoke procedure for the auditor:

1. Create test account via `/login` signup with consent.
2. Navigate to `/configuracion/datos`.
3. Click "Descargar JSON" — file downloads with the expected shape.
4. Click "Quiero eliminar mi cuenta" → "Programar eliminación" → confirm. UI shows the pending state.
5. Click "Cancelar solicitud". UI reverts to non-pending.
6. (Optional) Re-request deletion, set `ACCOUNT_PURGE_ENABLED=1`, manually trigger `/api/cron/account-purge` with curl. Observe the profile + auth.users disappear.
