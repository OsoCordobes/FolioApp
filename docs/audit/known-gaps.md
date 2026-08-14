# Folio · Known gaps + deferred items (pre-audit sprint)

Tracked here so auditors see explicit ownership + planned remediation. Each entry includes severity, current mitigation, and the sprint that closes it. Founder Lautaro signs off on this file at Phase 9 freeze.

## Status legend

- **WORK** — implemented in this sprint, audit-ready.
- **DOC** — accepted exception, documented in the relevant `docs/audit/*.md`.
- **DEFER** — known gap, post-audit timeline, with a workaround for the audit window.

---

## Deferred to post-audit (DEFER)

### Rotación de claves de cifrado (`FOLIO_ENC_KEY`)

- **Status**: **no implementada.** Cuatro documentos (`DEPLOYMENT.md`,
  `docs/audit/encryption-exceptions.md`, `docs/audit/retention.md`,
  `docs/LAUNCH-RUNBOOK.md`) citaban `scripts/rotate-enc-key.ts` como el
  procedimiento vigente. **Ese archivo no existe y nunca existió.** Corregido en
  los cuatro (2026-08-12); esta entrada es ahora la fuente de verdad.
- **Por qué no se improvisó**: el script tiene que leer con la key vieja y
  reescribir con la nueva **cada** columna `*_cifrado` del esquema. Un bug ahí
  no se nota hasta que alguien abre una ficha, y para entonces el ciphertext
  original ya se pisó. Escribirlo a ciegas y sin un ensayo contra datos reales
  es peor que declarar el gap.
- **Mitigation**: la key vive sólo en Vercel (no en el repo, no en backups de
  código) y el acceso a ese proyecto está limitado al founder. Ante una
  filtración, el camino seguro hoy es **restore desde backup pre-leak**, no una
  rotación a medias — una rotación incompleta deja filas cifradas con dos keys
  distintas y la app muestra fichas vacías (degrada a null, con reporte a
  Sentry vía `tryDecrypt`, pero el profesional ve la ficha en blanco).
- **Qué hace falta para cerrarlo**: el procedimiento completo, el inventario
  correcto (50 columnas en 22 tablas) y la lista de lo que falta están ahora en
  **`docs/ROTACION-CLAVES.md`**, que es la fuente de verdad operativa.
  ⚠️ El inventario de `encryption-exceptions.md` **NO sirve**: lista cinco
  columnas inexistentes y omite unas veinte reales.
- **Avance 2026-08-13**: `lib/crypto.ts` ya soporta **doble clave**
  (`FOLIO_ENC_KEY_NEXT` / `FOLIO_ENC_HMAC_KEY_NEXT`), con tests. Eso permite
  rotar **sin downtime**, que era el bloqueo conceptual. Falta el job de
  re-cifrado, migrar los lectores de blind index a `.in(candidatos)` y la sonda
  de cobertura — detalle en `docs/ROTACION-CLAVES.md`.
- **Urgencia real (2026-08-13)**: las dos claves están en Vercel como
  `sensitive` = write-only, y la única copia legible se perdió al sobrescribirse
  el `.env.local` del founder. **No existe backup de las claves.** Si Vercel las
  pierde, las 50 columnas cifradas quedan ilegibles para siempre. Esto dejó de
  ser un gap de compliance y pasó a ser riesgo de pérdida total de PHI.
- **Closes in**: sin fecha comprometida, pero ya no es "sin apuro": la ventana
  para rotar existe sólo mientras producción siga teniendo la clave vieja.

### Source maps de Sentry en el cliente

- **Status**: los errores del browser **ya llegan** a Sentry desde
  `instrumentation-client.ts` (antes no llegaba ninguno: `sentry.client.config.ts`
  existía y nadie lo cargaba). Lo que falta es **subir source maps**, que
  requiere `withSentryConfig` + `SENTRY_AUTH_TOKEN`/org/project en build.
- **Mitigation**: los stack traces llegan minificados. Sirven para detectar y
  contar errores; no para leer la línea exacta sin cruzarlos a mano con el
  build.
- **Closes in**: cuando se decida acoplar el build al token de Sentry.

### Sesion_enmienda UI

