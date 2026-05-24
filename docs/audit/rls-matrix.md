# Folio · RLS Policy Matrix

Catalog of every table × role × CRUD permission. RLS is FORCEd on every table; service-role bypass is documented per call-site in `app/(public)/onboarding/actions.ts` and other places.

**Roles** (from `member.role`):
- **OWNER** — founder/operator. Full access to their org.
- **DIRECTOR** — clinic director (F12). Same as OWNER for clinical data; subordinate for billing.
- **PROFESIONAL** — kinesiologist / psychologist / etc. Sees own patients + own clinical data.
- **COORDINADOR** — clinic coordinator (F12). Manages turnos, no clinical access.
- **ASISTENTE** — receptionist. PII access (agenda), no PHI.

## Tenancy + Identity

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `organization` | members of org | OWNER | OWNER | soft (via deleted_at, app-layer) |
| `profile` | self only | service-role only | self | service-role only (account-purge) |
| `member` | same org | OWNER/DIRECTOR | OWNER/DIRECTOR | soft |
| `equipo` | same org | OWNER/DIRECTOR | OWNER/DIRECTOR | soft |
| `disponibilidad_profesional` | same org | self or admin | self or admin | soft |
| `servicio_profesional` | same org | OWNER/DIRECTOR | OWNER/DIRECTOR | soft |

## Patient PII (paciente_identidad) + PHI (paciente)

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `paciente_identidad` | OWNER + assigned PROFESIONAL + ASISTENTE | OWNER/DIRECTOR | OWNER + assigned PROFESIONAL | **policy `_no_delete` (M03)** + pseudonymization SECURITY DEFINER |
| `paciente` | OWNER + assigned PROFESIONAL (PHI) | OWNER/DIRECTOR | same | **policy `_no_delete` (M03)** |

## Clinical entities

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `sesion` | OWNER + assigned PROFESIONAL | PROFESIONAL on own | self until locked (trigger blocks post-lock changes; M22 trigger blocks unlock) | **trigger blocks if locked + M03 `_no_delete`** |
| `sesion_enmienda` | OWNER + author | PROFESIONAL appending to own sesion | **trigger blocks ALL UPDATE** (append-only) | **trigger blocks ALL DELETE** |
| `diagnostico` | OWNER + assigned PROFESIONAL | PROFESIONAL | same | **policy `_no_delete` (M05)** |
| `alergia` | same | PROFESIONAL/ASISTENTE | same | **policy `_no_delete` (M05)** |
| `medicacion` | same | PROFESIONAL | same | **policy `_no_delete` (M05)** |
| `documento_clinico` | OWNER + assigned PROFESIONAL | PROFESIONAL | same | **policy `_no_delete` (M08)** |
| `contacto_emergencia` | same | OWNER/DIRECTOR/ASISTENTE | same | **policy `_no_delete` (M06)** |
| `tutor_legal` | same | OWNER/DIRECTOR | same | **policy `_no_delete` (M06)** |
| `consentimiento` | OWNER + assigned PROFESIONAL | PROFESIONAL captures signed | trigger blocks critical-field updates post-sign | **policy `_no_delete` (M07)** |

## Agenda + finanzas (M09)

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `servicio` | same org | OWNER/DIRECTOR | same | soft (deleted_at) |
| `turno` | OWNER + assigned PROFESIONAL + ASISTENTE | PROFESIONAL/ASISTENTE | same | **policy `_no_delete` (M09)** — use state machine `cancelado` instead |
| `transicion` | OWNER + assigned PROFESIONAL | trigger-driven on turno UPDATE | service-role | **policy `_no_delete` (M09)** |
| `pago` | OWNER + assigned PROFESIONAL | PROFESIONAL/ASISTENTE | self | **policy `_no_delete` (M22)** — for refunds INSERT a row with monto negativo |
| `post_visita` | OWNER + assigned PROFESIONAL | PROFESIONAL | same | **policy `_no_delete` (M22)** |
| `cobertura_paciente` | same | PROFESIONAL/ASISTENTE | same | **policy `_no_delete` (M22)** |
| `pedido` | OWNER + same org | ASISTENTE / via /book | OWNER/DIRECTOR/ASISTENTE | soft |
| `bloqueo` | OWNER + same org | OWNER/DIRECTOR/PROFESIONAL | same | hard (operator-removable) |

