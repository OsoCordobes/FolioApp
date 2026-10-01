-- M147 synthetic contract; all fixtures and Auth stubs roll back.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m147_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m147_jwt',true),''),'{}')::jsonb $$;
CREATE FUNCTION pg_temp.m147_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('14700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.m147_login(n integer,aal text DEFAULT 'aal2') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('test.m147_uid',pg_temp.m147_id(n)::text,true);
 PERFORM set_config('test.m147_jwt',jsonb_build_object('aal',aal,'session_id',pg_temp.m147_id(900+n))::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
END $$;
CREATE FUNCTION pg_temp.m147_expect(query text,code text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE query;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=code THEN RETURN; END IF;
  RAISE EXCEPTION 'M147 expected %, got %: %',code,SQLSTATE,SQLERRM;
 END;
 RAISE EXCEPTION 'M147 expected %, statement succeeded',code;
END $$;
CREATE FUNCTION pg_temp.m147_key_cipher(p_inv uuid) RETURNS bytea
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT fingerprint_key_cifrado FROM folio_intake_private.invitation WHERE id=p_inv
$$;

DO $$ BEGIN
 IF has_function_privilege('anon','public.patient_intake_issue(uuid,uuid,bytea)','EXECUTE')
  OR has_function_privilege('authenticated','public.patient_intake_issue(uuid,uuid,bytea)','EXECUTE')
  OR has_function_privilege('service_role','public.patient_intake_issue(uuid,uuid,bytea)','EXECUTE')
  OR has_function_privilege('anon','public.patient_intake_revoke(uuid,uuid)','EXECUTE')
  OR has_function_privilege('authenticated','public.patient_intake_revoke(uuid,uuid)','EXECUTE')
  OR has_function_privilege('service_role','public.patient_intake_revoke(uuid,uuid)','EXECUTE')
  OR has_function_privilege('anon','public.patient_intake_issue_v2(uuid,uuid,uuid,bigint,text,text,bytea)','EXECUTE')
  OR has_function_privilege('service_role','public.patient_intake_issue_v2(uuid,uuid,uuid,bigint,text,text,bytea)','EXECUTE')
  OR has_function_privilege('anon','public.patient_intake_revoke_v2(uuid,uuid,uuid,bigint,text)','EXECUTE')
  OR has_function_privilege('service_role','public.patient_intake_revoke_v2(uuid,uuid,uuid,bigint,text)','EXECUTE')
  OR has_function_privilege('anon','public.patient_intake_link_state(uuid,uuid)','EXECUTE')
  OR has_function_privilege('service_role','public.patient_intake_link_operation_status(uuid,uuid,uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.patient_intake_issue_v2(uuid,uuid,uuid,bigint,text,text,bytea)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.patient_intake_revoke_v2(uuid,uuid,uuid,bigint,text)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.patient_intake_link_state(uuid,uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.patient_intake_link_operation_status(uuid,uuid,uuid)','EXECUTE')
  OR has_table_privilege('authenticated','folio_intake_private.link_state','SELECT')
  OR has_table_privilege('service_role','folio_intake_private.link_operation','SELECT')
  OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='folio_intake_private'
    AND table_name='link_operation' AND column_name IN ('token','raw_token')) THEN
  RAISE EXCEPTION 'M147 execution/grant boundary changed';
 END IF;
END $$;

INSERT INTO auth.users(id,email) SELECT pg_temp.m147_id(n),'m147-'||n||'@synthetic.invalid'
 FROM generate_series(1,3) n;
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version)
 SELECT pg_temp.m147_id(n),'m147-'||n||'@synthetic.invalid',now(),'v1'
 FROM generate_series(1,3) n;
INSERT INTO public.organization(id,slug,nombre) VALUES
 (pg_temp.m147_id(10),'m147-one','Synthetic M147');
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
 (pg_temp.m147_id(11),pg_temp.m147_id(10),pg_temp.m147_id(1),'OWNER',true,now()),
 (pg_temp.m147_id(12),pg_temp.m147_id(10),pg_temp.m147_id(2),'PROFESIONAL',true,now()),
 (pg_temp.m147_id(13),pg_temp.m147_id(10),pg_temp.m147_id(3),'COORDINADOR',false,now());
INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado)
 VALUES(pg_temp.m147_id(31),pg_temp.m147_id(10),'\x01','\x02','\x03'),
 (pg_temp.m147_id(32),pg_temp.m147_id(10),'\x04','\x05','\x06');
INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id)
 VALUES(pg_temp.m147_id(33),pg_temp.m147_id(10),pg_temp.m147_id(31),pg_temp.m147_id(12));
INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
 VALUES(pg_temp.m147_id(51),pg_temp.m147_id(10),'Synthetic','CONSULTA_INICIAL',30,0);
INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents)
 VALUES(pg_temp.m147_id(61),pg_temp.m147_id(10),pg_temp.m147_id(33),pg_temp.m147_id(51),pg_temp.m147_id(12),now()+interval '3 days',30,0);
INSERT INTO auth.mfa_factors(id,user_id,status)
 SELECT pg_temp.m147_id(800+n),pg_temp.m147_id(n),'verified' FROM generate_series(1,3) n;
INSERT INTO auth.sessions(id,user_id,aal,factor_id)
 SELECT pg_temp.m147_id(900+n),pg_temp.m147_id(n),'aal2',pg_temp.m147_id(800+n)
 FROM generate_series(1,3) n;
INSERT INTO auth.sessions(id,user_id,aal,factor_id)
 VALUES(pg_temp.m147_id(904),pg_temp.m147_id(1),'aal2',pg_temp.m147_id(801));

SELECT pg_temp.m147_login(1);
SET LOCAL ROLE authenticated;
SELECT set_config('test.m147_valid_state',
  public.patient_intake_link_state(pg_temp.m147_id(10),pg_temp.m147_id(61))::text,true);
RESET ROLE;
SELECT pg_temp.m147_login(1,'aal1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.m147_expect($q$SELECT public.patient_intake_link_state(pg_temp.m147_id(10),pg_temp.m147_id(61))$q$,'42501');
SELECT pg_temp.m147_expect(format($q$SELECT public.patient_intake_issue_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(81),0,%L,%L,decode(repeat('aa',60),'hex'))$q$,
 (current_setting('test.m147_valid_state',true)::jsonb)->>'contextHash',repeat('1',64)),'42501');
