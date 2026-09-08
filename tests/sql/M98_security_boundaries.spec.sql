-- Real SQL/RLS regression tests, isolated and rolled back after verification.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m98_uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT ON member, organization, paciente, paciente_identidad, alergia TO authenticated;
GRANT INSERT, UPDATE ON organization TO authenticated;
GRANT SELECT, UPDATE ON organization TO service_role;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
 ('98000000-0000-4000-8000-000000000001', 'm98-owner@spec.test', now()),
 ('98000000-0000-4000-8000-000000000002', 'm98-prof@spec.test', now()),
 ('98000000-0000-4000-8000-000000000003', 'm98-patient@spec.test', now());
INSERT INTO profile (id,email,consent_pii_signed_at,consent_pii_text_version)
 SELECT id,email,now(),'v1' FROM auth.users WHERE id IN
 ('98000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000002');
INSERT INTO organization(id,slug,nombre) VALUES
 ('98000000-0000-4000-8000-000000000010','m98-boundaries','M98');
INSERT INTO member(id,organization_id,profile_id,role,accepted_at) VALUES
 ('98000000-0000-4000-8000-000000000011','98000000-0000-4000-8000-000000000010','98000000-0000-4000-8000-000000000001','OWNER',now()),
 ('98000000-0000-4000-8000-000000000012','98000000-0000-4000-8000-000000000010','98000000-0000-4000-8000-000000000002','PROFESIONAL',now());
INSERT INTO paciente_cuenta(id,auth_user_id,email,email_verificado_en) VALUES
 ('98000000-0000-4000-8000-000000000020','98000000-0000-4000-8000-000000000003','m98-patient@spec.test',now());
INSERT INTO paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,fecha_nacimiento,email_hash,dni_hash) VALUES
 ('98000000-0000-4000-8000-000000000030','98000000-0000-4000-8000-000000000010','\x01','\x02','\x03','1990-01-01',repeat('a',64),repeat('b',64));
INSERT INTO paciente(id,organization_id,identidad_id,profesional_principal_id) VALUES
 ('98000000-0000-4000-8000-000000000040','98000000-0000-4000-8000-000000000010','98000000-0000-4000-8000-000000000030','98000000-0000-4000-8000-000000000011');
INSERT INTO alergia(organization_id,paciente_id,sustancia_cifrado,severidad,activa) VALUES
 ('98000000-0000-4000-8000-000000000010','98000000-0000-4000-8000-000000000040','\x01','SEVERA',true);

