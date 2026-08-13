-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M97 · guardar horarios es atómico (o no pasa nada)
-- ════════════════════════════════════════════════════════════════════════════
-- BUG que cierra (audit adversarial · agenda): `saveHorarios`
-- (lib/db/configuracion.ts) reemplazaba la disponibilidad semanal con un DELETE
-- suelto + un INSERT suelto, DESCARTANDO el error del DELETE. Los dos statements
-- viajan como dos requests PostgREST independientes ⇒ dos transacciones. Si el
-- INSERT fallaba (un CHECK `disp_orden`, un pico de red, un 42501), el DELETE ya
-- estaba COMMITEADO: la UI mostraba "Horarios: <error>", el profesional entendía
-- "no se guardó" y se iba… con la disponibilidad en CERO.
--
-- Y cero franjas no es un estado ruidoso: `getSlotsDisponibles`
-- (lib/booking/availability.ts) trata "sin filas de disponibilidad" como una
-- configuración legítima y devuelve `[]` sin chistar. Resultado real: el link
-- público de reservas deja de ofrecer turnos —todo el fin de semana, si el save
-- falló un viernes— sin un solo error visible en ningún lado.
--
-- ─── Qué hace public.reemplazar_disponibilidad() ─────────────────────────────
-- DELETE + INSERT del set completo de franjas de UN profesional dentro de UNA
-- función ⇒ un solo statement para el caller ⇒ una sola transacción. Si el
-- INSERT levanta, la excepción aborta la función y el DELETE se va con ella: o
-- queda la semana nueva entera, o queda la vieja intacta. Nunca el vacío.
-- (Deliberadamente SIN bloque EXCEPTION: atrapar el error acá lo convertiría en
-- un retorno normal y commitearía el DELETE — exactamente el bug que borra.)
--
-- `p_franjas` es un array JSON de {dia_semana, hora_inicio, hora_fin}. La org y
-- el profesional van por parámetro y se re-escriben en cada fila: el cliente no
-- puede colar una franja para otro tenant dentro del payload.
--
-- ─── Por qué SECURITY DEFINER ────────────────────────────────────────────────
-- `disponibilidad_profesional` tiene RLS ENABLE+FORCE (M02). Una función DEFINER
-- con `search_path` fijado es el path controlado de la casa (M70/M84…M88), y
-- acá además hace falta para que el DELETE y el INSERT vean el MISMO snapshot de
-- permisos. La autorización no se pierde: se re-implementa explícitamente arriba
-- con los MISMOS guards que la policy `disp_write_self_or_admin` (M02):
--
--   · la org tiene que estar en public.user_org_ids()  → aislamiento multi-tenant
--   · OWNER/DIRECTOR de esa org, O el propio member    → self-scoping PROFESIONAL
--
-- Sumamos un guard que la policy no puede expresar: el `p_member_id` tiene que
-- ser un member VIVO de `p_organization_id`. Sin él, un OWNER podría escribirle
-- la agenda a un member de otro tenant (la policy valida la org de la FILA, y la
-- fila la construye esta función). EXECUTE sólo para `authenticated`: el wizard
-- de onboarding escribe con service_role por su propio camino y no la invoca.
--
-- ─── check_function_bodies = off (house style) ───────────────────────────────
-- Convención de la casa (M01/M60/M70…M88). Todo lo referenciado PRE-EXISTE
-- (disponibilidad_profesional y los helpers RLS son de M01/M02, este archivo
-- ordena último); el flag blinda el replay bajo la preview branch de Supabase.
--
-- ─── Orden de replay (append-only) ───────────────────────────────────────────
-- Prefijo …099 (después de M96 …098). Número canónico M97. Aditiva pura:
-- función nueva, cero tablas/columnas/policies tocadas. Replay-safe en
-- postgres:16 vanilla con DEFAULTS y bajo el wrapper de pgTAP.
-- ════════════════════════════════════════════════════════════════════════════

set check_function_bodies = off;

