-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M93 · pseudonimizar_paciente vuelve a exigir que el actor sea member
-- ════════════════════════════════════════════════════════════════════════════
-- EL AGUJERO QUE CIERRA (crítico · borrado irreversible de PII/PHI):
--
-- El cuerpo vigente (M70, cadena M13+M25+M45+M60+M61+M63+M73+M70) resuelve el
-- rol del actor así:
--
--     SELECT role, id INTO v_actor_role, v_actor_member_id
--       FROM member
--      WHERE profile_id = v_actor_id
--        AND organization_id = v_org_id
--        AND deleted_at IS NULL;
--     IF v_actor_role NOT IN ('OWNER', 'DIRECTOR') THEN RAISE EXCEPTION …
--
-- Cuando ese SELECT devuelve CERO filas, plpgsql deja `v_actor_role` en NULL y
-- `NULL NOT IN ('OWNER','DIRECTOR')` NO evalúa a true: evalúa a NULL. El IF no
-- entra, la función sigue de largo y ejecuta la supresión — que es DEFINITIVA:
-- DELETE de paciente_identidad, paciente_intake_avanzado, contacto_emergencia,
-- tutor_legal e instrumento_respuesta. La función es SECURITY DEFINER (bypassa
-- RLS) y tiene GRANT EXECUTE TO authenticated, así que la llama cualquier
-- usuario logueado vía PostgREST.
--
-- El resultado es una autorización INVERTIDA: el member ACTIVO con rol bajo
-- (ASISTENTE, PROFESIONAL, COORDINADOR) es rechazado correctamente, pero
--   · un ex-empleado con member.deleted_at seteado,
--   · cualquier member de OTRA organización,
--   · cualquier usuario autenticado sin ningún member,
-- caen en el caso "0 filas" y PASAN. Sólo hace falta conocer el uuid del
-- paciente para borrarle la PII/PHI a una org ajena, sin vuelta atrás.
--
-- El guard existía en M13 (`IF v_actor_role IS NULL THEN RAISE`) y se perdió en
-- el rewrite de M25; ninguno de los rewrites posteriores (M45/M60/M61/M63/M73/
-- M70) lo reintrodujo.
--
-- QUÉ CAMBIA: se re-declara el cuerpo VERBATIM de M70 y se agrega, antes del
-- chequeo de rol, el guard explícito de membership con ERRCODE 42501
-- (insufficient_privilege → `forbidden` en lib/db/errors.ts). Nada más: los
-- DELETE, el audit-trail, la rama service_role del cron /api/cron/account-purge
-- y el jsonb de salida quedan idénticos.
--
-- (Regla append-only: NO se edita M70; se REDEFINE con CREATE OR REPLACE, que
-- este archivo aplica DESPUÉS por su prefijo …095.)
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
  v_instrumentos_borrados int;
  v_tenia_cuenta       boolean;
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
    -- M93: sin esta rama, 0 filas dejaba v_actor_role en NULL y el chequeo de
    -- abajo (NULL NOT IN (…) ⇒ NULL) no bloqueaba: ex-empleados (deleted_at),
    -- members de otra org y usuarios sin membership alguna borraban PII/PHI
    -- ajena. El membership se exige ANTES que el rol.
    IF v_actor_role IS NULL THEN
      RAISE EXCEPTION 'pseudonimizar_paciente: actor no es member de la organización del paciente'
        USING ERRCODE = '42501';
    END IF;
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

  -- M70: ¿el paciente tenía una cuenta portal linkeada? (para el resumen).
  SELECT (cuenta_id IS NOT NULL) INTO v_tenia_cuenta
    FROM paciente WHERE id = p_paciente_id;

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
      'instrumento_respuesta_a_borrar', (SELECT count(*) FROM instrumento_respuesta WHERE paciente_id = p_paciente_id),
      'cuenta_link_a_desvincular', coalesce(v_tenia_cuenta, false),
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

  -- M73: borrar físicamente las respuestas de instrumentos clínicos (PHI). Las
  -- filas pueden estar lockeadas (append-only): la supresión legal (Ley 25.326
  -- art. 16) prevalece sobre el lock → el DELETE corre en SECURITY DEFINER y el
  -- lock guard sólo bloquea UPDATE, no DELETE (además instrumento_respuesta_no_delete
  -- es RLS, y esta función es DEFINER/BYPASSRLS).
  DELETE FROM instrumento_respuesta WHERE paciente_id = p_paciente_id;
  GET DIAGNOSTICS v_instrumentos_borrados = ROW_COUNT;

  UPDATE paciente
     SET identidad_id    = NULL,
         -- M70: romper el link con la cuenta portal (identificador que ata la
         -- ficha a un humano reconocible). No se borra la paciente_cuenta (es
         -- cross-org); sólo se desvincula ESTA ficha.
         cuenta_id       = NULL,
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
    'instrumento_respuesta_borrados', v_instrumentos_borrados,
    'cuenta_link_desvinculado', coalesce(v_tenia_cuenta, false),
    'pseudonimizacion_event_recorded', v_dni_hash IS NOT NULL
  );
END
$$;

-- Privilegios idénticos a los que fijó M45 (CREATE OR REPLACE preserva la ACL;
-- se re-declaran para que el archivo sea autoexplicativo y replayable solo).
REVOKE ALL     ON FUNCTION public.pseudonimizar_paciente(uuid, text, boolean) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.pseudonimizar_paciente(uuid, text, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.pseudonimizar_paciente(uuid, text, boolean) IS
  'Folio · M13 + M25 + M45 + M60 + M61 + M63 + M73 + M70 + M93 · pseudonimización de paciente. Borra paciente_identidad + paciente_intake_avanzado + contacto_emergencia + tutor_legal + instrumento_respuesta, DESVINCULA el link cuenta_id de la cuenta portal (M70), marca paciente.pseudonimizado_en, y graba pseudonimizacion_event con SHA-256 del DNI + nombre. SECURITY DEFINER. M93: exige que el actor humano SEA member activo de la org del paciente (42501) ANTES de chequear el rol — sin eso, 0 filas dejaba v_actor_role NULL y NULL NOT IN (…) no bloqueaba (ex-empleados y members de otra org borraban PII ajena). Callers: UI (OWNER/DIRECTOR, valida membership) y cron account-purge (service_role, auth.uid() NULL → performed_by NULL).';
