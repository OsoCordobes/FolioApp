-- M117: manual/walk-in identity + patient + visit are one durable operation.
-- Additive: apply after M116 and before deploying the new manual creation UI.
-- The migration runner owns the transaction and version ledger.
CREATE SCHEMA folio_manual_visit_private;
REVOKE ALL ON SCHEMA folio_manual_visit_private FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE folio_manual_visit_private.receipt (
  organization_id uuid NOT NULL REFERENCES public.organization(id),
  actor_id uuid NOT NULL REFERENCES public.member(id),
  operation_id uuid NOT NULL,
  request_hash text NOT NULL,
  bound_input jsonb NOT NULL,
  turno_id uuid NOT NULL UNIQUE REFERENCES public.turno(id),
  paciente_id uuid NOT NULL REFERENCES public.paciente(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, actor_id, operation_id)
);
ALTER TABLE folio_manual_visit_private.receipt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON folio_manual_visit_private.receipt FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION folio_manual_visit_private.create_visit(
  p_org uuid, p_operation uuid, p_hash text, p_paciente uuid, p_identity jsonb,
  p_profesional uuid, p_servicio uuid, p_inicio timestamptz, p_duracion integer, p_origen text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  actor public.member; professional public.member; service public.servicio;
  patient public.paciente; prior folio_manual_visit_private.receipt;
  bound jsonb; identity_id uuid; patient_id uuid; turn_id uuid; target uuid;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current staff required'; END IF;
  PERFORM 1 FROM public.organization WHERE id=p_org AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current organization required'; END IF;
  SELECT * INTO actor FROM public.member WHERE organization_id=p_org AND profile_id=auth.uid()
    AND deleted_at IS NULL AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
  IF NOT FOUND OR actor.role NOT IN ('OWNER','DIRECTOR','PROFESIONAL','COORDINADOR','ASISTENTE') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current accepted staff required';
  END IF;
  IF p_operation IS NULL OR coalesce(p_hash,'') !~ '^[a-f0-9]{64}$'
    OR p_inicio IS NULL OR NOT isfinite(p_inicio) OR p_duracion IS NULL OR p_duracion NOT BETWEEN 5 AND 480
    OR p_origen IS NULL OR p_origen NOT IN ('MANUAL','WALK_IN')
    OR (p_paciente IS NULL) = (p_identity IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Explicit operation and one patient source required';
  END IF;
  bound := jsonb_build_array(p_paciente, p_profesional, p_servicio, extract(epoch FROM p_inicio), p_duracion, p_origen);
  PERFORM pg_advisory_xact_lock(hashtextextended('manual-visit:'||p_org::text||':'||actor.id::text||':'||p_operation::text,0));
  SELECT * INTO prior FROM folio_manual_visit_private.receipt
    WHERE organization_id=p_org AND actor_id=actor.id AND operation_id=p_operation;
  IF FOUND THEN
    IF prior.request_hash IS DISTINCT FROM p_hash OR prior.bound_input IS DISTINCT FROM bound THEN
      RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Operation reused for different intent';
    END IF;
    PERFORM 1 FROM public.turno t WHERE t.id=prior.turno_id AND t.organization_id=p_org AND t.deleted_at IS NULL
      AND (actor.role IN ('OWNER','DIRECTOR') OR actor.id=t.profesional_id
        OR (actor.role IN ('ASISTENTE','COORDINADOR') AND public.user_has_scope_over(p_org,t.profesional_id))) FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current visit scope required'; END IF;
    -- Replays cannot disclose even a receipt after patient/vault access changes.
    SELECT * INTO patient FROM public.paciente WHERE id=prior.paciente_id AND organization_id=p_org
      AND deleted_at IS NULL AND pseudonimizado_en IS NULL FOR SHARE;
    IF NOT FOUND OR (patient.caja_fuerte_profesional IS NOT NULL AND patient.caja_fuerte_profesional IS DISTINCT FROM actor.id) THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current scoped patient required';
    END IF;
    IF actor.role='PROFESIONAL' AND patient.profesional_principal_id IS DISTINCT FROM actor.id
      AND NOT public.profesional_attended_paciente(patient.id,p_org) THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current patient assignment required';
    END IF;
    PERFORM 1 FROM public.paciente_identidad WHERE id=patient.identidad_id AND organization_id=p_org AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current scoped identity required'; END IF;
    RETURN jsonb_build_object('turnoId', prior.turno_id, 'pacienteId', prior.paciente_id, 'reused', true);
  END IF;
  target := coalesce(p_profesional, CASE WHEN actor.es_colegiado THEN actor.id END);
  SELECT * INTO professional FROM public.member WHERE id=target AND organization_id=p_org AND deleted_at IS NULL
    AND es_colegiado AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Current professional required'; END IF;
  -- A clinician's agenda is their own even if the member's default scope is
  -- TODOS. Delegated scope applies only to assistants and coordinators.
  IF NOT (actor.role IN ('OWNER','DIRECTOR') OR actor.id=target
    OR (actor.role IN ('ASISTENTE','COORDINADOR') AND public.user_has_scope_over(p_org,target))) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current professional scope required';
  END IF;
  SELECT * INTO service FROM public.servicio WHERE id=p_servicio AND organization_id=p_org AND activo AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Current service required'; END IF;
  -- Same lock namespace as M110; EXCLUDE also protects legacy concurrent writers.
  PERFORM pg_advisory_xact_lock(hashtextextended('booking-slot:'||p_org::text||':'||target::text,0));
  IF public.slot_ocupado(p_org,p_inicio,p_inicio+make_interval(mins=>p_duracion),NULL,target,NULL) THEN
    RAISE EXCEPTION USING ERRCODE='23P01', MESSAGE='Requested time no longer available';
  END IF;
  IF p_paciente IS NOT NULL THEN
    SELECT * INTO patient FROM public.paciente WHERE id=p_paciente AND organization_id=p_org
      AND deleted_at IS NULL AND pseudonimizado_en IS NULL FOR SHARE;
    IF NOT FOUND OR (patient.caja_fuerte_profesional IS NOT NULL AND patient.caja_fuerte_profesional IS DISTINCT FROM actor.id) THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current scoped patient required';
    END IF;
    IF actor.role='PROFESIONAL' AND patient.profesional_principal_id IS DISTINCT FROM actor.id
      AND NOT public.profesional_attended_paciente(patient.id,p_org) THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current patient assignment required';
    END IF;
    PERFORM 1 FROM public.paciente_identidad WHERE id=patient.identidad_id AND organization_id=p_org AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current scoped identity required'; END IF;
    patient_id := patient.id;
  ELSE
    IF jsonb_typeof(p_identity) IS DISTINCT FROM 'object' OR octet_length(p_identity::text)>16384
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_identity) k WHERE k NOT IN
        ('nombre_cifrado','apellido_cifrado','telefono_cifrado','email_cifrado','nombre_hash','telefono_hash'))
      OR nullif(p_identity->>'nombre_cifrado','') IS NULL OR nullif(p_identity->>'apellido_cifrado','') IS NULL
      OR nullif(p_identity->>'telefono_cifrado','') IS NULL
      OR coalesce(p_identity->>'nombre_hash','') !~ '^[a-f0-9]{64}$'
      OR coalesce(p_identity->>'telefono_hash','') !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Validated encrypted identity required';
    END IF;
    INSERT INTO public.paciente_identidad(organization_id,nombre_cifrado,apellido_cifrado,tipo_doc,telefono_cifrado,email_cifrado,nombre_hash,telefono_hash)
      VALUES(p_org,(p_identity->>'nombre_cifrado')::bytea,(p_identity->>'apellido_cifrado')::bytea,'DNI',
        (p_identity->>'telefono_cifrado')::bytea,(p_identity->>'email_cifrado')::bytea,p_identity->>'nombre_hash',p_identity->>'telefono_hash') RETURNING id INTO identity_id;
    INSERT INTO public.paciente(organization_id,identidad_id,tags,profesional_principal_id)
      VALUES(p_org,identity_id,'{}',target) RETURNING id INTO patient_id;
  END IF;
  INSERT INTO public.turno(organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,origen,estado)
    VALUES(p_org,patient_id,p_servicio,target,p_inicio,p_duracion,coalesce(service.precio_cents,0),p_origen::public.origen_turno,'AGENDADO') RETURNING id INTO turn_id;
  INSERT INTO public.recordatorio_job(organization_id,turno_id,tipo,scheduled_ts) VALUES
    (p_org,turn_id,'CONFIRMACION_24H',p_inicio-interval '24 hours'),
    (p_org,turn_id,'RECORDATORIO_2H',p_inicio-interval '2 hours');
  -- M107's turno trigger persists the Google intent in this same transaction.
  INSERT INTO folio_manual_visit_private.receipt(organization_id,actor_id,operation_id,request_hash,bound_input,turno_id,paciente_id)
    VALUES(p_org,actor.id,p_operation,p_hash,bound,turn_id,patient_id);
  RETURN jsonb_build_object('turnoId',turn_id,'pacienteId',patient_id,'reused',false);
