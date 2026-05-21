-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M23 · profile.consent_* (Ley 25.326 art. 14 explicit consent)
-- ════════════════════════════════════════════════════════════════════════════
-- Adds explicit PII-processing consent tracking on the professional's
-- profile row. Set at signup (signUpAndInitOrganization) when the user
-- accepts the privacy policy checkbox. The clinical-consent flow for
-- pacientes lives separately in the existing `consentimiento` table
-- (M07); these new columns are for the PROFESSIONAL's own consent to
-- have their PII processed by Folio.
--
-- Ley 25.326 art. 14 requires explicit, informed consent before processing
-- personal data. Without these columns, the auditor has no DB-level
-- evidence that the user agreed.
--
-- Backfill: existing profiles (pre-M23) receive the timestamp of M23
-- application as a presumed consent date with text_version='legacy-pre-m23'.
-- This is the audit-defensible position: the user signed up under the
-- prior privacy policy that was visible on /privacidad, and we record
-- the migration moment as the canonical consent timestamp.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS consent_pii_signed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS consent_pii_text_version text,
  ADD COLUMN IF NOT EXISTS consent_pii_ip           inet,
  ADD COLUMN IF NOT EXISTS consent_pii_user_agent   text;

-- Backfill existing rows with a legacy marker so we never have unmarked profiles.
UPDATE profile
   SET consent_pii_signed_at    = COALESCE(consent_pii_signed_at, created_at),
       consent_pii_text_version = COALESCE(consent_pii_text_version, 'legacy-pre-m23')
 WHERE consent_pii_signed_at IS NULL;

-- After backfill, make signed_at + text_version NOT NULL for new rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profile_consent_signed_required'
  ) THEN
    ALTER TABLE profile
      ADD CONSTRAINT profile_consent_signed_required
      CHECK (consent_pii_signed_at IS NOT NULL AND consent_pii_text_version IS NOT NULL);
  END IF;
END$$;

COMMENT ON COLUMN profile.consent_pii_signed_at IS
  'Folio · timestamp del momento en el que el profesional aceptó el aviso de privacidad (Ley 25.326 art. 14). NULL → profile inválido (CHECK).';
COMMENT ON COLUMN profile.consent_pii_text_version IS
  'Folio · versión del aviso de privacidad aceptado (p.ej. v1, v2). Permite saber qué texto exactamente firmó cada usuario cuando el aviso cambie. "legacy-pre-m23" → backfill al aplicar M23.';
COMMENT ON COLUMN profile.consent_pii_ip IS
  'Folio · IP del cliente en el momento de la aceptación (audit trail Ley 25.326).';
COMMENT ON COLUMN profile.consent_pii_user_agent IS
  'Folio · User-Agent del navegador en el momento de la aceptación (audit trail).';
