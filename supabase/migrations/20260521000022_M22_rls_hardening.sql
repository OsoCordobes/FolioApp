-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M22 · RLS hardening (pre-audit sprint Phase 2)
-- ════════════════════════════════════════════════════════════════════════════
-- Closes the legitimate gaps surfaced by the pre-audit Explore scan.
-- Several findings the scan flagged were FALSE POSITIVES — already correctly
-- handled in earlier migrations (audit_log SELECT org-scoping, integration
-- table RLS, paciente/diagnostico/alergia/medicacion/contacto/tutor/documento
-- /consentimiento/turno/transicion no_delete policies, sesion locked_guard
-- trigger). See docs/audit/rls-matrix.md for the full matrix and the FP list.
--
-- Real gaps fixed here:
--
--   1. sesion.locked_at IMMUTABILITY (the trigger in M10 prevents field
--      changes when locked, but does NOT prevent setting locked_at back
--      to NULL — i.e. "unlocking". Without this, the append-only guarantee
--      of Ley 26.529 art. 15/18 is technically bypassable.)
--
--   2. APPEND-ONLY DELETE PREVENTION on financial / clinical-outcome /
--      legal-record tables that lacked an explicit no_delete policy:
--        - pago                (payment record, financial audit)
--        - post_visita         (clinical outcome of a turno)
--        - cobertura_paciente  (insurance assignment audit)
--        - cargo_suscripcion   (billing payment record)
--        - suscripcion         (billing state audit)
--        - seguro_profesional  (RCP legal record)
--      None of these are deleted from the app code (verified via grep);
--      blocking DELETE removes a tampering vector without breaking flows.
--
--   3. STORAGE BUCKET UUID VALIDATION TIGHTENING (M21 org-logos bucket
--      compared organization_id::text to (string_to_array(name,'/'))[1].
--      A malformed path with garbage in the first segment could in
--      theory match an org-id under specific cast edge cases. Tighten
--      with an explicit regex for the UUID shape.)
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. sesion.locked_at immutability ────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_sesion_unlock()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL AND NEW.locked_at IS NULL THEN
    RAISE EXCEPTION 'Sesión bloqueada no se puede desbloquear. locked_at es append-only (Ley 26.529 art. 15/18). Usá sesion_enmienda para correcciones.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS sesion_lock_immutable_trg ON sesion;
CREATE TRIGGER sesion_lock_immutable_trg
  BEFORE UPDATE ON sesion
  FOR EACH ROW EXECUTE FUNCTION prevent_sesion_unlock();

COMMENT ON FUNCTION prevent_sesion_unlock() IS
  'Folio · M22 · Refuerza el append-only del lock de sesión. Una vez locked, no se puede des-lockear ni siquiera por OWNER. Para correcciones se usa sesion_enmienda.';

-- ─── 2. DELETE prevention on financial / outcome / legal records ─────────

CREATE POLICY pago_no_delete                 ON pago                 FOR DELETE USING (false);
CREATE POLICY post_visita_no_delete          ON post_visita          FOR DELETE USING (false);
CREATE POLICY cobertura_paciente_no_delete   ON cobertura_paciente   FOR DELETE USING (false);
CREATE POLICY cargo_suscripcion_no_delete    ON cargo_suscripcion    FOR DELETE USING (false);
CREATE POLICY suscripcion_no_delete          ON suscripcion          FOR DELETE USING (false);
CREATE POLICY seguro_profesional_no_delete   ON seguro_profesional   FOR DELETE USING (false);

COMMENT ON POLICY pago_no_delete                 ON pago                 IS
  'Folio · M22 · Pagos son audit financiero — no se borran. Para revertir, INSERT pago con monto negativo.';
COMMENT ON POLICY post_visita_no_delete          ON post_visita          IS
  'Folio · M22 · Outcome clínico del turno. No se borra (Ley 26.529 retención 10 años).';
COMMENT ON POLICY cobertura_paciente_no_delete   ON cobertura_paciente   IS
  'Folio · M22 · Asignación de obra social al paciente. No se borra (audit).';
COMMENT ON POLICY cargo_suscripcion_no_delete    ON cargo_suscripcion    IS
  'Folio · M22 · Cargo de suscripción facturado. No se borra (audit financiero).';
COMMENT ON POLICY suscripcion_no_delete          ON suscripcion          IS
  'Folio · M22 · Estado de suscripción org. No se borra (audit del lifecycle de cobro).';
COMMENT ON POLICY seguro_profesional_no_delete   ON seguro_profesional   IS
  'Folio · M22 · Póliza RCP del profesional. No se borra (legal trail).';

-- ─── 3. Storage bucket UUID validation tightening (M21 → M22) ───────────

DROP POLICY IF EXISTS "org-logos owner-or-director write" ON storage.objects;
CREATE POLICY "org-logos owner-or-director write"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'org-logos'
    AND auth.uid() IS NOT NULL
    AND substring(name FROM '^([0-9a-f-]{36})/') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.member m
      WHERE m.profile_id = auth.uid()
        AND m.organization_id::text = substring(name FROM '^([0-9a-f-]{36})/')
        AND m.role IN ('OWNER', 'DIRECTOR')
        AND m.deleted_at IS NULL
    )
  )
  WITH CHECK (
    bucket_id = 'org-logos'
    AND auth.uid() IS NOT NULL
    AND substring(name FROM '^([0-9a-f-]{36})/') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.member m
      WHERE m.profile_id = auth.uid()
        AND m.organization_id::text = substring(name FROM '^([0-9a-f-]{36})/')
        AND m.role IN ('OWNER', 'DIRECTOR')
        AND m.deleted_at IS NULL
    )
  );
