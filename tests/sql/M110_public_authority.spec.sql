-- Public receipt proves original submission; it never grants clinical access.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.public_authority_uid',true),'')::uuid $$;
CREATE FUNCTION pg_temp.bid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('11020000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.btime(n int) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT ((now() AT TIME ZONE 'America/Argentina/Cordoba')::date+make_interval(days=>n-95,hours=>9)) AT TIME ZONE 'America/Argentina/Cordoba' $$;
CREATE FUNCTION pg_temp.book(n int) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.submit_public_booking('m110-public-authority',pg_temp.bid(n),repeat('a',64),pg_temp.bid(11),pg_temp.bid(30),pg_temp.btime(n),
 '{"nombre_cifrado":"\\x01","telefono_cifrado":"\\x02","consent_version":"synthetic-v1"}'::jsonb,
 jsonb_build_object('nombre_cifrado','\x01','apellido_cifrado','\x02','telefono_cifrado','\x03','nombre_hash',repeat('a',64),'telefono_hash',repeat('b',64))) $$;
CREATE FUNCTION pg_temp.conversion(n int) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE pe public.pedido;BEGIN
 SELECT p.* INTO pe FROM public.pedido p JOIN folio_booking_private.submission s ON s.pedido_id=p.id WHERE s.organization_id=pg_temp.bid(10) AND s.operation_id=pg_temp.bid(n);
 RETURN public.promote_pedido_atomic(pe.organization_id,pe.id,pe.profesional_id,pe.servicio_id,pe.fecha_propuesta,NULL,
 jsonb_build_object('nombre_cifrado','\x01','apellido_cifrado','\x02','telefono_cifrado','\x03','nombre_hash',repeat('a',64),'telefono_hash',repeat('b',64)));
END $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
INSERT INTO auth.users(id,email) SELECT pg_temp.bid(n),'public-authority-'||n||'@synthetic.invalid' FROM generate_series(1,2) n;
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version) SELECT id,email,now(),'v1' FROM auth.users WHERE id IN(pg_temp.bid(1),pg_temp.bid(2));
INSERT INTO public.organization(id,slug,nombre,auto_confirmar_reservas,slot_margen_min) VALUES(pg_temp.bid(10),'m110-public-authority','Synthetic public authority',true,0);
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at)
 VALUES(pg_temp.bid(11),pg_temp.bid(10),pg_temp.bid(1),'OWNER',true,now()),(pg_temp.bid(12),pg_temp.bid(10),pg_temp.bid(2),'PROFESIONAL',true,now());
INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES(pg_temp.bid(30),pg_temp.bid(10),'Synthetic',enum_first(NULL::tipo_servicio_canonico),30,100);
INSERT INTO public.disponibilidad_profesional(organization_id,member_id,dia_semana,hora_inicio,hora_fin,vigencia_desde)
 SELECT pg_temp.bid(10),pg_temp.bid(11),n,'09:00','17:00',current_date-1 FROM generate_series(0,6) n;
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb;r2 jsonb;c jsonb;BEGIN
 r:=pg_temp.book(100);r2:=pg_temp.book(100);c:=pg_temp.conversion(100);
 IF r IS DISTINCT FROM r2 OR NOT (r->>'autoConfirmado')::boolean OR NOT (c->>'reused')::boolean OR (SELECT count(*) FROM jsonb_object_keys(r))<>2 THEN RAISE EXCEPTION 'M110 public submission/recovery contract lost';END IF;
END $$;
RESET ROLE;
-- Turning off future auto-confirmation does not revoke the earlier receipt.
UPDATE public.organization SET auto_confirmar_reservas=false WHERE id=pg_temp.bid(10);
SET LOCAL ROLE service_role;
DO $$ BEGIN IF NOT (pg_temp.conversion(100)->>'reused')::boolean OR NOT (pg_temp.book(100)->>'autoConfirmado')::boolean THEN RAISE EXCEPTION 'M110 previous public confirmation lost after setting change';END IF;END $$;
RESET ROLE;
SAVEPOINT changed;
UPDATE public.paciente SET caja_fuerte_profesional=pg_temp.bid(12) WHERE id=(SELECT paciente_id FROM folio_booking_private.conversion c JOIN folio_booking_private.submission s USING(pedido_id) WHERE s.operation_id=pg_temp.bid(100));
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb;BEGIN
 BEGIN PERFORM pg_temp.conversion(100);RAISE EXCEPTION 'M110 public gateway recovered protected clinical IDs';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 r:=pg_temp.book(100);
 IF NOT (r->>'autoConfirmado')::boolean OR (SELECT count(*) FROM jsonb_object_keys(r))<>2 OR r?'pacienteId' OR r?'turnoId' THEN RAISE EXCEPTION 'M110 minimal public proof exposed clinical IDs or was lost';END IF;
