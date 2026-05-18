-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M10 · Sesiones SOAP + Enmiendas (append-only enforcement)
-- ════════════════════════════════════════════════════════════════════════════
-- La sesión clínica es la unidad central del historial. Implementa:
--
--   - sesion           · 1:1 con turno · contiene SOAP (Subjetivo/Objetivo/
--                        Analisis/Plan) cifrado + vertebras JSONB + EVA antes/
--                        despues + notas + audio_url + locked_at.
--   - sesion_enmienda  · append-only · cualquier corrección post-locked_at
--                        crea una nueva fila aquí, no toca la sesión original.
--
-- LOCKED_AT ENFORCEMENT (Ley 26.529 art. 15 · inviolabilidad de HC):
--   - Mientras locked_at IS NULL, la sesión se puede editar libremente.
--   - Cuando se setea locked_at (al cerrar el turno + crear post-visita o
--     manualmente), un trigger BEFORE UPDATE/DELETE bloquea cualquier cambio.
--   - Para corregir errores post-lock: SesionEnmienda. La enmienda referencia
--     la sesión y describe qué se corrigió.
--
-- documento_clinico.sesion_id FK la cerramos acá ahora que existe sesion.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE sesion (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  turno_id                 uuid NOT NULL UNIQUE REFERENCES turno(id) ON DELETE CASCADE,
  paciente_id              uuid NOT NULL REFERENCES paciente(id) ON DELETE RESTRICT,

  -- SOAP estructurado, todo cifrado app-side
  soap_s_cifrado           bytea,                              -- Subjetivo
  soap_o_cifrado           bytea,                              -- Objetivo
  soap_a_cifrado           bytea,                              -- Análisis
  soap_p_cifrado           bytea,                              -- Plan

  -- Domain-specific (quiropraxia: mapa vertebral)
  vertebras_json           jsonb NOT NULL DEFAULT '[]',        -- [{ id: "C4", estado: "ajustada" }, ...]
  eva_antes                smallint,                           -- escala 0-10
  eva_despues              smallint,
  notas_cifrado            bytea,                              -- libres

  -- Adjuntos
  audio_url                text,                               -- grabación opcional (Supabase Storage)

  -- Inmutabilidad
  locked_at                timestamptz,
  locked_by_id             uuid REFERENCES member(id) ON DELETE SET NULL,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sesion_eva_valid CHECK (
    (eva_antes IS NULL OR eva_antes BETWEEN 0 AND 10)
    AND (eva_despues IS NULL OR eva_despues BETWEEN 0 AND 10)
  ),
  CONSTRAINT sesion_vertebras_is_array CHECK (jsonb_typeof(vertebras_json) = 'array'),
  CONSTRAINT sesion_locked_consistency
    CHECK ((locked_at IS NULL) = (locked_by_id IS NULL))
);

CREATE INDEX sesion_paciente_idx ON sesion (paciente_id, created_at DESC);
CREATE INDEX sesion_org_locked_idx ON sesion (organization_id, locked_at);
CREATE INDEX sesion_vertebras_gin ON sesion USING gin (vertebras_json jsonb_path_ops);

CREATE TRIGGER sesion_set_updated_at
  BEFORE UPDATE ON sesion FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Validar que paciente y turno coincidan en organización.
CREATE OR REPLACE FUNCTION sesion_validate_same_org()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM turno t
    WHERE t.id = NEW.turno_id
      AND t.organization_id = NEW.organization_id
      AND t.paciente_id = NEW.paciente_id
  ) THEN
    RAISE EXCEPTION 'sesion.turno_id debe coincidir en org y paciente';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER sesion_same_org_guard
  BEFORE INSERT OR UPDATE OF turno_id, paciente_id, organization_id ON sesion
  FOR EACH ROW EXECUTE FUNCTION sesion_validate_same_org();

COMMENT ON TABLE sesion IS
  'Folio · sesión clínica (SOAP estructurado) · 1:1 con turno. Append-only post-lock: una vez locked_at se setea, las correcciones se hacen via sesion_enmienda. Ley 26.529 art. 15.';

-- ─── Append-only enforcement ──────────────────────────────────────────────
-- Una vez locked_at IS NOT NULL, NO se permite UPDATE de campos clínicos
-- ni DELETE. Si se quiere "corregir", se inserta una enmienda.

CREATE OR REPLACE FUNCTION prevent_locked_sesion_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    -- Permitir el setear locked_at de NULL → not NULL (eso ES el lock).
    -- Si ya estaba locked, ningún cambio permitido salvo NO-OP.
    IF NEW.soap_s_cifrado    IS DISTINCT FROM OLD.soap_s_cifrado
       OR NEW.soap_o_cifrado IS DISTINCT FROM OLD.soap_o_cifrado
       OR NEW.soap_a_cifrado IS DISTINCT FROM OLD.soap_a_cifrado
       OR NEW.soap_p_cifrado IS DISTINCT FROM OLD.soap_p_cifrado
       OR NEW.vertebras_json IS DISTINCT FROM OLD.vertebras_json
       OR NEW.eva_antes      IS DISTINCT FROM OLD.eva_antes
       OR NEW.eva_despues    IS DISTINCT FROM OLD.eva_despues
       OR NEW.notas_cifrado  IS DISTINCT FROM OLD.notas_cifrado
       OR NEW.locked_at      IS DISTINCT FROM OLD.locked_at
       OR NEW.turno_id       IS DISTINCT FROM OLD.turno_id
       OR NEW.paciente_id    IS DISTINCT FROM OLD.paciente_id
    THEN
      RAISE EXCEPTION 'Sesión bloqueada (locked_at=%). Usá sesion_enmienda para correcciones (Ley 26.529 art. 15).', OLD.locked_at;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER sesion_locked_guard
  BEFORE UPDATE ON sesion
  FOR EACH ROW EXECUTE FUNCTION prevent_locked_sesion_update();