- **Status**: table + RLS + append-only triggers exist (M10), y el data layer también (`lib/db/sesiones.ts`). No UI to record an enmienda desde la ficha del paciente (`/pacientes/[id]`). (La ruta demo `/focus` fue eliminada del producto — commit f292b9c.)
- **Mitigation**: during the audit window, clinicians use the `sesion` editor pre-lock. Post-lock corrections are paused (rare in 2-week window).
- **Closes in**: post-audit Week 2.

### WhatsApp outbound compose UI

- **Status**: inbound webhook works (M18 + `/api/whatsapp/webhook`). No UI to compose + send outbound templates.
- **Mitigation**: reminders YA corren vía el pipeline de cron (`/api/cron/dispatch-recordatorios`, registrado en `vercel.json` y disparado cada 15 min por GitHub Actions — ver LAUNCH-RUNBOOK §6); para contacto manual hay deep-links wa.me (`components/paciente/paciente-detalle.tsx` `PacienteWhatsAppButton`). Compose de templates desde la UI sigue deferred.
- **Closes in**: F11 of the canonical plan.

### Google Calendar bidirectional sync · conflict resolution

- **Status**: OAuth + watch-renew + push Folio→Google funcionan. El inbound Google→Folio está implementado (`lib/google/inbound.ts`): los eventos ocupados de Google se espejan como `bloqueo` origen='google' (ventana 30 días, reconciliación por `gcal_event_id`, M52); los eventos creados por Folio se excluyen del espejo. La política de conflicto quedó DEFINIDA por diseño: el sync inbound nunca modifica turnos — un turno de Folio borrado en Google permanece intacto en Folio (fail-safe).
- **Mitigation**: no hay two-way sync de turnos (borrar/mover en Google no reagenda en Folio) — by design. Auditor sees a known-limitation note in `docs/audit/known-gaps.md` referencing this entry.
- **Closes in**: F10 of the canonical plan.

### Email fallback for turno reminders

- **Status**: la integración Resend existe (`lib/email/client.ts` + templates de invitación de equipo y confirmación de booking; fail-safe a log sin API key). Lo pendiente es específicamente el fallback de email en el pipeline de RECORDATORIOS: `/api/cron/dispatch-recordatorios` es WhatsApp-only.
- **Mitigation**: reminders use WhatsApp only. Pacientes without WhatsApp fall through silently (no hay SMS). Documented as known limitation in `/configuracion/billing` help text.
- **Closes in**: F11.

### F12 · Multi-tenant clinic UI

- **Status**: UI de clínica operativa: sección Equipo (roles DIRECTOR/PROFESIONAL/ASISTENTE, invitaciones M49/M51 — `components/configuracion/configuracion.tsx` + `app/(public)/invitacion/[token]`), selector multi-profesional en calendario (`components/calendario/calendario.tsx`) y en alta de turno (CLINICA-3, `components/hoy/turno-create-modal.tsx`), billing por seats (`lib/billing/pricing.ts`). Pendiente del scope F12 original: splits de comisión por profesional.
- **Mitigation**: first cohort of paying clients are 1-professional consultorios; los splits de comisión se liquidan fuera de Folio mientras tanto.
- **Closes in**: post-MVP (solo comisiones quedan pendientes).

### Patient clinical consent UI (Phase 6c · clinical signature)

- **Status**: `consentimiento` table (M07) + data layer completo (`lib/db/consentimientos.ts`: create/revoke, path de firma en Storage, inmutabilidad por trigger). Falta exclusivamente la UI que capture la firma canvas y llame a `createConsentimiento` (0 callers hoy).
- **Mitigation during audit window**:
  - A text-only consent checkbox is captured at first SOAP write (planned for Phase 6b; if 6c slips entirely, this falls back to a manual `consentimiento` row inserted by Lautaro on first contact).
  - Auditors are told the canvas-signature flow ships in post-audit Week 1.
  - Patients who request a copy of their consent receive a manually-prepared PDF from Lautaro until UI lands.
- **Closes in**: post-audit Week 1.

### PostHog full instrumentation beyond business events

