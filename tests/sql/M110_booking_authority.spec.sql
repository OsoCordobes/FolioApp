-- Synthetic authorization and receipt regressions; all fixtures roll back.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.booking_authority_uid',true),'')::uuid $$;
CREATE FUNCTION pg_temp.bid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('11010000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.btime(n int) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$ SELECT '2030-01-01T10:00:00Z'::timestamptz+make_interval(hours=>n) $$;
CREATE FUNCTION pg_temp.bidentity() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('nombre_cifrado','\x01','apellido_cifrado','\x02','telefono_cifrado','\x03','nombre_hash',repeat('a',64),'telefono_hash',repeat('b',64)) $$;
CREATE FUNCTION pg_temp.promote(n int,prof int DEFAULT 11,patient uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.promote_pedido_atomic(pg_temp.bid(10),pg_temp.bid(n),pg_temp.bid(prof),pg_temp.bid(30),pg_temp.btime(n),patient,CASE WHEN patient IS NULL THEN pg_temp.bidentity() END) $$;
CREATE FUNCTION pg_temp.denied(label text,statement text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN
 BEGIN
  EXECUTE statement;
  IF current_setting('test.booking_authority_red',true)='on' THEN RAISE EXCEPTION USING ERRCODE='Z1101',MESSAGE=label;END IF;
  RAISE EXCEPTION 'M110 AUTHORITY FAIL: %',label;
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 WHEN SQLSTATE 'Z1101' THEN RAISE NOTICE 'RED verified (successful effect rolled back): %',label;
 END;
END $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
GRANT SELECT ON public.member,public.organization,public.paciente,public.paciente_identidad,public.turno TO authenticated;
INSERT INTO auth.users(id,email) SELECT pg_temp.bid(n),'booking-authority-'||n||'@synthetic.invalid' FROM generate_series(1,3) n;
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version) SELECT id,email,now(),'v1' FROM auth.users WHERE id IN(pg_temp.bid(1),pg_temp.bid(2),pg_temp.bid(3));
INSERT INTO public.organization(id,slug,nombre,auto_confirmar_reservas,slot_margen_min) VALUES(pg_temp.bid(10),'m110-authority','Synthetic authorization',true,0);
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at)
 VALUES(pg_temp.bid(11),pg_temp.bid(10),pg_temp.bid(1),'OWNER',true,now()),
 (pg_temp.bid(12),pg_temp.bid(10),pg_temp.bid(2),'PROFESIONAL',true,now()),
 (pg_temp.bid(13),pg_temp.bid(10),pg_temp.bid(3),'PROFESIONAL',true,now());
INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
 VALUES(pg_temp.bid(30),pg_temp.bid(10),'Synthetic',enum_first(NULL::tipo_servicio_canonico),30,100);
INSERT INTO public.pedido(id,organization_id,canal,nombre_cifrado,telefono_cifrado,profesional_id,servicio_id,fecha_propuesta,duracion_min,precio_cents)
 SELECT pg_temp.bid(n),pg_temp.bid(10),'TELEFONO','\x01','\x02',pg_temp.bid(11),pg_temp.bid(30),pg_temp.btime(n),30,100 FROM generate_series(100,115) n;
INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,tipo_doc,telefono_cifrado)
 VALUES(pg_temp.bid(40),pg_temp.bid(10),'\x01','\x02','DNI','\x03');
INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id) VALUES(pg_temp.bid(41),pg_temp.bid(10),pg_temp.bid(40),pg_temp.bid(12));
UPDATE public.pedido SET paciente_id=pg_temp.bid(41) WHERE id=pg_temp.bid(104);
UPDATE public.pedido SET profesional_id=pg_temp.bid(12) WHERE id IN(pg_temp.bid(105),pg_temp.bid(107));
UPDATE public.pedido SET profesional_id=pg_temp.bid(13) WHERE id IN(pg_temp.bid(110),pg_temp.bid(111));
SELECT set_config('test.booking_authority_uid',pg_temp.bid(1)::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.promote(100,12),pg_temp.promote(101,11),pg_temp.promote(109,13);
RESET ROLE;
UPDATE public.member SET role='PROFESIONAL',alcance='TODOS' WHERE id=pg_temp.bid(11);
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied('PROFESIONAL/TODOS creates in colleague agenda','SELECT pg_temp.promote(102,12)');
SELECT pg_temp.denied('PROFESIONAL/TODOS recovers colleague receipt','SELECT pg_temp.promote(100,12)');
SELECT pg_temp.denied('Caller forges own destination to recover colleague receipt','SELECT pg_temp.promote(100,11)');
SELECT pg_temp.denied('PROFESIONAL adopts an unassigned existing patient','SELECT pg_temp.promote(104,11,pg_temp.bid(41))');
SELECT pg_temp.denied('PROFESIONAL takes another agenda request for own agenda','SELECT pg_temp.promote(110,11)');
DO $$ DECLARE r jsonb;BEGIN
 r:=pg_temp.promote(103,11);
 IF (r->>'reused')::boolean OR NOT (pg_temp.promote(103,11)->>'reused')::boolean OR NOT (pg_temp.promote(101,11)->>'reused')::boolean THEN RAISE EXCEPTION 'M110 own agenda create/replay lost';END IF;
END $$;
RESET ROLE;
UPDATE public.member SET role='ASISTENTE',es_colegiado=false,alcance='LISTA_PROFESIONALES',profesionales_gestionados=ARRAY[pg_temp.bid(12)::text] WHERE id=pg_temp.bid(11);
SET LOCAL ROLE authenticated;
SELECT pg_temp.promote(105,12);
SELECT pg_temp.denied('Assistant creates outside assigned agenda','SELECT pg_temp.promote(106,13)');
SELECT pg_temp.denied('Assistant recovers outside assigned agenda','SELECT pg_temp.promote(109,13)');
SELECT pg_temp.denied('Assistant takes an outside request into assigned agenda','SELECT pg_temp.promote(111,12)');
DO $$ BEGIN IF NOT (pg_temp.promote(100,12)->>'reused')::boolean THEN RAISE EXCEPTION 'M110 assigned assistant replay lost';END IF;END $$;
RESET ROLE;
UPDATE public.member SET role='COORDINADOR' WHERE id=pg_temp.bid(11);
SET LOCAL ROLE authenticated;
SELECT pg_temp.promote(107,12);
SELECT pg_temp.denied('Coordinator creates outside assigned agenda','SELECT pg_temp.promote(108,13)');
RESET ROLE;
UPDATE public.member SET role='OWNER',es_colegiado=true,alcance='TODOS',profesionales_gestionados='{}' WHERE id=pg_temp.bid(11);

-- Each revocation is isolated; organization deletion cascades to membership.
SAVEPOINT changed;
UPDATE public.organization SET deleted_at=now() WHERE id=pg_temp.bid(10);
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied('Deleted organization receipt','SELECT pg_temp.promote(100,12)');
RESET ROLE;ROLLBACK TO SAVEPOINT changed;
UPDATE public.member SET deleted_at=now() WHERE id=pg_temp.bid(12);
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied('Revoked destination professional receipt','SELECT pg_temp.promote(100,12)');
RESET ROLE;ROLLBACK TO SAVEPOINT changed;
UPDATE public.member SET accepted_at=NULL,invited_by_id=pg_temp.bid(1) WHERE id=pg_temp.bid(12);
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied('Unaccepted destination professional receipt','SELECT pg_temp.promote(100,12)');
RESET ROLE;ROLLBACK TO SAVEPOINT changed;
UPDATE public.turno SET deleted_at=now() WHERE id=(SELECT turno_id FROM folio_booking_private.conversion WHERE pedido_id=pg_temp.bid(100));
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied('Deleted appointment receipt','SELECT pg_temp.promote(100,12)');
RESET ROLE;ROLLBACK TO SAVEPOINT changed;
UPDATE public.paciente SET caja_fuerte_profesional=pg_temp.bid(13) WHERE id=(SELECT paciente_id FROM folio_booking_private.conversion WHERE pedido_id=pg_temp.bid(100));
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied('Protected patient receipt','SELECT pg_temp.promote(100,12)');
RESET ROLE;ROLLBACK TO SAVEPOINT changed;
UPDATE public.paciente SET deleted_at=now() WHERE id=(SELECT paciente_id FROM folio_booking_private.conversion WHERE pedido_id=pg_temp.bid(100));
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied('Deleted patient receipt','SELECT pg_temp.promote(100,12)');
RESET ROLE;ROLLBACK TO SAVEPOINT changed;
UPDATE public.paciente_identidad SET deleted_at=now() WHERE id=(SELECT identidad_id FROM public.paciente WHERE id=(SELECT paciente_id FROM folio_booking_private.conversion WHERE pedido_id=pg_temp.bid(100)));
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied('Deleted identity receipt','SELECT pg_temp.promote(100,12)');
RESET ROLE;ROLLBACK TO SAVEPOINT changed;
-- The actual appointment, not the submitted professional ID, defines current access.
UPDATE public.turno SET profesional_id=pg_temp.bid(12) WHERE id=(SELECT turno_id FROM folio_booking_private.conversion WHERE pedido_id=pg_temp.bid(101));
UPDATE public.member SET role='PROFESIONAL' WHERE id=pg_temp.bid(11);
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied('Receipt agenda changed after creation','SELECT pg_temp.promote(101,11)');
RESET ROLE;ROLLBACK TO SAVEPOINT changed;
UPDATE public.member SET role='PROFESIONAL' WHERE id=pg_temp.bid(11);
UPDATE public.paciente SET profesional_principal_id=pg_temp.bid(12) WHERE id=(SELECT paciente_id FROM folio_booking_private.conversion WHERE pedido_id=pg_temp.bid(101));
SET LOCAL ROLE authenticated;
SELECT pg_temp.denied('Receipt patient assignment revoked','SELECT pg_temp.promote(101,11)');
RESET ROLE;ROLLBACK TO SAVEPOINT changed;
-- Existing patients remain usable when assignment or an actual prior care
-- encounter grants access; these positive fixtures are also rolled back.
UPDATE public.member SET role='PROFESIONAL' WHERE id=pg_temp.bid(11);
UPDATE public.paciente SET profesional_principal_id=pg_temp.bid(11) WHERE id=pg_temp.bid(41);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb;BEGIN
 r:=pg_temp.promote(104,11,pg_temp.bid(41));
 IF r->>'pacienteId'<>pg_temp.bid(41)::text OR NOT (pg_temp.promote(104,11,pg_temp.bid(41))->>'reused')::boolean THEN RAISE EXCEPTION 'M110 assigned patient create/replay lost';END IF;
END $$;
RESET ROLE;ROLLBACK TO SAVEPOINT changed;
UPDATE public.member SET role='PROFESIONAL' WHERE id=pg_temp.bid(11);
INSERT INTO public.turno(organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,origen,estado)
 VALUES(pg_temp.bid(10),pg_temp.bid(41),pg_temp.bid(30),pg_temp.bid(11),'2020-01-01T12:00:00Z',30,100,'MANUAL','EN_SALA');
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF pg_temp.promote(104,11,pg_temp.bid(41))->>'pacienteId'<>pg_temp.bid(41)::text THEN RAISE EXCEPTION 'M110 prior attending clinician lost patient access';END IF;END $$;
RESET ROLE;ROLLBACK TO SAVEPOINT changed;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.paciente WHERE organization_id=pg_temp.bid(10))<>7
 OR (SELECT count(*) FROM public.turno WHERE organization_id=pg_temp.bid(10))<>6
 OR (SELECT count(*) FROM folio_booking_private.conversion WHERE organization_id=pg_temp.bid(10))<>6
 OR (SELECT count(*) FROM public.recordatorio_job WHERE organization_id=pg_temp.bid(10))<>12
 OR (SELECT count(*) FROM public.booking_followup_job WHERE organization_id=pg_temp.bid(10))<>6 THEN RAISE EXCEPTION 'M110 authorization regression left extra effects';END IF;
END $$;
ROLLBACK;
