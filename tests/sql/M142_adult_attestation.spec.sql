-- B04a synthetic authorization and revision checks. Transaction is rolled back.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m142_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m142_jwt',true),''),'{}')::jsonb $$;
CREATE FUNCTION pg_temp.m142_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('14200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.m142_login(n integer,aal text DEFAULT 'aal2') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 PERFORM set_config('test.m142_uid',pg_temp.m142_id(n)::text,true);
 PERFORM set_config('test.m142_jwt',jsonb_build_object('aal',aal,'session_id',pg_temp.m142_id(900+n))::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
END $$;
CREATE FUNCTION pg_temp.m142_expect(query text,code text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE query;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=code THEN RETURN; END IF;
  RAISE EXCEPTION 'M142 expected %, got %: %',code,SQLSTATE,SQLERRM;
 END;
 RAISE EXCEPTION 'M142 expected %, statement succeeded',code;
END $$;
DO $$ BEGIN
 IF has_table_privilege('anon','folio_adult_private.attestation','SELECT')
  OR has_table_privilege('authenticated','folio_adult_private.attestation','SELECT')
  OR has_table_privilege('service_role','folio_adult_private.attestation','INSERT')
  OR has_function_privilege('anon','public.read_adult_attestation(uuid,uuid)','EXECUTE')
  OR has_function_privilege('service_role','public.attest_adult_dob(uuid,uuid,uuid,bigint,bigint,date,date,text,text)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.attest_adult_dob(uuid,uuid,uuid,bigint,bigint,date,date,text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'M142 direct event or RPC grant boundary changed';
 END IF;
END $$;

INSERT INTO auth.users(id,email) SELECT pg_temp.m142_id(n),'m142-'||n||'@synthetic.invalid'
 FROM generate_series(1,7) n;
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version)
 SELECT pg_temp.m142_id(n),'m142-'||n||'@synthetic.invalid',now(),'v1'
 FROM generate_series(1,7) n;
INSERT INTO public.organization(id,slug,nombre) VALUES
 (pg_temp.m142_id(10),'m142-one','Synthetic B04a one'),
 (pg_temp.m142_id(20),'m142-two','Synthetic B04a two');
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
 (pg_temp.m142_id(11),pg_temp.m142_id(10),pg_temp.m142_id(1),'OWNER',true,now()),
 (pg_temp.m142_id(12),pg_temp.m142_id(10),pg_temp.m142_id(2),'DIRECTOR',false,now()),
 (pg_temp.m142_id(13),pg_temp.m142_id(10),pg_temp.m142_id(3),'PROFESIONAL',true,now()),
 (pg_temp.m142_id(14),pg_temp.m142_id(10),pg_temp.m142_id(4),'ASISTENTE',false,now()),
 (pg_temp.m142_id(15),pg_temp.m142_id(20),pg_temp.m142_id(5),'OWNER',true,now()),
 (pg_temp.m142_id(16),pg_temp.m142_id(10),pg_temp.m142_id(6),'DIRECTOR',true,now()),
 (pg_temp.m142_id(17),pg_temp.m142_id(10),pg_temp.m142_id(7),'PROFESIONAL',true,now());
INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,fecha_nacimiento) VALUES
 (pg_temp.m142_id(31),pg_temp.m142_id(10),'\x01','\x02','\x03',NULL),
 (pg_temp.m142_id(33),pg_temp.m142_id(10),'\x04','\x05','\x06','1991-01-01');
INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id) VALUES
 (pg_temp.m142_id(32),pg_temp.m142_id(10),pg_temp.m142_id(31),pg_temp.m142_id(13));
INSERT INTO auth.mfa_factors(id,user_id,status)
 SELECT pg_temp.m142_id(800+n),pg_temp.m142_id(n),'verified' FROM generate_series(1,7) n;
INSERT INTO auth.sessions(id,user_id,aal,factor_id)
 SELECT pg_temp.m142_id(900+n),pg_temp.m142_id(n),'aal2',pg_temp.m142_id(800+n)
 FROM generate_series(1,7) n;

-- Defaults, attempted forged writes, demographic edits and overflow.
DO $$ BEGIN
 IF (SELECT dob_revision FROM public.paciente_identidad WHERE id=pg_temp.m142_id(31))<>0
  OR (SELECT identity_link_revision FROM public.paciente WHERE id=pg_temp.m142_id(32))<>0 THEN
  RAISE EXCEPTION 'M142 initial revisions are not zero';
 END IF;
 PERFORM pg_temp.m142_expect($q$INSERT INTO public.paciente_identidad
  (id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,dob_revision)
  VALUES(pg_temp.m142_id(39),pg_temp.m142_id(10),'\x01','\x02','\x03',1)$q$,'23514');
 PERFORM pg_temp.m142_expect($q$INSERT INTO public.paciente_identidad
  (id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,dob_revision)
  VALUES(pg_temp.m142_id(39),pg_temp.m142_id(10),'\x01','\x02','\x03',NULL)$q$,'23514');
 PERFORM pg_temp.m142_expect($q$INSERT INTO public.paciente
  (id,organization_id,identity_link_revision)
  VALUES(pg_temp.m142_id(39),pg_temp.m142_id(10),-1)$q$,'23514');
 PERFORM pg_temp.m142_expect($q$UPDATE public.paciente_identidad SET dob_revision=1
  WHERE id=pg_temp.m142_id(31)$q$,'42501');
 PERFORM pg_temp.m142_expect($q$UPDATE public.paciente SET identity_link_revision=1
  WHERE id=pg_temp.m142_id(32)$q$,'42501');
END $$;
UPDATE public.paciente_identidad SET domicilio_ciudad='Synthetic' WHERE id=pg_temp.m142_id(31);
DO $$ BEGIN
 IF (SELECT dob_revision FROM public.paciente_identidad WHERE id=pg_temp.m142_id(31))<>0 THEN
  RAISE EXCEPTION 'M142 demographic edit changed DOB revision';
 END IF;
END $$;
-- Trigger overflow is checked using a rollback-only fixture override. The
-- override bypasses only this local trigger to seed the maximum counter.
ALTER TABLE public.paciente_identidad DISABLE TRIGGER adult_dob_revision_guard;
UPDATE public.paciente_identidad SET dob_revision=9223372036854775807 WHERE id=pg_temp.m142_id(33);
ALTER TABLE public.paciente_identidad ENABLE TRIGGER adult_dob_revision_guard;
SELECT pg_temp.m142_expect($q$UPDATE public.paciente_identidad SET fecha_nacimiento='1991-01-02'
 WHERE id=pg_temp.m142_id(33)$q$,'22003');
ALTER TABLE public.paciente DISABLE TRIGGER adult_identity_link_revision_guard;
UPDATE public.paciente SET identity_link_revision=9223372036854775807 WHERE id=pg_temp.m142_id(32);
ALTER TABLE public.paciente ENABLE TRIGGER adult_identity_link_revision_guard;
SELECT pg_temp.m142_expect($q$UPDATE public.paciente SET identidad_id=pg_temp.m142_id(33)
 WHERE id=pg_temp.m142_id(32)$q$,'22003');
ALTER TABLE public.paciente DISABLE TRIGGER adult_identity_link_revision_guard;
UPDATE public.paciente SET identity_link_revision=0 WHERE id=pg_temp.m142_id(32);
ALTER TABLE public.paciente ENABLE TRIGGER adult_identity_link_revision_guard;

-- Global MFA policy remains off. An aal1 JWT still fails when the same DB
-- session has already reached aal2 and has a verified factor.
SELECT pg_temp.m142_login(1,'aal1');
DO $$ BEGIN
 IF (public.mfa_access_status()->>'allowed')::boolean IS DISTINCT FROM true
  OR (public.mfa_access_status()->>'sessionValid')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'M142 fixture did not reproduce permissive global-off MFA';
 END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT * FROM folio_adult_private.attestation$q$,'42501');
