-- M148 synthetic contract; fixtures and Auth stubs roll back together.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m148_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m148_jwt',true),''),'{}')::jsonb $$;
CREATE FUNCTION pg_temp.m148_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('14800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.m148_login(n integer,aal text DEFAULT 'aal2') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('test.m148_uid',pg_temp.m148_id(n)::text,true);
 PERFORM set_config('test.m148_jwt',jsonb_build_object('aal',aal,'session_id',pg_temp.m148_id(900+n))::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
END $$;
CREATE FUNCTION pg_temp.m148_expect(query text,code text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE query;
 EXCEPTION WHEN OTHERS THEN
   IF SQLSTATE=code THEN RETURN; END IF;
   RAISE EXCEPTION 'M148 expected %, got %: %',code,SQLSTATE,SQLERRM;
 END;
 RAISE EXCEPTION 'M148 expected %, statement succeeded',code;
END $$;

DO $$ BEGIN
 IF has_table_privilege('authenticated','folio_intake_private.incorporation_operation','SELECT')
  OR has_table_privilege('service_role','folio_intake_private.incorporation_operation','UPDATE')
  OR has_table_privilege('anon','folio_intake_private.incorporation_provenance','SELECT')
  OR has_function_privilege('anon','public.patient_intake_incorporation_snapshot(uuid,uuid,uuid)','EXECUTE')
  OR has_function_privilege('service_role','public.patient_intake_incorporation_snapshot(uuid,uuid,uuid)','EXECUTE')
  OR has_function_privilege('authenticated','public.patient_intake_incorporation_materialize(uuid,jsonb,text)','EXECUTE')
  OR has_function_privilege('service_role','public.patient_intake_incorporation_apply(uuid,uuid,uuid,uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.patient_intake_incorporation_snapshot(uuid,uuid,uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.patient_intake_incorporation_prepare(uuid,uuid,uuid,text[],uuid,bigint,text,uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.patient_intake_incorporation_apply(uuid,uuid,uuid,uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.patient_intake_incorporation_status(uuid,uuid,uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.patient_intake_incorporation_cancel(uuid,uuid,uuid)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.patient_intake_incorporation_materialize(uuid,jsonb,text)','EXECUTE') THEN
  RAISE EXCEPTION 'M148 grant boundary failed';
 END IF;
END $$;

-- Supabase grants table DML to authenticated and lets RLS/guards constrain rows
-- and columns. The vanilla PG16 bootstrap does not install those platform grants.
GRANT SELECT, UPDATE ON public.paciente_identidad TO authenticated;

INSERT INTO auth.users(id,email) SELECT pg_temp.m148_id(n),'m148-'||n||'@synthetic.invalid'
  FROM generate_series(1,4) n;
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version)
  SELECT pg_temp.m148_id(n),'m148-'||n||'@synthetic.invalid',now(),'v1'
  FROM generate_series(1,4) n;
INSERT INTO public.organization(id,slug,nombre) VALUES
  (pg_temp.m148_id(10),'m148-org','M148 synthetic'),
  (pg_temp.m148_id(20),'m148-foreign-org','M148 foreign tenant');
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
  (pg_temp.m148_id(11),pg_temp.m148_id(10),pg_temp.m148_id(1),'OWNER',true,now()),
  (pg_temp.m148_id(12),pg_temp.m148_id(10),pg_temp.m148_id(3),'COORDINADOR',false,now()),
  (pg_temp.m148_id(13),pg_temp.m148_id(10),pg_temp.m148_id(4),'DIRECTOR',true,now());
INSERT INTO public.paciente_cuenta(id,auth_user_id,email) VALUES
  (pg_temp.m148_id(21),pg_temp.m148_id(2),'m148-2@synthetic.invalid');
INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado)
  VALUES(pg_temp.m148_id(31),pg_temp.m148_id(10),'\x01','\x02','\x03'),
    (pg_temp.m148_id(32),pg_temp.m148_id(10),'\x04','\x05','\x06');
INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id,cuenta_id)
  VALUES(pg_temp.m148_id(41),pg_temp.m148_id(10),pg_temp.m148_id(31),pg_temp.m148_id(11),pg_temp.m148_id(21)),
    (pg_temp.m148_id(42),pg_temp.m148_id(10),pg_temp.m148_id(32),pg_temp.m148_id(11),NULL);
INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
  VALUES(pg_temp.m148_id(51),pg_temp.m148_id(10),'Synthetic','CONSULTA_INICIAL',30,0);
INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents)
  VALUES(pg_temp.m148_id(61),pg_temp.m148_id(10),pg_temp.m148_id(41),pg_temp.m148_id(51),pg_temp.m148_id(11),now()+interval '3 days',30,0),
    (pg_temp.m148_id(62),pg_temp.m148_id(10),pg_temp.m148_id(41),pg_temp.m148_id(51),pg_temp.m148_id(11),now()+interval '4 days',30,0);
INSERT INTO auth.mfa_factors(id,user_id,status) VALUES
  (pg_temp.m148_id(801),pg_temp.m148_id(1),'verified'),
  (pg_temp.m148_id(803),pg_temp.m148_id(3),'verified'),
  (pg_temp.m148_id(804),pg_temp.m148_id(4),'verified');
INSERT INTO auth.sessions(id,user_id,aal,factor_id) VALUES
  (pg_temp.m148_id(901),pg_temp.m148_id(1),'aal2',pg_temp.m148_id(801)),
  (pg_temp.m148_id(903),pg_temp.m148_id(3),'aal2',pg_temp.m148_id(803)),
  (pg_temp.m148_id(904),pg_temp.m148_id(4),'aal2',pg_temp.m148_id(804));
INSERT INTO folio_intake_private.invitation
  (id,organization_id,turno_id,paciente_id,identidad_id,identity_link_revision,
   organization_intake_revision,paciente_intake_revision,identidad_intake_revision,
   profesional_id,issued_by_member_id,turno_inicio,turno_intake_revision,
   token_hash,fingerprint_key_cifrado,expires_at)
  SELECT pg_temp.m148_id(70+t_ids.n),o.id,t.id,p.id,pi.id,p.identity_link_revision,
    o.intake_revision,p.intake_revision,pi.intake_revision,t.profesional_id,pg_temp.m148_id(11),
    t.inicio,t.intake_revision,repeat(CASE WHEN t_ids.n=61 THEN '1' ELSE '2' END,64),decode(repeat('aa',60),'hex'),
    clock_timestamp()+interval '1 hour'
  FROM (VALUES (61),(62)) t_ids(n)
  JOIN public.turno t ON t.id=pg_temp.m148_id(t_ids.n)
  JOIN public.paciente p ON p.id=t.paciente_id
  JOIN public.paciente_identidad pi ON pi.id=p.identidad_id
  JOIN public.organization o ON o.id=t.organization_id;
INSERT INTO folio_intake_private.session(id,invitation_id,token_hash,expires_at)
  VALUES(pg_temp.m148_id(141),pg_temp.m148_id(131),repeat('a',64),clock_timestamp()+interval '30 minutes'),
    (pg_temp.m148_id(142),pg_temp.m148_id(132),repeat('b',64),clock_timestamp()+interval '30 minutes');
INSERT INTO folio_intake_private.submission
  (id,invitation_id,session_id,operation_id,questionnaire_version,content_fingerprint,answers_cifrado)
  VALUES(pg_temp.m148_id(151),pg_temp.m148_id(131),pg_temp.m148_id(141),pg_temp.m148_id(171),
      'admin.v1',repeat('a',64),decode(repeat('aa',64),'hex')),
    (pg_temp.m148_id(152),pg_temp.m148_id(132),pg_temp.m148_id(142),pg_temp.m148_id(172),
      'admin.v1',repeat('b',64),decode(repeat('bb',64),'hex'));

SELECT pg_temp.m148_login(3);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m148_expect($q$SELECT public.patient_intake_incorporation_snapshot(
  pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(151))$q$,'42501');
RESET ROLE;
SELECT pg_temp.m148_login(1,'aal1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.m148_expect($q$SELECT public.patient_intake_incorporation_snapshot(
  pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(151))$q$,'42501');
RESET ROLE;

