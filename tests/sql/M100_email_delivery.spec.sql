BEGIN;
DO $$
DECLARE
 o uuid:=gen_random_uuid(); synthetic uuid:=gen_random_uuid(); u uuid:=gen_random_uuid();
 m uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); t uuid:=gen_random_uuid();
 e public.email_delivery%ROWTYPE; newer public.email_delivery%ROWTYPE; j public.recordatorio_job%ROWTYPE;
 stale uuid; n integer; caught boolean:=false;
 sub_id uuid:=gen_random_uuid(); bill_id uuid:=gen_random_uuid();
BEGIN
 IF has_table_privilege('authenticated','public.email_delivery','SELECT') OR
    has_function_privilege('authenticated','public.email_claim(integer,uuid)','EXECUTE') OR
    has_function_privilege('anon','public.recordatorio_claim(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'M100 public queue access'; END IF;
 IF NOT has_function_privilege('service_role','public.email_claim(integer,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'M100 service claim denied'; END IF;
 INSERT INTO public.organization(id,slug,nombre) VALUES(o,'m100-spec-'||o,'Synthetic SQL test');
 INSERT INTO public.organization(id,slug,nombre,is_synthetic) VALUES(synthetic,'m100-syn-'||synthetic,'Synthetic SQL test',true);
 BEGIN UPDATE public.organization SET is_synthetic=false WHERE id=synthetic;
 EXCEPTION WHEN insufficient_privilege THEN caught:=true; END;
 IF NOT caught THEN RAISE EXCEPTION 'M100 synthetic mark can be removed'; END IF;
 -- Calling SQL role check is independent from organization OWNER membership.
 caught:=false;
 BEGIN
   PERFORM set_config('role','authenticated',true);
   INSERT INTO public.organization(slug,nombre,is_synthetic) VALUES('m100-forbidden','Forbidden',true);
 EXCEPTION WHEN insufficient_privilege THEN caught:=true; END;
 PERFORM set_config('role','none',true);
 IF NOT caught THEN RAISE EXCEPTION 'M100 public synthetic flag write'; END IF;
 SELECT * INTO e FROM public.email_enqueue(o,repeat('a',64),'booking','encrypted-original');
 SELECT * INTO newer FROM public.email_enqueue(o,repeat('a',64),'booking','changed-content');
 IF e.id<>newer.id OR newer.payload_cifrado<>'encrypted-original' THEN RAISE EXCEPTION 'M100 immutable dedupe failed'; END IF;
 SELECT * INTO e FROM public.email_claim(1,e.id);
 IF e.status<>'leased' OR e.attempts<>1 THEN RAISE EXCEPTION 'M100 first lease failed'; END IF;
 SELECT count(*) INTO n FROM public.email_claim(1,e.id);
 IF n<>0 THEN RAISE EXCEPTION 'M100 in-flight email double claimed'; END IF;
 stale:=e.lease_token;
 UPDATE public.email_delivery SET lease_until=now()-interval '1 second' WHERE id=e.id;
 SELECT * INTO newer FROM public.email_claim(1,e.id);
 IF newer.lease_token=stale OR newer.attempts<>2 THEN RAISE EXCEPTION 'M100 expired lease not reclaimed'; END IF;
 IF public.email_finish(e.id,stale,'accepted','stale-receipt') THEN RAISE EXCEPTION 'M100 stale completion accepted'; END IF;
 IF NOT public.email_finish(e.id,newer.lease_token,'accepted','provider-receipt') THEN RAISE EXCEPTION 'M100 current completion rejected'; END IF;
 SELECT * INTO e FROM public.email_delivery WHERE id=e.id;
 IF e.status<>'accepted' OR e.delivered_at IS NOT NULL OR e.payload_cifrado IS NOT NULL THEN
   RAISE EXCEPTION 'M100 acceptance/delivery/retention conflated'; END IF;
 SELECT * INTO e FROM public.email_enqueue(o,repeat('b',64),'booking','encrypted-original');
 UPDATE public.email_delivery SET first_attempt_at=now()-interval '24 hours' WHERE id=e.id;
 PERFORM * FROM public.email_claim(1,e.id);
 SELECT * INTO e FROM public.email_delivery WHERE id=e.id;
 IF e.status<>'terminal' OR e.sanitized_error<>'idempotency_window_expired' THEN RAISE EXCEPTION 'M100 expired idempotency replayed'; END IF;
 SELECT * INTO e FROM public.email_enqueue(synthetic,repeat('c',64),'booking','encrypted-original');
 IF e.status<>'terminal' OR e.payload_cifrado IS NOT NULL THEN RAISE EXCEPTION 'M100 synthetic mail queued'; END IF;
 -- Backoff permits recovery without permanently reserving the notification.
 SELECT * INTO e FROM public.email_enqueue(o,repeat('d',64),'booking','encrypted-original');
 SELECT * INTO e FROM public.email_claim(1,e.id);
 PERFORM public.email_finish(e.id,e.lease_token,'retryable',NULL,'provider_http_429');
 SELECT * INTO e FROM public.email_delivery WHERE id=e.id;
 IF e.status<>'retryable' OR e.available_at<=now() OR e.payload_cifrado IS NULL THEN RAISE EXCEPTION 'M100 retryable lost'; END IF;

 INSERT INTO auth.users(id,email) VALUES(u,'m100@example.invalid');
 INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES(u,'m100@example.invalid',now(),'v1');
 INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES(m,o,u,'OWNER',true,now());
 INSERT INTO public.paciente(id,organization_id) VALUES(p,o);
 INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
 VALUES(s,o,'Synthetic administrative appointment','SEGUIMIENTO_ESTANDAR',30,100000);
 INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents)
 VALUES(t,o,p,s,m,now()+interval '2 hours',30,100000);
 INSERT INTO public.recordatorio_job(organization_id,turno_id,tipo,scheduled_ts)
 VALUES(o,t,'RECORDATORIO_2H',now()-interval '1 minute');
 SELECT * INTO j FROM public.recordatorio_claim(1);
 IF j.delivery_state<>'leased' THEN RAISE EXCEPTION 'M100 reminder lease failed'; END IF;
 SELECT count(*) INTO n FROM public.recordatorio_claim(1);
 IF n<>0 THEN RAISE EXCEPTION 'M100 overlapping reminder claim'; END IF;
 stale:=j.lease_token;
 UPDATE public.recordatorio_job SET lease_until=now()-interval '1 second' WHERE id=j.id;
 SELECT * INTO j FROM public.recordatorio_claim(1);
 IF public.recordatorio_finish(j.id,stale,'accepted','email','stale') THEN RAISE EXCEPTION 'M100 stale reminder completion'; END IF;
 UPDATE public.recordatorio_job SET external_started_at=now(),canal='whatsapp',lease_until=now()-interval '1 second' WHERE id=j.id;
 PERFORM * FROM public.recordatorio_claim(1);
 SELECT * INTO j FROM public.recordatorio_job WHERE id=j.id;
 IF j.delivery_state<>'terminal' OR j.error_msg<>'provider_response_unknown' OR j.enviado_ts IS NOT NULL THEN
 RAISE EXCEPTION 'M100 ambiguous WhatsApp resent or reported accepted'; END IF;
 INSERT INTO public.suscripcion(id,organization_id,payer_email) VALUES(sub_id,o,'synthetic@example.invalid');
 INSERT INTO public.billing_followup_job(id,organization_id,subscription_id,job_type,idempotency_key,status)
 VALUES(bill_id,o,sub_id,'subscription_activated','m100-billing-'||bill_id,'terminal');
 SELECT * INTO e FROM public.email_enqueue(o,repeat('e',64),'billing_subscription_activated','encrypted-original',NULL,NULL,NULL,bill_id);
 SELECT * INTO e FROM public.email_claim(1,e.id);
 PERFORM public.email_finish(e.id,e.lease_token,'accepted','late-provider-receipt');
 IF NOT EXISTS(SELECT 1 FROM public.billing_followup_job WHERE id=bill_id AND status='accepted' AND provider_id='late-provider-receipt') THEN
   RAISE EXCEPTION 'M100 asynchronous email receipt left billing status stale'; END IF;
 RAISE NOTICE 'M100 durable delivery assertions passed';
END $$;
ROLLBACK;