END $$;
REVOKE ALL ON FUNCTION folio_manual_visit_private.create_visit(uuid,uuid,text,uuid,jsonb,uuid,uuid,timestamptz,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA folio_manual_visit_private TO authenticated;
GRANT EXECUTE ON FUNCTION folio_manual_visit_private.create_visit(uuid,uuid,text,uuid,jsonb,uuid,uuid,timestamptz,integer,text) TO authenticated;

-- The exposed entry point carries no elevated privileges. Keep implementation
-- and receipts outside PostgREST's exposed schemas, with explicit narrow grants.
CREATE FUNCTION public.create_manual_turno_atomic(
  p_org uuid, p_operation uuid, p_hash text, p_paciente uuid, p_identity jsonb,
  p_profesional uuid, p_servicio uuid, p_inicio timestamptz, p_duracion integer, p_origen text
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT folio_manual_visit_private.create_visit(p_org,p_operation,p_hash,p_paciente,p_identity,p_profesional,p_servicio,p_inicio,p_duracion,p_origen);
$$;
REVOKE ALL ON FUNCTION public.create_manual_turno_atomic(uuid,uuid,text,uuid,jsonb,uuid,uuid,timestamptz,integer,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_manual_turno_atomic(uuid,uuid,text,uuid,jsonb,uuid,uuid,timestamptz,integer,text) TO authenticated;