-- ════════════════════════════════════════════════════════════════════════════
-- public.reemplazar_disponibilidad(uuid, uuid, jsonb) → integer
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.reemplazar_disponibilidad(
  p_organization_id uuid,
  p_member_id       uuid,
  p_franjas         jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role       text;
  v_self       uuid;
  v_franjas    jsonb := coalesce(p_franjas, '[]'::jsonb);
  v_insertadas integer;
BEGIN
  IF p_organization_id IS NULL OR p_member_id IS NULL THEN
    RAISE EXCEPTION 'reemplazar_disponibilidad: falta la organización o el profesional'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_franjas) <> 'array' THEN
    RAISE EXCEPTION 'reemplazar_disponibilidad: p_franjas tiene que ser un array JSON'
      USING ERRCODE = '22023';
  END IF;

  -- ─── Guard 1 · la org es del usuario (aislamiento multi-tenant) ───────────
  IF NOT EXISTS (
    SELECT 1 FROM public.user_org_ids() AS t(org_id)
     WHERE t.org_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'No tenés permiso para editar horarios de esa organización.'
      USING ERRCODE = '42501';
  END IF;

  -- ─── Guard 2 · OWNER/DIRECTOR, o el propio profesional (disp_write_self_or_admin) ──
  v_role := public.user_role_in(p_organization_id);
  v_self := public.user_member_id_in(p_organization_id);

  IF NOT (v_role IN ('OWNER', 'DIRECTOR') OR p_member_id = v_self) THEN
    RAISE EXCEPTION 'Sólo el propio profesional o un OWNER/DIRECTOR puede editar esos horarios.'
      USING ERRCODE = '42501';
  END IF;

  -- ─── Guard 3 · el profesional es de ESTA org (lo que la policy no ve) ─────
  IF NOT EXISTS (
    SELECT 1 FROM member m
     WHERE m.id = p_member_id
       AND m.organization_id = p_organization_id
       AND m.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Ese profesional no pertenece a la organización.'
      USING ERRCODE = '42501';
  END IF;

  -- ─── El reemplazo, en una sola transacción ────────────────────────────────
  DELETE FROM disponibilidad_profesional
   WHERE organization_id = p_organization_id
     AND member_id = p_member_id;

  INSERT INTO disponibilidad_profesional
    (organization_id, member_id, dia_semana, hora_inicio, hora_fin)
  SELECT
    p_organization_id,
    p_member_id,
    (f.franja->>'dia_semana')::smallint,
    f.franja->>'hora_inicio',
    f.franja->>'hora_fin'
  FROM jsonb_array_elements(v_franjas) AS f(franja);

  GET DIAGNOSTICS v_insertadas = ROW_COUNT;
  RETURN v_insertadas;
END
$$;

COMMENT ON FUNCTION public.reemplazar_disponibilidad(uuid, uuid, jsonb) IS
  'Folio M97 · reemplaza ATÓMICAMENTE la disponibilidad semanal de un profesional (DELETE + INSERT en una transacción): si el INSERT falla, el DELETE se revierte y la agenda vieja queda intacta — antes el par suelto vía PostgREST podía dejar la agenda pública en CERO slots en silencio. Guards equivalentes a la policy disp_write_self_or_admin (org del usuario + OWNER/DIRECTOR o el propio member) más la validación de que el member sea de esa org. SECURITY DEFINER; EXECUTE sólo authenticated. Devuelve la cantidad de franjas insertadas.';

-- EXECUTE sólo para `authenticated`: la invoca /configuracion bajo la sesión del
-- profesional. anon/PUBLIC revocados — sin sesión, `user_org_ids()` viene vacío
-- y el Guard 1 ya cortaría, pero no hay razón para exponerla (defensa en capas).
-- (Supabase concede EXECUTE a anon/authenticated por default privileges; en
-- vanilla, a PUBLIC. Se revocan ambos explícitamente.)
REVOKE ALL ON FUNCTION public.reemplazar_disponibilidad(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reemplazar_disponibilidad(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.reemplazar_disponibilidad(uuid, uuid, jsonb) TO authenticated;