SELECT pg_temp.m147_expect($q$SELECT public.patient_intake_issue(pg_temp.m147_id(10),pg_temp.m147_id(61),decode(repeat('aa',60),'hex'))$q$,'42501');
SELECT pg_temp.m147_expect($q$SELECT public.patient_intake_revoke(pg_temp.m147_id(10),pg_temp.m147_id(61))$q$,'42501');
RESET ROLE;
SELECT pg_temp.m147_login(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m147_expect($q$SELECT public.patient_intake_link_state(pg_temp.m147_id(20),pg_temp.m147_id(61))$q$,'42501');
SELECT pg_temp.m147_expect(format($q$SELECT public.patient_intake_issue_v2(pg_temp.m147_id(20),pg_temp.m147_id(61),pg_temp.m147_id(82),0,%L,%L,decode(repeat('aa',60),'hex'))$q$,
 (current_setting('test.m147_valid_state',true)::jsonb)->>'contextHash',repeat('2',64)),'42501');
SELECT pg_temp.m147_expect($q$SELECT * FROM folio_intake_private.link_operation$q$,'42501');

DO $$ DECLARE state jsonb; issued jsonb; duplicate_issue jsonb; status jsonb;
  first_invitation uuid; key_before bytea; revoked jsonb; second jsonb;
BEGIN
 state:=public.patient_intake_link_state(pg_temp.m147_id(10),pg_temp.m147_id(61));
 IF state->>'generation'<>'0' OR (state->>'active')::boolean THEN RAISE EXCEPTION 'M147 initial state'; END IF;
 issued:=public.patient_intake_issue_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(71),
   (state->>'generation')::bigint,state->>'contextHash',repeat('a',64),decode(repeat('bb',60),'hex'));
 IF issued->>'status'<>'issued' OR issued->>'generation'<>'1' OR issued ? 'token'
   OR issued ? 'tokenHash' THEN RAISE EXCEPTION 'M147 issue result'; END IF;
 first_invitation:=(issued->>'invitationId')::uuid;
 key_before:=pg_temp.m147_key_cipher(first_invitation);
 duplicate_issue:=public.patient_intake_issue_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(71),
   0,state->>'contextHash',repeat('a',64),decode(repeat('cc',60),'hex'));
 IF duplicate_issue IS DISTINCT FROM issued THEN RAISE EXCEPTION 'M147 issue retry changed result'; END IF;
 IF pg_temp.m147_key_cipher(first_invitation) IS DISTINCT FROM key_before
   THEN RAISE EXCEPTION 'M147 retry replaced fingerprint key'; END IF;
 status:=public.patient_intake_link_operation_status(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(71));
 IF status->>'status'<>'issued' OR status ? 'token' OR status ? 'tokenHash'
   THEN RAISE EXCEPTION 'M147 operation status exposed token'; END IF;
 PERFORM pg_temp.m147_expect(format($q$SELECT public.patient_intake_issue_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(71),0,%L,%L,decode(repeat('dd',60),'hex'))$q$,
   state->>'contextHash',repeat('d',64)),'40001');
 PERFORM pg_temp.m147_expect(format($q$SELECT public.patient_intake_issue_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(72),0,%L,%L,decode(repeat('dd',60),'hex'))$q$,
   state->>'contextHash',repeat('d',64)),'40001');
 state:=public.patient_intake_link_state(pg_temp.m147_id(10),pg_temp.m147_id(61));
 revoked:=public.patient_intake_revoke_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(73),
   (state->>'generation')::bigint,state->>'contextHash');
 IF revoked->>'status'<>'revoked' OR revoked->>'generation'<>'2'
   OR (revoked->>'revoked')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'M147 revoke result'; END IF;
 IF public.patient_intake_revoke_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(73),
   1,state->>'contextHash') IS DISTINCT FROM revoked THEN RAISE EXCEPTION 'M147 revoke retry'; END IF;
 IF public.patient_intake_issue_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(71),
   0,state->>'contextHash',repeat('a',64),decode(repeat('ee',60),'hex'))->>'status'<>'superseded'
   THEN RAISE EXCEPTION 'M147 old issue revived'; END IF;
 state:=public.patient_intake_link_state(pg_temp.m147_id(10),pg_temp.m147_id(61));
 second:=public.patient_intake_issue_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(74),
   (state->>'generation')::bigint,state->>'contextHash',repeat('b',64),decode(repeat('ff',60),'hex'));
 IF second->>'status'<>'issued' OR second->>'generation'<>'3' THEN RAISE EXCEPTION 'M147 fresh issue'; END IF;
 PERFORM set_config('test.m147_second_invitation',second->>'invitationId',true);
 PERFORM set_config('test.m147_second_context',state->>'contextHash',true);
 IF public.patient_intake_revoke_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(73),
   1,state->>'contextHash')->>'status'<>'superseded' THEN RAISE EXCEPTION 'M147 old revoke affected new link'; END IF;
 IF public.patient_intake_link_state(pg_temp.m147_id(10),pg_temp.m147_id(61))->>'invitationId'
   IS DISTINCT FROM second->>'invitationId' THEN RAISE EXCEPTION 'M147 new link revoked by old operation'; END IF;
END $$;
RESET ROLE;

-- Same member with a different valid Auth session cannot read or replay the
-- first session's operation, even while its invitation remains active.
SELECT pg_temp.m147_login(1);
SELECT set_config('test.m147_jwt',jsonb_build_object('aal','aal2','session_id',pg_temp.m147_id(904))::text,true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.patient_intake_link_operation_status(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(74))->>'status'<>'not_recorded'
   THEN RAISE EXCEPTION 'M147 same actor different session read receipt'; END IF;
 PERFORM pg_temp.m147_expect(format($q$SELECT public.patient_intake_issue_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(74),2,%L,%L,decode(repeat('aa',60),'hex'))$q$,
   current_setting('test.m147_second_context',true),repeat('b',64)),'40001');
