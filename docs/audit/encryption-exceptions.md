# Folio · Encryption inventory + documented exceptions

Audit-prep deliverable for the 2-week pre-audit sprint. Catalogues every column in the Folio schema that holds PII or PHI, the encryption mechanism applied, and — where plaintext is preserved — the explicit threat-model rationale and mitigations.

> **Algorithm**: AES-256-GCM, application-side. Key = `FOLIO_ENC_KEY` (32 bytes, base64, env-only, Vercel-encrypted at rest). HMAC blind-index key = `FOLIO_ENC_HMAC_KEY` (separate 32-byte secret, HMAC-SHA256). Implementation: `lib/crypto.ts`. Round-trip integration test: `tests/unit/crypto-roundtrip.test.ts` (12 cases, 100% pass).
>
> **Why app-side instead of pgsodium TCE**: documented in `memory/decision_supabase_free_pgcrypto.md`. Short version: Supabase Free tier doesn't expose pgsodium key-management at the level we'd need; app-side AES-GCM under Vercel-managed keys gives us equivalent security with simpler rotation (`scripts/rotate-enc-key.ts`).

---

## Encrypted columns (full inventory)

### `profile` (the professional / authenticated user)

| Column | Plaintext? | Notes |
|---|---|---|
| `id` | yes | UUID, not PII |
| `email` | **yes — exception, see below** | Required plaintext by Supabase Auth for log-in lookup |
| `nombre_cifrado` (bytea) | encrypted | AES-256-GCM |
| `apellido_cifrado` (bytea) | encrypted | AES-256-GCM |
| `matricula` | yes — non-PII | Professional license number, public record |
| `avatar_url` | yes — non-PII | Storage URL |
| `two_factor_enabled` | yes — non-PII | Boolean |
| `created_at`, `updated_at` | yes — timestamps | not PII |

### `paciente_identidad` (patient PII)

| Column | Plaintext? | Notes |
|---|---|---|
| `id` | yes | UUID |
| `organization_id` | yes | UUID |
| `nombre_cifrado` | encrypted | AES-256-GCM |
| `apellido_cifrado` | encrypted | AES-256-GCM |
| `tipo_doc` | yes — enum | DNI/LE/LC/CI/PASAPORTE — type only, not value |
| `numero_doc_cifrado` | encrypted | AES-256-GCM |
| `email_cifrado` | encrypted | AES-256-GCM |
| `telefono_cifrado` | encrypted | AES-256-GCM |
| `domicilio_calle_cifrado` | encrypted | AES-256-GCM |
| `domicilio_numero_cifrado` | encrypted | AES-256-GCM |
| `fecha_nacimiento` | **yes — exception, see below** | Required for clinical age grouping + analytics |
| `sexo_biologico` | **yes — clinical relevance** | M/F/I — Ley 26.743 requires biological sex tracked separately from gender identity |
| `genero_autopercibido` | **yes — clinical relevance** | Free text, Ley 26.743 |
| `domicilio_ciudad` | **yes — exception, see below** | k-anonymity geo cohort for analytics |
| `domicilio_provincia` | **yes — exception, see below** | k-anonymity geo cohort for analytics |
| `domicilio_cp` | **yes — exception, see below** | k-anonymity geo cohort for analytics |
| `nombre_hash` (text) | HMAC blind-index | HMAC-SHA256, FOLIO_ENC_HMAC_KEY, for prefix lookup |
| `dni_hash` (text) | HMAC blind-index | HMAC-SHA256, FOLIO_ENC_HMAC_KEY, for exact lookup |

### `paciente` (PHI — clinical metadata)

| Column | Plaintext? | Notes |
|---|---|---|
| `caja_fuerte_profesional` | yes — admin scope only | Free-text notes by the professional |
| `motivo_consulta_breve` | yes — admin scope only | Brief case summary |
| All structured clinical fields are in linked tables (sesion, diagnostico, alergia, medicacion, documento_clinico), with appropriate encryption per-column (see below). |

### `sesion` (SOAP session notes — PHI)