SELECT pg_temp.m142_expect($q$INSERT INTO folio_adult_private.attestation
 (organization_id,paciente_id,identidad_id,dob_revision,identity_link_revision,verified_by_member_id,source_code)
 VALUES(pg_temp.m142_id(10),pg_temp.m142_id(32),pg_temp.m142_id(31),0,0,pg_temp.m142_id(11),'DOCUMENTO_EXHIBIDO')$q$,'42501');
SELECT pg_temp.m142_expect($q$SELECT public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))$q$,'42501');
SELECT pg_temp.m142_expect($q$SELECT public.attest_adult_dob(pg_temp.m142_id(10),pg_temp.m142_id(32),pg_temp.m142_id(31),0,0,NULL,'1990-01-01','DOCUMENTO_EXHIBIDO','ERROR_CARGA')$q$,'42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.m142_expect($q$SELECT * FROM folio_adult_private.attestation$q$,'42501');
RESET ROLE;
-- A session/factor are both required independently of the JWT AAL.
DELETE FROM auth.mfa_factors WHERE id=pg_temp.m142_id(806);
SELECT pg_temp.m142_login(6);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))$q$,'42501');
RESET ROLE;

SELECT pg_temp.m142_login(1);
SET LOCAL ROLE authenticated;
DO $$ DECLARE state jsonb; result jsonb; stale jsonb;
BEGIN
 state:=public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32));
 IF state->>'dob' IS NOT NULL OR (state->>'attested')::boolean IS DISTINCT FROM false
  OR (state->>'dobRevision')::bigint<>0 THEN
  RAISE EXCEPTION 'M142 null DOB read failed';
 END IF;
 PERFORM pg_temp.m142_expect($q$SELECT public.attest_adult_dob(pg_temp.m142_id(10),pg_temp.m142_id(32),pg_temp.m142_id(31),0,0,NULL,'1990-01-01','DOCUMENTO_EXHIBIDO')$q$,'22023');
 result:=public.attest_adult_dob(pg_temp.m142_id(10),pg_temp.m142_id(32),pg_temp.m142_id(31),0,0,NULL,'1990-01-01','DOCUMENTO_EXHIBIDO','ERROR_CARGA');
 IF result->>'status' IS DISTINCT FROM 'attested' OR (result->>'dobRevision')::bigint<>1 THEN
  RAISE EXCEPTION 'M142 null DOB correction/attestation failed';
 END IF;
 stale:=public.attest_adult_dob(pg_temp.m142_id(10),pg_temp.m142_id(32),pg_temp.m142_id(31),0,0,NULL,'1990-01-01','DOCUMENTO_EXHIBIDO','ERROR_CARGA');
 IF stale->>'status' IS DISTINCT FROM 'conflict' OR (stale->>'dobRevision')::bigint<>1 THEN
  RAISE EXCEPTION 'M142 stale DOB CAS did not return current revision';
 END IF;
 PERFORM pg_temp.m142_expect($q$SELECT public.attest_adult_dob(pg_temp.m142_id(10),pg_temp.m142_id(32),pg_temp.m142_id(31),1,0,'1990-01-01','1990-01-01','DOCUMENTO_EXHIBIDO','ERROR_CARGA')$q$,'22023');
 IF (public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))->>'attested')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'M142 current attestation not readable';
 END IF;
