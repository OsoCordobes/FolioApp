-- Prepared for the existing disposable hosted PG16 migration/spec job. NOT run locally.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m150_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m150_jwt',true),''),'{}')::jsonb $$;
CREATE FUNCTION pg_temp.m150_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.m150_assert(check_value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF check_value IS DISTINCT FROM true THEN RAISE EXCEPTION 'M150 assertion: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.m150_error(query text,code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE query;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE=code THEN RETURN; END IF;
    RAISE EXCEPTION 'M150 expected %, got %: %',code,SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION 'M150 expected %, statement succeeded',code;
END $$;

-- Fixture grants reproduce the Data API table grants without broadening production.
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT,UPDATE ON public.paciente_identidad TO authenticated;
GRANT SELECT ON public.paciente,public.member TO authenticated;
INSERT INTO auth.users(id,email) SELECT pg_temp.m150_id(n),'m150-'||n||'@synthetic.invalid' FROM generate_series(1,4) n;
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version)
  SELECT pg_temp.m150_id(n),'m150-'||n||'@synthetic.invalid',now(),'v1' FROM generate_series(1,4) n;
INSERT INTO public.organization(id,slug,nombre) VALUES(pg_temp.m150_id(10),'m150-org','M150 synthetic');
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
  (pg_temp.m150_id(11),pg_temp.m150_id(10),pg_temp.m150_id(1),'OWNER',true,now()),
  (pg_temp.m150_id(12),pg_temp.m150_id(10),pg_temp.m150_id(3),'PROFESIONAL',false,now()),
  (pg_temp.m150_id(13),pg_temp.m150_id(10),pg_temp.m150_id(4),'DIRECTOR',false,now());
INSERT INTO public.paciente_cuenta(id,auth_user_id,email) VALUES
  (pg_temp.m150_id(21),pg_temp.m150_id(2),'m150-2@synthetic.invalid'),
  (pg_temp.m150_id(22),pg_temp.m150_id(1),'m150-1@synthetic.invalid');
INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado)
 VALUES(pg_temp.m150_id(31),pg_temp.m150_id(10),decode(repeat('aa',32),'hex'),decode(repeat('bb',32),'hex'),decode(repeat('cc',32),'hex')),
   (pg_temp.m150_id(32),pg_temp.m150_id(10),decode(repeat('aa',32),'hex'),decode(repeat('bb',32),'hex'),decode(repeat('cc',32),'hex'));
INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id,cuenta_id) VALUES
 (pg_temp.m150_id(41),pg_temp.m150_id(10),pg_temp.m150_id(31),pg_temp.m150_id(12),pg_temp.m150_id(21)),
 (pg_temp.m150_id(42),pg_temp.m150_id(10),pg_temp.m150_id(32),pg_temp.m150_id(11),pg_temp.m150_id(21));
INSERT INTO auth.sessions(id,user_id,aal) SELECT pg_temp.m150_id(900+n),pg_temp.m150_id(n),'aal1' FROM generate_series(1,4) n;
UPDATE folio_mfa_private.policy SET application_ready=false;

SELECT pg_temp.m150_assert(NOT has_table_privilege('authenticated','public.paciente','UPDATE'),'fixture does not give portal patient UPDATE');
DO $$ DECLARE name text; signature text;
BEGIN
  FOREACH name IN ARRAY ARRAY['patient_admin_contact_cas','patient_admin_coverage_cas','patient_portal_contact_cas'] LOOP
    signature:='public.'||name||'(uuid,uuid,uuid,text,text,uuid,text,uuid,jsonb)';
    PERFORM pg_temp.m150_assert(has_function_privilege('authenticated',signature,'EXECUTE'),'authenticated wrapper grant');
    PERFORM pg_temp.m150_assert(NOT has_function_privilege('anon',signature,'EXECUTE'),'anon cannot call');
    PERFORM pg_temp.m150_assert(NOT has_function_privilege('service_role',signature,'EXECUTE'),'service cannot call');
    PERFORM pg_temp.m150_assert((SELECT NOT prosecdef AND 'search_path=pg_catalog'=ANY(proconfig) FROM pg_proc WHERE oid=signature::regprocedure),'invoker with fixed search path');
  END LOOP;
END $$;