SELECT set_config('test.m98_uid','98000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    UPDATE organization SET is_internal_account = true WHERE id='98000000-0000-4000-8000-000000000010';
    RAISE EXCEPTION 'M98 FAIL: OWNER can exempt their own subscription';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF public.paciente_tiene_alergias_severas('98000000-0000-4000-8000-000000000040') IS NOT TRUE THEN
    RAISE EXCEPTION 'M98 FAIL: legitimate clinical allergy warning lost';
  END IF;
END $$;
RESET ROLE;

-- Same-org professional without patient assignment must not learn clinical booleans.
UPDATE paciente SET pseudonimizado_en=now(), identidad_id=null
 WHERE id='98000000-0000-4000-8000-000000000040';
SELECT set_config('test.m98_uid','98000000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.paciente_tiene_alergias_severas('98000000-0000-4000-8000-000000000040') IS TRUE OR
    public.paciente_es_pseudonimizado('98000000-0000-4000-8000-000000000040') IS TRUE THEN
   RAISE EXCEPTION 'M98 FAIL: unassigned professional can read protected patient facts';
 END IF;
END $$;
RESET ROLE;
SELECT set_config('test.m98_uid','',true);
UPDATE paciente SET pseudonimizado_en=null, identidad_id='98000000-0000-4000-8000-000000000030',
 caja_fuerte_profesional='98000000-0000-4000-8000-000000000012'
 WHERE id='98000000-0000-4000-8000-000000000040';
SELECT set_config('test.m98_uid','98000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.paciente_tiene_alergias_severas('98000000-0000-4000-8000-000000000040') IS TRUE THEN
   RAISE EXCEPTION 'M98 FAIL: OWNER can read a locked patient allergy';
 END IF;
 IF has_function_privilege('authenticated','public.portal_link_verified_patient(uuid,uuid,uuid,uuid,text,text,text,text)','EXECUTE') THEN
   RAISE EXCEPTION 'M98 FAIL: authenticated clients can invoke privileged linkage';
 END IF;
END $$;
RESET ROLE;
SELECT set_config('test.m98_uid','',true);
UPDATE paciente SET caja_fuerte_profesional=null WHERE id='98000000-0000-4000-8000-000000000040';

-- Exercise trigger INSERT guard with an isolated permissive RLS policy: a denial
-- must come from the column guard, not unrelated organization INSERT RLS.
CREATE POLICY m98_test_insert ON organization FOR INSERT TO authenticated WITH CHECK (true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  INSERT INTO organization(slug,nombre,is_internal_account) VALUES ('m98-illegal-insert','M98',true);
  RAISE EXCEPTION 'M98 FAIL: authenticated INSERT can set internal account';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- Administrative changes remain available.
UPDATE organization SET is_internal_account=true WHERE id='98000000-0000-4000-8000-000000000010';
UPDATE organization SET is_internal_account=false WHERE id='98000000-0000-4000-8000-000000000010';
SET LOCAL ROLE service_role;
UPDATE organization SET is_internal_account=true WHERE id='98000000-0000-4000-8000-000000000010';
UPDATE organization SET is_internal_account=false WHERE id='98000000-0000-4000-8000-000000000010';
RESET ROLE;

DO $$
DECLARE linked boolean;
BEGIN
  -- Shared constants simplify repeated calls without creating a test-only production RPC.
  linked := public.portal_link_verified_patient('98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000020','98000000-0000-4000-8000-000000000040','98000000-0000-4000-8000-000000000010','attacker@spec.test',repeat('a',64),repeat('b',64),null);
  IF linked THEN RAISE EXCEPTION 'M98 FAIL: stale/forged verified email accepted'; END IF;

  UPDATE auth.users SET email_confirmed_at=null WHERE id='98000000-0000-4000-8000-000000000003';
  linked := public.portal_link_verified_patient('98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000020','98000000-0000-4000-8000-000000000040','98000000-0000-4000-8000-000000000010','m98-patient@spec.test',repeat('a',64),repeat('b',64),null);
  IF linked THEN RAISE EXCEPTION 'M98 FAIL: unverified Auth accepted'; END IF;
  UPDATE auth.users SET email_confirmed_at=now() WHERE id='98000000-0000-4000-8000-000000000003';

  UPDATE paciente_identidad SET fecha_nacimiento=current_date - interval '17 years' WHERE id='98000000-0000-4000-8000-000000000030';
  linked := public.portal_link_verified_patient('98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000020','98000000-0000-4000-8000-000000000040','98000000-0000-4000-8000-000000000010','m98-patient@spec.test',repeat('a',64),repeat('b',64),null);
  IF linked THEN RAISE EXCEPTION 'M98 FAIL: minor auto-linked to family email'; END IF;
  UPDATE paciente_identidad SET fecha_nacimiento=null WHERE id='98000000-0000-4000-8000-000000000030';
  linked := public.portal_link_verified_patient('98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000020','98000000-0000-4000-8000-000000000040','98000000-0000-4000-8000-000000000010','m98-patient@spec.test',repeat('a',64),repeat('b',64),null);
  IF linked THEN RAISE EXCEPTION 'M98 FAIL: unknown birth auto-linked'; END IF;
  UPDATE paciente_identidad SET fecha_nacimiento='1990-01-01',email_hash=repeat('c',64) WHERE id='98000000-0000-4000-8000-000000000030';
  linked := public.portal_link_verified_patient('98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000020','98000000-0000-4000-8000-000000000040','98000000-0000-4000-8000-000000000010','m98-patient@spec.test',repeat('a',64),repeat('b',64),null);
  IF linked THEN RAISE EXCEPTION 'M98 FAIL: stale identity hash accepted'; END IF;
  UPDATE paciente_identidad SET email_hash=repeat('a',64) WHERE id='98000000-0000-4000-8000-000000000030';
  UPDATE organization SET deleted_at=now() WHERE id='98000000-0000-4000-8000-000000000010';
  linked := public.portal_link_verified_patient('98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000020','98000000-0000-4000-8000-000000000040','98000000-0000-4000-8000-000000000010','m98-patient@spec.test',repeat('a',64),repeat('b',64),null);
  IF linked THEN RAISE EXCEPTION 'M98 FAIL: deleted organization accepted'; END IF;
  UPDATE organization SET deleted_at=null WHERE id='98000000-0000-4000-8000-000000000010';
  -- Every live household member counts, even if already linked or their age is unknown/minor.
  INSERT INTO paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,fecha_nacimiento,email_hash,dni_hash) VALUES
    ('98000000-0000-4000-8000-000000000031','98000000-0000-4000-8000-000000000010','\x01','\x02','\x03','1992-01-01',repeat('a',64),repeat('d',64));
  INSERT INTO paciente(id,organization_id,identidad_id,profesional_principal_id,cuenta_id) VALUES
    ('98000000-0000-4000-8000-000000000041','98000000-0000-4000-8000-000000000010','98000000-0000-4000-8000-000000000031','98000000-0000-4000-8000-000000000011','98000000-0000-4000-8000-000000000020');
  linked := public.portal_link_verified_patient('98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000020','98000000-0000-4000-8000-000000000040','98000000-0000-4000-8000-000000000010','m98-patient@spec.test',repeat('a',64),repeat('b',64),null);
  IF linked THEN RAISE EXCEPTION 'M98 FAIL: linked household member ignored for ambiguity'; END IF;
  UPDATE paciente_identidad SET fecha_nacimiento=null WHERE id='98000000-0000-4000-8000-000000000031';
  linked := public.portal_link_verified_patient('98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000020','98000000-0000-4000-8000-000000000040','98000000-0000-4000-8000-000000000010','m98-patient@spec.test',repeat('a',64),repeat('b',64),null);
  IF linked THEN RAISE EXCEPTION 'M98 FAIL: unknown-age household member ignored'; END IF;
  UPDATE paciente_identidad SET fecha_nacimiento=current_date - interval '10 years' WHERE id='98000000-0000-4000-8000-000000000031';
  linked := public.portal_link_verified_patient('98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000020','98000000-0000-4000-8000-000000000040','98000000-0000-4000-8000-000000000010','m98-patient@spec.test',repeat('a',64),repeat('b',64),null);
  IF linked THEN RAISE EXCEPTION 'M98 FAIL: minor household member ignored'; END IF;
  UPDATE paciente SET deleted_at=now() WHERE id='98000000-0000-4000-8000-000000000041';
  linked := public.portal_link_verified_patient('98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000020','98000000-0000-4000-8000-000000000040','98000000-0000-4000-8000-000000000010','m98-patient@spec.test',repeat('a',64),repeat('b',64),null);
  IF linked IS NOT TRUE THEN RAISE EXCEPTION 'M98 FAIL: verified adult legitimate linkage rejected'; END IF;
  linked := public.portal_link_verified_patient('98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000020','98000000-0000-4000-8000-000000000040','98000000-0000-4000-8000-000000000010','m98-patient@spec.test',repeat('a',64),repeat('b',64),null);
  IF linked THEN RAISE EXCEPTION 'M98 FAIL: linked patient was overwritten'; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_log WHERE resource_id='98000000-0000-4000-8000-000000000040' AND action='paciente.portal_auto_link') THEN
    RAISE EXCEPTION 'M98 FAIL: linkage has no transactional audit';
  END IF;
END $$;
SET LOCAL ROLE service_role;
-- A repeat is safely false; importantly, service_role can execute the RPC.
SELECT public.portal_link_verified_patient('98000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000020','98000000-0000-4000-8000-000000000040','98000000-0000-4000-8000-000000000010','m98-patient@spec.test',repeat('a',64),repeat('b',64),null);
RESET ROLE;
ROLLBACK;
