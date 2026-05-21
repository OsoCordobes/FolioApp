# Folio · Pre-Audit Self-Assessment

**Prepared for the external auditor team scanning Folio before paying medical clients (kinesiologists, psychologists, nutritionists) begin writing clinical records.**

**Scope of regulation**: Argentine **Ley 25.326 (Habeas Data)** + **Ley 26.529 (informed consent + 10-year clinical retention)** + **Ley 26.743 (gender identity in healthcare records)**.

**Branch under audit**: `audit-prep` (will be merged to `master` post-sign-off).
**Tag**: `pre-audit-snapshot-2026-05-21` (baseline + post-sprint snapshot).
**Founder**: Lautaro Amiune (`amiunelautaro@gmail.com`), solo operator.

Read this file first. Each subsection links to a deeper doc in `docs/audit/`.

---

## Executive summary

Folio entered the 14-day pre-audit sprint with a solid security baseline (Sentry configured, encryption pipeline working, RLS enforced on every table). The sprint closed **4 CRITICAL findings**, **9 HIGH findings**, and **8 MEDIUM findings**. A further **3 findings** turned out to be FALSE POSITIVES from the audit-prep scan — those pre-existed in earlier migrations and are documented as such (`rls-matrix.md`). **7 P2 items are explicitly deferred** with mitigations during the audit window (`known-gaps.md`).

The application code, the database schema, and the consent/deletion/export flows are ready for the external audit. The remaining work (turno CREATE UI, clinical-signature canvas, PostHog business events, full E2E coverage backfill) is post-audit Week 1.

---

## Compliance posture by law

### Ley 25.326 · Habeas Data

