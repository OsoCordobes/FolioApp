-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M24 · profile.deletion_requested_at (Ley 25.326 art. 16 right-to-erasure)
-- ════════════════════════════════════════════════════════════════════════════
-- Adds a soft-delete request marker. The user clicks "Eliminar cuenta" in
-- /configuracion/datos → action sets deletion_requested_at = now() and an
-- email is sent confirming the 30-day grace period.
--
-- The hard-delete cron (`/api/cron/account-purge`) runs daily at 03:00 UTC
-- and processes profiles whose deletion_requested_at < now() - interval
-- '30 days'. Hard-delete = cascade-anonymize via the existing pseudonymize
-- procedure (M13) on each paciente of every org the profile owns, then
-- physical delete of the profile and member rows.
--
-- The 30-day grace honors Habeas Data §16 (user can withdraw the request).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_reason       text;

CREATE INDEX IF NOT EXISTS profile_deletion_due_idx
  ON profile (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;

COMMENT ON COLUMN profile.deletion_requested_at IS
  'Folio · timestamp del request de eliminación de cuenta (Ley 25.326 art. 16). NULL = sin pedido pendiente. NOT NULL = el cron de purga hard-delete a los 30 días.';
COMMENT ON COLUMN profile.deletion_reason IS
  'Folio · razón opcional del usuario para borrar la cuenta. Audit trail.';
