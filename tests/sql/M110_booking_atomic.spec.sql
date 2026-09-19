BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.booking_uid',true),'')::uuid $$;
INSERT INTO auth.users(id,email) VALUES('11000000-0000-4000-8000-000000000001','booking@synthetic.invalid');
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES('11000000-0000-4000-8000-000000000001','booking@synthetic.invalid',now(),'v1');
INSERT INTO organization(id,slug,nombre,auto_confirmar_reservas,slot_margen_min) VALUES('11000000-0000-4000-8000-000000000010','m110-synthetic','Synthetic',true,0);
INSERT INTO member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES('11000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000010','11000000-0000-4000-8000-000000000001','OWNER',true,now());
INSERT INTO servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES('11000000-0000-4000-8000-000000000020','11000000-0000-4000-8000-000000000010','Synthetic',enum_first(null::tipo_servicio_canonico),30,100);
INSERT INTO disponibilidad_profesional(organization_id,member_id,dia_semana,hora_inicio,hora_fin,vigencia_desde)
SELECT '11000000-0000-4000-8000-000000000010','11000000-0000-4000-8000-000000000011',n,'09:00','17:00',current_date-1 FROM generate_series(0,6) n;
INSERT INTO pedido(id,organization_id,canal,nombre_cifrado,telefono_cifrado,profesional_id,servicio_id,fecha_propuesta,duracion_min,precio_cents)
SELECT ('11000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'11000000-0000-4000-8000-000000000010','TELEFONO','\x01','\x02','11000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000020',now()+make_interval(days=>n-29),30,100 FROM generate_series(30,32) n;
CREATE FUNCTION pg_temp.booking_identity() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"nombre_cifrado":"\\x01","apellido_cifrado":"\\x02","telefono_cifrado":"\\x03","nombre_hash":"same-name","telefono_hash":"shared-household"}'::jsonb $$;
SELECT set_config('test.booking_uid','11000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;r2 jsonb;org uuid:='11000000-0000-4000-8000-000000000010';prof uuid:='11000000-0000-4000-8000-000000000011';sv uuid:='11000000-0000-4000-8000-000000000020';BEGIN
 r:=public.promote_pedido_atomic(org,'11000000-0000-4000-8000-000000000030',prof,sv,now()+interval '1 day',NULL,pg_temp.booking_identity());
 r2:=public.promote_pedido_atomic(org,'11000000-0000-4000-8000-000000000030',prof,sv,now()+interval '1 day',NULL,pg_temp.booking_identity());
 IF r->>'turnoId' IS DISTINCT FROM r2->>'turnoId' OR r->>'pacienteId' IS DISTINCT FROM r2->>'pacienteId' THEN RAISE EXCEPTION 'M110 duplicate conversion';END IF;
 r2:=public.promote_pedido_atomic(org,'11000000-0000-4000-8000-000000000031',prof,sv,now()+interval '2 days',NULL,pg_temp.booking_identity());
 IF r->>'pacienteId'=r2->>'pacienteId' THEN RAISE EXCEPTION 'M110 shared household merged patients';END IF;
 BEGIN PERFORM public.promote_pedido_atomic(org,'11000000-0000-4000-8000-000000000032',prof,sv,now()+interval '3 days',(r->>'pacienteId')::uuid,pg_temp.booking_identity());RAISE EXCEPTION 'M110 arbitrary patient adopted';EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM turno WHERE organization_id='11000000-0000-4000-8000-000000000010')<>2 OR (SELECT count(*) FROM recordatorio_job WHERE organization_id='11000000-0000-4000-8000-000000000010')<>4 OR (SELECT count(*) FROM booking_followup_job WHERE organization_id='11000000-0000-4000-8000-000000000010')<>2 THEN RAISE EXCEPTION 'M110 duplicate effects';END IF;
END $$;
CREATE FUNCTION pg_temp.fail_booking_turn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='11000000-0000-4000-8000-000000000010' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Synthetic failure after patient insertion';END IF;RETURN NEW;END $$;
CREATE TRIGGER m110_failure BEFORE INSERT ON turno FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_booking_turn();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.promote_pedido_atomic('11000000-0000-4000-8000-000000000010','11000000-0000-4000-8000-000000000032','11000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000020',now()+interval '3 days',NULL,pg_temp.booking_identity());RAISE EXCEPTION 'M110 failure committed';EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
RESET ROLE;
DROP TRIGGER m110_failure ON turno;
DO $$ BEGIN
 IF (SELECT count(*) FROM paciente WHERE organization_id='11000000-0000-4000-8000-000000000010')<>2 OR (SELECT count(*) FROM paciente_identidad WHERE organization_id='11000000-0000-4000-8000-000000000010')<>2 OR (SELECT estado FROM pedido WHERE id='11000000-0000-4000-8000-000000000032')<>'PENDIENTE' THEN RAISE EXCEPTION 'M110 rollback left orphans';END IF;
