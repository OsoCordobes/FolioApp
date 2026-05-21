# Folio · Consent Flow (Ley 25.326 + Ley 26.529)

Two consent layers, captured at different moments:

## Layer 1 · PII processing consent (Ley 25.326 art. 14)

**When**: signup (either via `/login` "Crear cuenta" form OR via `/onboarding` Step 1 form).

**What**: explicit checkbox "Acepto el Aviso de Privacidad (Ley 25.326) y los Términos" linking to `/privacidad` + `/terminos`.

**Gates**:
- Client-side: submit button disabled until checkbox ticked.
- Server-side: `signUpAndInitOrganization()` refuses `options.consent !== true`.
- Captcha-side: Turnstile token required in production (`verifyTurnstile()`).
- Rate-limit: 5 signups / IP / hour (`limitByIp("signup", ip, 5)`).

**Persistence**: `profile.consent_pii_*` (M23):
- `consent_pii_signed_at` (timestamptz, NOT NULL via CHECK)
- `consent_pii_text_version` (text, NOT NULL via CHECK — current: `'v1'`)
- `consent_pii_ip` (inet)
- `consent_pii_user_agent` (text)

**Audit trail**: the M12 trigger captures the profile INSERT in `audit_log` with the full row, so the consent timestamp is doubly recorded.

**Visibility to user**: `/configuracion/datos` shows the consent date + text version. The user can export the record (Layer-1 + Layer-2 consents) via the "Descargar JSON" button (Habeas Data §15).

## Layer 2 · Clinical informed consent (Ley 26.529 art. 5–11)

**When**: before the first SOAP `sesion` is written for a paciente (post-audit Week 1 UI; text-only fallback during audit window).

**What**: signed consent form per `plantilla_consentimiento` template. Canvas-drawn signature uploaded to `consentimientos-firmados` bucket (Storage RLS-gated to same org).

**Persistence**: `consentimiento` table (M07):
- `paciente_id`, `plantilla_id`, `tipo`, `firmado_en`, `firma_storage_path`, `firmado_por_tutor_id`, `ip`, `user_agent`.
- Append-only via trigger `consentimiento_prevent_critical_update()`.
- Cannot be deleted (RLS `consentimiento_no_delete`).

**Revocation**: `revocado_en` + `revocado_motivo` columns. Revocation is itself appended (timestamp-only); the original consent row is preserved for audit.

**Status during audit window**: the **UI for canvas-signature capture is deferred** to post-audit Week 1. During the audit window, clinicians defer first-SOAP-write for net-new pacientes OR record consent manually in Supabase Studio. See `known-gaps.md` §"Patient clinical consent UI (Phase 6c)" for the fallback procedure.

## Layer 3 · Cookie consent (Argentina e-Commerce + GDPR best practice)

**When**: first visit to any Folio page.

**What**: fixed-bottom banner offering "Aceptar analytics" / "Solo esenciales".

**Persistence**: `localStorage.folio.cookieConsent` ∈ {`granted`, `denied`}.

**Effect**: PostHog SDK init is gated on `granted`. Supabase auth cookie is "strictly necessary" → no consent required. Banner does NOT block the rest of the page (overlaps fixed-bottom; tests pre-dismiss via init script).

## Data flow diagram

```
User visits /login or /onboarding
     │
     ▼
Cookie banner (Layer 3) — fixed-bottom, dismissible
     │
     ▼
Signup form:
  - Email + Password
  - Consent checkbox (Layer 1) — REQUIRED
  - Turnstile widget (production) — REQUIRED
     │ submit
     ▼
signUpAndInitOrganization()
  - limitByIp("signup", ip, 5)
  - verifyTurnstile(token, ip)
  - validate consent === true
  - service-role: auth.admin.createUser
  - service-role: INSERT organization
  - service-role: INSERT profile (with consent_pii_*)
  - service-role: INSERT member (role=OWNER)
     │
     ▼
Onboarding steps 2–9 (org details, mood, logo, etc.)
     │
     ▼
/hoy dashboard
     │
     ▼
First clinical contact with a paciente:
  - Consent capture modal (Layer 2) — post-audit Week 1
  - During audit window: manual record
     │
     ▼
SOAP sesion editor opens
```

## Tests

- `tests/e2e/auth.spec.ts` — 3 cases (signup happy path, bad creds, already-exists banner)
- `tests/e2e/signup-consent-ratelimit.spec.ts` — 5 cases (consent disabled-state, consent text reference Ley 25.326, /onboarding step 1 has consent, /reset-password reachable, /api/auth/reset redirects)
- `tests/unit/crypto-roundtrip.test.ts` — 12 cases covering encrypt/decrypt of PII columns

## Sample data flow for the auditor

Re-create the consent record for a new test account:

```sql
-- 1. After signup, inspect the profile row
SELECT id, email, consent_pii_signed_at, consent_pii_text_version, consent_pii_ip
  FROM profile
 WHERE email = '<test-email>';

-- 2. Inspect the corresponding audit_log entry
SELECT ts, actor_id, action, payload
  FROM audit_log
 WHERE resource_type = 'profile'
   AND payload->>'id' = '<profile-id>';
```