END $$;
RESET ROLE;
-- Accredited director and assigned professional are both legitimate readers.
SELECT pg_temp.m142_login(6);
INSERT INTO auth.mfa_factors(id,user_id,status) VALUES(pg_temp.m142_id(806),pg_temp.m142_id(6),'verified');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))->>'attested')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'M142 accredited director unexpectedly denied';
 END IF;
END $$;
RESET ROLE;
SELECT pg_temp.m142_login(3);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))->>'attested')::boolean IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'M142 assigned professional unexpectedly denied';
 END IF;
END $$;
RESET ROLE;
SELECT pg_temp.m142_login(1);
DO $$ BEGIN
 IF (SELECT count(*) FROM folio_adult_private.attestation WHERE paciente_id=pg_temp.m142_id(32))<>1 THEN
  RAISE EXCEPTION 'M142 stale CAS wrote another event';
 END IF;
 PERFORM pg_temp.m142_expect($q$UPDATE folio_adult_private.attestation SET source_code='DECLARACION_PACIENTE'$q$,'42501');
 PERFORM pg_temp.m142_expect($q$DELETE FROM folio_adult_private.attestation$q$,'42501');
END $$;

-- Direct DOB A->B->A and link A->B->A cannot reactivate old evidence.
UPDATE public.paciente_identidad SET fecha_nacimiento='1992-01-01' WHERE id=pg_temp.m142_id(31);
UPDATE public.paciente_identidad SET fecha_nacimiento='1990-01-01' WHERE id=pg_temp.m142_id(31);
SELECT pg_temp.m142_login(1);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))->>'attested')::boolean IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'M142 DOB ABA revived old attestation';
 END IF;