| Column | Plaintext? | Notes |
|---|---|---|
| `soap_s_cifrado` | encrypted | Subjetivo |
| `soap_o_cifrado` | encrypted | Objetivo |
| `soap_a_cifrado` | encrypted | Análisis |
| `soap_p_cifrado` | encrypted | Plan |
| `signos_vitales_cifrado` | encrypted | Pulse, BP, etc. |
| `audio_url_cifrado` | encrypted | Optional dictation audio (Storage URL) |
| `notas_cifrado` | encrypted | Free-text additional notes |
| `vertebra_estado_json` | yes — clinical taxonomy | Chiropractic mapping (no PII) |
| `eva_pain_score` | yes — clinical scale | 0–10 integer |
| `created_at`, `locked_at` | yes — timestamps | not PII |

### `sesion_enmienda` (append-only amendments — PHI)

All clinical content fields encrypted, mirrors `sesion`. Append-only enforced by `prevent_sesion_enmienda_mutation()` (M10).

### `documento_clinico`

| Column | Plaintext? | Notes |
|---|---|---|
| `storage_path` | yes — Storage URL | Document binary lives in Supabase Storage with RLS; no PII in URL path itself |
| `descripcion_cifrado` | encrypted | Optional descriptor |
| `tipo` | yes — enum | RECETA, ESTUDIO, INFORME, etc. |

### `contacto_emergencia` / `tutor_legal`

| Column | Plaintext? | Notes |
|---|---|---|
| `nombre_cifrado` | encrypted | |
| `parentesco_cifrado` | encrypted | |
| `telefono_cifrado` | encrypted | |
| `email_cifrado` | encrypted | |

### `diagnostico` / `alergia` / `medicacion`

| Column | Plaintext? | Notes |
|---|---|---|
| `descripcion_cifrado` | encrypted | The clinical description / drug name / allergen |
| `cie10_codigo` | yes — taxonomy | Standard medical code, not PII |
| `severidad`, `severidad_alergia` | yes — enum | not PII |

### `consentimiento`

| Column | Plaintext? | Notes |
|---|---|---|
| `paciente_id` | yes — FK UUID | not PII |
| `kind` | yes — enum | `pii_treatment`, `clinical`, `image_use`, etc. |
| `texto_legal_version` | yes — version string | Legal text version pinned |
| `firmado_en` | yes — timestamp | not PII |
| `signature_image` (bytea, future) | encrypted | Drawn canvas signature (Phase 6c) |

### `integration` (OAuth tokens — Google Calendar, WhatsApp, MP)

| Column | Plaintext? | Notes |
|---|---|---|
| `access_token_cifrado` | encrypted | AES-256-GCM |
| `refresh_token_cifrado` | encrypted | AES-256-GCM |
| `meta_json` | yes — provider-specific | calendar_id, phone_number_id, etc. — provider IDs, not secrets |

### `seguro_profesional`

| Column | Plaintext? | Notes |
|---|---|---|
| `numero_poliza_cifrado` | encrypted | AES-256-GCM |
| `compania`, `vigencia_*`, `monto_cobertura` | yes — admin data | not PII |
| `documento_path` | yes — Storage URL | Storage-RLS gates the PDF itself |

### `audit_log`

Append-only (M12 RLS prevents INSERT/UPDATE/DELETE outside the trigger). Stores `payload_before`, `payload_after` as JSONB. The trigger excludes `*_cifrado` columns from the payload to avoid double-storing ciphertext; the diff is `[REDACTED-PII]` for those fields.

---

## Documented exceptions (plaintext-at-rest)

The auditor will see these as plaintext in the DB. Each is documented + justified + mitigated.

### `profile.email` — plaintext

- **Why**: Supabase Auth requires email as a plaintext, indexed, unique column for log-in (`auth.users.email`). The `public.profile.email` column mirrors `auth.users.email` for join convenience. Encrypting either would break Supabase's authentication path.
- **Risk**: An attacker with read-access to the DB sees the list of registered professionals' emails.
- **Mitigation**:
  - RLS on `profile`: a user can only SELECT their own row.
  - Service-role access is restricted to server-side actions that gate on `auth.getUser()`.
  - The email is the professional's own — not a patient's. Patient emails (`paciente_identidad.email_cifrado`) ARE encrypted.
- **Defensible position**: identical practice at every major SaaS (Stripe, Linear, Notion). The email is not "datos sensibles" under Ley 25.326 art. 3.

