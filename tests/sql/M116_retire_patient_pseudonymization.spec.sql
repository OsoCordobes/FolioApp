-- Rollback-only synthetic fixtures on vanilla PostgreSQL 16 + Auth stubs.
-- Real roles exercise ACLs; postgres also exercises the retired function body.
BEGIN;

DO $$
DECLARE proc record; role_name text;
BEGIN
  SELECT * INTO STRICT proc FROM pg_proc
    WHERE oid = to_regprocedure('public.pseudonimizar_paciente(uuid,text,boolean)');
  IF coalesce(obj_description(proc.oid, 'pg_proc'), '') NOT LIKE '%policy=retired.v1%'
    OR proc.prorettype <> 'jsonb'::regtype OR proc.pronargdefaults <> 1
    OR proc.proargnames <> ARRAY['p_paciente_id','p_motivo','p_dry_run']::text[]
    OR proc.prosecdef OR proc.proisstrict THEN
    RAISE EXCEPTION 'M116: retired signature, default or invocation contract changed';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(role_name, proc.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'M116: application role still has EXECUTE: %', role_name;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner)))
    WHERE grantee = 0 AND privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'M116: PUBLIC still has EXECUTE';
  END IF;
  IF current_user <> 'postgres' OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    OR NOT has_function_privilege(current_user, proc.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'M116: this fixture must verify the body as postgres superuser';
  END IF;
END $$;

DO $$
DECLARE
  org uuid := '11600000-0000-4000-8000-000000000001';
  staff uuid := '11600000-0000-4000-8000-000000000010';
  member_id uuid := '11600000-0000-4000-8000-000000000011';
  portal_user uuid := '11600000-0000-4000-8000-000000000020';
  account_id uuid := '11600000-0000-4000-8000-000000000021';
  identity_id uuid := '11600000-0000-4000-8000-000000000030';
  patient uuid := '11600000-0000-4000-8000-000000000031';
  service_id uuid := '11600000-0000-4000-8000-000000000040';
  appointment_id uuid := '11600000-0000-4000-8000-000000000041';
  clinical_session uuid := '11600000-0000-4000-8000-000000000042';
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (staff,'m116-staff@synthetic.invalid'),(portal_user,'m116-patient@synthetic.invalid');
  INSERT INTO auth.identities(user_id,provider) VALUES(staff,'email'),(portal_user,'email');
  INSERT INTO auth.mfa_factors(id,user_id,status) VALUES
    ('11600000-0000-4000-8000-000000000050',staff,'verified');
  INSERT INTO auth.sessions(id,user_id,aal,factor_id) VALUES
    ('11600000-0000-4000-8000-000000000051',staff,'aal2','11600000-0000-4000-8000-000000000050'),
    ('11600000-0000-4000-8000-000000000052',portal_user,'aal1',NULL);
  INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version,deletion_requested_at,deletion_reason)
    VALUES(staff,'m116-staff@synthetic.invalid',now(),'synthetic-v1',now()-interval '90 days','Synthetic pending human review');
  INSERT INTO organization(id,slug,nombre) VALUES(org,'m116-synthetic','M116 synthetic');
  INSERT INTO member(id,organization_id,profile_id,role,accepted_at)
    VALUES(member_id,org,staff,'OWNER',now());
  INSERT INTO paciente_cuenta(id,auth_user_id,email) VALUES(account_id,portal_user,'m116-patient@synthetic.invalid');
  INSERT INTO paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,dni_hash,nombre_hash)
    VALUES(identity_id,org,'\x0102','\x0304','\x0506',repeat('a',64),repeat('b',64));
  INSERT INTO paciente(id,organization_id,identidad_id,cuenta_id,profesional_principal_id)
    VALUES(patient,org,identity_id,account_id,member_id);
  INSERT INTO contacto_emergencia(organization_id,paciente_id,nombre_cifrado,telefono_cifrado,vinculo)
    VALUES(org,patient,'\x0708','\x090a','CONYUGE');
  INSERT INTO tutor_legal(organization_id,paciente_id,nombre_cifrado,numero_doc_cifrado,telefono_cifrado,vinculo)
    VALUES(org,patient,'\x0b0c','\x0d0e','\x0f10','MADRE');
  INSERT INTO paciente_intake_avanzado(organization_id,paciente_id,especialidad,datos_cifrado)
    VALUES(org,patient,'psicologia','\x1112');
  INSERT INTO servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
    VALUES(service_id,org,'Synthetic',enum_first(NULL::tipo_servicio_canonico),30,100);
  INSERT INTO turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents)
    VALUES(appointment_id,org,patient,service_id,member_id,now()+interval '1 day',30,100);
  INSERT INTO sesion(id,organization_id,turno_id,paciente_id,soap_s_cifrado,notas_cifrado,locked_at,locked_by_id)
    VALUES(clinical_session,org,appointment_id,patient,'\x1314','\x1516',now(),member_id);
  INSERT INTO sesion_enmienda(organization_id,sesion_id,autor_id,motivo,texto_correccion_cifrado)
    VALUES(org,clinical_session,member_id,'Synthetic correction with preserved authorship','\x1718');
  INSERT INTO nota_clinica(organization_id,paciente_id,autor_id,texto_cifrado)
    VALUES(org,patient,member_id,'\x191a');
  INSERT INTO instrumento_respuesta(organization_id,paciente_id,sesion_id,instrumento_id,instrumento_version,
    respuestas_cifrado,score_total,banda,completado_por,locked_at)
    VALUES(org,patient,clinical_session,'phq9.v1',1,'\x1b1c',9,'leve','profesional',now());
