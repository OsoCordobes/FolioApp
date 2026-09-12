-- M119: one transaction owns rescheduling, reminders and durable Google intents.
-- Additive. Apply after M118, before deploying the new reschedule action/UI.
-- Transaction is owned by the migration runner with its ledger write.
-- For manual psql rehearsal use --single-transaction; never add outer COMMIT.
CREATE SCHEMA folio_reschedule_private;
REVOKE ALL ON SCHEMA folio_reschedule_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE folio_reschedule_private.receipt (
  organization_id uuid NOT NULL REFERENCES public.organization(id),
  actor_id uuid NOT NULL REFERENCES public.member(id),
  operation_id uuid NOT NULL,
  original_turno_id uuid NOT NULL UNIQUE REFERENCES public.turno(id),
  replacement_turno_id uuid NOT NULL UNIQUE REFERENCES public.turno(id),
  bound_input jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(organization_id,actor_id,operation_id)
);
ALTER TABLE folio_reschedule_private.receipt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON folio_reschedule_private.receipt FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION folio_reschedule_private.reschedule(
  p_org uuid,p_operation uuid,p_turno uuid,p_inicio timestamptz,p_duracion integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  actor public.member; professional public.member; original public.turno;
  patient public.paciente; prior folio_reschedule_private.receipt;
  target uuid; replacement uuid; duration integer; bound jsonb;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current staff required'; END IF;
  PERFORM 1 FROM public.organization WHERE id=p_org AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current organization required'; END IF;
  SELECT * INTO actor FROM public.member WHERE organization_id=p_org AND profile_id=auth.uid()
    AND deleted_at IS NULL AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
  IF NOT FOUND OR actor.role NOT IN('OWNER','DIRECTOR','PROFESIONAL','COORDINADOR','ASISTENTE') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current accepted staff required';
  END IF;
  IF p_operation IS NULL OR p_turno IS NULL OR p_inicio IS NULL OR NOT isfinite(p_inicio)
    OR (p_duracion IS NOT NULL AND p_duracion NOT BETWEEN 5 AND 480) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Explicit operation and valid reschedule required';
  END IF;
  bound:=jsonb_build_array(p_turno,extract(epoch FROM p_inicio),p_duracion);
  PERFORM pg_advisory_xact_lock(hashtextextended('reschedule:'||p_org::text||':'||actor.id::text||':'||p_operation::text,0));
  SELECT * INTO prior FROM folio_reschedule_private.receipt
    WHERE organization_id=p_org AND actor_id=actor.id AND operation_id=p_operation;
  IF FOUND AND (prior.original_turno_id IS DISTINCT FROM p_turno OR prior.bound_input IS DISTINCT FROM bound) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Operation reused for different intent';
  END IF;

  -- Discover agenda without locking the turno first: M110/M117 take the agenda
  -- advisory lock before mutating a turno. Recheck its identity after the lock.
  SELECT profesional_id INTO target FROM public.turno WHERE id=p_turno AND organization_id=p_org AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current visit scope required'; END IF;
  SELECT * INTO professional FROM public.member WHERE id=target AND organization_id=p_org AND deleted_at IS NULL
    AND es_colegiado AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current professional required'; END IF;
  IF NOT(actor.role IN('OWNER','DIRECTOR') OR actor.id=target
    OR (actor.role IN('ASISTENTE','COORDINADOR') AND public.user_has_scope_over(p_org,target))) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current professional scope required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('booking-slot:'||p_org::text||':'||target::text,0));
  SELECT * INTO original FROM public.turno WHERE id=p_turno AND organization_id=p_org AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR original.profesional_id IS DISTINCT FROM target THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Original visit changed; review current agenda';
  END IF;
  SELECT * INTO patient FROM public.paciente WHERE id=original.paciente_id AND organization_id=p_org
    AND deleted_at IS NULL AND pseudonimizado_en IS NULL FOR SHARE;
  IF NOT FOUND OR (patient.caja_fuerte_profesional IS NOT NULL AND patient.caja_fuerte_profesional IS DISTINCT FROM actor.id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current scoped patient required';
  END IF;
  IF actor.role='PROFESIONAL' AND patient.profesional_principal_id IS DISTINCT FROM actor.id
    AND NOT public.profesional_attended_paciente(patient.id,p_org) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current patient assignment required';
  END IF;
  PERFORM 1 FROM public.paciente_identidad WHERE id=patient.identidad_id AND organization_id=p_org AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current scoped identity required'; END IF;

  IF prior.operation_id IS NOT NULL THEN
    -- A receipt is a historical confirmation, never a way around current scope.
    PERFORM 1 FROM public.turno t JOIN public.member m ON m.id=t.profesional_id AND m.organization_id=t.organization_id
      AND m.deleted_at IS NULL AND m.es_colegiado AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
      WHERE t.id=prior.replacement_turno_id AND t.organization_id=p_org
      AND t.deleted_at IS NULL AND t.paciente_id=patient.id
      AND (actor.role IN('OWNER','DIRECTOR') OR actor.id=t.profesional_id
        OR (actor.role IN('ASISTENTE','COORDINADOR') AND public.user_has_scope_over(p_org,t.profesional_id))) FOR SHARE OF t,m;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current replacement scope required'; END IF;
    RETURN jsonb_build_object('nuevoTurnoId',prior.replacement_turno_id,'reused',true);
  END IF;
  IF original.estado NOT IN('AGENDADO','CONFIRMADO','NO_ASISTIO') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Original visit can no longer be rescheduled';
  END IF;
  PERFORM 1 FROM public.servicio WHERE id=original.servicio_id AND organization_id=p_org AND activo AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current service required'; END IF;
  duration:=coalesce(p_duracion,original.duracion_min);
  IF public.slot_ocupado(p_org,p_inicio,p_inicio+make_interval(mins=>duration),NULL,target,p_turno) THEN
    RAISE EXCEPTION USING ERRCODE='23P01',MESSAGE='Requested time no longer available';
  END IF;
  -- Release the original's EXCLUDE range inside this transaction. Failure of
  -- any later INSERT/trigger rolls this UPDATE and its Google intent back too.
  UPDATE public.turno SET estado='REAGENDADO',atendiendo_desde=NULL WHERE id=original.id;
  INSERT INTO public.turno(organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,origen,estado,nota_reserva_cifrado,modalidad)
    VALUES(p_org,original.paciente_id,original.servicio_id,original.profesional_id,p_inicio,duration,original.precio_cents,
      'MANUAL','AGENDADO',original.nota_reserva_cifrado,original.modalidad) RETURNING id INTO replacement;
  -- History and the uncertain-provider boundary remain intact. A worker holding
  -- an old lease cannot acknowledge or retry it after this cancellation.
  UPDATE public.recordatorio_job SET delivery_state='terminal',error_msg='appointment_cancelled',lease_token=NULL,lease_until=NULL
    WHERE organization_id=p_org AND turno_id=original.id AND enviado_ts IS NULL;
  INSERT INTO public.recordatorio_job(organization_id,turno_id,tipo,scheduled_ts) VALUES
    (p_org,replacement,'CONFIRMACION_24H',p_inicio-interval '24 hours'),
    (p_org,replacement,'RECORDATORIO_2H',p_inicio-interval '2 hours');
  -- M107's turno trigger persists cancellation + new Google intent at commit.
  -- Do not copy the previous room, external event ID, payments or clinical data.
  INSERT INTO folio_reschedule_private.receipt(organization_id,actor_id,operation_id,original_turno_id,replacement_turno_id,bound_input)
    VALUES(p_org,actor.id,p_operation,original.id,replacement,bound);
  RETURN jsonb_build_object('nuevoTurnoId',replacement,'reused',false);
END $$;
REVOKE ALL ON FUNCTION folio_reschedule_private.reschedule(uuid,uuid,uuid,timestamptz,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA folio_reschedule_private TO authenticated;
GRANT EXECUTE ON FUNCTION folio_reschedule_private.reschedule(uuid,uuid,uuid,timestamptz,integer) TO authenticated;
CREATE FUNCTION public.reschedule_turno_atomic(p_org uuid,p_operation uuid,p_turno uuid,p_inicio timestamptz,p_duracion integer DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT folio_reschedule_private.reschedule(p_org,p_operation,p_turno,p_inicio,p_duracion);
$$;
REVOKE ALL ON FUNCTION public.reschedule_turno_atomic(uuid,uuid,uuid,timestamptz,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_turno_atomic(uuid,uuid,uuid,timestamptz,integer) TO authenticated;
