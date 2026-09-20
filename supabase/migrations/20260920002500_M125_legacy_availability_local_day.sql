-- M125: keep the legacy M97 writer on the same local day as M113's versioned
-- reader/writer. The M02 CURRENT_DATE default follows the caller session TZ;
-- around UTC midnight it can make a new Cordoba week look future-dated.
-- Preserve the MFA wrapper installed by M101 and all M97 authorization guards.
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
  PERFORM folio_mfa_private.assert_access();

  IF p_organization_id IS NULL OR p_member_id IS NULL THEN
    RAISE EXCEPTION 'reemplazar_disponibilidad: falta la organización o el profesional'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_franjas) <> 'array' THEN
    RAISE EXCEPTION 'reemplazar_disponibilidad: p_franjas tiene que ser un array JSON'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_org_ids() AS t(org_id)
     WHERE t.org_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'No tenés permiso para editar horarios de esa organización.'
      USING ERRCODE = '42501';
  END IF;

  v_role := public.user_role_in(p_organization_id);
  v_self := public.user_member_id_in(p_organization_id);

  IF NOT (v_role IN ('OWNER', 'DIRECTOR') OR p_member_id = v_self) THEN
    RAISE EXCEPTION 'Sólo el propio profesional o un OWNER/DIRECTOR puede editar esos horarios.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM member m
     WHERE m.id = p_member_id
       AND m.organization_id = p_organization_id
       AND m.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Ese profesional no pertenece a la organización.'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM disponibilidad_profesional
   WHERE organization_id = p_organization_id
     AND member_id = p_member_id;

  INSERT INTO disponibilidad_profesional
    (organization_id, member_id, dia_semana, hora_inicio, hora_fin, vigencia_desde)
  SELECT
    p_organization_id,
    p_member_id,
    (f.franja->>'dia_semana')::smallint,
    f.franja->>'hora_inicio',
    f.franja->>'hora_fin',
    (now() AT TIME ZONE 'America/Argentina/Cordoba')::date
  FROM jsonb_array_elements(v_franjas) AS f(franja);

  GET DIAGNOSTICS v_insertadas = ROW_COUNT;
  RETURN v_insertadas;
END
$$;

REVOKE ALL ON FUNCTION public.reemplazar_disponibilidad(uuid, uuid, jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.reemplazar_disponibilidad(uuid, uuid, jsonb) TO authenticated;
COMMENT ON FUNCTION public.reemplazar_disponibilidad(uuid, uuid, jsonb) IS
  'Folio M125: M97 atomic legacy replacement with M101 MFA gate; new rows use the Cordoba day expected by M113. Existing dated rows remain unchanged.';