-- A valid staff session cannot cross the tenant boundary or reuse another visit's receipt.
SELECT pg_temp.m148_login(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m148_expect($q$SELECT public.patient_intake_incorporation_snapshot(
  pg_temp.m148_id(20),pg_temp.m148_id(61),pg_temp.m148_id(151))$q$,'42501');
SELECT pg_temp.m148_expect($q$SELECT public.patient_intake_incorporation_snapshot(
  pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(152))$q$,'42501');
RESET ROLE;

SELECT pg_temp.m148_login(1);
SET LOCAL ROLE authenticated;
SELECT set_config('test.m148_snapshot',public.patient_intake_incorporation_snapshot(
  pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(151))::text,true);
SELECT pg_temp.m148_expect($q$SELECT public.patient_intake_incorporation_materialize(
  pg_temp.m148_id(999),'{}'::jsonb,repeat('a',64))$q$,'42501');
SELECT set_config('test.m148_prepared',public.patient_intake_incorporation_prepare(
  pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(151),ARRAY['nombre'],
  pg_temp.m148_id(31),0,current_setting('test.m148_snapshot',true)::jsonb->>'contextHash',
  pg_temp.m148_id(181))::text,true);
DO $$ BEGIN
 IF (current_setting('test.m148_prepared',true)::jsonb)->>'status'<>'pending'
  OR NOT current_setting('test.m148_prepared',true)::jsonb ? 'sourceCipherBase64' THEN
  RAISE EXCEPTION 'M148 expected pending source for authorized editor'; END IF;
END $$;

-- An operation id is idempotent only for its original payload.
SELECT public.patient_intake_incorporation_prepare(
  pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(151),ARRAY['email'],
  pg_temp.m148_id(31),0,current_setting('test.m148_snapshot',true)::jsonb->>'contextHash',
  pg_temp.m148_id(186));
SELECT pg_temp.m148_expect(format($q$SELECT public.patient_intake_incorporation_prepare(
  %L::uuid,%L::uuid,%L::uuid,ARRAY['telefono'],%L::uuid,0,%L,%L::uuid)$q$,
  pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(151),pg_temp.m148_id(31),
  current_setting('test.m148_snapshot',true)::jsonb->>'contextHash',pg_temp.m148_id(186)),'40001');
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
SELECT set_config('test.m148_materialized',public.patient_intake_incorporation_materialize(
  (current_setting('test.m148_prepared',true)::jsonb->>'preparationId')::uuid,
  jsonb_build_object('nombre_cifrado',encode(decode(repeat('11',32),'hex'),'base64'),
    'nombre_hash',repeat('1',64)),repeat('a',64))::text,true);
SELECT public.patient_intake_incorporation_materialize(
  (current_setting('test.m148_prepared',true)::jsonb->>'preparationId')::uuid,
  jsonb_build_object('nombre_cifrado',encode(decode(repeat('22',32),'hex'),'base64'),
    'nombre_hash',repeat('2',64)),repeat('a',64));
RESET ROLE;
SELECT pg_temp.m148_login(1);
SET LOCAL ROLE authenticated;
SELECT set_config('test.m148_applied',public.patient_intake_incorporation_apply(
  pg_temp.m148_id(10),pg_temp.m148_id(61),
  (current_setting('test.m148_prepared',true)::jsonb->>'preparationId')::uuid,
  pg_temp.m148_id(181))::text,true);
RESET ROLE;
DO $$ BEGIN
 IF current_setting('test.m148_applied',true)::jsonb->>'status'<>'applied'
  OR (SELECT admin_revision FROM public.paciente_identidad WHERE id=pg_temp.m148_id(31))<>1
  OR (SELECT telefono_cifrado FROM public.paciente_identidad WHERE id=pg_temp.m148_id(31))<>'\x03'::bytea
  OR (SELECT count(*) FROM folio_intake_private.incorporation_provenance WHERE operation_id=pg_temp.m148_id(181))<>1 THEN
  RAISE EXCEPTION 'M148 selective apply/provenance failed'; END IF;
END $$;
SELECT pg_temp.m148_login(1);
SET LOCAL ROLE authenticated;
SELECT public.patient_intake_incorporation_apply(pg_temp.m148_id(10),pg_temp.m148_id(61),
  (current_setting('test.m148_prepared',true)::jsonb->>'preparationId')::uuid,pg_temp.m148_id(181));
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM folio_intake_private.incorporation_provenance WHERE operation_id=pg_temp.m148_id(181))<>1
  OR (SELECT admin_revision FROM public.paciente_identidad WHERE id=pg_temp.m148_id(31))<>1 THEN
  RAISE EXCEPTION 'M148 terminal replay duplicated write'; END IF;
