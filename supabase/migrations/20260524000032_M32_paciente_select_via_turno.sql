-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M32 · PROFESIONAL gana lectura de paciente via turno atendido
-- ════════════════════════════════════════════════════════════════════════════
-- Hallazgo auditoría HIGH-15: M03 comment línea 227 prometía "PROFESIONAL si
-- profesional_principal_id = mi member_id O si tengo turnos atendidos con el
-- paciente (lo último se materializa en M09 vía EXISTS en turno)". Pero ese
-- segundo branch NUNCA se implementó — la policy solo matcheaba
-- profesional_principal_id.
--
-- Consecuencia: un profesional que CUBRE a otro (ej. vacaciones, urgencia,
-- equipo rotativo) atiende al paciente, registra el turno como CERRADO, pero
-- después NO PUEDE LEER la PHI de ese paciente porque no es el "principal".
-- Workflow clínico roto.
--
-- Fix: agregar el branch "EXISTS turno where profesional_id = me AND estado
-- IN ATENDIENDO/CERRADO/EN_SALA". Mantener todo lo demás idéntico al M03
-- (OWNER, DIRECTOR colegiado, caja_fuerte).
--
-- Implementación: helper SECURITY DEFINER para evitar circular dep (turno RLS
-- también scope por profesional → sin DEFINER el subquery se filtraría).
--
-- Análisis de seguridad:
--   - Policy nueva es STRICTLY MORE PERMISSIVE para PROFESIONAL (agrega un
--     branch OR). No quita acceso a nadie.
--   - El branch nuevo solo abre paciente cuando el PROFESIONAL YA atendió
--     un turno legítimamente — es ex post, no apertura preventiva.
--   - caja_fuerte sigue cerrando incluso para profesionales que atendieron
--     (el AND caja_fuerte_profesional ... viene aparte y tiene precedencia).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Helper SECURITY DEFINER ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.profesional_attended_paciente(
  p_paciente_id uuid,
  p_org_id      uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- TRUE si el usuario actual (como member en p_org_id) atendió un turno
  -- "real" (no AGENDADO/CANCELADO/REAGENDADO/NO_ASISTIO) del paciente
  -- p_paciente_id. Estados que cuentan como "atendió":
  --   EN_SALA      — paciente en consultorio con el profesional
  --   ATENDIENDO   — consulta en curso
  --   CERRADO      — consulta finalizada
  --
  -- SECURITY DEFINER: bypasea RLS de turno para evitar self-reference.
  SELECT EXISTS (
    SELECT 1 FROM turno t
    WHERE t.paciente_id = p_paciente_id
      AND t.organization_id = p_org_id
      AND t.profesional_id = public.user_member_id_in(p_org_id)
      AND t.estado IN ('EN_SALA', 'ATENDIENDO', 'CERRADO')
  );
$$;

REVOKE ALL ON FUNCTION public.profesional_attended_paciente(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profesional_attended_paciente(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.profesional_attended_paciente(uuid, uuid) IS
  'M32 · helper RLS · TRUE si el member actual atendió (EN_SALA/ATENDIENDO/CERRADO) algún turno del paciente. Bypass RLS de turno via SECURITY DEFINER.';

-- ─── 2. Reemplazar policy SELECT de paciente con el branch via turno ────

DROP POLICY IF EXISTS paciente_select_clinical ON paciente;

CREATE POLICY paciente_select_clinical
  ON paciente FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND (
      -- OWNER siempre
      public.user_role_in(organization_id) = 'OWNER'
      -- DIRECTOR si es_colegiado
      OR (
        public.user_role_in(organization_id) = 'DIRECTOR'
        AND EXISTS (
          SELECT 1 FROM member
          WHERE profile_id = auth.uid()
            AND organization_id = paciente.organization_id
            AND es_colegiado = true
        )
      )
      -- PROFESIONAL: dueño (profesional_principal_id) O atendió un turno
      -- (M32 fix · antes solo dueño)
      OR (
        public.user_role_in(organization_id) = 'PROFESIONAL'
        AND (
          profesional_principal_id = public.user_member_id_in(organization_id)
          OR public.profesional_attended_paciente(id, organization_id)
        )
      )
    )
    -- Caja fuerte: si seteada, solo el member específico (mantenido de M03;
    -- aplica con precedencia incluso si el profesional atendió un turno).
    AND (
      caja_fuerte_profesional IS NULL
      OR caja_fuerte_profesional = public.user_member_id_in(organization_id)
    )
  );

COMMENT ON POLICY paciente_select_clinical ON paciente IS
  'M32 · OWNER + DIRECTOR colegiado + PROFESIONAL (dueño O atendió turno). caja_fuerte tiene precedencia.';
