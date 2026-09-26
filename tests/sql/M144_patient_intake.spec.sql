-- Synthetic B09a contract. This spec never commits fixtures.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m144_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m144_jwt',true),''),'{}')::jsonb $$;
CREATE FUNCTION pg_temp.m144_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('14400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.m144_login(n integer,aal text DEFAULT 'aal2') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('test.m144_uid',pg_temp.m144_id(n)::text,true);
 PERFORM set_config('test.m144_jwt',jsonb_build_object('aal',aal,'session_id',pg_temp.m144_id(900+n))::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
END $$;
CREATE FUNCTION pg_temp.m144_expect(query text,code text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE query;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=code THEN RETURN; END IF;
  RAISE EXCEPTION 'M144 expected %, got %: %',code,SQLSTATE,SQLERRM;
 END;
 RAISE EXCEPTION 'M144 expected %, statement succeeded',code;
END $$;

DO $$ BEGIN
 IF has_table_privilege('anon','folio_intake_private.invitation','SELECT')
  OR has_table_privilege('authenticated','folio_intake_private.submission','SELECT')
  OR has_table_privilege('service_role','folio_intake_private.submission','INSERT')
  OR has_table_privilege('service_role','folio_intake_private.event','SELECT')
  OR has_function_privilege('anon','public.patient_intake_issue(uuid,uuid,bytea)','EXECUTE')
  OR has_function_privilege('authenticated','public.patient_intake_submit(text,uuid,text,text,bytea)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.patient_intake_submit(text,uuid,text,text,bytea)','EXECUTE') THEN
  RAISE EXCEPTION 'M144 private grant boundary changed';
 END IF;
END $$;

INSERT INTO auth.users(id,email) SELECT pg_temp.m144_id(n),'m144-'||n||'@synthetic.invalid'
 FROM generate_series(1,6) n;
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version)
 SELECT pg_temp.m144_id(n),'m144-'||n||'@synthetic.invalid',now(),'v1'
 FROM generate_series(1,6) n;
INSERT INTO public.organization(id,slug,nombre) VALUES
 (pg_temp.m144_id(10),'m144-one','Synthetic B09a one'),
 (pg_temp.m144_id(20),'m144-two','Synthetic B09a two');
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
 (pg_temp.m144_id(11),pg_temp.m144_id(10),pg_temp.m144_id(1),'OWNER',true,now()),
 (pg_temp.m144_id(12),pg_temp.m144_id(10),pg_temp.m144_id(2),'PROFESIONAL',true,now()),
 (pg_temp.m144_id(13),pg_temp.m144_id(10),pg_temp.m144_id(3),'COORDINADOR',false,now()),
 (pg_temp.m144_id(21),pg_temp.m144_id(20),pg_temp.m144_id(4),'OWNER',true,now()),
 (pg_temp.m144_id(14),pg_temp.m144_id(10),pg_temp.m144_id(5),'DIRECTOR',false,now()),
 (pg_temp.m144_id(15),pg_temp.m144_id(10),pg_temp.m144_id(6),'ASISTENTE',false,now());
INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado) VALUES
 (pg_temp.m144_id(31),pg_temp.m144_id(10),'\x01','\x02','\x03'),
 (pg_temp.m144_id(32),pg_temp.m144_id(10),'\x04','\x05','\x06'),
 (pg_temp.m144_id(35),pg_temp.m144_id(10),'\x0a','\x0b','\x0c'),
 (pg_temp.m144_id(41),pg_temp.m144_id(20),'\x07','\x08','\x09');
INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id) VALUES
 (pg_temp.m144_id(33),pg_temp.m144_id(10),pg_temp.m144_id(31),pg_temp.m144_id(12)),
 (pg_temp.m144_id(34),pg_temp.m144_id(10),pg_temp.m144_id(35),pg_temp.m144_id(12)),
 (pg_temp.m144_id(43),pg_temp.m144_id(20),pg_temp.m144_id(41),pg_temp.m144_id(21));
INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES
 (pg_temp.m144_id(51),pg_temp.m144_id(10),'Synthetic','CONSULTA_INICIAL',30,0),
 (pg_temp.m144_id(52),pg_temp.m144_id(20),'Synthetic','CONSULTA_INICIAL',30,0);
INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents)
 VALUES(pg_temp.m144_id(61),pg_temp.m144_id(10),pg_temp.m144_id(33),pg_temp.m144_id(51),pg_temp.m144_id(12),now()+interval '3 days',30,0),
 (pg_temp.m144_id(62),pg_temp.m144_id(20),pg_temp.m144_id(43),pg_temp.m144_id(52),pg_temp.m144_id(21),now()+interval '3 days',30,0);
INSERT INTO auth.mfa_factors(id,user_id,status)
 SELECT pg_temp.m144_id(800+n),pg_temp.m144_id(n),'verified' FROM generate_series(1,6) n;
INSERT INTO auth.sessions(id,user_id,aal,factor_id)
 SELECT pg_temp.m144_id(900+n),pg_temp.m144_id(n),'aal2',pg_temp.m144_id(800+n)
 FROM generate_series(1,6) n;

SELECT pg_temp.m144_login(1,'aal1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.m144_expect($q$SELECT public.patient_intake_issue(pg_temp.m144_id(10),pg_temp.m144_id(61),decode(repeat('aa',60),'hex'))$q$,'42501');
SELECT pg_temp.m144_expect($q$SELECT * FROM folio_intake_private.invitation$q$,'42501');
SELECT pg_temp.m144_expect($q$SELECT public.patient_intake_issue(pg_temp.m144_id(20),pg_temp.m144_id(62),decode(repeat('aa',60),'hex'))$q$,'42501');
RESET ROLE;

-- Administrative review follows the current role/scope matrix.
SELECT pg_temp.m144_login(2);
SET LOCAL ROLE authenticated;
SELECT public.patient_intake_review(pg_temp.m144_id(10),pg_temp.m144_id(61));
RESET ROLE;
SELECT pg_temp.m144_login(3);
SET LOCAL ROLE authenticated;
SELECT public.patient_intake_review(pg_temp.m144_id(10),pg_temp.m144_id(61));
RESET ROLE;
SELECT pg_temp.m144_login(5);
SET LOCAL ROLE authenticated;
SELECT public.patient_intake_review(pg_temp.m144_id(10),pg_temp.m144_id(61));
RESET ROLE;
SELECT pg_temp.m144_login(6);
SET LOCAL ROLE authenticated;
SELECT public.patient_intake_review(pg_temp.m144_id(10),pg_temp.m144_id(61));
RESET ROLE;
SELECT pg_temp.m144_login(4);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m144_expect($q$SELECT public.patient_intake_review(pg_temp.m144_id(10),pg_temp.m144_id(61))$q$,'42501');
RESET ROLE;
SELECT pg_temp.m144_login(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m144_expect($q$SELECT public.patient_intake_review(pg_temp.m144_id(10),pg_temp.m144_id(62))$q$,'42501');
RESET ROLE;
UPDATE public.member SET alcance='LISTA_PROFESIONALES',profesionales_gestionados=ARRAY[pg_temp.m144_id(21)::text]
 WHERE id IN (pg_temp.m144_id(13),pg_temp.m144_id(15));
SELECT pg_temp.m144_login(3);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m144_expect($q$SELECT public.patient_intake_review(pg_temp.m144_id(10),pg_temp.m144_id(61))$q$,'42501');
RESET ROLE;
SELECT pg_temp.m144_login(6);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m144_expect($q$SELECT public.patient_intake_review(pg_temp.m144_id(10),pg_temp.m144_id(61))$q$,'42501');
RESET ROLE;
UPDATE public.member SET alcance='TODOS',profesionales_gestionados='{}'
 WHERE id IN (pg_temp.m144_id(13),pg_temp.m144_id(15));
UPDATE public.paciente SET profesional_principal_id=NULL WHERE id=pg_temp.m144_id(33);
SELECT pg_temp.m144_login(2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m144_expect($q$SELECT public.patient_intake_review(pg_temp.m144_id(10),pg_temp.m144_id(61))$q$,'42501');
RESET ROLE;
UPDATE public.paciente SET profesional_principal_id=pg_temp.m144_id(12) WHERE id=pg_temp.m144_id(33);

SELECT pg_temp.m144_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE issued jsonb;
BEGIN
 issued:=public.patient_intake_issue(pg_temp.m144_id(10),pg_temp.m144_id(61),decode(repeat('aa',60),'hex'));
 IF issued->>'token' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'M144 weak invitation'; END IF;
 PERFORM set_config('test.m144_invitation',issued::text,true);
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.m144_expect($q$SELECT * FROM folio_intake_private.submission$q$,'42501');
DO $$ DECLARE exchanged jsonb; key_info jsonb;
BEGIN
 exchanged:=public.patient_intake_exchange(encode(sha256(decode((current_setting('test.m144_invitation',true)::jsonb)->>'token','hex')),'hex'));
 IF exchanged->>'session' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'M144 weak session'; END IF;
 PERFORM set_config('test.m144_session',exchanged::text,true);
 key_info:=public.patient_intake_submission_key(encode(sha256(decode(exchanged->>'session','hex')),'hex'));
 IF key_info->>'invitationId' IS DISTINCT FROM (current_setting('test.m144_invitation',true)::jsonb)->>'invitationId'
  OR key_info->>'keyCipherBase64' IS NULL THEN
  RAISE EXCEPTION 'M144 session key is not bound to invitation';
 END IF;
END $$;
DO $$ DECLARE token text; first_result jsonb; reused jsonb; state jsonb;
BEGIN
 token:=encode(sha256(decode((current_setting('test.m144_session',true)::jsonb)->>'session','hex')),'hex');
 first_result:=public.patient_intake_submit(token,pg_temp.m144_id(71),'admin.v1',repeat('a',64),decode(repeat('bb',64),'hex'));
 reused:=public.patient_intake_submit(token,pg_temp.m144_id(71),'admin.v1',repeat('a',64),decode(repeat('cc',64),'hex'));
 IF first_result->>'receiptId' IS DISTINCT FROM reused->>'receiptId' OR (reused->>'reused')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'M144 receipt not idempotent';
 END IF;
 state:=public.patient_intake_operation_status(token,pg_temp.m144_id(71));
 IF state->>'status' IS DISTINCT FROM 'received' OR state ? 'answers' THEN
  RAISE EXCEPTION 'M144 public state not minimal';
 END IF;
 IF public.patient_intake_operation_status(token,pg_temp.m144_id(72))->>'status' IS DISTINCT FROM 'not_received' THEN
  RAISE EXCEPTION 'M144 missing operation state';
 END IF;
 PERFORM pg_temp.m144_expect(format($q$SELECT public.patient_intake_submit(%L,pg_temp.m144_id(71),'admin.v1',%L,decode(repeat('dd',64),'hex'))$q$,token,repeat('b',64)),'40001');
END $$;
RESET ROLE;

SELECT pg_temp.m144_expect($q$UPDATE folio_intake_private.submission
 SET answers_cifrado=decode(repeat('dd',64),'hex') WHERE operation_id=pg_temp.m144_id(71)$q$,'42501');
SELECT pg_temp.m144_expect($q$DELETE FROM folio_intake_private.submission
 WHERE operation_id=pg_temp.m144_id(71)$q$,'42501');
UPDATE folio_intake_private.session SET issued_at=now()-interval '48 hours',
 expires_at=now()-interval '24 hours'
 WHERE token_hash=encode(sha256(decode((current_setting('test.m144_session',true)::jsonb)->>'session','hex')),'hex');
SET LOCAL ROLE service_role;
DO $$ DECLARE token text;
BEGIN
 token:=encode(sha256(decode((current_setting('test.m144_session',true)::jsonb)->>'session','hex')),'hex');
 PERFORM pg_temp.m144_expect(format('SELECT public.patient_intake_operation_status(%L,pg_temp.m144_id(71))',token),'42501');
END $$;
RESET ROLE;

-- Reissue revokes the session and does not change the previous receipt.
SELECT pg_temp.m144_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE issued jsonb;
BEGIN
 issued:=public.patient_intake_issue(pg_temp.m144_id(10),pg_temp.m144_id(61),decode(repeat('dd',60),'hex'));
 PERFORM set_config('test.m144_reissued',issued::text,true);
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ DECLARE token text;
BEGIN
 token:=encode(sha256(decode((current_setting('test.m144_session',true)::jsonb)->>'session','hex')),'hex');
 PERFORM pg_temp.m144_expect(format('SELECT public.patient_intake_operation_status(%L,pg_temp.m144_id(71))',token),'42501');
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM folio_intake_private.session
  WHERE token_hash=encode(sha256(decode((current_setting('test.m144_session',true)::jsonb)->>'session','hex')),'hex')
  AND revoked_at IS NULL) THEN
  RAISE EXCEPTION 'M144 reissue did not revoke prior session';
 END IF;
END $$;

-- Turn date X -> Y -> X cannot revive the currently issued invitation.
UPDATE public.turno SET inicio=inicio+interval '1 hour' WHERE id=pg_temp.m144_id(61);
UPDATE public.turno SET inicio=inicio-interval '1 hour' WHERE id=pg_temp.m144_id(61);
DO $$ BEGIN
 IF (SELECT intake_revision FROM public.turno WHERE id=pg_temp.m144_id(61))<>2 THEN
  RAISE EXCEPTION 'M144 turn date ABA revision did not advance';
 END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE token text;
BEGIN
 token:=encode(sha256(decode((current_setting('test.m144_reissued',true)::jsonb)->>'token','hex')),'hex');
 PERFORM pg_temp.m144_expect(format('SELECT public.patient_intake_exchange(%L)',token),'42501');
END $$;
RESET ROLE;

SELECT pg_temp.m144_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE issued jsonb;
BEGIN
 issued:=public.patient_intake_issue(pg_temp.m144_id(10),pg_temp.m144_id(61),decode(repeat('ee',60),'hex'));
 PERFORM set_config('test.m144_link_token',issued::text,true);
END $$;
RESET ROLE;
-- Identity A -> B -> A cannot revive the current invitation.
UPDATE public.paciente SET identidad_id=pg_temp.m144_id(32) WHERE id=pg_temp.m144_id(33);
UPDATE public.paciente SET identidad_id=pg_temp.m144_id(31) WHERE id=pg_temp.m144_id(33);
DO $$ BEGIN
 IF (SELECT identity_link_revision FROM public.paciente WHERE id=pg_temp.m144_id(33))<>2 THEN
  RAISE EXCEPTION 'M144 link revision did not advance';
 END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE token text;
BEGIN
 token:=encode(sha256(decode((current_setting('test.m144_link_token',true)::jsonb)->>'token','hex')),'hex');
 PERFORM pg_temp.m144_expect(format('SELECT public.patient_intake_exchange(%L)',token),'42501');
END $$;
RESET ROLE;

-- Each restored entity gets its own freshly issued token before the ABA.
SELECT pg_temp.m144_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE issued jsonb;
BEGIN
 issued:=public.patient_intake_issue(pg_temp.m144_id(10),pg_temp.m144_id(61),decode(repeat('e1',60),'hex'));
 PERFORM set_config('test.m144_org_token',issued::text,true);
END $$;
RESET ROLE;
UPDATE public.organization SET deleted_at=now() WHERE id=pg_temp.m144_id(10);
UPDATE public.organization SET deleted_at=NULL WHERE id=pg_temp.m144_id(10);
-- M37 intentionally leaves members soft-deleted on org restoration. Restore
-- only these synthetic fixture members so the rejection isolates org revision.
UPDATE public.member SET deleted_at=NULL WHERE organization_id=pg_temp.m144_id(10);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.member WHERE organization_id=pg_temp.m144_id(10) AND deleted_at IS NOT NULL) THEN
  RAISE EXCEPTION 'M144 org ABA fixture membership was not restored';
 END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE token text;
BEGIN
 token:=encode(sha256(decode((current_setting('test.m144_org_token',true)::jsonb)->>'token','hex')),'hex');
 PERFORM pg_temp.m144_expect(format('SELECT public.patient_intake_exchange(%L)',token),'42501');
END $$;
RESET ROLE;

SELECT pg_temp.m144_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE issued jsonb;
BEGIN
 issued:=public.patient_intake_issue(pg_temp.m144_id(10),pg_temp.m144_id(61),decode(repeat('e2',60),'hex'));
 PERFORM set_config('test.m144_patient_token',issued::text,true);
END $$;
RESET ROLE;
UPDATE public.paciente SET deleted_at=now() WHERE id=pg_temp.m144_id(33);
UPDATE public.paciente SET deleted_at=NULL WHERE id=pg_temp.m144_id(33);
SET LOCAL ROLE service_role;
DO $$ DECLARE token text;
BEGIN
 token:=encode(sha256(decode((current_setting('test.m144_patient_token',true)::jsonb)->>'token','hex')),'hex');
 PERFORM pg_temp.m144_expect(format('SELECT public.patient_intake_exchange(%L)',token),'42501');
END $$;
RESET ROLE;

SELECT pg_temp.m144_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE issued jsonb;
BEGIN
 issued:=public.patient_intake_issue(pg_temp.m144_id(10),pg_temp.m144_id(61),decode(repeat('e3',60),'hex'));
 PERFORM set_config('test.m144_identity_token',issued::text,true);
END $$;
RESET ROLE;
UPDATE public.paciente_identidad SET deleted_at=now() WHERE id=pg_temp.m144_id(31);
UPDATE public.paciente_identidad SET deleted_at=NULL WHERE id=pg_temp.m144_id(31);
SET LOCAL ROLE service_role;
DO $$ DECLARE token text;
BEGIN
 token:=encode(sha256(decode((current_setting('test.m144_identity_token',true)::jsonb)->>'token','hex')),'hex');
 PERFORM pg_temp.m144_expect(format('SELECT public.patient_intake_exchange(%L)',token),'42501');
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT intake_revision FROM public.organization WHERE id=pg_temp.m144_id(10))<>2
  OR (SELECT intake_revision FROM public.paciente WHERE id=pg_temp.m144_id(33))<>2
  OR (SELECT intake_revision FROM public.paciente_identidad WHERE id=pg_temp.m144_id(31))<>2 THEN
  RAISE EXCEPTION 'M144 soft-delete restoration revision did not advance';
 END IF;
