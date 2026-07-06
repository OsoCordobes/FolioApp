-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M73 · instrumento_respuesta (respuestas de escalas clínicas)
-- ════════════════════════════════════════════════════════════════════════════
-- Keystone de la biblioteca de instrumentos (Fase 1 · C2). Cada fila es UNA
-- aplicación de un instrumento validado (DASS-21, PCL-5, NDI, ODI, Borg, PHQ-9,
-- GAD-7, C-SSRS, objetivos SMART — definiciones puras en lib/instrumentos/) a un
-- paciente, en una sesión o como pre-admisión (sesion_id NULL). Decisión de
-- arquitectura del plan: tabla DEDICADA (no dentro de sesion.tool_data_cifrado)
-- → habilita planillas completadas por el paciente, reuso cross-especialidad y
-- series longitudinales baratas.
--
--   respuestas_cifrado  bytea   · JSON de respuestas crudas, cifrado app-side
--                                 (AES-256-GCM, lib/crypto). Es PHI: las
--                                 respuestas de una escala de salud mental /
--                                 dolor son datos sensibles → nunca plaintext en
--                                 reposo, mismo trato que sesion.soap_*.
--   score_total   int NULL  · snapshot del puntaje total EN CLARO. Es un entero
--                             derivado (no reversible a las respuestas) → se deja
--                             en claro a propósito para graficar series sin
--                             descifrar N filas por render (SerieEvolucion, C3).
--   banda         text NULL · snapshot de la banda de severidad EN CLARO (id
--                             estable de la def: "moderado", "alto"…). Igual que
--                             score_total: derivado, para series/badges baratos.
--   instrumento_id/version    · id versionado de la def (p. ej. "dass21.v1") +
--                               versión numérica; permiten re-scorear y detectar
--                               drift de def. NO hay FK (las defs viven en git,
--                               no en la DB) — la app valida el id contra el
--                               registry (lib/instrumentos) antes de insertar.
--   completado_por text  · 'profesional' | 'paciente' (pre-admisión).
--   locked_at     timestamptz NULL · una vez seteado, la fila es inmutable
--                             (espejo de sesion.locked_at, Ley 26.529 art. 15):
--                             las respuestas de un instrumento aplicado son parte
--                             de la HC y no se editan retroactivamente; para
--                             corregir se aplica el instrumento de nuevo.
--
-- Convenciones espejadas de M60 (paciente_intake_avanzado): validate_same_org
-- dedicado, set_updated_at, audit_log_trigger, RLS clinical-scoped idéntica
-- (select/update por can_read_clinical; insert/update-check por OWNER/PROFESIONAL/
-- DIRECTOR; no_delete). El trigger de lock es el espejo de
-- prevent_locked_sesion_update (M10): post-lock ningún cambio de datos.
--
-- ERASURE: la tabla tiene PHI (respuestas de escalas clínicas keyeadas por
-- paciente_id). Como M60, se REDEFINE pseudonimizar_paciente sumando el DELETE de
-- esta tabla. El cuerpo se copia VERBATIM del vigente (M63) y sólo se AGREGA el
-- DELETE nuevo (regla append-only).
--
-- Append-only / portabilidad: la tabla + sus funciones referencian sólo objetos
-- pre-existentes (organization, paciente, sesion, member helpers RLS,
-- set_updated_at, audit_log_trigger). NO referencia tablas de migraciones
-- posteriores → NO necesita `set check_function_bodies = off`. Sin índices ni
-- EXCLUDE con expresiones no-IMMUTABLE. Replay-safe en postgres:16 vanilla y bajo
-- pgTAP.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE instrumento_respuesta (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  paciente_id         uuid NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,
  -- Opcional: NULL = aplicación de pre-admisión (sin sesión asociada todavía).
  -- ON DELETE SET NULL: borrar la sesión no destruye la aplicación del
  -- instrumento (parte de la HC del paciente).
  sesion_id           uuid REFERENCES sesion(id) ON DELETE SET NULL,

  -- Def del instrumento (vive en git, lib/instrumentos — sin FK). La app valida
  -- instrumento_id contra el registry antes de insertar.
  instrumento_id      text NOT NULL,
  instrumento_version int  NOT NULL,

  -- Respuestas crudas cifradas app-side (PHI). JSON serializado del shape que
  -- espera la def (number[] / boolean[] / objeto estructurado).
  respuestas_cifrado  bytea,

  -- Snapshot del score EN CLARO (derivado, no reversible) para series baratas.
  score_total         int,
  banda               text,

  completado_por      text NOT NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  locked_at           timestamptz,

  CONSTRAINT instrumento_respuesta_completado_por_valido
    CHECK (completado_por IN ('profesional', 'paciente')),
  CONSTRAINT instrumento_respuesta_version_positiva
    CHECK (instrumento_version >= 1),
  CONSTRAINT instrumento_respuesta_instrumento_id_len
    CHECK (length(instrumento_id) BETWEEN 1 AND 80),
  CONSTRAINT instrumento_respuesta_banda_len
    CHECK (banda IS NULL OR length(banda) BETWEEN 1 AND 60)
);

