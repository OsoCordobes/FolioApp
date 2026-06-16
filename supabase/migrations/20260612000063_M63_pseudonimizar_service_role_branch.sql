-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M63 · pseudonimizar_paciente: restaura la rama service_role (cron purga)
-- ════════════════════════════════════════════════════════════════════════════
-- Regresión funcional (la purga post-grace de 30 días nunca corre):
--
--   M45 (security hardening) había agregado a pseudonimizar_paciente una rama
--   para permitir la invocación con service_role (auth.uid() = NULL), porque el
--   cron /api/cron/account-purge la llama con el cliente service-role (sin JWT
--   de usuario) para suprimir la PII de cada paciente de las orgs del titular
--   borrado (Ley 25.326 art. 16, derecho a la supresión tras el período de
--   gracia). Sin esa rama el proc abortaba con "requiere auth.uid()".
--
--   M60 (intake avanzado) reescribió el cuerpo a partir del de M25 y PERDIÓ la
--   rama service_role. M61 (borra contactos + tutores) extendió el cuerpo de
--   M60 verbatim, arrastrando la regresión. Resultado: el cuerpo vigente (M61)
--   arranca con
--
--       IF v_actor_id IS NULL THEN
--         RAISE EXCEPTION 'pseudonimizar_paciente: requiere auth.uid()';
--
--   y como el cron invoca con service_role (auth.uid() NULL), tira excepción por
--   CADA paciente → la purga nunca completa.
--
-- Fix (DB-only, additive): CREATE OR REPLACE sobre el cuerpo vigente (M61),
--   re-injectando el patrón de detección de service_role de M45 verbatim:
--
--       v_is_service := v_actor_id IS NULL
--                       AND coalesce(auth.role(), '') = 'service_role';
--
--   Cuando v_is_service:
--     · no se exige auth.uid();
--     · v_actor_role := 'service_role' (se saltea el lookup en member y el guard
--       OWNER/DIRECTOR — el cron ya corre con un rol privilegiado / BYPASSRLS);
--     · performed_by del pseudonimizacion_event queda NULL (el motivo documenta
--       que fue el cron de purga; la columna es nullable desde M25).
--   Todo lo demás (los DELETE de paciente_identidad + paciente_intake_avanzado +
--   contacto_emergencia + tutor_legal, el insert del audit-trail, el dry-run y
--   el jsonb de retorno) queda IDÉNTICO a M61.
--
-- SECURITY DEFINER + SET search_path = public. RLS y grants SIN cambios
-- (CREATE OR REPLACE preserva los privilegios; authenticated + service_role ya
-- tienen EXECUTE desde M45). Todos los objetos referenciados pre-existen → sin
-- check_function_bodies off.
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
  v_org_id             uuid;
  v_actor_id           uuid;
  v_actor_member_id    uuid;
  v_identidad_id       uuid;
  v_actor_role         text;
  v_is_service         boolean;
  v_nombre_hash        text;
  v_dni_hash           text;
  v_intake_borrados    int;
  v_contactos_borrados int;
  v_tutores_borrados   int;
BEGIN
  v_actor_id := auth.uid();
  -- M45/M63: el cron /api/cron/account-purge invoca con service_role (sin JWT de
  -- usuario → auth.uid() = NULL). Antes esto abortaba con "requiere auth.uid()"
  -- y la purga post-grace de 30 días (Ley 25.326 art. 16) nunca corría.
  v_is_service := v_actor_id IS NULL AND coalesce(auth.role(), '') = 'service_role';
  IF v_actor_id IS NULL AND NOT v_is_service THEN
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

  IF v_is_service THEN
    v_actor_role := 'service_role';
  ELSE
    SELECT role, id INTO v_actor_role, v_actor_member_id
      FROM member
     WHERE profile_id = v_actor_id
       AND organization_id = v_org_id
       AND deleted_at IS NULL;
    IF v_actor_role NOT IN ('OWNER', 'DIRECTOR') THEN
      RAISE EXCEPTION 'pseudonimizar_paciente: rol % no autorizado. Solo OWNER/DIRECTOR.', v_actor_role;
    END IF;
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
  'Folio · M13 + M25 + M45 + M60 + M61 + M63 · pseudonimización de paciente. Borra paciente_identidad + paciente_intake_avanzado + contacto_emergencia + tutor_legal (PII propia y de terceros), marca paciente.pseudonimizado_en, y graba pseudonimizacion_event con SHA-256 del DNI + nombre. SECURITY DEFINER. Callers: UI (OWNER/DIRECTOR, valida membership) y cron account-purge (service_role, auth.uid() NULL → performed_by NULL).';