END $$;
SELECT set_config('test.booking_uid','',true);
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb;r2 jsonb;start_at timestamptz:=((now() AT TIME ZONE 'America/Argentina/Cordoba')::date+interval '4 days 9 hours') AT TIME ZONE 'America/Argentina/Cordoba';data jsonb:='{"nombre_cifrado":"\\x01","telefono_cifrado":"\\x02","consent_version":"2026-09-08"}';BEGIN
 BEGIN PERFORM public.promote_pedido_atomic('11000000-0000-4000-8000-000000000010','11000000-0000-4000-8000-000000000032','11000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000020',start_at,NULL,pg_temp.booking_identity());RAISE EXCEPTION 'M110 service adopted nonpublic request';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 r:=public.submit_public_booking('m110-synthetic','11000000-0000-4000-8000-000000000090',repeat('a',64),'11000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000020',start_at,data,pg_temp.booking_identity());
 r2:=public.submit_public_booking('m110-synthetic','11000000-0000-4000-8000-000000000090',repeat('a',64),'11000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000020',start_at,data,pg_temp.booking_identity());
 IF r IS DISTINCT FROM r2 OR NOT(r->>'autoConfirmado')::boolean THEN RAISE EXCEPTION 'M110 public replay changed result';END IF;
 BEGIN PERFORM public.public_booking_receipt('m110-synthetic','11000000-0000-4000-8000-000000000090',repeat('b',64));RAISE EXCEPTION 'M110 changed public intent accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.promote_pedido_atomic(uuid,uuid,uuid,uuid,timestamptz,uuid,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.submit_public_booking(text,uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'M110 privileged API exposed';END IF;
END $$;
-- Public pending mode retains one request and durable notifications, rejects forged times.
UPDATE public.organization SET auto_confirmar_reservas=false WHERE id='11000000-0000-4000-8000-000000000010';
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb;r2 jsonb;j public.booking_followup_job;start_at timestamptz:=((now() AT TIME ZONE 'America/Argentina/Cordoba')::date+interval '5 days 9 hours') AT TIME ZONE 'America/Argentina/Cordoba';data jsonb:='{"nombre_cifrado":"\\x01","telefono_cifrado":"\\x02","consent_version":"synthetic-v1"}';BEGIN
 BEGIN PERFORM public.submit_public_booking('m110-synthetic','11000000-0000-4000-8000-000000000091',repeat('a',64),'11000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000020',start_at+interval '7 minutes',data,pg_temp.booking_identity());RAISE EXCEPTION 'M110 forged slot accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 r:=public.submit_public_booking('m110-synthetic','11000000-0000-4000-8000-000000000092',repeat('a',64),'11000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000020',start_at,data,pg_temp.booking_identity());
 r2:=public.submit_public_booking('m110-synthetic','11000000-0000-4000-8000-000000000092',repeat('a',64),'11000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000020',start_at,data,pg_temp.booking_identity());
 IF r IS DISTINCT FROM r2 OR (r->>'autoConfirmado')::boolean THEN RAISE EXCEPTION 'M110 pending request not idempotent';END IF;
 SELECT * INTO j FROM public.booking_claim_followups(1);
 IF j.id IS NULL OR public.booking_finish_followup(j.id,gen_random_uuid(),true,false) THEN RAISE EXCEPTION 'M110 missing lease or stale lease accepted';END IF;
 IF NOT public.booking_finish_followup(j.id,j.lease_token,true,false) OR public.booking_finish_followup(j.id,j.lease_token,true,false) THEN RAISE EXCEPTION 'M110 followup completion not fenced';END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM folio_booking_private.submission WHERE organization_id='11000000-0000-4000-8000-000000000010')<>2 THEN RAISE EXCEPTION 'M110 forged slot left receipt';END IF;
 IF (SELECT count(*) FROM pedido WHERE organization_id='11000000-0000-4000-8000-000000000010' AND canal='WEB')<>2 THEN RAISE EXCEPTION 'M110 duplicated public request';END IF;
END $$;
-- Current actor and entity authority is checked by the privileged transaction.
SELECT set_config('test.booking_uid','11000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.promote_pedido_atomic('11000000-0000-4000-8000-000000000010','11000000-0000-4000-8000-000000000032','11000000-0000-4000-8000-000000000099','11000000-0000-4000-8000-000000000020',now()+interval '3 days',NULL,pg_temp.booking_identity());RAISE EXCEPTION 'M110 foreign professional accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN PERFORM public.promote_pedido_atomic('11000000-0000-4000-8000-000000000010','11000000-0000-4000-8000-000000000032','11000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000099',now()+interval '3 days',NULL,pg_temp.booking_identity());RAISE EXCEPTION 'M110 foreign service accepted';EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
RESET ROLE;
-- Declining an already-converted request cannot detach its receipt.
GRANT SELECT,UPDATE ON public.pedido TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN UPDATE public.pedido SET estado='RECHAZADO',rechazado_motivo='Synthetic rejection' WHERE id='11000000-0000-4000-8000-000000000030';RAISE EXCEPTION 'M110 confirmed request rewritten';EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
RESET ROLE;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"aal":"aal1"}'::jsonb $$;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.promote_pedido_atomic('11000000-0000-4000-8000-000000000010','11000000-0000-4000-8000-000000000030',NULL,NULL,NULL,NULL,NULL);RAISE EXCEPTION 'M110 receipt bypassed MFA';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK;