CREATE OR REPLACE FUNCTION prevent_locked_sesion_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Sesión bloqueada no se puede borrar. Ley 26.529 art. 18 (retención 10 años).';
  END IF;
  RETURN OLD;
END
$$;

CREATE TRIGGER sesion_no_delete_locked
  BEFORE DELETE ON sesion
  FOR EACH ROW EXECUTE FUNCTION prevent_locked_sesion_delete();

-- ─── SesionEnmienda ───────────────────────────────────────────────────────

CREATE TABLE sesion_enmienda (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  sesion_id                   uuid NOT NULL REFERENCES sesion(id) ON DELETE CASCADE,
  autor_id                    uuid NOT NULL REFERENCES member(id) ON DELETE RESTRICT,
  motivo                      text NOT NULL,                   -- "Error de transcripción C4 → C5", etc.
  texto_correccion_cifrado    bytea NOT NULL,                  -- AES-256-GCM app-side
  created_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sesion_enmienda_motivo_len CHECK (length(motivo) BETWEEN 10 AND 500)
);

CREATE INDEX sesion_enmienda_sesion_idx ON sesion_enmienda (sesion_id, created_at);
CREATE INDEX sesion_enmienda_autor_idx ON sesion_enmienda (autor_id, created_at DESC);

COMMENT ON TABLE sesion_enmienda IS
  'Folio · corrección append-only de una sesión bloqueada. Cada enmienda preserva la sesión original; el historial completo se reconstruye leyendo sesion + enmiendas.';

-- Las enmiendas NO se pueden editar ni borrar (append-only puro).
CREATE OR REPLACE FUNCTION prevent_sesion_enmienda_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'sesion_enmienda es append-only (no UPDATE)';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sesion_enmienda es append-only (no DELETE)';
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER sesion_enmienda_no_update
  BEFORE UPDATE ON sesion_enmienda
  FOR EACH ROW EXECUTE FUNCTION prevent_sesion_enmienda_mutation();

CREATE TRIGGER sesion_enmienda_no_delete
  BEFORE DELETE ON sesion_enmienda
  FOR EACH ROW EXECUTE FUNCTION prevent_sesion_enmienda_mutation();

-- ─── Cerrar FK pendiente en documento_clinico (M08) ───────────────────────

ALTER TABLE documento_clinico
  ADD CONSTRAINT documento_clinico_sesion_fk
  FOREIGN KEY (sesion_id) REFERENCES sesion(id) ON DELETE SET NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE sesion           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sesion           FORCE  ROW LEVEL SECURITY;
ALTER TABLE sesion_enmienda  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sesion_enmienda  FORCE  ROW LEVEL SECURITY;

-- ─── Sesion: clinic-scoped fino (igual que paciente) ──────────────────────
-- OWNER siempre, DIRECTOR colegiado siempre, PROFESIONAL si atendió el turno
-- (vía join a turno.profesional_id).

CREATE POLICY sesion_select_clinical
  ON sesion FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND (
      public.user_role_in(organization_id) = 'OWNER'
      OR (
        public.user_role_in(organization_id) = 'DIRECTOR'
        AND EXISTS (
          SELECT 1 FROM member
          WHERE profile_id = auth.uid()
            AND organization_id = sesion.organization_id
            AND es_colegiado = true
        )
      )
      OR EXISTS (
        SELECT 1 FROM turno t
        WHERE t.id = sesion.turno_id
          AND t.profesional_id = public.user_member_id_in(sesion.organization_id)
      )
    )
  );

CREATE POLICY sesion_insert_clinical
  ON sesion FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (
      SELECT 1 FROM turno t
      WHERE t.id = sesion.turno_id
        AND t.organization_id = sesion.organization_id
        AND (
          public.user_role_in(t.organization_id) IN ('OWNER', 'DIRECTOR')
          OR t.profesional_id = public.user_member_id_in(t.organization_id)
        )
    )
  );

CREATE POLICY sesion_update_clinical
  ON sesion FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND (
      public.user_role_in(organization_id) = 'OWNER'
      OR EXISTS (
        SELECT 1 FROM turno t
        WHERE t.id = sesion.turno_id
          AND t.profesional_id = public.user_member_id_in(sesion.organization_id)
      )
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  );

-- DELETE bloqueado salvo si locked_at IS NULL (trigger lo enforced también).
CREATE POLICY sesion_delete_pre_lock
  ON sesion FOR DELETE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND locked_at IS NULL
    AND EXISTS (
      SELECT 1 FROM turno t
      WHERE t.id = sesion.turno_id
        AND t.profesional_id = public.user_member_id_in(sesion.organization_id)
    )
  );

-- ─── SesionEnmienda: solo INSERT por roles clínicos ──────────────────────

CREATE POLICY sesion_enmienda_select_clinical
  ON sesion_enmienda FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (SELECT 1 FROM sesion s WHERE s.id = sesion_enmienda.sesion_id)
  );

CREATE POLICY sesion_enmienda_insert_clinical
  ON sesion_enmienda FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND autor_id = public.user_member_id_in(organization_id)
    AND EXISTS (
      SELECT 1 FROM sesion s
      WHERE s.id = sesion_enmienda.sesion_id
        AND s.organization_id = sesion_enmienda.organization_id
    )
  );

-- UPDATE / DELETE bloqueado por trigger arriba; aún así RLS-policy nula.