- **Status**: catálogo tipado de business events en `lib/observability/events.ts` (Sprint 2 T2.2) + funnel de landing gateado por cookie consent. Wired hoy: `paciente.created`, `booking_public.completed`, `landing.*`. Definidos sin call sites aún: `signup.completed`, `onboarding.completed`, `turno.created`, `turno.closed`, `soap.autosaved`, `documento.uploaded`.
- **Mitigation**: zero analytics during audit window is acceptable (no public users yet); Sentry handles error events.
- **Closes in**: Phase 8 of this sprint + ongoing.

### Accessibility audit

- **Status**: Keyboard nav, ARIA labels, color contrast (especially brass accents on cream) not formally tested.
- **Mitigation**: app is usable via keyboard (forms, tab order); ARIA on critical elements (radiogroup in MoodPicker, modal dialogs in onboarding). Color contrast on body text passes WCAG AA visually; the brass-on-cream of decorative elements (corner-mark, sub-line) is informational and does not carry text.
- **Closes in**: post-audit Week 1 — formal Axe audit.

---

## Documented exceptions (DOC)

These are accepted by-design choices, defensible at audit. Full rationale lives in `docs/audit/encryption-exceptions.md` and `docs/audit/rls-matrix.md`.

### `profile.email` stored plaintext

- **Why**: Supabase Auth dependency. See `encryption-exceptions.md`.

### `paciente_identidad.domicilio_{ciudad,provincia,cp}` stored plaintext

- **Why**: k-anonymity geo cohort for analytics M15/M16. Paired with encrypted name + DNI on same row, geo alone does not re-identify. See `encryption-exceptions.md`.

### `paciente_identidad.fecha_nacimiento`, `sexo_biologico`, `genero_autopercibido` plaintext

- **Why**: clinical relevance (age-banding, biological-sex treatments) + Ley 26.743 obligation to track gender identity separately. See `encryption-exceptions.md`.

### Soft-delete RLS filtering at application layer (not in policies)

- **Why**: by design — `deleted_at` is filtered in `lib/db/*.ts` queries (`.is("deleted_at", null)`). Moving the filter into RLS would prevent admins from viewing soft-deleted entities for recovery purposes, which is a Habeas Data §16 obligation (grace period before hard-delete).
- **Mitigation**: integration tests on `pacientes`, `member`, `organization` flows confirm app-layer filter is consistent. Any agent reading directly via Supabase Studio sees all rows (including soft-deleted) and is responsible for the filter.

### `audit_log` partition retention enforcement

- **Status**: 10-year retention is a Ley 26.529 obligation. No automated cron yet to archive partitions older than 120 months to `audit-archive` Storage bucket (la CREACIÓN de particiones futuras sí está automatizada: cron mensual `/api/cron/maintenance` en `vercel.json` → `audit_log_run_maintenance(6)`); el archival sigue siendo procedimiento manual documentado en `retention.md`.
- **Mitigation**: at current volumes (4 auth users), `audit_log` will not reach the 10-year boundary for several years. Manual archival in 2027+ is acceptable interim.

### Pseudonimización audit trail (DNI SHA-256 preservation)

- **Status**: Landed — M25 (`supabase/migrations/20260521000025_M25_pseudonimizacion_audit.sql`) crea `pseudonimizacion_event` con el SHA-256 del DNI original; integrado al flujo de pseudonimización (M61/M63).

---

## Already closed (WORK)

