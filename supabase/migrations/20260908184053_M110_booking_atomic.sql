-- M110: additive booking receipts and transactional conversion. No external sends.
BEGIN;
CREATE SCHEMA folio_booking_private;
REVOKE ALL ON SCHEMA folio_booking_private FROM PUBLIC,anon,authenticated;
CREATE TABLE folio_booking_private.conversion (
 pedido_id uuid PRIMARY KEY REFERENCES public.pedido(id),organization_id uuid NOT NULL REFERENCES public.organization(id),
 turno_id uuid NOT NULL UNIQUE REFERENCES public.turno(id),paciente_id uuid NOT NULL REFERENCES public.paciente(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE folio_booking_private.submission (
 organization_id uuid NOT NULL REFERENCES public.organization(id),operation_id uuid NOT NULL,request_hash text NOT NULL,
 pedido_id uuid NOT NULL UNIQUE REFERENCES public.pedido(id),result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,operation_id)
);
ALTER TABLE folio_booking_private.conversion ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_booking_private.submission ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA folio_booking_private FROM PUBLIC,anon,authenticated;
-- Only conversions created by the new API become immutable receipts. Legacy UI
-- writes remain compatible while the additive migration precedes deployment.
CREATE FUNCTION folio_booking_private.guard_conversion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF ROW(NEW.organization_id,NEW.estado,NEW.paciente_id,NEW.profesional_id,NEW.servicio_id,NEW.fecha_propuesta)
  IS DISTINCT FROM ROW(OLD.organization_id,OLD.estado,OLD.paciente_id,OLD.profesional_id,OLD.servicio_id,OLD.fecha_propuesta)
  AND EXISTS(SELECT 1 FROM folio_booking_private.conversion WHERE pedido_id=OLD.id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Converted booking receipt is immutable';
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION folio_booking_private.guard_conversion() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER booking_conversion_immutable BEFORE UPDATE ON public.pedido FOR EACH ROW EXECUTE FUNCTION folio_booking_private.guard_conversion();
CREATE TABLE public.booking_followup_job (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES public.organization(id),
 pedido_id uuid NOT NULL REFERENCES public.pedido(id),turno_id uuid REFERENCES public.turno(id),
 kind text NOT NULL CHECK(kind IN('confirmed_email','received_email','staff_request_email')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','leased','complete','terminal')),
 available_at timestamptz NOT NULL DEFAULT now(),lease_token uuid,lease_until timestamptz,attempts int NOT NULL DEFAULT 0,
 sanitized_error text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(pedido_id,kind)
);
ALTER TABLE public.booking_followup_job ENABLE ROW LEVEL SECURITY;
CREATE POLICY folio_mfa_gate ON public.booking_followup_job AS RESTRICTIVE FOR ALL TO authenticated
 USING((SELECT public.mfa_access_allowed())) WITH CHECK((SELECT public.mfa_access_allowed()));
REVOKE ALL ON public.booking_followup_job FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.booking_followup_job TO service_role;
CREATE INDEX booking_followup_due ON public.booking_followup_job(available_at,id) WHERE status IN('pending','leased');

CREATE FUNCTION public.promote_pedido_atomic(p_org uuid,p_pedido uuid,p_profesional uuid,p_servicio uuid,p_inicio timestamptz,p_expected_patient uuid,p_identity jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pe public.pedido;sv public.servicio;org public.organization;prof public.member;patient public.paciente;
 receipt folio_booking_private.conversion;identity_id uuid;patient_id uuid;turn_id uuid;duration int;price int;actor uuid;
 service_call boolean:=current_setting('role',true)='service_role';origin public.origen_turno;
BEGIN
 IF NOT service_call THEN
  PERFORM folio_mfa_private.assert_access();actor:=public.user_member_id_in(p_org);
  IF actor IS NULL OR public.user_role_in(p_org) NOT IN('OWNER','DIRECTOR','PROFESIONAL','COORDINADOR','ASISTENTE') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current staff access required';END IF;
  PERFORM 1 FROM public.member WHERE id=actor AND organization_id=p_org AND profile_id=auth.uid() AND deleted_at IS NULL
   AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current accepted staff required';END IF;
 END IF;
 SELECT * INTO org FROM public.organization WHERE id=p_org AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current organization required';END IF;
 SELECT * INTO pe FROM public.pedido WHERE id=p_pedido AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Request organization mismatch';END IF;
 IF service_call AND (pe.canal<>'WEB' OR org.opt_out_public_listing OR NOT org.auto_confirmar_reservas OR NOT EXISTS(SELECT 1 FROM folio_booking_private.submission r WHERE r.pedido_id=pe.id AND r.organization_id=p_org)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Public confirmation authority missing';END IF;
 SELECT * INTO receipt FROM folio_booking_private.conversion WHERE pedido_id=pe.id;
 IF FOUND THEN
  IF p_expected_patient IS NOT NULL AND p_expected_patient<>receipt.paciente_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Request patient cannot be replaced';END IF;
  RETURN jsonb_build_object('turnoId',receipt.turno_id,'pacienteId',receipt.paciente_id,'reused',true);
 END IF;
 IF pe.estado<>'PENDIENTE' THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Request already processed without a conversion receipt';END IF;
 IF p_expected_patient IS DISTINCT FROM pe.paciente_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Request patient cannot be replaced';END IF;
 IF service_call AND (pe.paciente_id IS NOT NULL OR p_profesional IS DISTINCT FROM pe.profesional_id OR p_servicio IS DISTINCT FROM pe.servicio_id OR p_inicio IS DISTINCT FROM pe.fecha_propuesta) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Public confirmation must match its persisted request';END IF;
 SELECT * INTO sv FROM public.servicio WHERE id=p_servicio AND organization_id=p_org AND activo AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current service required';END IF;
 SELECT * INTO prof FROM public.member WHERE id=p_profesional AND organization_id=p_org AND deleted_at IS NULL AND es_colegiado AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current professional required';END IF;
 IF p_inicio IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Appointment time required';END IF;
 duration:=CASE WHEN p_servicio=pe.servicio_id THEN pe.duracion_min ELSE sv.duracion_min END;
 price:=CASE WHEN p_servicio=pe.servicio_id THEN coalesce(pe.precio_cents,0) ELSE coalesce(sv.precio_cents,0) END;
 PERFORM pg_advisory_xact_lock(hashtextextended('booking-slot:'||p_org::text||':'||p_profesional::text,0));
 IF public.slot_ocupado(p_org,p_inicio,p_inicio+make_interval(mins=>duration),p_pedido,p_profesional,NULL) THEN
  RAISE EXCEPTION USING ERRCODE='23P01',MESSAGE='Requested time no longer available';END IF;
 IF pe.paciente_id IS NOT NULL THEN
  SELECT * INTO patient FROM public.paciente WHERE id=pe.paciente_id AND organization_id=p_org AND deleted_at IS NULL AND pseudonimizado_en IS NULL FOR SHARE;
  IF NOT FOUND OR (patient.caja_fuerte_profesional IS NOT NULL AND patient.caja_fuerte_profesional IS DISTINCT FROM actor) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current scoped patient required';END IF;
  PERFORM 1 FROM public.paciente_identidad WHERE id=patient.identidad_id AND organization_id=p_org AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current scoped identity required';END IF;
  patient_id:=patient.id;
 ELSE
  IF p_identity IS NULL OR jsonb_typeof(p_identity)<>'object' OR p_identity->>'nombre_cifrado' IS NULL OR p_identity->>'apellido_cifrado' IS NULL OR p_identity->>'telefono_cifrado' IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Validated new patient identity required';END IF;
  INSERT INTO public.paciente_identidad(organization_id,nombre_cifrado,apellido_cifrado,tipo_doc,telefono_cifrado,email_cifrado,nombre_hash,telefono_hash)
   VALUES(p_org,(p_identity->>'nombre_cifrado')::bytea,(p_identity->>'apellido_cifrado')::bytea,'DNI',(p_identity->>'telefono_cifrado')::bytea,(p_identity->>'email_cifrado')::bytea,p_identity->>'nombre_hash',p_identity->>'telefono_hash') RETURNING id INTO identity_id;
  INSERT INTO public.paciente(organization_id,identidad_id,motivo_consulta_cifrado,tags,profesional_principal_id)
   VALUES(p_org,identity_id,pe.motivo_cifrado,'{}',p_profesional) RETURNING id INTO patient_id;
 END IF;
 origin:=CASE pe.canal WHEN 'WEB' THEN 'BOOKING'::public.origen_turno WHEN 'WHATSAPP' THEN 'WHATSAPP'::public.origen_turno WHEN 'INSTAGRAM' THEN 'BOOKING'::public.origen_turno WHEN 'PORTAL' THEN 'BOOKING'::public.origen_turno ELSE 'MANUAL'::public.origen_turno END;
 INSERT INTO public.turno(organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,origen,estado,nota_reserva_cifrado)
 VALUES(p_org,patient_id,p_servicio,p_profesional,p_inicio,duration,price,origin,'CONFIRMADO',pe.motivo_cifrado) RETURNING id INTO turn_id;
 UPDATE public.pedido SET estado='CONFIRMADO',confirmado_ts=now(),paciente_id=patient_id,
 nombre_cifrado=CASE WHEN pe.paciente_id IS NULL THEN coalesce((p_identity->>'pedido_nombre_cifrado')::bytea,pe.nombre_cifrado) ELSE pe.nombre_cifrado END,
 telefono_cifrado=CASE WHEN pe.paciente_id IS NULL THEN (p_identity->>'telefono_cifrado')::bytea ELSE pe.telefono_cifrado END,
 email_cifrado=CASE WHEN pe.paciente_id IS NULL THEN (p_identity->>'email_cifrado')::bytea ELSE pe.email_cifrado END,profesional_id=p_profesional,servicio_id=p_servicio,fecha_propuesta=p_inicio,duracion_min=duration,precio_cents=price WHERE id=p_pedido;
 INSERT INTO folio_booking_private.conversion(pedido_id,organization_id,turno_id,paciente_id) VALUES(p_pedido,p_org,turn_id,patient_id);
 INSERT INTO public.recordatorio_job(organization_id,turno_id,tipo,scheduled_ts) VALUES
 (p_org,turn_id,'CONFIRMACION_24H',p_inicio-interval '24 hours'),(p_org,turn_id,'RECORDATORIO_2H',p_inicio-interval '2 hours') ON CONFLICT(turno_id,tipo) DO NOTHING;
 INSERT INTO public.booking_followup_job(organization_id,pedido_id,turno_id,kind) VALUES(p_org,p_pedido,turn_id,'confirmed_email') ON CONFLICT(pedido_id,kind) DO NOTHING;
 UPDATE public.booking_followup_job SET status='terminal',sanitized_error='request_confirmed',lease_token=NULL,lease_until=NULL WHERE pedido_id=p_pedido AND kind IN('received_email','staff_request_email') AND status='pending';
 RETURN jsonb_build_object('turnoId',turn_id,'pacienteId',patient_id,'reused',false);
END $$;
REVOKE ALL ON FUNCTION public.promote_pedido_atomic(uuid,uuid,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.promote_pedido_atomic(uuid,uuid,uuid,uuid,timestamptz,uuid,jsonb) TO authenticated,service_role;

CREATE FUNCTION public.public_booking_receipt(p_slug text,p_operation uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r folio_booking_private.submission;BEGIN
 SELECT r0.* INTO r FROM folio_booking_private.submission r0 JOIN public.organization o ON o.id=r0.organization_id AND o.deleted_at IS NULL AND NOT o.opt_out_public_listing
 WHERE o.slug=p_slug AND r0.operation_id=p_operation;
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF r.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Booking operation was reused for different details';END IF;
 RETURN r.result;
END $$;
REVOKE ALL ON FUNCTION public.public_booking_receipt(text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.public_booking_receipt(text,uuid,text) TO service_role;

CREATE FUNCTION public.submit_public_booking(p_slug text,p_operation uuid,p_hash text,p_profesional uuid,p_servicio uuid,p_inicio timestamptz,p_data jsonb,p_identity jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE org public.organization;sv public.servicio;existing jsonb;pe_id uuid;promoted jsonb;outcome jsonb;local_start timestamp;BEGIN
 IF p_operation IS NULL OR coalesce(p_hash,'')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Stable booking operation required';END IF;
 SELECT * INTO org FROM public.organization WHERE slug=p_slug AND deleted_at IS NULL AND NOT opt_out_public_listing FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Public organization unavailable';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('booking-request:'||org.id::text||':'||p_operation::text,0));
 existing:=public.public_booking_receipt(p_slug,p_operation,p_hash);IF existing IS NOT NULL THEN RETURN existing;END IF;
 SELECT * INTO sv FROM public.servicio WHERE id=p_servicio AND organization_id=org.id AND activo AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current public service required';END IF;
 PERFORM 1 FROM public.member WHERE id=p_profesional AND organization_id=org.id AND deleted_at IS NULL AND es_colegiado AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current public professional required';END IF;
 IF p_inicio IS NULL OR p_inicio<=now() OR p_inicio>now()+interval '60 days' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current offered appointment time required';END IF;
 local_start:=p_inicio AT TIME ZONE 'America/Argentina/Cordoba';
 PERFORM 1 FROM public.disponibilidad_profesional d WHERE d.organization_id=org.id AND d.member_id=p_profesional AND d.activa
  AND d.dia_semana=extract(dow FROM local_start) AND d.vigencia_desde<=local_start::date AND (d.vigencia_hasta IS NULL OR d.vigencia_hasta>=local_start::date)
  AND local_start::time>=d.hora_inicio::time AND local_start+make_interval(mins=>sv.duracion_min)<=local_start::date+d.hora_fin::time
  AND mod(extract(epoch FROM (local_start::time-d.hora_inicio::time)),(sv.duracion_min+greatest(0,coalesce(org.slot_margen_min,0)))*60)=0 FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requested time is not an offered slot';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('booking-slot:'||org.id::text||':'||p_profesional::text,0));
 IF public.slot_ocupado(org.id,p_inicio,p_inicio+make_interval(mins=>sv.duracion_min),NULL,p_profesional,NULL) THEN RAISE EXCEPTION USING ERRCODE='23P01',MESSAGE='Requested time no longer available';END IF;
 IF p_data IS NULL OR p_data->>'nombre_cifrado' IS NULL OR p_data->>'telefono_cifrado' IS NULL OR coalesce(p_data->>'consent_version','')='' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Validated booking and consent required';END IF;
 INSERT INTO public.pedido(organization_id,canal,estado,nombre_cifrado,telefono_cifrado,email_cifrado,fecha_propuesta,duracion_min,servicio_id,profesional_id,motivo_cifrado,precio_cents,consent_aceptado_en,consent_ip,consent_user_agent,consent_version)
 VALUES(org.id,'WEB','PENDIENTE',(p_data->>'nombre_cifrado')::bytea,(p_data->>'telefono_cifrado')::bytea,(p_data->>'email_cifrado')::bytea,p_inicio,sv.duracion_min,sv.id,p_profesional,(p_data->>'motivo_cifrado')::bytea,sv.precio_cents,now(),(p_data->>'consent_ip')::inet,p_data->>'consent_user_agent',p_data->>'consent_version') RETURNING id INTO pe_id;
 outcome:=jsonb_build_object('id',pe_id,'autoConfirmado',false);
 INSERT INTO folio_booking_private.submission(organization_id,operation_id,request_hash,pedido_id,result) VALUES(org.id,p_operation,p_hash,pe_id,outcome);
 IF org.auto_confirmar_reservas THEN
  promoted:=public.promote_pedido_atomic(org.id,pe_id,p_profesional,sv.id,p_inicio,NULL,p_identity);
  outcome:=jsonb_build_object('id',pe_id,'autoConfirmado',true);
  UPDATE folio_booking_private.submission SET result=outcome WHERE organization_id=org.id AND operation_id=p_operation;
 ELSE
  INSERT INTO public.booking_followup_job(organization_id,pedido_id,kind) VALUES(org.id,pe_id,'received_email'),(org.id,pe_id,'staff_request_email');
 END IF;
 RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION public.submit_public_booking(text,uuid,text,uuid,uuid,timestamptz,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_booking(text,uuid,text,uuid,uuid,timestamptz,jsonb,jsonb) TO service_role;

CREATE FUNCTION public.booking_claim_followups(p_limit int DEFAULT 10) RETURNS SETOF public.booking_followup_job
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH picked AS(SELECT j.id FROM public.booking_followup_job j JOIN public.organization o ON o.id=j.organization_id AND o.deleted_at IS NULL AND NOT o.is_synthetic
 WHERE j.status IN('pending','leased') AND j.available_at<=now() AND (j.lease_until IS NULL OR j.lease_until<=now()) ORDER BY j.available_at,j.id LIMIT greatest(1,least(p_limit,10)) FOR UPDATE OF j SKIP LOCKED)
 UPDATE public.booking_followup_job j SET status='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1 FROM picked WHERE j.id=picked.id RETURNING j.*;
$$;
CREATE FUNCTION public.booking_finish_followup(p_id uuid,p_lease uuid,p_success boolean,p_terminal boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 UPDATE public.booking_followup_job SET status=CASE WHEN p_success THEN 'complete' WHEN p_terminal THEN 'terminal' ELSE 'pending' END,
 available_at=now()+make_interval(secs=>least(3600,30*greatest(1,attempts))),lease_token=NULL,lease_until=NULL,sanitized_error=CASE WHEN p_success THEN NULL WHEN p_terminal THEN 'notification_unavailable' ELSE 'notification_retry' END
 WHERE id=p_id AND status='leased' AND lease_token=p_lease AND lease_until>now();RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.booking_claim_followups(int),public.booking_finish_followup(uuid,uuid,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.booking_claim_followups(int),public.booking_finish_followup(uuid,uuid,boolean,boolean) TO service_role;
COMMIT;