END $$;
RESET ROLE;

-- Expiry invalidates replay without changing the generation or replacing the
-- original invitation. The old operation remains a durable receipt.
UPDATE folio_intake_private.invitation SET issued_at=now()-interval '25 hours',
 expires_at=now()-interval '1 hour'
 WHERE id=current_setting('test.m147_second_invitation',true)::uuid;
SELECT pg_temp.m147_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; state jsonb;
BEGIN
 result:=public.patient_intake_issue_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(74),
   2,current_setting('test.m147_second_context',true),repeat('b',64),decode(repeat('aa',60),'hex'));
 state:=public.patient_intake_link_state(pg_temp.m147_id(10),pg_temp.m147_id(61));
 IF result->>'status'<>'superseded' OR state->>'generation'<>'3'
   OR (state->>'active')::boolean THEN RAISE EXCEPTION 'M147 expired replay revived link'; END IF;
END $$;
RESET ROLE;

-- Another staff member/session cannot read or reuse the first actor's receipt.
SELECT pg_temp.m147_login(3);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.patient_intake_link_operation_status(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(71))->>'status'<>'not_recorded'
   THEN RAISE EXCEPTION 'M147 leaked foreign receipt'; END IF;
 PERFORM pg_temp.m147_expect(format($q$SELECT public.patient_intake_issue_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(71),0,%L,%L,decode(repeat('aa',60),'hex'))$q$,
   public.patient_intake_link_state(pg_temp.m147_id(10),pg_temp.m147_id(61))->>'contextHash',repeat('a',64)),'40001');
END $$;
RESET ROLE;

-- A date ABA and identity A->B->A invalidate a captured context even when
-- the operator has not advanced its generation.
SELECT pg_temp.m147_login(1);
SET LOCAL ROLE authenticated;
SELECT set_config('test.m147_old_context',
  (public.patient_intake_link_state(pg_temp.m147_id(10),pg_temp.m147_id(61))->>'contextHash'),true);
RESET ROLE;
UPDATE public.turno SET inicio=inicio+interval '1 hour' WHERE id=pg_temp.m147_id(61);
UPDATE public.turno SET inicio=inicio-interval '1 hour' WHERE id=pg_temp.m147_id(61);
UPDATE public.paciente SET identidad_id=pg_temp.m147_id(32) WHERE id=pg_temp.m147_id(33);
UPDATE public.paciente SET identidad_id=pg_temp.m147_id(31) WHERE id=pg_temp.m147_id(33);
SELECT pg_temp.m147_login(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m147_expect(format($q$SELECT public.patient_intake_revoke_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(75),3,%L)$q$,
 current_setting('test.m147_old_context',true)),'40001');
DO $$ DECLARE state jsonb; revoked jsonb; fenced jsonb;
BEGIN
 state:=public.patient_intake_link_state(pg_temp.m147_id(10),pg_temp.m147_id(61));
 revoked:=public.patient_intake_revoke_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(76),
   (state->>'generation')::bigint,state->>'contextHash');
 IF revoked->>'generation'<>'4' THEN RAISE EXCEPTION 'M147 context fence'; END IF;
 state:=public.patient_intake_link_state(pg_temp.m147_id(10),pg_temp.m147_id(61));
 fenced:=public.patient_intake_revoke_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(77),
   (state->>'generation')::bigint,state->>'contextHash');
 IF fenced->>'generation'<>'5' OR (fenced->>'revoked')::boolean THEN
   RAISE EXCEPTION 'M147 empty revoke did not advance fence'; END IF;
 PERFORM pg_temp.m147_expect(format($q$SELECT public.patient_intake_issue_v2(pg_temp.m147_id(10),pg_temp.m147_id(61),pg_temp.m147_id(78),4,%L,%L,decode(repeat('aa',60),'hex'))$q$,
   state->>'contextHash',repeat('c',64)),'40001');
END $$;
RESET ROLE;
ROLLBACK;