END $$;

-- Portal contact remains writable even though M148 increments admin_revision.
SELECT pg_temp.m148_login(2,'aal1');
SET LOCAL ROLE authenticated;
UPDATE public.paciente_identidad SET telefono_cifrado='\x44',telefono_hash=repeat('4',64)
  WHERE id=pg_temp.m148_id(31);
RESET ROLE;
DO $$ BEGIN
 IF (SELECT admin_revision FROM public.paciente_identidad WHERE id=pg_temp.m148_id(31))<>2 THEN
  RAISE EXCEPTION 'M148 portal contact should increment revision after M86 guard'; END IF;
END $$;
SELECT pg_temp.m148_login(2,'aal1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.m148_expect($q$UPDATE public.paciente_identidad SET admin_revision=42
  WHERE id=pg_temp.m148_id(31)$q$,'42501');
RESET ROLE;

-- A cancelled absent operation is durable and cannot be revived by late prepare.
SELECT pg_temp.m148_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE state jsonb; cancelled jsonb; late jsonb;
BEGIN
 state:=public.patient_intake_incorporation_snapshot(pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(151));
 cancelled:=public.patient_intake_incorporation_cancel(pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(182));
 late:=public.patient_intake_incorporation_prepare(pg_temp.m148_id(10),pg_temp.m148_id(61),
   pg_temp.m148_id(151),ARRAY['email'],pg_temp.m148_id(31),(state->>'adminRevision')::bigint,
   state->>'contextHash',pg_temp.m148_id(182));
 IF cancelled->>'status'<>'cancelled' OR late->>'status'<>'cancelled'
  OR late ? 'sourceCipherBase64' OR late ? 'current' THEN
  RAISE EXCEPTION 'M148 cancel-before-prepare revived source'; END IF;
END $$;
RESET ROLE;

-- ABA of an administrative value invalidates the old snapshot even if it returns.
SELECT pg_temp.m148_login(1);
SET LOCAL ROLE authenticated;
SELECT set_config('test.m148_aba_snapshot',public.patient_intake_incorporation_snapshot(
  pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(151))::text,true);
RESET ROLE;
UPDATE public.paciente_identidad SET telefono_cifrado='\x55' WHERE id=pg_temp.m148_id(31);
UPDATE public.paciente_identidad SET telefono_cifrado='\x44' WHERE id=pg_temp.m148_id(31);
SELECT pg_temp.m148_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE stale jsonb;
BEGIN
 stale:=public.patient_intake_incorporation_prepare(pg_temp.m148_id(10),pg_temp.m148_id(61),
   pg_temp.m148_id(151),ARRAY['telefono'],pg_temp.m148_id(31),
   (current_setting('test.m148_aba_snapshot',true)::jsonb->>'adminRevision')::bigint,
   current_setting('test.m148_aba_snapshot',true)::jsonb->>'contextHash',pg_temp.m148_id(183));
 IF stale->>'status'<>'conflict' OR stale ? 'sourceCipherBase64' THEN
  RAISE EXCEPTION 'M148 ABA snapshot unexpectedly usable'; END IF;
END $$;
RESET ROLE;

-- Reassigning the visit changes the M144 context. A pending replay cannot leak A's cipher.
SELECT pg_temp.m148_login(1);
SET LOCAL ROLE authenticated;
SELECT set_config('test.m148_replay_snapshot',public.patient_intake_incorporation_snapshot(
  pg_temp.m148_id(10),pg_temp.m148_id(62),pg_temp.m148_id(152))::text,true);
SELECT set_config('test.m148_replay_prepare',public.patient_intake_incorporation_prepare(
  pg_temp.m148_id(10),pg_temp.m148_id(62),pg_temp.m148_id(152),ARRAY['nombre'],
  pg_temp.m148_id(31),(current_setting('test.m148_replay_snapshot',true)::jsonb->>'adminRevision')::bigint,
  current_setting('test.m148_replay_snapshot',true)::jsonb->>'contextHash',pg_temp.m148_id(184))::text,true);