END $$;
UPDATE public.turno SET paciente_id=pg_temp.m144_id(34) WHERE id=pg_temp.m144_id(61);
UPDATE public.turno SET paciente_id=pg_temp.m144_id(33) WHERE id=pg_temp.m144_id(61);
DO $$ BEGIN
 IF (SELECT intake_revision FROM public.turno WHERE id=pg_temp.m144_id(61))<>4 THEN
  RAISE EXCEPTION 'M144 turn patient ABA revision did not advance';
 END IF;
END $$;

-- A fresh proposal remains reviewable after arrival and encounter start.
SELECT pg_temp.m144_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE issued jsonb;
BEGIN
 issued:=public.patient_intake_issue(pg_temp.m144_id(10),pg_temp.m144_id(61),decode(repeat('ef',60),'hex'));
 PERFORM set_config('test.m144_final_invitation',issued::text,true);
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ DECLARE exchanged jsonb;
BEGIN
 exchanged:=public.patient_intake_exchange(encode(sha256(decode(
  (current_setting('test.m144_final_invitation',true)::jsonb)->>'token','hex')),'hex'));
 PERFORM set_config('test.m144_final_session',exchanged::text,true);
 PERFORM public.patient_intake_submit(encode(sha256(decode(exchanged->>'session','hex')),'hex'),
  pg_temp.m144_id(73),'admin.v1',repeat('c',64),decode(repeat('fe',64),'hex'));
