-- M122: a day-scoped operational read for reception. Existing clinical tables,
-- policies and turno_extendido remain unchanged. No new write authority or gate.
-- Reuse M111's private namespace without replacing its existing object grants.

CREATE FUNCTION folio_agenda_private.recepcion_dia(
 p_org uuid,p_fecha date,p_profesional uuid DEFAULT NULL
) RETURNS TABLE(
 id uuid,organization_id uuid,inicio timestamptz,duracion_min integer,estado text,origen text,
 precio_cents integer,gcal_event_id text,atendiendo_desde timestamptz,duracion_real_min integer,
 paciente_id uuid,paciente_nombre_cifrado bytea,paciente_apellido_cifrado bytea,paciente_telefono_cifrado bytea,
 paciente_tipo text,paciente_tags text[],paciente_alerta_alergia boolean,
 servicio_nombre text,servicio_tipo_canonico text,
 pago_id uuid,pago_monto_cents integer,pago_estado text,pago_pagado_ts timestamptz,
 profesional_id uuid,nota_reserva_cifrado bytea,modalidad text,pago_metodo text,pago_updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_role text;v_mfa jsonb;v_timezone text;v_start timestamptz;v_end timestamptz;
BEGIN
 IF p_org IS NULL OR p_fecha IS NULL OR NOT isfinite(p_fecha) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid reception agenda day';
 END IF;
 PERFORM folio_mfa_private.assert_access();
 v_mfa:=public.mfa_access_status();
 IF auth.uid() IS NULL OR (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2'
  OR (v_mfa->>'allowed')::boolean IS DISTINCT FROM true
  OR (v_mfa->>'isStaff')::boolean IS DISTINCT FROM true
  OR (v_mfa->>'hasVerifiedFactor')::boolean IS DISTINCT FROM true
  OR (v_mfa->>'sessionValid')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Reception agenda requires current verified staff';
 END IF;
 -- Existing helpers resolve current, accepted membership and live organization;
 -- no role, organization, user metadata or actor identifier is trusted from JWT.
 v_role:=public.user_role_in(p_org);
 IF v_role IS NULL OR v_role NOT IN('ASISTENTE','COORDINADOR') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Reception agenda role required';
 END IF;
 SELECT o.timezone INTO v_timezone FROM public.organization o WHERE o.id=p_org AND o.deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Reception agenda organization unavailable';END IF;
 IF p_profesional IS NOT NULL AND (
  NOT EXISTS(SELECT 1 FROM public.member m WHERE m.id=p_profesional AND m.organization_id=p_org AND m.deleted_at IS NULL
   AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL))
  OR NOT public.user_has_scope_over(p_org,p_profesional)
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Reception agenda professional unavailable';END IF;
 v_start:=p_fecha::timestamp AT TIME ZONE v_timezone;
 v_end:=(p_fecha+1)::timestamp AT TIME ZONE v_timezone;

 RETURN QUERY SELECT
  t.id,t.organization_id,t.inicio,t.duracion_min::integer,t.estado::text,t.origen::text,
  CASE WHEN v_role='ASISTENTE' THEN t.precio_cents END,t.gcal_event_id,t.atendiendo_desde,t.duracion_real_min::integer,
  t.paciente_id,pi.nombre_cifrado,pi.apellido_cifrado,pi.telefono_cifrado,
  NULL::text,NULL::text[],false,s.nombre::text,s.tipo_canonico::text,
  pa.id,pa.monto_cents,pa.estado::text,pa.pagado_ts,t.profesional_id,NULL::bytea,t.modalidad::text,pa.metodo::text,pa.updated_at
 FROM public.turno t
 JOIN public.paciente p ON p.id=t.paciente_id AND p.organization_id=t.organization_id
 JOIN public.paciente_identidad pi ON pi.id=p.identidad_id AND pi.organization_id=t.organization_id
 JOIN public.servicio s ON s.id=t.servicio_id AND s.organization_id=t.organization_id
 -- A coordinator receives no payment row or identifier, even though legacy pago
 -- SELECT policy permits scoped staff. Later server payment reads cannot start.
 LEFT JOIN public.pago pa ON pa.turno_id=t.id AND v_role='ASISTENTE'
 WHERE t.organization_id=p_org AND t.deleted_at IS NULL AND t.inicio>=v_start AND t.inicio<v_end
  AND (p_profesional IS NULL OR t.profesional_id=p_profesional)
  AND public.user_has_scope_over(p_org,t.profesional_id)
  AND p.deleted_at IS NULL AND p.pseudonimizado_en IS NULL AND p.caja_fuerte_profesional IS NULL
  AND pi.deleted_at IS NULL AND NOT public.has_caja_fuerte_blocking_access(pi.id,p_org)
 ORDER BY t.inicio,t.id;
END $$;
REVOKE ALL ON FUNCTION folio_agenda_private.recepcion_dia(uuid,date,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA folio_agenda_private TO authenticated;
GRANT EXECUTE ON FUNCTION folio_agenda_private.recepcion_dia(uuid,date,uuid) TO authenticated;

CREATE FUNCTION public.agenda_recepcion_dia(
 p_org uuid,p_fecha date,p_profesional uuid DEFAULT NULL
) RETURNS TABLE(
 id uuid,organization_id uuid,inicio timestamptz,duracion_min integer,estado text,origen text,
 precio_cents integer,gcal_event_id text,atendiendo_desde timestamptz,duracion_real_min integer,
 paciente_id uuid,paciente_nombre_cifrado bytea,paciente_apellido_cifrado bytea,paciente_telefono_cifrado bytea,
 paciente_tipo text,paciente_tags text[],paciente_alerta_alergia boolean,
 servicio_nombre text,servicio_tipo_canonico text,
 pago_id uuid,pago_monto_cents integer,pago_estado text,pago_pagado_ts timestamptz,
 profesional_id uuid,nota_reserva_cifrado bytea,modalidad text,pago_metodo text,pago_updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT * FROM folio_agenda_private.recepcion_dia(p_org,p_fecha,p_profesional)
$$;
REVOKE ALL ON FUNCTION public.agenda_recepcion_dia(uuid,date,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.agenda_recepcion_dia(uuid,date,uuid) TO authenticated;
COMMENT ON FUNCTION public.agenda_recepcion_dia(uuid,date,uuid) IS
 'Folio M122: current AAL2 reception reads one organization-local day within managed professional scope. Identity respects M31 vault and deletion; clinical fields are absent, coordinator payment fields are null. No clinical RLS or writer permissions are changed.';