RESET ROLE;
DO $$ DECLARE prepared jsonb:=current_setting('test.m148_replay_prepare',true)::jsonb;
BEGIN
 IF prepared->>'status'<>'pending' OR NOT prepared ? 'sourceCipherBase64' OR NOT prepared ? 'current'
  OR (SELECT status FROM folio_intake_private.incorporation_operation
      WHERE organization_id=pg_temp.m148_id(10) AND operation_id=pg_temp.m148_id(184))<>'pending'
  OR (SELECT paciente_id FROM folio_intake_private.incorporation_operation
      WHERE organization_id=pg_temp.m148_id(10) AND operation_id=pg_temp.m148_id(184))<>pg_temp.m148_id(41)
  OR (SELECT receipt_id FROM folio_intake_private.incorporation_operation
      WHERE organization_id=pg_temp.m148_id(10) AND operation_id=pg_temp.m148_id(184))<>pg_temp.m148_id(152)
  OR (SELECT source_cipher FROM folio_intake_private.incorporation_operation
      WHERE organization_id=pg_temp.m148_id(10) AND operation_id=pg_temp.m148_id(184))
      <>decode(repeat('bb',64),'hex') THEN
  RAISE EXCEPTION 'M148 original replay preparation did not retain its pending source'; END IF;
END $$;
UPDATE public.turno SET paciente_id=pg_temp.m148_id(42) WHERE id=pg_temp.m148_id(62);
SELECT pg_temp.m148_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE replay jsonb; durable jsonb;
BEGIN
 replay:=public.patient_intake_incorporation_prepare(pg_temp.m148_id(10),pg_temp.m148_id(62),
   pg_temp.m148_id(152),ARRAY['nombre'],pg_temp.m148_id(31),
   (current_setting('test.m148_replay_snapshot',true)::jsonb->>'adminRevision')::bigint,
   current_setting('test.m148_replay_snapshot',true)::jsonb->>'contextHash',pg_temp.m148_id(184));
 durable:=public.patient_intake_incorporation_prepare(pg_temp.m148_id(10),pg_temp.m148_id(62),
   pg_temp.m148_id(152),ARRAY['nombre'],pg_temp.m148_id(31),
   (current_setting('test.m148_replay_snapshot',true)::jsonb->>'adminRevision')::bigint,
   current_setting('test.m148_replay_snapshot',true)::jsonb->>'contextHash',pg_temp.m148_id(184));
 IF replay->>'status'<>'conflict' OR replay ? 'sourceCipherBase64' OR replay ? 'current' THEN
  RAISE EXCEPTION 'M148 stale replay returned prior patient source'; END IF;
 IF durable->>'status'<>'conflict' OR durable ? 'sourceCipherBase64' OR durable ? 'current' THEN
  RAISE EXCEPTION 'M148 terminal conflict replay leaked prior patient source'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM folio_intake_private.incorporation_operation
      WHERE organization_id=pg_temp.m148_id(10) AND operation_id=pg_temp.m148_id(184))<>'conflict'
  OR (SELECT terminal_reason FROM folio_intake_private.incorporation_operation
      WHERE organization_id=pg_temp.m148_id(10) AND operation_id=pg_temp.m148_id(184))<>'context_changed'
  OR (SELECT source_cipher FROM folio_intake_private.incorporation_operation
      WHERE organization_id=pg_temp.m148_id(10) AND operation_id=pg_temp.m148_id(184))
      <>decode(repeat('bb',64),'hex') THEN
  RAISE EXCEPTION 'M148 context conflict was not durable with its original encrypted source'; END IF;
END $$;

-- A materialized replay also closes when the administrative revision changes.
SELECT pg_temp.m148_login(1);
SET LOCAL ROLE authenticated;
SELECT set_config('test.m148_revision_snapshot',public.patient_intake_incorporation_snapshot(
  pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(151))::text,true);