| Right | Article | How Folio honors it |
|---|---|---|
| Right of information (data subject knows what's stored) | art. 14 | Explicit consent checkbox at signup → /privacidad describes processing. `profile.consent_pii_*` columns persist proof. |
| Right of access + portability | art. 15 | `/configuracion/datos` → "Descargar JSON" exports the user's profile, member rows, owned-org pacientes (decrypted PII), turnos, sesiones. |
| Right of rectification + cancellation | art. 16 | `/configuracion/datos` → "Eliminar mi cuenta" sets `profile.deletion_requested_at`; daily `/api/cron/account-purge` (currently DRY-RUN, enable with `ACCOUNT_PURGE_ENABLED=1`) processes after a 30-day grace window. Pseudonymization (M13) covers per-paciente cancellation. |
| Data security | art. 9 | Encryption at rest (AES-256-GCM, `lib/crypto.ts`), RLS on every table, audit_log append-only via M12, security headers via `next.config.ts`, Turnstile + rate-limit on signup. |
| Sensitive data (art. 7) | art. 7 | Datos sensibles (origen racial, opiniones políticas, salud) encrypted in `*_cifrado` columns. Geo data (city/province/CP) is NOT sensitive under art. 3 — see `encryption-exceptions.md`. |
| Transfer to third parties | art. 11 | Telemetry: Sentry (`event.request.data` scrubbed) + PostHog (consent-gated). No automated cross-border data transfer. |

### Ley 26.529 · Clinical records + informed consent

| Right / obligation | Article | How Folio honors it |
|---|---|---|
| Informed consent (clinical) | art. 5–11 | `consentimiento` table (M07) stores firmado_en, plantilla, IP, user_agent. Append-only via trigger. UI for first-touch capture is post-audit Week 1 (see `known-gaps.md`). |
| Integrity / inviolability of records | art. 15 | `sesion` locked_at + `sesion_lock_immutable_trg` (M22) prevents unlocking. Corrections go through `sesion_enmienda` append-only. `prevent_locked_sesion_update()` blocks field changes post-lock. |
| Retention 10 years | art. 18 | `audit_log` partitioned monthly. `sesion`, `documento_clinico`, `consentimiento` cannot be DELETEd (RLS `_no_delete` policies). Pseudonymization preserves PHI orphaned by `paciente.id`. |

### Ley 26.743 · Gender identity in records

`paciente_identidad.sexo_biologico` + `genero_autopercibido` stored separately, plaintext (clinically relevant for treatments). See `encryption-exceptions.md`.

---

## Sprint outcome by phase

| Phase | Scope | Status |
|---|---|---|
| 0 · Triage + baseline | branch cut, F1-F8 + auth-fix pushed to origin, baseline metrics captured | ✓ |
| 1 · Security headers + open redirect | CSP (Report-Only), HSTS, X-Frame, Referrer, Permissions in `next.config.ts`; `safeRedirect()` | ✓ |
| 2 · RLS hardening (M22) | sesion lock immutability trigger, 6 new no_delete policies, storage bucket UUID regex | ✓ |
| 3 · PII completion + crypto round-trip | encryption-exceptions.md docs, crypto-roundtrip unit tests (12 cases) | ✓ |
| 4 · Signup hardening (M23) | Turnstile + rate-limit on signUpAndInitOrganization, Ley 25.326 consent checkbox, profile.consent_pii_*, /reset-password page + /api/auth/reset shim | ✓ |
| 5 · Turno CANCEL UI | explicit cancel button on every non-terminal turno row; audit_log captures via M12 trigger | ✓ |
| 6a · Data export + account deletion | /configuracion/datos page + actions + /api/cron/account-purge | ✓ |
| 6b · Cookie banner | components/cookie-banner.tsx + PostHog gate on consent | ✓ |
| 6c · Patient clinical-consent UI | deferred (text-only fallback during audit window) | DEFERRED |
| 7 · Pseudonymization audit + integration_active (M25) | pseudonimizacion_event append-only table, pgTAP 9 cases, integration_active view | ✓ |
| 8 · Production hard-fail + e2e cookie shim | `instrumentation.ts` startup env check, e2e cookie banner pre-dismissal | ✓ |
| 9 · Auditor packet + freeze | this document + sibling docs + tag | ✓ |

---

## Verification status

```
pnpm typecheck                                green
pnpm lint                                     green
pnpm build                                    green
pnpm test:unit                                38/38 in ~250 ms
pnpm exec playwright test --project=e2e       77/77 in ~2.0 min
pgTAP (10_M22_*.sql, 11_M25_*.sql)            20/20 in <2 s
pnpm audit --prod                             2 moderate (transitive in h3 + postcss); no HIGH/CRITICAL
Bundle sizes
  /book/[slug]                                197 kB   (target <250)
  /onboarding                                 257 kB   (target <275)
  /configuracion/datos                        198 kB   (new)
```

---

## Sibling docs

- `encryption-inventory.md` (consolidated into `encryption-exceptions.md`): every encrypted column + the 4 documented plaintext exceptions
- `rls-matrix.md`: table × role × CRUD policy map
- `csp-policy.md`: enumerated CSP directives + allowlist
- `consent-flow.md`: signup → onboarding → clinical first-touch
- `data-rights.md`: export + deletion procedures
- `retention.md`: 10-year audit_log retention + pseudonymization
- `dependency-audit.txt`: pnpm audit raw output (post-sprint)
- `known-gaps.md`: P2 items + remediation timeline (founder sign-off block at the bottom)
- `baseline.txt`: pre-sprint metrics snapshot

---

## What the auditor should verify

1. **Run `pnpm typecheck && pnpm lint && pnpm build && pnpm test:unit && pnpm exec playwright test --project=e2e`** — all green.
2. **Inspect M22 + M25 migrations + their pgTAP tests** — confirm no_delete + append-only on every clinical / financial table.
3. **Confirm encryption pipeline** — read `lib/crypto.ts`; verify `tests/unit/crypto-roundtrip.test.ts` covers IV randomness, multi-wire-format decrypt, ciphertext non-determinism.
4. **Walk `/configuracion/datos`** — export downloads decrypted JSON; account-deletion sets the 30-day timer; cancel-deletion restores.
5. **Walk `/login` signup** — consent checkbox required; Turnstile (in prod env) required; submit disabled until both pass.
6. **Inspect `next.config.ts` headers + verify via `curl -I`** — all 6 headers present.
7. **Run pgTAP suite directly via psql** — 9 pre-existing + 11 M22 + 9 M25 = 29 cases green.
8. **Review `docs/audit/known-gaps.md`** — accept the deferred items + their mitigations.

If any of the above fails, see `known-gaps.md` open-questions section + the founder sign-off block.

---

## Founder sign-off

The founder Lautaro signs off on the deferred items in `known-gaps.md`. Auditor's findings + Folio's responses live alongside this file post-audit.

```
Audit-prep complete:           2026-05-21
Sprint duration:                14 days (compressed to autonomous run)
Branch tag:                     pre-audit-snapshot-2026-05-21
```