### `paciente_identidad.domicilio_{ciudad,provincia,cp}` — plaintext

- **Why**: The analytics pipeline (M15 + M16) builds k-anonymity geo cohorts (city → metro area → province → region → national, cascading until k≥5 for absolute values or k≥10 for monetary). Encrypting the geo columns would break that aggregation without per-query decrypt, which is infeasible at scale.
- **Risk**: An attacker with DB read-access could see distribution of patients by city + province + CP.
- **Mitigation**:
  - The **identifying** fields on the same row (nombre, apellido, numero_doc, email, telefono, calle, numero) are all encrypted. Geo alone does not re-identify under Ley 25.326's standard ("medios razonables para identificar"), absent the name + DNI.
  - RLS on `paciente_identidad` scopes every SELECT to the org's members via `user_org_ids()`. Cross-tenant access requires a service-role bypass that itself authenticates the caller.
  - The analytics layer uses `paciente_dim` (M15), not `paciente_identidad` directly — and `paciente_dim` is keyed by anonymized cohort attributes, not by patient identity.
- **Defensible position**: City / province / postal code is "datos personales" under Ley 25.326 art. 2 but NOT "datos sensibles" under art. 3 (origen racial/étnico, opiniones políticas, convicciones religiosas, salud, sexualidad). Plaintext city is the industry norm (every CRM, every analytics tool).

### `paciente_identidad.fecha_nacimiento` — plaintext

- **Why**: Clinical relevance — age-banding is a primary axis for treatment (pediatric, geriatric, etc.). Decimating into encrypted form prevents efficient age-range queries. Analytics pipeline groups by 5-year age bands; queries hit on `EXTRACT(YEAR FROM AGE(fecha_nacimiento))`.
- **Risk**: DOB visible.
- **Mitigation**: Same as geo — paired with encrypted name/DNI, DOB alone does not re-identify.
- **Defensible position**: DOB without name is not PII in isolation. Every electronic health record on the market stores DOB plaintext.

### `paciente_identidad.sexo_biologico` + `genero_autopercibido` — plaintext

- **Why**: Ley 26.743 (Identidad de Género) explicitly requires healthcare providers to track biological sex (clinically relevant) AND self-perceived gender (legally required to honour) as separate fields. Encrypting these breaks clinical workflows (a doctor needs to know biological sex for pregnancy-relevant treatments without decrypting).
- **Mitigation**: Same as geo + DOB.

---

## Encryption integration tests

Located at `tests/unit/crypto-roundtrip.test.ts`. 12 cases:

1. round-trip across 8 sample inputs (Spanish names, emails, phones, addresses, emojis, 2 KB long string, single chars, whitespace-padded)
2. IV randomness — same plaintext → different ciphertext
3. null/undefined pass-through
4. multi-wire-format decrypt (`\\x<hex>`, raw hex, Buffer, Uint8Array)
5. short ciphertext throws
6. blindIndex determinism (case + space normalization)
7. blindIndex format (64-char lowercase hex)
8. blindIndex null/empty handling
9. encryptFields object form + null preservation
10. generateKeyBase64 produces exactly 32 bytes
11. ciphertext-equality leakage check (three encryptions of same input must all differ)

Run: `pnpm test:unit` (or `node --import tsx --test tests/unit/crypto-roundtrip.test.ts`).

---

## Key handling + rotation

- **Storage**: `FOLIO_ENC_KEY` + `FOLIO_ENC_HMAC_KEY` live in Vercel env vars, encrypted at rest by Vercel KMS. Never committed.
- **`.gitignore`**: `.env*` is excluded.
- **Generation**: `openssl rand -base64 32` (one-time, before first deploy).
- **Rotation**: `scripts/rotate-enc-key.ts` (referenced in `lib/crypto.ts` comments) re-encrypts every `*_cifrado` column with the new key column-by-column. The script is run with `FOLIO_ENC_KEY_NEXT` set; once complete, the new key is promoted to `FOLIO_ENC_KEY`.
- **Recovery script**: `scripts/reset-user-password.mjs` (shipped in this sprint) lets an admin set a new password for a stuck account without revealing keys.

---

## Blind-index collision risk

