# Folio · Known gaps + deferred items (pre-audit sprint)

Tracked here so auditors see explicit ownership + planned remediation. Each entry includes severity, current mitigation, and the sprint that closes it. Founder Lautaro signs off on this file at Phase 9 freeze.

## Status legend

- **WORK** — implemented in this sprint, audit-ready.
- **DOC** — accepted exception, documented in the relevant `docs/audit/*.md`.
- **DEFER** — known gap, post-audit timeline, with a workaround for the audit window.

---

## Deferred to post-audit (DEFER)

### Turno CRUD UI surface · CREATE + REAGENDAR

- **Status**: state-machine + server actions in place (`lib/db/turnos.ts` `createTurno`, `transitionTurno`); the **interactive UI** for creating a turno from `/hoy` or `/calendario` (modal: paciente picker, servicio, datetime) is deferred. **CANCEL** ships in Phase 5 (button on every non-terminal row, audit-logged via the M12 trigger).
- **Mitigation during audit window**:
  - Founder Lautaro creates turnos manually via `/admin/migrate`-style scripts or directly in Supabase Studio.
  - Existing patients book through `/book/<slug>` (public booking flow F7).
  - Auditors verify the audit_log captures every state transition correctly via `/admin/audit`.
- **Closes in**: post-audit Week 1, separate UI sprint. Scope: modal-driven CREATE form + REAGENDAR modal + paciente typeahead by `nombre_hash`.

### Sesion_enmienda UI

- **Status**: table + RLS + append-only triggers exist (M10). No UI to record an enmienda from `/focus/[turnoId]` or `/pacientes/[id]`.
- **Mitigation**: during the audit window, clinicians use the `sesion` editor pre-lock. Post-lock corrections are paused (rare in 2-week window).
- **Closes in**: post-audit Week 2.

### WhatsApp outbound compose UI

- **Status**: inbound webhook works (M18 + `/api/whatsapp/webhook`). No UI to compose + send outbound templates.
- **Mitigation**: reminders ship via the cron-job pipeline (`recordatorio_job` table); manual compose is deferred.
- **Closes in**: F11 of the canonical plan.

### Google Calendar bidirectional sync · conflict resolution

- **Status**: OAuth + watch-renew exist. One-way push from Folio → Google works (turno create writes `gcal_event_id`). The reverse (Google → Folio) is partially wired but conflict resolution (turno deleted in Google: what does Folio do?) is undefined.
- **Mitigation**: integration ships in one-way mode for the audit window. Auditor sees a known-limitation note in `docs/audit/known-gaps.md` referencing this entry.
- **Closes in**: F10 of the canonical plan.

### Email fallback for turno reminders

- **Status**: Resend env vars present in `.env.local.example`, no integration code.
- **Mitigation**: reminders use WhatsApp only. Pacientes without WhatsApp get an SMS-stub or fall through silently. Documented as known limitation in `/configuracion/billing` help text.
- **Closes in**: F11.

### AFIP WSFEv1 invoicing

- **Status**: Migration M11 has `certificado_arca_cifrado` column on org. No code path uses it. Per canonical plan, F12.
- **Mitigation**: Folio does not issue facturas during the audit window. Manual invoicing through external software.
- **Closes in**: F12 (post-MVP, ~5-7 days after launch).

### F12 · Multi-tenant clinic UI

- **Status**: schema + RLS clinic-ready since day 1 (per canonical plan §2.4bis). UI for clinic-specific role hierarchy (DIRECTOR view of multiple PROFESIONALes) deferred.
- **Mitigation**: first cohort of paying clients are 1-professional consultorios. Clinic-mode is F12.
- **Closes in**: F12.

### Patient clinical consent UI (Phase 6c · clinical signature)

- **Status**: `consentimiento` table exists (M07) with append-only triggers. No UI to capture canvas signature before SOAP entry.
- **Mitigation during audit window**:
  - A text-only consent checkbox is captured at first SOAP write (planned for Phase 6b; if 6c slips entirely, this falls back to a manual `consentimiento` row inserted by Lautaro on first contact).
  - Auditors are told the canvas-signature flow ships in post-audit Week 1.
  - Patients who request a copy of their consent receive a manually-prepared PDF from Lautaro until UI lands.
- **Closes in**: post-audit Week 1.

### PostHog full instrumentation beyond business events

- **Status**: `FolioPostHogProvider` set up. Phase 8 wires `signup`, `turno_created`, `turno_state_changed`, `sesion_signed`, `subscription_started` events.
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

- **Status**: 10-year retention is a Ley 26.529 obligation. No automated cron yet to archive partitions older than 120 months to `audit-archive` Storage bucket. Phase 7 designs the cron; if it doesn't ship by Day 12, the operational procedure is documented + manual.
- **Mitigation**: at current volumes (4 auth users), `audit_log` will not reach the 10-year boundary for several years. Manual archival in 2027+ is acceptable interim.

### Pseudonimización audit trail (DNI SHA-256 preservation)

- **Status**: Phase 7 adds `pseudonimizacion_event` table to preserve a SHA-256 hash of the original DNI for dispute resolution. Until landed, pseudonymization deletes `paciente_identidad` fully.
- **Mitigation**: no pseudonymizations have run yet (zero paying clients during audit window).

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