SELECT set_config('test.m148_revision_prepare',public.patient_intake_incorporation_prepare(
  pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(151),ARRAY['cobertura.nombre'],
  pg_temp.m148_id(31),(current_setting('test.m148_revision_snapshot',true)::jsonb->>'adminRevision')::bigint,
  current_setting('test.m148_revision_snapshot',true)::jsonb->>'contextHash',pg_temp.m148_id(185))::text,true);
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
SELECT set_config('test.m148_revision_materialized',public.patient_intake_incorporation_materialize(
  (current_setting('test.m148_revision_prepare',true)::jsonb->>'preparationId')::uuid,
  jsonb_build_object('cobertura_nombre','M148 proposed coverage'),repeat('a',64))::text,true);
RESET ROLE;
DO $$ DECLARE materialized jsonb:=current_setting('test.m148_revision_materialized',true)::jsonb;
BEGIN
 IF materialized->>'status'<>'materialized' OR materialized ? 'sourceCipherBase64'
  OR materialized ? 'current' THEN
  RAISE EXCEPTION 'M148 revision case did not reach materialized safely'; END IF;
END $$;
UPDATE public.paciente_identidad SET cobertura_nombre='M148 changed elsewhere'
  WHERE id=pg_temp.m148_id(31);
SELECT pg_temp.m148_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE replay jsonb; durable jsonb;
BEGIN
 replay:=public.patient_intake_incorporation_prepare(pg_temp.m148_id(10),pg_temp.m148_id(61),
   pg_temp.m148_id(151),ARRAY['cobertura.nombre'],pg_temp.m148_id(31),
   (current_setting('test.m148_revision_snapshot',true)::jsonb->>'adminRevision')::bigint,
   current_setting('test.m148_revision_snapshot',true)::jsonb->>'contextHash',pg_temp.m148_id(185));
 durable:=public.patient_intake_incorporation_prepare(pg_temp.m148_id(10),pg_temp.m148_id(61),
   pg_temp.m148_id(151),ARRAY['cobertura.nombre'],pg_temp.m148_id(31),
   (current_setting('test.m148_revision_snapshot',true)::jsonb->>'adminRevision')::bigint,
   current_setting('test.m148_revision_snapshot',true)::jsonb->>'contextHash',pg_temp.m148_id(185));
 IF replay->>'status'<>'conflict' OR replay->>'reason'<>'snapshot_changed'
  OR replay ? 'sourceCipherBase64' OR replay ? 'current' THEN
  RAISE EXCEPTION 'M148 materialized revision replay returned a stale snapshot'; END IF;
 IF durable->>'status'<>'conflict' OR durable->>'reason'<>'snapshot_changed'
  OR durable ? 'sourceCipherBase64' OR durable ? 'current' THEN
  RAISE EXCEPTION 'M148 materialized revision conflict was not durable'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM folio_intake_private.incorporation_operation
      WHERE organization_id=pg_temp.m148_id(10) AND operation_id=pg_temp.m148_id(185))<>'conflict'
  OR (SELECT terminal_reason FROM folio_intake_private.incorporation_operation
      WHERE organization_id=pg_temp.m148_id(10) AND operation_id=pg_temp.m148_id(185))<>'snapshot_changed'
  OR (SELECT source_cipher FROM folio_intake_private.incorporation_operation
      WHERE organization_id=pg_temp.m148_id(10) AND operation_id=pg_temp.m148_id(185))
      <>decode(repeat('aa',64),'hex') THEN
  RAISE EXCEPTION 'M148 materialized revision conflict did not persist safely'; END IF;
END $$;

-- Private synthetic rows make both public expiration transitions deterministic.
INSERT INTO folio_intake_private.incorporation_operation
  (organization_id,operation_id,preparation_id,actor_member_id,actor_session_id,turno_id,
   paciente_id,identidad_id,receipt_id,questionnaire_version,selected_keys,
   expected_admin_revision,expected_context_hash,source_fingerprint,source_cipher,snapshot,
   status,expires_at)
VALUES
  (pg_temp.m148_id(10),pg_temp.m148_id(187),pg_temp.m148_id(197),pg_temp.m148_id(11),
   pg_temp.m148_id(901),pg_temp.m148_id(61),pg_temp.m148_id(41),pg_temp.m148_id(31),
   pg_temp.m148_id(151),'admin.v1',ARRAY['email'],
   (SELECT admin_revision FROM public.paciente_identidad WHERE id=pg_temp.m148_id(31)),
   repeat('e',64),repeat('a',64),decode(repeat('aa',64),'hex'),'{}'::jsonb,
   'pending',clock_timestamp()-interval '1 second');
