-- M133: bounded calendar projection for reception. M122 remains the
-- authorization gate; each local day is checked under the caller's current
-- Auth/MFA session, role, organization and managed-professional scope.
-- The public wrapper is SECURITY INVOKER and returns no clinical or money data.
CREATE FUNCTION public.agenda_recepcion_rango(
 p_org uuid,p_desde date,p_hasta date,p_profesional uuid DEFAULT NULL
) RETURNS TABLE(
 id uuid,organization_id uuid,inicio timestamptz,duracion_min integer,estado text,origen text,
 paciente_id uuid,paciente_nombre_cifrado bytea,paciente_apellido_cifrado bytea,paciente_telefono_cifrado bytea,
 servicio_nombre text,profesional_id uuid,modalidad text
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF p_org IS NULL OR p_desde IS NULL OR p_hasta IS NULL
  OR NOT pg_catalog.isfinite(p_desde) OR NOT pg_catalog.isfinite(p_hasta)
  OR p_hasta<p_desde OR p_hasta-p_desde>41 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid reception calendar range';
 END IF;

 RETURN QUERY SELECT
  r.id,r.organization_id,r.inicio,r.duracion_min,r.estado,r.origen,
  r.paciente_id,r.paciente_nombre_cifrado,r.paciente_apellido_cifrado,r.paciente_telefono_cifrado,
  r.servicio_nombre,r.profesional_id,r.modalidad
 FROM pg_catalog.generate_series(p_desde::timestamp,p_hasta::timestamp,interval '1 day') AS d(fecha)
 CROSS JOIN LATERAL public.agenda_recepcion_dia(p_org,d.fecha::date,p_profesional) AS r
 ORDER BY r.inicio,r.id;
END $$;

REVOKE ALL ON FUNCTION public.agenda_recepcion_rango(uuid,date,date,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.agenda_recepcion_rango(uuid,date,date,uuid) TO authenticated;
COMMENT ON FUNCTION public.agenda_recepcion_rango(uuid,date,date,uuid) IS
 'Folio M133: at most 42 organization-local days through M122 for current verified reception; appointment identity/contact only, no clinical or financial fields.';

-- The calendar also renders pending requests. Its old organization-wide query
-- exposed assigned requests outside reception scope and their price to a
-- coordinator. Keep the M122 authorization boundary and narrow this projection.
CREATE FUNCTION folio_agenda_private.recepcion_pedidos(p_org uuid,p_fecha date,p_profesional uuid)
RETURNS TABLE(
 id uuid,canal text,estado text,nombre_cifrado bytea,telefono_cifrado bytea,email_cifrado bytea,
 paciente_id uuid,profesional_id uuid,fecha_propuesta timestamptz,duracion_min integer,
 servicio_id uuid,precio_cents integer,recibido_ts timestamptz,confirmado_ts timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_role text;
BEGIN
 -- Even an empty request inbox must pass the current AAL2/role/scope gate.
 PERFORM count(*) FROM public.agenda_recepcion_dia(p_org,p_fecha,p_profesional);
 v_role:=public.user_role_in(p_org);
 RETURN QUERY SELECT
  p.id,p.canal::text,p.estado::text,p.nombre_cifrado,p.telefono_cifrado,p.email_cifrado,
  p.paciente_id,p.profesional_id,p.fecha_propuesta,p.duracion_min::integer,p.servicio_id,
  CASE WHEN v_role='ASISTENTE' THEN p.precio_cents ELSE NULL::integer END,
  p.recibido_ts,p.confirmado_ts
 FROM public.pedido p
 WHERE p.organization_id=p_org AND p.estado='PENDIENTE'
  AND (p_profesional IS NULL OR p.profesional_id=p_profesional OR p.profesional_id IS NULL)
  AND public.user_has_scope_over(p_org,p.profesional_id)
  AND (p.paciente_id IS NULL OR EXISTS(
   SELECT 1 FROM public.paciente pa
   JOIN public.paciente_identidad pi ON pi.id=pa.identidad_id AND pi.organization_id=p_org
   WHERE pa.id=p.paciente_id AND pa.organization_id=p_org
    AND pa.deleted_at IS NULL AND pa.pseudonimizado_en IS NULL
    AND pa.caja_fuerte_profesional IS NULL AND pi.deleted_at IS NULL
    AND NOT public.has_caja_fuerte_blocking_access(pi.id,p_org)
  ))
 ORDER BY p.recibido_ts DESC,p.id DESC;
END $$;
REVOKE ALL ON FUNCTION folio_agenda_private.recepcion_pedidos(uuid,date,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION folio_agenda_private.recepcion_pedidos(uuid,date,uuid) TO authenticated;

CREATE FUNCTION public.agenda_recepcion_pedidos(p_org uuid,p_fecha date,p_profesional uuid DEFAULT NULL)
RETURNS TABLE(
 id uuid,canal text,estado text,nombre_cifrado bytea,telefono_cifrado bytea,email_cifrado bytea,
 paciente_id uuid,profesional_id uuid,fecha_propuesta timestamptz,duracion_min integer,
 servicio_id uuid,precio_cents integer,recibido_ts timestamptz,confirmado_ts timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT * FROM folio_agenda_private.recepcion_pedidos(p_org,p_fecha,p_profesional)
$$;
REVOKE ALL ON FUNCTION public.agenda_recepcion_pedidos(uuid,date,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.agenda_recepcion_pedidos(uuid,date,uuid) TO authenticated;
COMMENT ON FUNCTION public.agenda_recepcion_pedidos(uuid,date,uuid) IS
 'Folio M133: M122-verified inbox within current and selected professional scope; unassigned only for TODOS, coordinator price null, no clinical motive.';

-- Return only currently selectable professionals. The caller still applies
-- M122 on calendar reads; this keeps the visible picker aligned with that gate.
CREATE FUNCTION folio_agenda_private.recepcion_profesionales(p_org uuid,p_fecha date)
RETURNS TABLE(id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM count(*) FROM public.agenda_recepcion_dia(p_org,p_fecha,NULL);
 RETURN QUERY SELECT m.id FROM public.member m
 WHERE m.organization_id=p_org AND m.es_colegiado AND m.deleted_at IS NULL
  AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
  AND public.user_has_scope_over(p_org,m.id)
 ORDER BY m.created_at,m.id;
END $$;
REVOKE ALL ON FUNCTION folio_agenda_private.recepcion_profesionales(uuid,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION folio_agenda_private.recepcion_profesionales(uuid,date) TO authenticated;

CREATE FUNCTION public.agenda_recepcion_profesionales(p_org uuid,p_fecha date)
RETURNS TABLE(id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT * FROM folio_agenda_private.recepcion_profesionales(p_org,p_fecha)
$$;
REVOKE ALL ON FUNCTION public.agenda_recepcion_profesionales(uuid,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.agenda_recepcion_profesionales(uuid,date) TO authenticated;
COMMENT ON FUNCTION public.agenda_recepcion_profesionales(uuid,date) IS
 'Folio M133: current M122-verified reception scope for the calendar professional picker.';

-- Personal Google/manual blocks must follow the same managed-professional
-- boundary as appointments; their titles can reveal a private schedule.
CREATE FUNCTION folio_agenda_private.recepcion_bloqueos(
 p_org uuid,p_fecha date,p_desde timestamptz,p_hasta timestamptz,p_profesional uuid
) RETURNS TABLE(id uuid,inicio timestamptz,duracion_min integer,titulo text,origen text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_desde IS NULL OR p_hasta IS NULL OR NOT pg_catalog.isfinite(p_desde)
  OR NOT pg_catalog.isfinite(p_hasta) OR p_hasta<=p_desde OR p_hasta-p_desde>interval '8 days'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid reception block range';END IF;
 PERFORM count(*) FROM public.agenda_recepcion_dia(p_org,p_fecha,p_profesional);
 RETURN QUERY SELECT b.id,b.inicio,b.duracion_min::integer,NULL::text,b.origen
 FROM public.bloqueo b
 WHERE b.organization_id=p_org AND b.inicio>=p_desde AND b.inicio<p_hasta
  AND (p_profesional IS NULL OR b.profesional_id=p_profesional)
  AND public.user_has_scope_over(p_org,b.profesional_id)
 ORDER BY b.inicio,b.id;
END $$;
REVOKE ALL ON FUNCTION folio_agenda_private.recepcion_bloqueos(uuid,date,timestamptz,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION folio_agenda_private.recepcion_bloqueos(uuid,date,timestamptz,timestamptz,uuid) TO authenticated;

CREATE FUNCTION public.agenda_recepcion_bloqueos(
 p_org uuid,p_fecha date,p_desde timestamptz,p_hasta timestamptz,p_profesional uuid DEFAULT NULL
) RETURNS TABLE(id uuid,inicio timestamptz,duracion_min integer,titulo text,origen text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT * FROM folio_agenda_private.recepcion_bloqueos(p_org,p_fecha,p_desde,p_hasta,p_profesional)
$$;
REVOKE ALL ON FUNCTION public.agenda_recepcion_bloqueos(uuid,date,timestamptz,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.agenda_recepcion_bloqueos(uuid,date,timestamptz,timestamptz,uuid) TO authenticated;

CREATE FUNCTION folio_agenda_private.recepcion_disponibilidad(
 p_org uuid,p_fecha date,p_profesional uuid
) RETURNS TABLE(id uuid,dia_semana integer,hora_inicio text,hora_fin text,vigencia_desde date,vigencia_hasta date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM count(*) FROM public.agenda_recepcion_dia(p_org,p_fecha,p_profesional);
 RETURN QUERY SELECT d.id,d.dia_semana::integer,d.hora_inicio,d.hora_fin,d.vigencia_desde,d.vigencia_hasta
 FROM public.disponibilidad_profesional d
 WHERE d.organization_id=p_org AND d.activa
  AND (p_profesional IS NULL OR d.member_id=p_profesional)
  AND public.user_has_scope_over(p_org,d.member_id)
 ORDER BY d.vigencia_desde,d.id;
END $$;
REVOKE ALL ON FUNCTION folio_agenda_private.recepcion_disponibilidad(uuid,date,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION folio_agenda_private.recepcion_disponibilidad(uuid,date,uuid) TO authenticated;

CREATE FUNCTION public.agenda_recepcion_disponibilidad(
 p_org uuid,p_fecha date,p_profesional uuid DEFAULT NULL
) RETURNS TABLE(id uuid,dia_semana integer,hora_inicio text,hora_fin text,vigencia_desde date,vigencia_hasta date)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT * FROM folio_agenda_private.recepcion_disponibilidad(p_org,p_fecha,p_profesional)
$$;
REVOKE ALL ON FUNCTION public.agenda_recepcion_disponibilidad(uuid,date,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.agenda_recepcion_disponibilidad(uuid,date,uuid) TO authenticated;
