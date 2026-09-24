-- M128 / B05a expand. Scope direct pedido rows while keeping old column grants
-- during the code rollout. M129 contracts those grants after every reader uses
-- the checked clinical-reason RPC. Unassigned requests remain available to
-- professionals who can claim them through M110; scoped reception needs TODOS.
-- Keep OWNER/DIRECTOR's existing organization-wide row authority.

CREATE SCHEMA IF NOT EXISTS folio_pedido_private;
REVOKE ALL ON SCHEMA folio_pedido_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA folio_pedido_private TO authenticated;

CREATE FUNCTION folio_pedido_private.staff_scope(p_org uuid, p_profesional uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_role text;
BEGIN
  v_role := public.user_role_in(p_org);
  IF v_role IN ('OWNER', 'DIRECTOR') THEN RETURN true; END IF;
  IF v_role = 'PROFESIONAL' THEN
    RETURN p_profesional IS NULL
       OR p_profesional = public.user_member_id_in(p_org);
  END IF;
  IF v_role IN ('ASISTENTE', 'COORDINADOR') THEN
    IF p_profesional IS NULL THEN
      -- LISTA/EQUIPO has no defined owner for an unassigned request.
      RETURN public.user_has_scope_over(p_org, NULL);
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.member m
      WHERE m.id = p_profesional AND m.organization_id = p_org
        AND m.deleted_at IS NULL
        AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
    ) AND public.user_has_scope_over(p_org, p_profesional);
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION folio_pedido_private.staff_scope(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION folio_pedido_private.staff_scope(uuid,uuid) TO authenticated;

DROP POLICY pedido_select_admin ON public.pedido;
DROP POLICY pedido_write_admin ON public.pedido;

CREATE POLICY pedido_select_scoped ON public.pedido FOR SELECT
USING (folio_pedido_private.staff_scope(organization_id, profesional_id));

CREATE POLICY pedido_insert_scoped ON public.pedido FOR INSERT
WITH CHECK (folio_pedido_private.staff_scope(organization_id, profesional_id));

CREATE POLICY pedido_update_scoped ON public.pedido FOR UPDATE
USING (folio_pedido_private.staff_scope(organization_id, profesional_id))
WITH CHECK (folio_pedido_private.staff_scope(organization_id, profesional_id));

-- No direct DELETE policy. The M84 patient-portal INSERT policy remains intact.
-- Current authenticated direct UPDATE is only the inbox rejection CAS. Promotion
-- is the checked M110 SECURITY DEFINER RPC. Narrow UPDATE now so an actor
-- cannot move a visible request to NULL/another professional during rollout.
REVOKE UPDATE, DELETE ON public.pedido FROM PUBLIC, anon, authenticated;
GRANT UPDATE (estado, rechazado_motivo) ON public.pedido TO authenticated;

CREATE FUNCTION folio_pedido_private.motivos_clinicos(p_org uuid, p_ids uuid[])
RETURNS TABLE(id uuid, motivo_cifrado bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  PERFORM folio_mfa_private.assert_access();
  IF p_org IS NULL OR p_ids IS NULL OR cardinality(p_ids) > 10000
     OR NOT public.can_read_clinical(p_org) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Clinical request access required';
  END IF;

  RETURN QUERY
    SELECT p.id, p.motivo_cifrado
    FROM public.pedido p
    WHERE p.organization_id = p_org AND p.id = ANY(p_ids)
      AND folio_pedido_private.staff_scope(p.organization_id, p.profesional_id);
END $$;
REVOKE ALL ON FUNCTION folio_pedido_private.motivos_clinicos(uuid,uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION folio_pedido_private.motivos_clinicos(uuid,uuid[]) TO authenticated;

CREATE FUNCTION public.pedido_motivos_clinicos(p_org uuid, p_ids uuid[])
RETURNS TABLE(id uuid, motivo_cifrado bytea)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
  SELECT * FROM folio_pedido_private.motivos_clinicos(p_org, p_ids)
$$;
REVOKE ALL ON FUNCTION public.pedido_motivos_clinicos(uuid,uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pedido_motivos_clinicos(uuid,uuid[]) TO authenticated;