CREATE INDEX instrumento_respuesta_org_idx ON instrumento_respuesta (organization_id);
CREATE INDEX instrumento_respuesta_paciente_idx ON instrumento_respuesta (paciente_id);
-- Serie longitudinal por paciente + instrumento (SerieEvolucion, C3):
-- filtra por (paciente_id, instrumento_id) y ordena por created_at.
CREATE INDEX instrumento_respuesta_serie_idx
  ON instrumento_respuesta (paciente_id, instrumento_id, created_at);
CREATE INDEX instrumento_respuesta_sesion_idx
  ON instrumento_respuesta (sesion_id) WHERE sesion_id IS NOT NULL;

COMMENT ON TABLE instrumento_respuesta IS
  'Folio M73 · una aplicación de un instrumento clínico (lib/instrumentos) a un paciente. respuestas_cifrado = JSON AES-256-GCM (PHI); score_total/banda = snapshot en claro (derivado) para series longitudinales. Append-only post-lock (Ley 26.529). Borrado en pseudonimizar_paciente.';
COMMENT ON COLUMN instrumento_respuesta.respuestas_cifrado IS
  'M73 · respuestas crudas del instrumento, JSON cifrado app-side (AES-256-GCM). PHI: nunca plaintext en reposo. El scoring canónico se recomputa server-side desde estas respuestas al guardar (lib/db/instrumentos.ts).';
COMMENT ON COLUMN instrumento_respuesta.score_total IS
  'M73 · snapshot EN CLARO del puntaje total (entero derivado, no reversible). En claro a propósito: grafica series sin descifrar N filas por render.';
COMMENT ON COLUMN instrumento_respuesta.banda IS
  'M73 · snapshot EN CLARO de la banda de severidad (id estable de la def, ej. "moderado"). Derivado; para badges/series baratos.';
COMMENT ON COLUMN instrumento_respuesta.locked_at IS
  'M73 · una vez seteado, la fila es inmutable (trigger prevent_locked_instrumento_respuesta_update, espejo de sesion). Corregir = aplicar el instrumento de nuevo.';

-- ─── Triggers ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION instrumento_respuesta_validate_same_org()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM paciente p
    WHERE p.id = NEW.paciente_id
      AND p.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'instrumento_respuesta.paciente_id debe coincidir en org con el paciente';
  END IF;
  -- Si hay sesión, debe pertenecer a la misma org (evita cruzar respuestas de
  -- un paciente con una sesión de otro tenant/paciente).
  IF NEW.sesion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sesion s
    WHERE s.id = NEW.sesion_id
      AND s.organization_id = NEW.organization_id
      AND s.paciente_id = NEW.paciente_id
  ) THEN
    RAISE EXCEPTION 'instrumento_respuesta.sesion_id debe coincidir en org y paciente';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER instrumento_respuesta_same_org_guard
  BEFORE INSERT OR UPDATE OF paciente_id, organization_id, sesion_id ON instrumento_respuesta
  FOR EACH ROW EXECUTE FUNCTION instrumento_respuesta_validate_same_org();