END $$;
RESET ROLE;
UPDATE public.paciente SET identidad_id=pg_temp.m142_id(33) WHERE id=pg_temp.m142_id(32);
UPDATE public.paciente SET identidad_id=pg_temp.m142_id(31) WHERE id=pg_temp.m142_id(32);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb;
BEGIN
 result:=public.attest_adult_dob(pg_temp.m142_id(10),pg_temp.m142_id(32),pg_temp.m142_id(31),3,0,'1990-01-01','1990-01-01','DOCUMENTO_EXHIBIDO');
 IF result->>'status' IS DISTINCT FROM 'conflict' OR (result->>'identityLinkRevision')::bigint<>2 THEN
  RAISE EXCEPTION 'M142 link ABA CAS did not conflict';
 END IF;
 IF (public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))->>'attested')::boolean IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'M142 link ABA revived old attestation';
 END IF;
END $$;
RESET ROLE;

-- Cross-org, reception, non-accredited director and professional without
-- clinical scope all fail. A vault overrides owner/director breadth too.
SELECT pg_temp.m142_login(2);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))$q$,'42501');
RESET ROLE;
SELECT pg_temp.m142_login(4);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT public.attest_adult_dob(pg_temp.m142_id(10),pg_temp.m142_id(32),pg_temp.m142_id(31),3,2,'1990-01-01','1990-01-01','DOCUMENTO_EXHIBIDO')$q$,'42501');
RESET ROLE;
SELECT pg_temp.m142_login(5);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))$q$,'42501');
RESET ROLE;
SELECT pg_temp.m142_login(7);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))$q$,'42501');
RESET ROLE;
UPDATE public.paciente SET caja_fuerte_profesional=pg_temp.m142_id(13) WHERE id=pg_temp.m142_id(32);
SELECT pg_temp.m142_login(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))$q$,'42501');
RESET ROLE;
UPDATE public.paciente SET caja_fuerte_profesional=NULL WHERE id=pg_temp.m142_id(32);
UPDATE public.member SET deleted_at=now() WHERE id=pg_temp.m142_id(11);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))$q$,'42501');
RESET ROLE;
UPDATE public.member SET deleted_at=NULL WHERE id=pg_temp.m142_id(11);
UPDATE public.member SET accepted_at=NULL,invited_by_id=pg_temp.m142_id(2)
 WHERE id=pg_temp.m142_id(11);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))$q$,'42501');
RESET ROLE;
UPDATE public.member SET accepted_at=now(),invited_by_id=NULL WHERE id=pg_temp.m142_id(11);
UPDATE public.organization SET deleted_at=now() WHERE id=pg_temp.m142_id(10);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))$q$,'42501');
RESET ROLE;
UPDATE public.organization SET deleted_at=NULL WHERE id=pg_temp.m142_id(10);
UPDATE public.paciente SET deleted_at=now() WHERE id=pg_temp.m142_id(32);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))$q$,'42501');
RESET ROLE;
UPDATE public.paciente SET deleted_at=NULL WHERE id=pg_temp.m142_id(32);
UPDATE public.paciente_identidad SET deleted_at=now() WHERE id=pg_temp.m142_id(31);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))$q$,'55000');
RESET ROLE;
UPDATE public.paciente_identidad SET deleted_at=NULL WHERE id=pg_temp.m142_id(31);
UPDATE public.paciente SET identidad_id=NULL WHERE id=pg_temp.m142_id(32);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))$q$,'55000');
RESET ROLE;
UPDATE public.paciente SET identidad_id=pg_temp.m142_id(31) WHERE id=pg_temp.m142_id(32);
UPDATE public.paciente SET identidad_id=NULL,pseudonimizado_en=now() WHERE id=pg_temp.m142_id(32);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))$q$,'42501');
RESET ROLE;
UPDATE public.paciente SET identidad_id=pg_temp.m142_id(31),pseudonimizado_en=NULL WHERE id=pg_temp.m142_id(32);

-- A linked identity from another tenant is not a current identity.
INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado)
 VALUES(pg_temp.m142_id(34),pg_temp.m142_id(20),'\x07','\x08','\x09');
UPDATE public.paciente SET identidad_id=pg_temp.m142_id(34) WHERE id=pg_temp.m142_id(32);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))$q$,'55000');
RESET ROLE;
UPDATE public.paciente SET identidad_id=pg_temp.m142_id(31) WHERE id=pg_temp.m142_id(32);

-- A colleague's original M03 demographic correction invalidates only by
-- revision; no new verification event appears. Factor revocation also closes.
UPDATE auth.mfa_factors SET status='unverified' WHERE id=pg_temp.m142_id(801);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m142_expect($q$SELECT public.read_adult_attestation(pg_temp.m142_id(10),pg_temp.m142_id(32))$q$,'42501');
RESET ROLE;
ROLLBACK;