END $$;

-- Compare full rows, including ciphertext, linkage, authorship and timestamps.
-- No count-only assertion can hide an identity unlink or a modified narrative.
CREATE FUNCTION pg_temp.m116_snapshot() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE table_name text; rows jsonb; result jsonb := '{}';
BEGIN
  FOREACH table_name IN ARRAY ARRAY['organization','member','profile','paciente_cuenta','paciente_identidad',
    'paciente','contacto_emergencia','tutor_legal','paciente_intake_avanzado','turno','sesion',
    'sesion_enmienda','nota_clinica','instrumento_respuesta','pseudonimizacion_event','audit_log'] LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), ''[]''::jsonb) FROM public.%I t', table_name) INTO rows;
    result := result || jsonb_build_object('public.'||table_name, rows);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['users','identities','sessions','mfa_factors'] LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), ''[]''::jsonb) FROM auth.%I t', table_name) INTO rows;
    result := result || jsonb_build_object('auth.'||table_name, rows);
  END LOOP;
  RETURN result;
END $$;
CREATE TEMP TABLE m116_before AS SELECT pg_temp.m116_snapshot() AS state;

-- Simulate an authenticated OWNER with AAL2. Retirement still wins even though
-- this account would have passed the old member/MFA authorization checks.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m116_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT '{"aal":"aal2","session_id":"11600000-0000-4000-8000-000000000051"}'::jsonb $$;
SELECT set_config('test.m116_uid','11600000-0000-4000-8000-000000000010',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;

DO $$
DECLARE actor text; dry boolean; observed text;
BEGIN
  FOREACH actor IN ARRAY ARRAY['authenticated','service_role','anon','postgres'] LOOP
    FOREACH dry IN ARRAY ARRAY[false,true,NULL] LOOP
      EXECUTE format('SET LOCAL ROLE %I',actor);
      BEGIN
        PERFORM public.pseudonimizar_paciente('11600000-0000-4000-8000-000000000031','Synthetic retired request',dry);
        RAISE EXCEPTION 'M116: erasure unexpectedly succeeded for %',actor;
      EXCEPTION WHEN insufficient_privilege THEN
        observed := SQLERRM;
        IF actor='postgres' AND observed <> 'patient_pseudonymization_retired' THEN RAISE; END IF;
        IF actor<>'postgres' AND observed NOT LIKE '%permission denied for function pseudonimizar_paciente%' THEN RAISE; END IF;
      END;
      RESET ROLE;
      IF pg_temp.m116_snapshot() IS DISTINCT FROM (SELECT state FROM m116_before) THEN
        RAISE EXCEPTION 'M116: data changed after retired request by %',actor;
      END IF;
    END LOOP;
  END LOOP;
  -- Named arguments/default and null inputs also reach the explicit rejection.
  BEGIN
    PERFORM public.pseudonimizar_paciente(p_paciente_id=>NULL,p_motivo=>NULL);
    RAISE EXCEPTION 'M116: default/null invocation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'patient_pseudonymization_retired' THEN RAISE; END IF;
  END;
END $$;

-- Defense in depth: an accidental future EXECUTE grant must not restore the
-- old erasure body. This test-only grant is rolled back with all fixtures.
GRANT EXECUTE ON FUNCTION public.pseudonimizar_paciente(uuid,text,boolean) TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.pseudonimizar_paciente('11600000-0000-4000-8000-000000000031','Synthetic accidental regrant',false);
    RAISE EXCEPTION 'M116: restoring EXECUTE reactivated patient erasure';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'patient_pseudonymization_retired' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF pg_temp.m116_snapshot() IS DISTINCT FROM (SELECT state FROM m116_before) THEN
    RAISE EXCEPTION 'M116: identity, clinical history, instruments or Auth changed';
  END IF;
END $$;
ROLLBACK;