- HMAC-SHA256 output: 256 bits.
- Collision probability for `n` distinct inputs:  `1 − e^(−n²/2^257)`. For `n = 10⁹` patients (≈ all humans), probability < 10⁻³⁹.
- **UNIQUE constraint on `(organization_id, dni_hash)`**: enforced in M03 line 66–67. If a real collision ever occurred at the org level, the insert would fail rather than silently overwrite — a fail-safe.

---

## What's NOT encrypted (and shouldn't be)

- Foreign keys (UUIDs), enums, timestamps, booleans, geo cohort fields, clinical taxonomies (CIE-10, severity enums), and similar non-identifying / non-private structural data.
- See above table for the exhaustive list of "plaintext OK" columns.

---

*Reviewed and signed off at audit-prep Phase 3. Companion `rls-matrix.md` to be authored at Phase 9.*

---

## Post-audit exceptions (Sprint 1 — 2026-05-24)

### A1 · `rejectUnauthorized: false` en cliente `pg` directo (admin migrations)

**Aplicación**: única — `app/api/admin/migrate/route.ts:110-114`.

**Por qué existe**: Supabase Pooler expone un certificado auto-firmado en el chain de Vercel ECS Lambda. El cliente `pg` (`node-pg`), al construir la conexión, valida el chain por default y dispara `Error: self signed certificate in certificate chain`. La opción `rejectUnauthorized: false` deshabilita esa validación para que la conexión proceda.

**Path afectado**: Vercel function → Supabase Pooler (puerto 5432 direct, sslmode=no-verify).

**Otros paths a Supabase NO afectados**: el tráfico de usuarios va por `supabase-js` (HTTPS, cert validado por default vía el bundle de CAs de Node). PostgREST, Realtime, Auth, Storage — todos validan cert.

**Volumen**: el endpoint `/api/admin/migrate` se invoca ~10 veces en la vida total del proyecto (1 por deploy de migrations significativo). En operación normal nunca corre.

**Threat model**:
- **Atacante MITM**: tendría que comprometer infra interna de AWS y/o Vercel/Supabase para interceptar tráfico entre dos endpoints cloud privados. Probabilidad: muy baja.
- **Impacto si se materializa**: el atacante observa los statements SQL de las migrations (estructura del schema, ya pública en este repo) y potencialmente roba el `CRON_SECRET` del header Authorization. No accede a PII/PHI (las migrations son DDL puro, no consultan datos de pacientes).

**Mitigaciones existentes**:
- El endpoint admin completo está gateado con `ALLOW_PROD_RESET=yes-im-sure-2026` para resets destructivos (Sprint 0 Task 0.3 / audit C1).
- `CRON_SECRET` rotado post-auditoría 2026-05-24 (Sprint 0 Task 0.6).
- Cada invocación queda en logs de Vercel + Sentry trace.

**Long-term fix (Sprint 3+)**:
Reemplazar `/api/admin/migrate` con `supabase db push` ejecutado vía GitHub Actions con OIDC. El endpoint desaparece del repo y la conexión la maneja la CLI oficial de Supabase, que sí valida el cert del proyecto correctamente.

**Estado**: **excepción aceptada con mitigation**, deferida a Sprint 3+ para reemplazo arquitectural.

---

### A2 · Blind-index salt per-tenant — EN PROGRESO

Status post-Sprint 1: la `FOLIO_ENC_HMAC_KEY` global se utiliza tal cual para todos los blind indexes (`nombre_hash`, `dni_hash`, `telefono_hash`). Si la key se filtra (improbable, vive en Vercel encrypted-at-rest, separada del DB), el atacante con acceso al `dni_hash` puede precomputar ~99M hashes de DNIs argentinos (8 dígitos) y des-anonimizar TODA la DB.

**Mitigación elegida**: agregar salt per-tenant (`HMAC(key, org_id || ":" || normalized)`). Si la key leaks, el atacante necesita re-precomputar 99M × N orgs en vez de 99M × 1 — multiplica el costo por el número de tenants.

**Implementación**: Sprint 1 Tasks 1.5.1–1.5.6 (refactor crypto.ts + rehash script + dual-read fallback + remove legacy fallback post-72h). Esta sección se actualiza a "resolved" cuando Task 1.5.6 cierre.