## Integration + seguro + reminders

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `integration` | OWNER/DIRECTOR or owning member | OWNER or owning member | same | same |
| `integration_active` (view, M25) | inherits from `integration` | n/a | n/a | n/a |
| `seguro_profesional` | OWNER/DIRECTOR + self | OWNER + self | same | **policy `_no_delete` (M22)** |
| `recordatorio_job` | same org | OWNER/DIRECTOR/PROFESIONAL/ASISTENTE | same | service-role cron |

## Suscripción + billing

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `suscripcion` | OWNER (own org) | service-role (MP webhook) | service-role | **policy `_no_delete` (M22)** |
| `cargo_suscripcion` | OWNER (own org) | service-role (MP webhook) | service-role | **policy `_no_delete` (M22)** |

## Audit + compliance

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `audit_log` | OWNER (own org) | SECURITY DEFINER trigger only (policy `_no_direct_insert`) | **policy `_no_update`** | **policy `_no_delete`** |
| `pseudonimizacion_event` (M25) | OWNER/DIRECTOR (own org) | SECURITY DEFINER inside pseudonimizar_paciente() (policy `_no_direct_insert`) | **policy `_no_update`** | **policy `_no_delete`** |

## Catálogos (read-only seed data)

| Table | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| `codigo_cie10` | authenticated | service-role only |
| `obra_social` | authenticated | service-role only |
| `plantilla_consentimiento` | authenticated | service-role only · **policy `_no_delete` (M04)** |

## Storage buckets

| Bucket | Read | Write |
|---|---|---|
| `org-logos` | public (READ-ONLY on objects with valid UUID-prefixed paths) | OWNER/DIRECTOR of the org owning the path (M22 tightening: regex-validated UUID at the path segment) |
| `consentimientos-firmados` (future, F8 / 6c) | OWNER/DIRECTOR + assigned PROFESIONAL of the same org | same |

## Service-role bypass call sites

Every `createSupabaseServiceClient()` call gates on `auth.getUser()` BEFORE the bypass — verified by grepping all 30+ call sites in `app/(public)/onboarding/actions.ts`, `app/(app)/configuracion/datos/actions.ts`, `app/api/admin/*`, `app/api/cron/*`. For cron endpoints, the bearer-token CRON_SECRET stands in for auth.

## Pre-existing false-positive findings

Three findings from the audit-prep Explore scan turned out to be already-handled in earlier migrations. Cataloging here so the auditor doesn't redo the work:

| Reported as missing | Actual location | Status |
|---|---|---|
| `audit_log` SELECT org-scoping (H4) | M12 line 211 `organization_id IN (SELECT public.user_org_ids()) AND public.user_role_in(organization_id) = 'OWNER'` | PRE-EXISTING — policy correct |
| `integration` table RLS (H6) | M11 lines 131–168 — full RLS with admin-or-self gating | PRE-EXISTING — policy correct |
| `consentimiento` DELETE prevention (H7) | M07 — policy `consentimiento_no_delete` + UPDATE-after-sign trigger | PRE-EXISTING — policy correct |

## pgTAP coverage

| Suite | Migration | Cases | Status |
|---|---|---|---|
| `01_helpers.sql` | M01 | n/a (helper functions) | green |
| `02_tenancy.sql` | M02 | n | green |
| `03_paciente_split.sql` | M03 | n | green |
| `04_catalogos.sql` | M04 | n | green |
| `05_entidades_clinicas.sql` | M05 | n | green |
| `06_contactos.sql` | M06 | n | green |
| `07_consentimientos.sql` | M07 | n | green |
| `08_audit_log_kanonimity.sql` | M12+M15 | n | green |
| `09_card_personalization.sql` | M21 | 11 | green |
| `10_M22_rls_hardening.sql` | M22 (NEW) | 11 | green |
| `11_M25_pseudonimizacion_audit.sql` | M25 (NEW) | 9 | green |

---

## Service-role bypass auditing

Cada uso de `createSupabaseServiceClient()` (RLS bypass por SERVICE_ROLE_KEY) tiene un riesgo de cross-tenant leak si no está gateado. El proceso de re-audit trimestral y la lista de call sites esperados viven en [`quarterly-service-role-audit.md`](./quarterly-service-role-audit.md).