END $$;
RESET ROLE;
UPDATE public.turno SET estado='CONFIRMADO' WHERE id=pg_temp.m144_id(61);
UPDATE public.turno SET estado='EN_SALA' WHERE id=pg_temp.m144_id(61);
DO $$ BEGIN
 IF (SELECT intake_revision FROM public.turno WHERE id=pg_temp.m144_id(61))<>4 THEN
  RAISE EXCEPTION 'M144 ordinary arrival invalidated intake';
 END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE token text;
BEGIN
 token:=encode(sha256(decode((current_setting('test.m144_final_session',true)::jsonb)->>'session','hex')),'hex');
 IF public.patient_intake_operation_status(token,pg_temp.m144_id(73))->>'status' IS DISTINCT FROM 'received' THEN
  RAISE EXCEPTION 'M144 arrival invalidated session';
 END IF;
END $$;
RESET ROLE;
UPDATE public.turno SET estado='ATENDIENDO',atendiendo_desde=now() WHERE id=pg_temp.m144_id(61);
SELECT pg_temp.m144_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE proposals jsonb;
BEGIN
 proposals:=public.patient_intake_review(pg_temp.m144_id(10),pg_temp.m144_id(61));
 IF jsonb_array_length(proposals)<1 THEN RAISE EXCEPTION 'M144 encounter hid received proposal'; END IF;