CREATE TRIGGER instrumento_respuesta_set_updated_at
  BEFORE UPDATE ON instrumento_respuesta
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER instrumento_respuesta_audit
  AFTER INSERT OR UPDATE OR DELETE ON instrumento_respuesta
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

-- ─── Lock enforcement (espejo de prevent_locked_sesion_update, M10) ──────────
-- Una vez locked_at IS NOT NULL, ningún cambio de datos clínicos (respuestas,
-- score, banda, instrumento, paciente/sesión). Permitido: el NO-OP y el propio
-- lock (NULL → not NULL). Para corregir se aplica el instrumento de nuevo.

CREATE OR REPLACE FUNCTION prevent_locked_instrumento_respuesta_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    IF NEW.respuestas_cifrado  IS DISTINCT FROM OLD.respuestas_cifrado
       OR NEW.score_total      IS DISTINCT FROM OLD.score_total
       OR NEW.banda            IS DISTINCT FROM OLD.banda
       OR NEW.instrumento_id   IS DISTINCT FROM OLD.instrumento_id
       OR NEW.instrumento_version IS DISTINCT FROM OLD.instrumento_version
       OR NEW.completado_por   IS DISTINCT FROM OLD.completado_por
       OR NEW.locked_at        IS DISTINCT FROM OLD.locked_at
       OR NEW.paciente_id      IS DISTINCT FROM OLD.paciente_id
       OR NEW.sesion_id        IS DISTINCT FROM OLD.sesion_id
    THEN
      RAISE EXCEPTION 'Instrumento bloqueado (locked_at=%). Aplicá el instrumento de nuevo para corregir (Ley 26.529 art. 15).', OLD.locked_at;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER instrumento_respuesta_locked_guard
  BEFORE UPDATE ON instrumento_respuesta
  FOR EACH ROW EXECUTE FUNCTION prevent_locked_instrumento_respuesta_update();

-- ─── RLS (clinical-scoped, espejo de M60/paciente_intake_avanzado) ───────────

ALTER TABLE instrumento_respuesta ENABLE ROW LEVEL SECURITY;
ALTER TABLE instrumento_respuesta FORCE  ROW LEVEL SECURITY;

CREATE POLICY instrumento_respuesta_select_clinical
  ON instrumento_respuesta FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  );

CREATE POLICY instrumento_respuesta_insert_clinical
  ON instrumento_respuesta FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'PROFESIONAL', 'DIRECTOR')
  );

CREATE POLICY instrumento_respuesta_update_clinical
  ON instrumento_respuesta FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'PROFESIONAL', 'DIRECTOR')
  );

CREATE POLICY instrumento_respuesta_no_delete
  ON instrumento_respuesta FOR DELETE
  USING (false);

-- ════════════════════════════════════════════════════════════════════════════
-- Erasure: extender pseudonimizar_paciente (cuerpo vigente = M63) para borrar
-- físicamente las respuestas de instrumentos del paciente. Cuerpo copiado de M63
-- VERBATIM + el DELETE FROM instrumento_respuesta y un contador en el resumen.
-- (Regla append-only: NO se edita M63; se REDEFINE con CREATE OR REPLACE.)
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
      'instrumento_respuesta_a_borrar', (SELECT count(*) FROM instrumento_respuesta WHERE paciente_id = p_paciente_id),
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
    'pseudonimizacion_event_recorded', v_dni_hash IS NOT NULL
  );
END
$$;

COMMENT ON FUNCTION public.pseudonimizar_paciente(uuid, text, boolean) IS
  'Folio · M13 + M25 + M45 + M60 + M61 + M63 + M73 · pseudonimización de paciente. Borra paciente_identidad + paciente_intake_avanzado + contacto_emergencia + tutor_legal + instrumento_respuesta (PII propia, de terceros y respuestas de escalas clínicas), marca paciente.pseudonimizado_en, y graba pseudonimizacion_event con SHA-256 del DNI + nombre. SECURITY DEFINER. Callers: UI (OWNER/DIRECTOR, valida membership) y cron account-purge (service_role, auth.uid() NULL → performed_by NULL).';