INSERT INTO folio_intake_private.incorporation_operation
  (organization_id,operation_id,preparation_id,actor_member_id,actor_session_id,turno_id,
   paciente_id,identidad_id,receipt_id,questionnaire_version,selected_keys,
   expected_admin_revision,expected_context_hash,source_fingerprint,source_cipher,snapshot,
   patch,changed_keys,status,expires_at)
VALUES
  (pg_temp.m148_id(10),pg_temp.m148_id(188),pg_temp.m148_id(198),pg_temp.m148_id(11),
   pg_temp.m148_id(901),pg_temp.m148_id(61),pg_temp.m148_id(41),pg_temp.m148_id(31),
   pg_temp.m148_id(151),'admin.v1',ARRAY['email'],
   (SELECT admin_revision FROM public.paciente_identidad WHERE id=pg_temp.m148_id(31)),
   repeat('f',64),repeat('a',64),decode(repeat('aa',64),'hex'),'{}'::jsonb,
   jsonb_build_object('email_cifrado',encode(decode(repeat('66',32),'hex'),'base64'),
     'email_hash',repeat('6',64)),ARRAY['email'],'materialized',clock_timestamp()-interval '1 second');
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
SELECT set_config('test.m148_expired_materialize',public.patient_intake_incorporation_materialize(
  pg_temp.m148_id(197),'{}'::jsonb,repeat('a',64))::text,true);
RESET ROLE;
SELECT pg_temp.m148_login(1);
SET LOCAL ROLE authenticated;
SELECT set_config('test.m148_expired_apply',public.patient_intake_incorporation_apply(
  pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(198),pg_temp.m148_id(188))::text,true);
RESET ROLE;
DO $$ DECLARE materialize_result jsonb:=current_setting('test.m148_expired_materialize',true)::jsonb;
  apply_result jsonb:=current_setting('test.m148_expired_apply',true)::jsonb;
BEGIN
 IF materialize_result->>'status'<>'cancelled' OR materialize_result->>'reason'<>'expired'
  OR apply_result->>'status'<>'cancelled' OR apply_result->>'reason'<>'expired'
  OR EXISTS (SELECT 1 FROM folio_intake_private.incorporation_operation
      WHERE operation_id IN (pg_temp.m148_id(187),pg_temp.m148_id(188))
        AND (status<>'cancelled' OR terminal_reason<>'expired' OR finished_at IS NULL))
  OR EXISTS (SELECT 1 FROM folio_intake_private.incorporation_provenance
      WHERE operation_id IN (pg_temp.m148_id(187),pg_temp.m148_id(188))) THEN
  RAISE EXCEPTION 'M148 expiration did not close both public RPC paths safely'; END IF;
END $$;

-- Applying fechaNacimiento advances dob_revision and makes the old M142 event stale.
SELECT set_config('test.m148_dob_before',
  (SELECT dob_revision::text FROM public.paciente_identidad WHERE id=pg_temp.m148_id(31)),true);
INSERT INTO folio_adult_private.attestation
  (organization_id,paciente_id,identidad_id,dob_revision,identity_link_revision,
   verified_by_member_id,source_code)
SELECT p.organization_id,p.id,p.identidad_id,pi.dob_revision,p.identity_link_revision,
  pg_temp.m148_id(11),'DOCUMENTO_EXHIBIDO'
FROM public.paciente p JOIN public.paciente_identidad pi ON pi.id=p.identidad_id
WHERE p.id=pg_temp.m148_id(41);
SELECT pg_temp.m148_login(1);
SET LOCAL ROLE authenticated;
SELECT set_config('test.m148_dob_snapshot',public.patient_intake_incorporation_snapshot(
  pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(151))::text,true);
SELECT set_config('test.m148_dob_prepare',public.patient_intake_incorporation_prepare(
  pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(151),ARRAY['fechaNacimiento'],
  pg_temp.m148_id(31),(current_setting('test.m148_dob_snapshot',true)::jsonb->>'adminRevision')::bigint,
  current_setting('test.m148_dob_snapshot',true)::jsonb->>'contextHash',pg_temp.m148_id(189))::text,true);
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
SELECT public.patient_intake_incorporation_materialize(
  (current_setting('test.m148_dob_prepare',true)::jsonb->>'preparationId')::uuid,
  jsonb_build_object('fecha_nacimiento','1990-01-02'),repeat('a',64));