END $$;
RESET ROLE;
UPDATE public.turno SET estado='CERRADO',atendiendo_desde=NULL WHERE id=pg_temp.m144_id(61);
SELECT pg_temp.m144_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE proposals jsonb;
BEGIN
 proposals:=public.patient_intake_review(pg_temp.m144_id(10),pg_temp.m144_id(61));
 IF jsonb_array_length(proposals)<1 THEN RAISE EXCEPTION 'M144 close hid received proposal'; END IF;
END $$;
RESET ROLE;

-- Portal cancellation must pass M84/M91's full-row guard before M144 advances
-- the intake revision. This exercises the real RLS and BEFORE triggers.
INSERT INTO auth.users(id,email) VALUES(pg_temp.m144_id(7),'m144-portal@synthetic.invalid');
INSERT INTO public.paciente_cuenta(id,auth_user_id,email)
 VALUES(pg_temp.m144_id(70),pg_temp.m144_id(7),'m144-portal@synthetic.invalid');
UPDATE public.paciente SET cuenta_id=pg_temp.m144_id(70) WHERE id=pg_temp.m144_id(33);
INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,estado)
 VALUES(pg_temp.m144_id(63),pg_temp.m144_id(10),pg_temp.m144_id(33),pg_temp.m144_id(51),
  pg_temp.m144_id(12),now()+interval '7 days',30,0,'CONFIRMADO');
