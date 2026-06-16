-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M61 · Erasure fix: pseudonimizar_paciente borra contactos + tutores
-- ════════════════════════════════════════════════════════════════════════════
-- Brecha de cumplimiento (Ley 25.326 art. 16 — derecho al olvido / supresión):
--
--   El cuerpo ORIGINAL de pseudonimizar_paciente (M13, líneas 134-136) borraba
--   físicamente la PII de terceros asociada al paciente:
--
--       DELETE FROM contacto_emergencia WHERE paciente_id = p_paciente_id;
--       DELETE FROM tutor_legal         WHERE paciente_id = p_paciente_id;
--
--   M25 (audit trail) hizo CREATE OR REPLACE de TODO el cuerpo para sumar el
--   row append-only en pseudonimizacion_event, y al reescribirlo PERDIÓ esos
--   dos DELETE. M60 (intake avanzado) extendió el cuerpo de M25 sin recuperarlos.
--   Resultado: el proc vigente (M60) borra paciente_identidad + intake avanzado
--   pero NO contacto_emergencia ni tutor_legal. Esas tablas guardan PII de
--   TERCEROS (nombre/teléfono/DNI cifrados de contactos de emergencia y
--   representantes legales), keyeadas por paciente_id, y SOBREVIVÍAN a la
--   pseudonimización → la supresión quedaba incompleta.
--
-- Fix (DB-only): redefinir pseudonimizar_paciente (cuerpo vigente = M60) verbatim
--   re-agregando los dos DELETE y exponiendo sus conteos en el dry-run y en el
--   resultado. RLS y grants quedan iguales (CREATE OR REPLACE preserva los
--   privilegios; las tablas se borran vía SECURITY DEFINER, igual que ya hace
--   M60 con paciente_intake_avanzado pese a su política no_delete USING(false)).
--   Se mantiene SECURITY DEFINER + SET search_path = public. Todos los objetos
--   referenciados pre-existen → sin check_function_bodies off.
-- ════════════════════════════════════════════════════════════════════════════

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
  v_intake_borrados   int;
  v_contactos_borrados int;
  v_tutores_borrados  int;
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
      'intake_avanzado_a_borrar', (SELECT count(*) FROM paciente_intake_avanzado WHERE paciente_id = p_paciente_id),
      'contactos_emergencia_a_borrar', (SELECT count(*) FROM contacto_emergencia WHERE paciente_id = p_paciente_id),
      'tutores_legales_a_borrar', (SELECT count(*) FROM tutor_legal WHERE paciente_id = p_paciente_id),
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

  -- M60: borrar físicamente el intake avanzado (PHI/PII directa + de terceros).
  DELETE FROM paciente_intake_avanzado WHERE paciente_id = p_paciente_id;
  GET DIAGNOSTICS v_intake_borrados = ROW_COUNT;

  -- M61: re-borrar la PII de terceros (contactos de emergencia + tutores
  -- legales) que M13 borraba y M25 había perdido al reescribir el cuerpo.
  DELETE FROM contacto_emergencia WHERE paciente_id = p_paciente_id;
  GET DIAGNOSTICS v_contactos_borrados = ROW_COUNT;
  DELETE FROM tutor_legal WHERE paciente_id = p_paciente_id;
  GET DIAGNOSTICS v_tutores_borrados = ROW_COUNT;

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
    'intake_avanzado_borrados', v_intake_borrados,
    'contactos_emergencia_borrados', v_contactos_borrados,
    'tutores_legales_borrados', v_tutores_borrados,
    'pseudonimizacion_event_recorded', v_dni_hash IS NOT NULL
  );
END
$$;

COMMENT ON FUNCTION public.pseudonimizar_paciente(uuid, text, boolean) IS
  'Folio · M13 + M25 + M60 + M61 · pseudonimización de paciente. Borra paciente_identidad + paciente_intake_avanzado + contacto_emergencia + tutor_legal (PII propia y de terceros), marca paciente.pseudonimizado_en, y graba pseudonimizacion_event con SHA-256 del DNI + nombre. SECURITY DEFINER; solo OWNER/DIRECTOR.';