END $$;
RESET ROLE;ROLLBACK TO SAVEPOINT changed;
UPDATE public.member SET deleted_at=now() WHERE id=pg_temp.bid(11);
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM pg_temp.conversion(100);RAISE EXCEPTION 'M110 public conversion ignored revoked professional';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;ROLLBACK TO SAVEPOINT changed;
UPDATE public.organization SET opt_out_public_listing=true WHERE id=pg_temp.bid(10);
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF public.public_booking_receipt('m110-public-authority',pg_temp.bid(100),repeat('a',64)) IS NOT NULL THEN RAISE EXCEPTION 'M110 hidden organization receipt exposed';END IF;
 BEGIN PERFORM pg_temp.book(100);RAISE EXCEPTION 'M110 hidden organization accepted public replay';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;ROLLBACK TO SAVEPOINT changed;
-- A manually resolved public request never gives service conversion rights.
SET LOCAL ROLE service_role;
DO $$ BEGIN IF (pg_temp.book(101)->>'autoConfirmado')::boolean THEN RAISE EXCEPTION 'M110 pending mode lost';END IF;END $$;
RESET ROLE;
SELECT set_config('test.public_authority_uid',pg_temp.bid(1)::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.conversion(101);
RESET ROLE;
UPDATE public.organization SET auto_confirmar_reservas=true WHERE id=pg_temp.bid(10);
SELECT set_config('test.public_authority_uid','',true);
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM pg_temp.conversion(101);RAISE EXCEPTION 'M110 public service adopted manual conversion';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF (pg_temp.book(101)->>'autoConfirmado')::boolean THEN RAISE EXCEPTION 'M110 historical public acknowledgment changed';END IF;
END $$;
RESET ROLE;
-- Elevated accidental callers still carry the original SQL role.
CREATE FUNCTION pg_temp.elevated_public_receipt() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT public.public_booking_receipt('m110-public-authority',pg_temp.bid(100),repeat('a',64)) $$;
CREATE FUNCTION pg_temp.elevated_public_submit() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT pg_temp.book(102) $$;
CREATE FUNCTION pg_temp.elevated_public_claim() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT count(*) FROM public.booking_claim_followups(1) $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM pg_temp.elevated_public_receipt();RAISE EXCEPTION 'M110 elevated client bypassed public gateway';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM pg_temp.elevated_public_submit();RAISE EXCEPTION 'M110 elevated client submitted public request';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF pg_temp.elevated_public_claim()<>0 THEN RAISE EXCEPTION 'M110 elevated client claimed provider jobs';END IF;
END $$;
RESET ROLE;
DO $$ DECLARE p record;BEGIN
 FOR p IN SELECT oid,proname,prosecdef FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('promote_pedido_atomic','public_booking_receipt','submit_public_booking','booking_claim_followups','booking_finish_followup') LOOP
  IF p.prosecdef OR has_function_privilege('anon',p.oid,'EXECUTE') OR (p.proname<>'promote_pedido_atomic' AND has_function_privilege('authenticated',p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'M110 gateway privilege boundary broken: %',p.proname;END IF;
 END LOOP;
 IF (SELECT count(*) FROM public.turno WHERE organization_id=pg_temp.bid(10))<>2 OR (SELECT count(*) FROM public.paciente WHERE organization_id=pg_temp.bid(10))<>2
 OR (SELECT count(*) FROM folio_booking_private.submission WHERE organization_id=pg_temp.bid(10))<>2 OR (SELECT count(*) FROM public.recordatorio_job WHERE organization_id=pg_temp.bid(10))<>4 THEN RAISE EXCEPTION 'M110 public retries created additional effects';END IF;
END $$;
ROLLBACK;