SELECT pg_temp.m144_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE issued jsonb;
BEGIN
 issued:=public.patient_intake_issue(pg_temp.m144_id(10),pg_temp.m144_id(63),decode(repeat('f1',60),'hex'));
 PERFORM set_config('test.m144_portal_invitation',issued::text,true);
END $$;
RESET ROLE;
GRANT SELECT, UPDATE ON public.turno TO authenticated;
GRANT SELECT ON public.paciente,public.member TO authenticated;
SELECT pg_temp.m144_login(7);
SET LOCAL ROLE authenticated;
DO $$ DECLARE blocked boolean:=false;
BEGIN
 BEGIN
  UPDATE public.turno SET estado='CANCELADO',deleted_at=now() WHERE id=pg_temp.m144_id(63);
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM NOT LIKE 'portal: sólo se puede cambiar el estado%' THEN RAISE; END IF;
  blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'M144 portal tampering was allowed'; END IF;
END $$;
DO $$ DECLARE changed integer;
BEGIN
 UPDATE public.turno SET estado='CANCELADO' WHERE id=pg_temp.m144_id(63);
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>1 THEN RAISE EXCEPTION 'M144 portal cancellation did not update the visit'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.turno WHERE id=pg_temp.m144_id(63)
  AND estado='CANCELADO' AND deleted_at IS NULL AND intake_revision=1) THEN
  RAISE EXCEPTION 'M144 portal cancellation did not advance intake revision';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM folio_intake_private.invitation
  WHERE turno_id=pg_temp.m144_id(63) AND turno_intake_revision=0) THEN
  RAISE EXCEPTION 'M144 portal invitation revision fixture changed';
 END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE token text;
BEGIN
 token:=encode(sha256(decode((current_setting('test.m144_portal_invitation',true)::jsonb)->>'token','hex')),'hex');
 PERFORM pg_temp.m144_expect(format('SELECT public.patient_intake_exchange(%L)',token),'55000');
END $$;
RESET ROLE;
-- State resurrection is also rejected by the existing M09 transition guard.
SELECT pg_temp.m144_login(1);
SELECT pg_temp.m144_expect($q$UPDATE public.turno SET estado='CONFIRMADO' WHERE id=pg_temp.m144_id(63)$q$,'P0001');
ROLLBACK;