RESET ROLE;
SELECT pg_temp.m148_login(1);
SET LOCAL ROLE authenticated;
SELECT set_config('test.m148_dob_applied',public.patient_intake_incorporation_apply(
  pg_temp.m148_id(10),pg_temp.m148_id(61),
  (current_setting('test.m148_dob_prepare',true)::jsonb->>'preparationId')::uuid,
  pg_temp.m148_id(189))::text,true);
RESET ROLE;
DO $$ BEGIN
 IF current_setting('test.m148_dob_applied',true)::jsonb->>'status'<>'applied'
  OR (SELECT fecha_nacimiento FROM public.paciente_identidad
      WHERE id=pg_temp.m148_id(31))<>DATE '1990-01-02'
  OR (SELECT dob_revision FROM public.paciente_identidad WHERE id=pg_temp.m148_id(31))
      <>current_setting('test.m148_dob_before',true)::bigint+1
  OR (SELECT count(*) FROM folio_adult_private.attestation WHERE paciente_id=pg_temp.m148_id(41))<>1
  OR EXISTS (SELECT 1 FROM folio_adult_private.attestation a
      JOIN public.paciente p ON p.id=a.paciente_id
      JOIN public.paciente_identidad pi ON pi.id=p.identidad_id
      WHERE a.paciente_id=pg_temp.m148_id(41) AND a.identidad_id=pi.id
        AND a.identity_link_revision=p.identity_link_revision AND a.dob_revision=pi.dob_revision)
  OR (SELECT count(*) FROM folio_intake_private.incorporation_provenance
      WHERE operation_id=pg_temp.m148_id(189))<>1 THEN
  RAISE EXCEPTION 'M148 fechaNacimiento did not invalidate M142 attestation exactly once'; END IF;
END $$;

-- A director can prepare while the patient is open, but a later foreign safe
-- assignment must reject apply without consuming the materialized operation.
SELECT pg_temp.m148_login(4);
SET LOCAL ROLE authenticated;
SELECT set_config('test.m148_safe_snapshot',public.patient_intake_incorporation_snapshot(
  pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(151))::text,true);
SELECT set_config('test.m148_safe_prepare',public.patient_intake_incorporation_prepare(
  pg_temp.m148_id(10),pg_temp.m148_id(61),pg_temp.m148_id(151),ARRAY['cobertura.nombre'],
  pg_temp.m148_id(31),(current_setting('test.m148_safe_snapshot',true)::jsonb->>'adminRevision')::bigint,
  current_setting('test.m148_safe_snapshot',true)::jsonb->>'contextHash',pg_temp.m148_id(190))::text,true);
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
SELECT public.patient_intake_incorporation_materialize(
  (current_setting('test.m148_safe_prepare',true)::jsonb->>'preparationId')::uuid,
  jsonb_build_object('cobertura_nombre','M148 safe proposal'),repeat('a',64));
RESET ROLE;
UPDATE public.paciente SET caja_fuerte_profesional=pg_temp.m148_id(11)
  WHERE id=pg_temp.m148_id(41);
SELECT pg_temp.m148_login(4);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.patient_intake_incorporation_apply(
    pg_temp.m148_id(10),pg_temp.m148_id(61),
    (current_setting('test.m148_safe_prepare',true)::jsonb->>'preparationId')::uuid,
    pg_temp.m148_id(190));
  RAISE EXCEPTION 'M148 foreign safe apply unexpectedly succeeded';
 EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM folio_intake_private.incorporation_operation
      WHERE operation_id=pg_temp.m148_id(190))<>'materialized'
  OR EXISTS (SELECT 1 FROM folio_intake_private.incorporation_provenance
      WHERE operation_id=pg_temp.m148_id(190)) THEN
  RAISE EXCEPTION 'M148 foreign safe rejection consumed the operation'; END IF;
END $$;
UPDATE public.paciente SET caja_fuerte_profesional=NULL WHERE id=pg_temp.m148_id(41);
ROLLBACK;
