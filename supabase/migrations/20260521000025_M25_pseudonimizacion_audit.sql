-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M25 · Pseudonimización audit trail + integration_active view
-- ════════════════════════════════════════════════════════════════════════════
-- 1. pseudonimizacion_event (append-only) — captures SHA-256 hash of
--    (DNI + name) before paciente_identidad is deleted. Lets auditors
--    verify "pseudonymization happened for THIS DNI" without preserving
--    plaintext.
-- 2. integration_active view — filters integration to non-expired tokens
--    so code paths can `.from('integration_active')` and avoid stale
--    token use.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE pseudonimizacion_event (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organization(id) ON DELETE RESTRICT,
  paciente_id       uuid NOT NULL,
  dni_sha256        text NOT NULL,
  nombre_sha256     text NOT NULL,
  performed_at      timestamptz NOT NULL DEFAULT now(),
  performed_by      uuid REFERENCES profile(id) ON DELETE RESTRICT,
  motivo            text NOT NULL CHECK (length(motivo) >= 3),

  CONSTRAINT pseudonimizacion_dni_hash_len CHECK (length(dni_sha256) = 64),
  CONSTRAINT pseudonimizacion_nombre_hash_len CHECK (length(nombre_sha256) = 64)
);

CREATE INDEX pseudonimizacion_event_org_idx ON pseudonimizacion_event (organization_id, performed_at DESC);
CREATE INDEX pseudonimizacion_event_dni_idx ON pseudonimizacion_event (dni_sha256);

COMMENT ON TABLE pseudonimizacion_event IS
  'Folio · M25 · audit-trail append-only de cada pseudonimización. Conserva SOLO hashes SHA-256 (DNI + nombre) — el plaintext nunca se preserva. Permite reconstruir "esta pseudonimización pasó para ESTE DNI" sin re-exponer PII. Ley 25.326 art. 16 + Ley 26.529 retención 10 años.';

ALTER TABLE pseudonimizacion_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE pseudonimizacion_event FORCE  ROW LEVEL SECURITY;

CREATE POLICY pseudonimizacion_event_select_owner ON pseudonimizacion_event FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
  );
CREATE POLICY pseudonimizacion_event_no_direct_insert ON pseudonimizacion_event FOR INSERT WITH CHECK (false);
CREATE POLICY pseudonimizacion_event_no_update         ON pseudonimizacion_event FOR UPDATE USING (false);
CREATE POLICY pseudonimizacion_event_no_delete         ON pseudonimizacion_event FOR DELETE USING (false);

-- Extend pseudonimizar_paciente() to write the audit event.
CREATE OR REPLACE FUNCTION public.pseudonimizar_paciente(
  p_paciente_id   uuid,
  p_motivo        text,
  p_dry_run       boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id            uuid;
  v_actor_id          uuid;
  v_actor_member_id   uuid;
  v_identidad_id      uuid;
  v_actor_role        text;
  v_nombre_hash       text;
  v_dni_hash          text;
  v_resumen           jsonb;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: requiere auth.uid()';
  END IF;
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: motivo requerido (>= 3 caracteres)';
  END IF;

  SELECT p.organization_id, p.identidad_id
    INTO v_org_id, v_identidad_id
    FROM paciente p
   WHERE p.id = p_paciente_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: paciente % no existe', p_paciente_id;
  END IF;

  SELECT role, id INTO v_actor_role, v_actor_member_id
    FROM member
   WHERE profile_id = v_actor_id
     AND organization_id = v_org_id
     AND deleted_at IS NULL;
  IF v_actor_role NOT IN ('OWNER', 'DIRECTOR') THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: rol % no autorizado. Solo OWNER/DIRECTOR.', v_actor_role;
  END IF;

  -- Capture the blind-index hashes BEFORE deletion (M25 audit trail).
  IF v_identidad_id IS NOT NULL THEN
    SELECT nombre_hash, dni_hash
      INTO v_nombre_hash, v_dni_hash
      FROM paciente_identidad
     WHERE id = v_identidad_id;
  END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'paciente_id', p_paciente_id,
      'organization_id', v_org_id,
      'actor_role', v_actor_role,
      'motivo', p_motivo,
      'dry_run', true,
      'identidad_id', v_identidad_id,
      'would_record_event', v_dni_hash IS NOT NULL AND v_nombre_hash IS NOT NULL
    );
  END IF;

  IF v_dni_hash IS NOT NULL AND v_nombre_hash IS NOT NULL THEN
    INSERT INTO pseudonimizacion_event
      (organization_id, paciente_id, dni_sha256, nombre_sha256, performed_by, motivo)
    VALUES
      (v_org_id, p_paciente_id, v_dni_hash, v_nombre_hash, v_actor_id, p_motivo);
  END IF;

  IF v_identidad_id IS NOT NULL THEN
    DELETE FROM paciente_identidad WHERE id = v_identidad_id;
  END IF;

  UPDATE paciente
     SET identidad_id    = NULL,
         pseudonimizado_en = now()
   WHERE id = p_paciente_id;

  RETURN jsonb_build_object(
    'paciente_id', p_paciente_id,
    'organization_id', v_org_id,
    'actor_role', v_actor_role,
    'motivo', p_motivo,
    'dry_run', false,
    'identidad_id_borrada', v_identidad_id,
    'pseudonimizacion_event_recorded', v_dni_hash IS NOT NULL
  );
END
$$;

COMMENT ON FUNCTION public.pseudonimizar_paciente(uuid, text, boolean) IS
  'Folio · M13 + M25 · pseudonimización de paciente. Borra paciente_identidad, marca paciente.pseudonimizado_en, y graba un row append-only en pseudonimizacion_event con SHA-256 del DNI + nombre. SECURITY DEFINER; rol validado internamente (solo OWNER/DIRECTOR).';

-- ─── integration_active view ───────────────────────────────────────────

CREATE OR REPLACE VIEW integration_active AS
SELECT *
  FROM integration
 WHERE expira_ts IS NULL OR expira_ts > now();

COMMENT ON VIEW integration_active IS
  'Folio · M25 · integration filtrado a tokens no expirados. Code paths usan esta vista para evitar tokens revocados/expirados. RLS heredada de integration.';