| Finding | Phase | Status |
|---|---|---|
| C1 Open redirect in /login | 1 | Closed — `safeRedirect()` |
| C4 PII signup consent (Ley 25.326 art. 14) | 4 | Closed — checkbox + M23 columns |
| H1 Security headers missing | 1 | Closed — CSP report-only, HSTS, X-Frame, Referrer, Permissions |
| H5 signup rate-limit + Turnstile | 4 | Closed — limitByIp + verifyTurnstile in action |
| H12 /api/auth/reset missing | 4 | Closed — route 302s to /reset-password page |
| M1 sesion.locked_at unlockable | 2 | Closed — `prevent_sesion_unlock()` trigger |
| M2 (partial) DELETE on financial / clinical-outcome tables | 2 | Closed — 6 new `_no_delete` policies on `pago`, `post_visita`, `cobertura_paciente`, `cargo_suscripcion`, `suscripcion`, `seguro_profesional` |
| M6 Storage bucket UUID validation | 2 | Closed — regex substring match instead of string_to_array |
| M9 Crypto round-trip integration tests | 3 | Closed — 12 node:test cases |
| M16 Blind index UNIQUE | n/a | Pre-existing (FP from Explore) — already in M03 |
| H4 audit_log SELECT org-scoping | n/a | Pre-existing (FP from Explore) — already in M12 |
| H6 integration RLS | n/a | Pre-existing (FP from Explore) — already in M11 |
| H7 consentimiento DELETE prevention | n/a | Pre-existing (FP from Explore) — already in M07 |
| Phase 5 turno CANCEL UI | 5 | Closed — explicit cancel button on every non-terminal turno row, audit_log captures the UPDATE via the M12 trigger |
| Turno CREATE + REAGENDAR UI | post-audit | Closed — `components/hoy/turno-create-modal.tsx` (typeahead paciente + picker profesional CLINICA-3) + `turno-reagendar-modal.tsx`; server actions en `app/(app)/hoy/actions.ts` |
| AFIP WSFEv1 invoicing | post-MVP | Closed — `lib/afip/wsfev1.ts` + `lib/afip/comprobantes.ts` usan `organization.certificado_arca_cifrado`; emisión desde `app/(app)/finanzas/actions.ts`; `AFIP_ENV` selecciona homologación/producción |

---

## Post-audit hardening (Sprint 0 — 2026-05-24)

### A1 — `rejectUnauthorized: false` en cliente pg directo

- **Status**: aceptado como excepción con threat model documentado.
- **Detail**: aplica solo al endpoint admin `/api/admin/migrate` (~10
  invocaciones en la vida del proyecto, gateado con escape hatch). Path
  Vercel↔Supabase, infra cloud privada, MITM = costo alto. La excepción
  completa con threat model + mitigations vive en
  [`docs/audit/encryption-exceptions.md`](./encryption-exceptions.md#a1--rejectunauthorized-false-en-cliente-pg-directo-admin-migrations).
- **Long-term fix (Sprint 3)**: reemplazar el endpoint con `supabase db push`
  vía GitHub Actions OIDC; deshabilita la necesidad de cliente `pg` directo.

### C1 — `/api/admin/migrate?reset=true` escape hatch

- **Status**: closed via dual-factor gate.
- **Detail**: el `?reset=true` ejecuta `DROP SCHEMA public CASCADE`. Histórica-
  mente solo protegido por `Bearer ${CRON_SECRET}`. Sprint 0 Task 0.3 agrega
  un escape hatch obligatorio en producción: `ALLOW_PROD_RESET=yes-im-sure-2026`.
  Sin esa env explícita, el endpoint retorna 403 incluso con Bearer válido.
- **Cómo se usa cuando hace falta**:
  1. Setear `ALLOW_PROD_RESET=yes-im-sure-2026` en Vercel Production env vars.
  2. Trigger redeploy para propagar.
  3. Ejecutar el `curl ?reset=true`.
  4. **Inmediatamente** quitar la env + redeploy nuevamente.
- **Long-term fix (Sprint 3)**: reemplazar el endpoint completo con
  `supabase db push` ejecutado vía GitHub Actions con OIDC.

---

## Open questions for the auditor (transparency)

1. **Plaintext geo for k-anonymity**: do you accept the trade-off, or require encrypting `domicilio_{ciudad,provincia,cp}` with a per-org decrypt key for analytics? (Folio's current position: the trade-off is defensible. If you object, the cipher-column migration M23a from the deferred plan can land in 1-2 days.)
2. **Soft-delete RLS filtering**: app-layer vs RLS layer for `deleted_at IS NULL` — accept the design rationale (Habeas Data §16 recovery)?
3. **PostHog cookie consent**: cookie banner ships Phase 6b. Are post-launch users sufficient as the first cohort, or do we need pre-launch banner for any visitor?
4. **Sentry PII scrubbing in dev**: `sentry.{client,server,edge}.config.ts` all scrub `event.request.data` in `beforeSend`. Confirm this satisfies your Ley 25.326 reading on telemetry.

Lautaro signs off below at Phase 9 freeze:

```
Founder approval — date:                     signature:
```