SELECT set_config('test.m150_uid',pg_temp.m150_id(1)::text,true);
SELECT set_config('test.m150_jwt',jsonb_build_object('session_id',pg_temp.m150_id(901),'aal','aal1')::text,true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;

-- AAL1 is allowed while M101 does not require MFA. No intake AAL2 rule is copied.
SELECT pg_temp.m150_assert(public.patient_admin_contact_cas(
 pg_temp.m150_id(10),pg_temp.m150_id(41),pg_temp.m150_id(31),'0','0',pg_temp.m150_id(11),'OWNER',pg_temp.m150_id(901),
 jsonb_build_object('nombre_cifrado',chr(92)||'x'||repeat('ab',32),'apellido_cifrado',chr(92)||'x'||repeat('bb',32),
 'nombre_hash',repeat('a',64),'telefono_cifrado',chr(92)||'x'||repeat('cd',32),'telefono_hash',repeat('c',64),
 'email_cifrado',NULL,'email_hash',NULL,'ocupacion_cifrado',NULL))->>'status'='applied','staff contact under current AAL1 policy');
SELECT pg_temp.m150_assert((SELECT admin_revision=1 AND email_cifrado IS NULL AND email_hash IS NULL AND ocupacion_cifrado IS NULL FROM public.paciente_identidad WHERE id=pg_temp.m150_id(31)),'one increment and explicit nullable clears');
SELECT pg_temp.m150_assert(public.patient_admin_coverage_cas(
 pg_temp.m150_id(10),pg_temp.m150_id(41),pg_temp.m150_id(31),'0','0',pg_temp.m150_id(11),'OWNER',pg_temp.m150_id(901),
 '{"cobertura_nombre":null,"cobertura_plan":null,"cobertura_nro_afiliado_cifrado":null}')='{"status":"conflict"}'::jsonb,'old revision returns only scoped conflict');

-- Invalid versions, unknown keys, missing/mismatched pairs and NOT NULL fields reject.
SELECT pg_temp.m150_assert(NOT folio_editor_private.revision_valid('01') AND NOT folio_editor_private.revision_valid('9223372036854775808')
 AND folio_editor_private.revision_valid('9223372036854775807'),'canonical bigint limits');
SELECT pg_temp.m150_assert(NOT folio_editor_private.patch_valid('portal','{"email_hash":null}')
 AND NOT folio_editor_private.patch_valid('portal','{"email_cifrado":null,"email_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')
 AND NOT folio_editor_private.patch_valid('portal','{"telefono_cifrado":null,"telefono_hash":null}')
 AND NOT folio_editor_private.patch_valid('portal','{"nombre_cifrado":null}')
 AND NOT folio_editor_private.patch_valid('coverage','{"cobertura_nombre":null,"cobertura_plan":"210","cobertura_nro_afiliado_cifrado":null}')
 AND folio_editor_private.patch_valid('portal','{"email_cifrado":null,"email_hash":null,"domicilio_calle_cifrado":null}'),'editor allowlists/pairs/nullability');
SELECT pg_temp.m150_error(format('SELECT folio_editor_private.lock_scope(''portal'',%L,%L,%L,''PORTAL'',%L)',
 pg_temp.m150_id(10),pg_temp.m150_id(41),pg_temp.m150_id(21),pg_temp.m150_id(901)),'42501');
SELECT pg_temp.m150_error(format('SELECT public.patient_portal_contact_cas(%L,%L,%L,''1'',''0'',%L,''PORTAL'',%L,''{"email_cifrado":null,"email_hash":null}'')',
 pg_temp.m150_id(10),pg_temp.m150_id(41),pg_temp.m150_id(31),pg_temp.m150_id(22),pg_temp.m150_id(901)),'42501');

-- Real portal ownership, including nullable email/address clears, without patient UPDATE.
RESET ROLE;
SELECT set_config('test.m150_uid',pg_temp.m150_id(2)::text,true);
SELECT set_config('test.m150_jwt',jsonb_build_object('session_id',pg_temp.m150_id(902),'aal','aal1')::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m150_assert(public.patient_portal_contact_cas(
 pg_temp.m150_id(10),pg_temp.m150_id(41),pg_temp.m150_id(31),'1','0',pg_temp.m150_id(21),'PORTAL',pg_temp.m150_id(902),
 jsonb_build_object('domicilio_ciudad','Rosario','email_cifrado',NULL,'email_hash',NULL))->>'status'='applied','portal current patient only');
SELECT pg_temp.m150_assert((SELECT email_hash IS NULL AND domicilio_ciudad='Rosario' FROM public.paciente_identidad WHERE id=pg_temp.m150_id(31)),'portal maintains nullable pair');

-- Valid UNIQUE-respecting relink and ABA, with old identity still readable via Q.
RESET ROLE;
UPDATE public.paciente SET identidad_id=NULL WHERE id=pg_temp.m150_id(42);
UPDATE public.paciente SET identidad_id=pg_temp.m150_id(32) WHERE id=pg_temp.m150_id(41);
UPDATE public.paciente SET identidad_id=pg_temp.m150_id(31) WHERE id=pg_temp.m150_id(42);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m150_assert(public.patient_portal_contact_cas(
 pg_temp.m150_id(10),pg_temp.m150_id(41),pg_temp.m150_id(31),'2','0',pg_temp.m150_id(21),'PORTAL',pg_temp.m150_id(902),
 '{"domicilio_ciudad":"wrong target"}')='{"status":"conflict"}'::jsonb,'portal cannot substitute Q as original patient');
SELECT pg_temp.m150_assert((SELECT domicilio_ciudad='Rosario' FROM public.paciente_identidad WHERE id=pg_temp.m150_id(31)),'old target untouched');
RESET ROLE;
UPDATE public.paciente SET identidad_id=NULL WHERE id=pg_temp.m150_id(42);
UPDATE public.paciente SET identidad_id=pg_temp.m150_id(31) WHERE id=pg_temp.m150_id(41);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m150_assert(public.patient_portal_contact_cas(
 pg_temp.m150_id(10),pg_temp.m150_id(41),pg_temp.m150_id(31),'2','0',pg_temp.m150_id(21),'PORTAL',pg_temp.m150_id(902),
 '{"domicilio_ciudad":"wrong ABA"}')='{"status":"conflict"}'::jsonb,'ABA requires original link revision too');

-- >2^53 fixture values only; guards are restored before testing actual writes.
RESET ROLE;
ALTER TABLE public.paciente_identidad DISABLE TRIGGER zz_paciente_identidad_admin_revision_guard;
UPDATE public.paciente_identidad SET admin_revision=9007199254740993 WHERE id=pg_temp.m150_id(31);
ALTER TABLE public.paciente_identidad ENABLE TRIGGER zz_paciente_identidad_admin_revision_guard;
ALTER TABLE public.paciente DISABLE TRIGGER adult_identity_link_revision_guard;
UPDATE public.paciente SET identity_link_revision=9007199254740993 WHERE id=pg_temp.m150_id(41);
ALTER TABLE public.paciente ENABLE TRIGGER adult_identity_link_revision_guard;
SET LOCAL ROLE authenticated;
SELECT pg_temp.m150_assert(public.patient_portal_contact_cas(
 pg_temp.m150_id(10),pg_temp.m150_id(41),pg_temp.m150_id(31),'9007199254740993','9007199254740993',pg_temp.m150_id(21),'PORTAL',pg_temp.m150_id(902),
 '{"domicilio_ciudad":"Exact"}')=jsonb_build_object('status','applied','adminRevision','9007199254740994','identityLinkRevision','9007199254740993'),'both output versions are exact text');

-- Lost ownership gives a generic scope error, not a version/conflict oracle.
RESET ROLE;
UPDATE public.paciente SET cuenta_id=NULL WHERE id=pg_temp.m150_id(41);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m150_error(format('SELECT public.patient_portal_contact_cas(%L,%L,%L,''0'',''0'',%L,''PORTAL'',%L,''{"domicilio_ciudad":"wrong"}'')',
 pg_temp.m150_id(10),pg_temp.m150_id(41),pg_temp.m150_id(31),pg_temp.m150_id(21),pg_temp.m150_id(902)),'42501');

-- Conditional MFA becomes required; an AAL1 caller must now be rejected.
RESET ROLE;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now()-interval '1 minute';
SELECT set_config('test.m150_uid',pg_temp.m150_id(1)::text,true);
SELECT set_config('test.m150_jwt',jsonb_build_object('session_id',pg_temp.m150_id(901),'aal','aal1')::text,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m150_error(format('SELECT public.patient_admin_coverage_cas(%L,%L,%L,''9007199254740994'',''9007199254740993'',%L,''OWNER'',%L,''{"cobertura_nombre":null,"cobertura_plan":null,"cobertura_nro_afiliado_cifrado":null}'')',
 pg_temp.m150_id(10),pg_temp.m150_id(41),pg_temp.m150_id(31),pg_temp.m150_id(11),pg_temp.m150_id(901)),'42501');

ROLLBACK;
