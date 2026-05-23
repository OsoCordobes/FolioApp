-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M31 · paciente_identidad respeta caja_fuerte_profesional
-- ════════════════════════════════════════════════════════════════════════════
-- Hallazgo auditoría HIGH-12: la policy M03 paciente_identidad_select_org
-- abría TODA la PII (nombre, DNI, teléfono, domicilio) a cualquier miembro
-- de la org. M03 ya restringe la PHI (notas SOAP, motivo) por
-- caja_fuerte_profesional, PERO la EXISTENCIA del paciente VIP + su data
-- identificatoria quedaba expuesta. Un COORDINADOR con LISTA_PROFESIONALES
-- limitado a un solo médico podía ver "Existe el paciente X con DNI Y y
-- teléfono Z" para CUALQUIER paciente — including los VIP.
--
-- Esta migración cierra ese gap manteniendo el caso operacional normal
-- (99% de pacientes no VIP, recepción ve la PII para agendar/llamar):
--   - Pacientes SIN caja_fuerte: comportamiento idéntico al M03 (todos
--     los roles ven la PII para agenda/recordatorios/búsqueda).
--   - Pacientes CON caja_fuerte: solo el member designado + OWNER/DIRECTOR
--     ven la PII. Recepción/COORDINADOR no pueden ni listar/buscar al VIP.
--
-- Implementación:
--   - Helper SECURITY DEFINER `has_caja_fuerte_blocking_access(p_identidad_id,
--     p_org_id) RETURNS boolean` que bypasea RLS del subquery sobre paciente
--     (evita dead-lock circular: paciente RLS depende de caja_fuerte, ahora
--     paciente_identidad RLS dependería de paciente RLS si no usamos
--     SECURITY DEFINER).
--   - DROP policy vieja, CREATE nueva con la condición.
--
-- Análisis de seguridad:
--   - Helper devuelve solo boolean → no leakea data sensible.
--   - Restrictivo: la nueva policy es STRICTLY MORE RESTRICTIVE que la vieja
--     (oculta filas para non-designados). En vez de "abrir nuevos pacientes
--     que antes estaban tapados" (potencial leak), CIERRA acceso que antes
--     era abierto.
--   - Por ende: ZERO chance de exponer data nueva. Único riesgo es que un
--     COORDINADOR que antes podía ver la PII de un paciente VIP, ahora no
--     pueda. Eso ES EL PUNTO de la fix.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Helper SECURITY DEFINER ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.has_caja_fuerte_blocking_access(
  p_identidad_id uuid,
  p_org_id       uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- TRUE si el paciente linked tiene caja_fuerte set Y el usuario actual
  -- NO es el member designado NI OWNER/DIRECTOR. En ese caso la PII debe
  -- ocultarse.
  --
  -- SECURITY DEFINER: bypasea RLS del SELECT sobre paciente para evitar
  -- circular dependency (paciente RLS revisa caja_fuerte; sin DEFINER,
  -- este subquery filtraría rows que el caller no puede ver, dando
  -- falso negativo = "no hay caja fuerte" = permitir leer PII de VIP).
  SELECT EXISTS (
    SELECT 1 FROM paciente p
    WHERE p.identidad_id = p_identidad_id
      AND p.caja_fuerte_profesional IS NOT NULL
      AND p.caja_fuerte_profesional <> public.user_member_id_in(p_org_id)
      AND public.user_role_in(p_org_id) NOT IN ('OWNER', 'DIRECTOR')
  );
$$;

REVOKE ALL ON FUNCTION public.has_caja_fuerte_blocking_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_caja_fuerte_blocking_access(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.has_caja_fuerte_blocking_access(uuid, uuid) IS
  'M31 · helper RLS · TRUE cuando el paciente linked a paciente_identidad.id tiene caja_fuerte set y el usuario actual NO es el designado ni admin. Bypass RLS via SECURITY DEFINER para evitar recursión.';

-- ─── 2. Reemplazar policy SELECT de paciente_identidad ───────────────────

DROP POLICY IF EXISTS paciente_identidad_select_org ON paciente_identidad;

CREATE POLICY paciente_identidad_select_scoped
  ON paciente_identidad FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND deleted_at IS NULL
    -- M31 · respetar caja_fuerte_profesional. Si el paciente tiene caja
    -- fuerte set Y el usuario NO es el member designado ni OWNER/DIRECTOR,
    -- ocultar la fila completa.
    AND NOT public.has_caja_fuerte_blocking_access(id, organization_id)
  );

COMMENT ON POLICY paciente_identidad_select_scoped ON paciente_identidad IS
  'M31 · open a todos los miembros activos de la org EXCEPTO cuando el paciente linked tiene caja_fuerte set, en cuyo caso solo el member designado + OWNER/DIRECTOR. Pacientes sin caja_fuerte: comportamiento idéntico a M03.';
