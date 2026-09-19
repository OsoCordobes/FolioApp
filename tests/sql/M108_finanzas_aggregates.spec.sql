-- Synthetic, rollback-only. Exercise real invoker RLS with > PostgREST max_rows.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.m108_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m108_jwt',true),''),'{}')::jsonb $$;
INSERT INTO auth.users(id,email,email_confirmed_at) SELECT
 ('10800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'m108-'||n||'@spec.invalid',now() FROM generate_series(1,3)n;
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version)
 SELECT id,email,now(),'v1' FROM auth.users WHERE id::text LIKE '10800000%';
INSERT INTO organization(id,slug,nombre,is_internal_account) VALUES
 ('10800000-0000-4000-8000-000000000010','m108-fixture','Synthetic finance',true),
 ('10800000-0000-4000-8000-000000000011','m108-other','Synthetic other',true);
INSERT INTO member(id,organization_id,profile_id,role,accepted_at) VALUES
 ('10800000-0000-4000-8000-000000000021','10800000-0000-4000-8000-000000000010','10800000-0000-4000-8000-000000000001','OWNER',now()),
 ('10800000-0000-4000-8000-000000000022','10800000-0000-4000-8000-000000000010','10800000-0000-4000-8000-000000000002','PROFESIONAL',now()),
 ('10800000-0000-4000-8000-000000000023','10800000-0000-4000-8000-000000000010','10800000-0000-4000-8000-000000000003','ASISTENTE',now());
INSERT INTO paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,nombre_hash,dni_hash)
 VALUES('10800000-0000-4000-8000-000000000030','10800000-0000-4000-8000-000000000010','\x01','\x02','\x03',repeat('a',64),repeat('b',64));
INSERT INTO paciente(id,organization_id,identidad_id,profesional_principal_id)
 VALUES('10800000-0000-4000-8000-000000000031','10800000-0000-4000-8000-000000000010','10800000-0000-4000-8000-000000000030','10800000-0000-4000-8000-000000000022');
INSERT INTO servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
 VALUES('10800000-0000-4000-8000-000000000040','10800000-0000-4000-8000-000000000010','Synthetic service','CONSULTA_INICIAL',5,101);
INSERT INTO turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,estado,precio_cents)
 SELECT ('10800001-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '10800000-0000-4000-8000-000000000010','10800000-0000-4000-8000-000000000031','10800000-0000-4000-8000-000000000040',
 CASE WHEN n=1205 THEN '10800000-0000-4000-8000-000000000021'::uuid ELSE '10800000-0000-4000-8000-000000000022'::uuid END,
 '2026-09-01T03:00:00Z'::timestamptz+n*interval '10 minutes',5,'CERRADO',101 FROM generate_series(1,1205)n;
INSERT INTO pago(id,turno_id,monto_cents,metodo,estado,pagado_ts,created_at)
 SELECT ('10800002-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('10800001-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 CASE WHEN n=1205 THEN 2147483647 ELSE 101 END,'EFECTIVO',CASE WHEN n<=1100 THEN 'PAGADO'::estado_pago ELSE 'PENDIENTE'::estado_pago END,
 CASE WHEN n>1100 THEN NULL WHEN n=1 THEN '2026-10-01T03:00:00Z'::timestamptz ELSE '2026-09-02T02:59:59Z'::timestamptz END,
 '2026-09-01T03:00:00Z' FROM generate_series(1,1205)n;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON organization,member,pago,turno,servicio,paciente,paciente_identidad TO authenticated;
GRANT INSERT,UPDATE,DELETE ON pago TO authenticated;
-- Another OWNER membership must not widen the actor's PROFESIONAL role here.
INSERT INTO member(id,organization_id,profile_id,role,accepted_at) VALUES
 ('10800000-0000-4000-8000-000000000024','10800000-0000-4000-8000-000000000011','10800000-0000-4000-8000-000000000002','OWNER',now());
-- Unpaid colleague appointment used to probe direct INSERT (outside summary period).
INSERT INTO turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents) VALUES
 ('10800001-0000-4000-8000-000000001206','10800000-0000-4000-8000-000000000010','10800000-0000-4000-8000-000000000031',
  '10800000-0000-4000-8000-000000000040','10800000-0000-4000-8000-000000000021','2026-11-01T03:00Z',5,101);
-- The fixture was bulk-loaded in this transaction; autovacuum cannot analyze it yet.
ANALYZE public.pago,public.turno,public.paciente,public.paciente_identidad,public.servicio,public.member,public.organization;
SELECT set_config('test.m108_uid','10800000-0000-4000-8000-000000000001',true);
SELECT set_config('test.m108_jwt','{"aal":"aal1"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; page jsonb; before_ts timestamptz; before_id uuid; ids uuid[]:='{}'; x jsonb; rev text; BEGIN
 r:=public.finanzas_summary('10800000-0000-4000-8000-000000000010','2026-09-01T03:00Z','2026-10-01T03:00Z','2026-08-01T03:00Z','2026-09-01T03:00Z');
 IF r->>'paid_cents'<>'111100' OR r->>'pending_cents'<>'2147494151' OR r->>'sessions'<>'1205' THEN
  RAISE EXCEPTION 'M108: aggregate truncated or cents rounded'; END IF;
 IF r->'days'->0->>'bucket'<>'2026-09-01' OR r->'days'->0->>'cents'<>'111100' THEN
  RAISE EXCEPTION 'M108: Cordoba boundary/out-of-range paid timestamp mismatch'; END IF;
 page:=public.finanzas_movements('10800000-0000-4000-8000-000000000010','2026-09-01T03:00Z','2026-10-01T03:00Z');
 IF jsonb_array_length(page->'rows')<>50 THEN RAISE EXCEPTION 'M108: dashboard page is not bounded to fifty'; END IF;
 LOOP
  page:=public.finanzas_movements('10800000-0000-4000-8000-000000000010','2026-09-01T03:00Z','2026-10-01T03:00Z',
    p_before_created=>before_ts,p_before_id=>before_id,p_limit=>100,p_check_revision=>true);
  IF jsonb_array_length(page->'rows')>100 OR page->>'total_count'<>'1205' THEN RAISE EXCEPTION 'M108: unbounded or truncated page'; END IF;
  IF rev IS NOT NULL AND rev<>page->>'revision' THEN RAISE EXCEPTION 'M108: unstable revision without writes'; END IF;
  rev:=page->>'revision';
  FOR x IN SELECT value FROM jsonb_array_elements(page->'rows') LOOP
   IF (x->>'id')::uuid=ANY(ids) THEN RAISE EXCEPTION 'M108: tied timestamp repeated a row'; END IF;
   ids:=array_append(ids,(x->>'id')::uuid); before_ts:=(x->>'created_at')::timestamptz; before_id:=(x->>'id')::uuid;
  END LOOP;
  EXIT WHEN NOT (page->>'has_more')::boolean;
 END LOOP;
 IF cardinality(ids)<>1205 THEN RAISE EXCEPTION 'M108: missing movement beyond max_rows'; END IF;
 page:=public.finanzas_movements('10800000-0000-4000-8000-000000000010','2026-09-01T03:00Z','2026-10-01T03:00Z',
   p_status=>'pendientes',p_query=>'Exact synthetic identity',p_hashes=>ARRAY[repeat('a',64)]);
 IF page->>'total_count'<>'105' THEN RAISE EXCEPTION 'M108: status/hash filter applies only to first page'; END IF;
 page:=public.finanzas_movements('10800000-0000-4000-8000-000000000010','2026-09-01T03:00Z','2026-10-01T03:00Z',p_query=>'1,01',p_amount_cents=>'101');
 IF page->>'total_count'<>'1204' THEN RAISE EXCEPTION 'M108: amount filter not exact'; END IF;
 page:=public.finanzas_movements('10800000-0000-4000-8000-000000000010','2026-09-01T03:00Z','2026-10-01T03:00Z',p_status=>'cobrados',p_query=>'SYNTHETIC');
 IF page->>'total_count'<>'1100' THEN RAISE EXCEPTION 'M108: service/status filter mismatch'; END IF;
 page:=public.finanzas_movements('10800000-0000-4000-8000-000000000010','2026-09-01T03:00Z','2026-10-01T03:00Z',p_query=>'unknown identity',p_hashes=>ARRAY[repeat('c',64)]);
 IF page->>'total_count'<>'0' THEN RAISE EXCEPTION 'M108: unmatched blind index returned another identity'; END IF;
 -- Same-count mutation must change the export revision; dates use a half-open range.
 UPDATE pago SET monto_cents=102 WHERE id='10800002-0000-4000-8000-000000000002';
 page:=public.finanzas_movements('10800000-0000-4000-8000-000000000010','2026-09-01T03:00Z','2026-10-01T03:00Z',p_check_revision=>true);
 IF rev=page->>'revision' OR page->>'total_count'<>'1205' THEN RAISE EXCEPTION 'M108: same-count value change invisible to export revision'; END IF;
 UPDATE pago SET monto_cents=101,created_at='2026-10-01T03:00Z' WHERE id='10800002-0000-4000-8000-000000000002';
 page:=public.finanzas_movements('10800000-0000-4000-8000-000000000010','2026-09-01T03:00Z','2026-10-01T03:00Z');
 IF page->>'total_count'<>'1204' THEN RAISE EXCEPTION 'M108: exclusive range end included'; END IF;
 UPDATE pago SET created_at='2026-09-01T03:00Z' WHERE id='10800002-0000-4000-8000-000000000002';
 BEGIN
  PERFORM public.finanzas_movements('10800000-0000-4000-8000-000000000011','2026-09-01T03:00Z','2026-10-01T03:00Z');
  RAISE EXCEPTION 'M108: foreign organization allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.finanzas_movements('10800000-0000-4000-8000-000000000010','2026-09-01T03:00Z','2026-10-01T03:00Z',p_limit=>1001);
  RAISE EXCEPTION 'M108: caller widened page'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('test.m108_uid','10800000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; affected integer; BEGIN
 r:=public.finanzas_movements('10800000-0000-4000-8000-000000000010','2026-09-01T03:00Z','2026-10-01T03:00Z');
 IF r->>'total_count'<>'1204' THEN RAISE EXCEPTION 'M108: professional sees colleague financial rows'; END IF;
 IF EXISTS(SELECT 1 FROM pago WHERE id='10800002-0000-4000-8000-000000001205') THEN
  RAISE EXCEPTION 'M108: raw REST reads colleague payment'; END IF;
 UPDATE pago SET monto_cents=102 WHERE id='10800002-0000-4000-8000-000000001205';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'M108: raw REST updates colleague payment'; END IF;
 BEGIN
  INSERT INTO pago(turno_id,monto_cents,metodo,estado) VALUES('10800001-0000-4000-8000-000000001206',101,'EFECTIVO','PENDIENTE');
  RAISE EXCEPTION 'M108: raw REST inserts colleague payment'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE pago SET turno_id='10800001-0000-4000-8000-000000001206' WHERE id='10800002-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'M108: raw REST transfers payment outside professional scope'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 DELETE FROM pago WHERE id='10800002-0000-4000-8000-000000000001';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'M108: raw REST deletes financial history'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.m108_uid','10800000-0000-4000-8000-000000000001',true);
UPDATE paciente SET caja_fuerte_profesional='10800000-0000-4000-8000-000000000021'
 WHERE id='10800000-0000-4000-8000-000000000031';
SELECT set_config('test.m108_uid','10800000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.finanzas_movements('10800000-0000-4000-8000-000000000010','2026-09-01T03:00Z','2026-10-01T03:00Z');
 IF r->>'total_count'<>'1204' OR r->'rows'->0->>'nombre_cifrado' IS NOT NULL THEN
  RAISE EXCEPTION 'M108: finance join expanded caja fuerte clinical visibility'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.m108_uid','10800000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE affected integer; BEGIN
 UPDATE pago SET monto_cents=2147483646 WHERE id='10800002-0000-4000-8000-000000001205';
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'M108: receptionist cash permissions were removed'; END IF;
 BEGIN
  PERFORM public.finanzas_movements('10800000-0000-4000-8000-000000000010','2026-09-01T03:00Z','2026-10-01T03:00Z');
  RAISE EXCEPTION 'M108: assistant can query finance dashboard'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Revocation in this organization is not rescued by the same user's OWNER role elsewhere.
SELECT set_config('test.m108_uid','10800000-0000-4000-8000-000000000001',true);
UPDATE member SET deleted_at=now() WHERE id='10800000-0000-4000-8000-000000000022';
SELECT set_config('test.m108_uid','10800000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pago WHERE id='10800002-0000-4000-8000-000000000001') THEN
  RAISE EXCEPTION 'M108: revoked member still reads raw payment'; END IF;
 BEGIN
  PERFORM public.finanzas_summary('10800000-0000-4000-8000-000000000010','2026-09-01T03:00Z','2026-10-01T03:00Z','2026-08-01T03:00Z','2026-09-01T03:00Z');
  RAISE EXCEPTION 'M108: revoked member still queries aggregate'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('test.m108_uid','10800000-0000-4000-8000-000000000001',true);
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.finanzas_movements('10800000-0000-4000-8000-000000000010','2026-09-01T03:00Z','2026-10-01T03:00Z');
  RAISE EXCEPTION 'M108: direct RPC bypasses MFA AAL1'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege('anon','public.finanzas_summary(uuid,timestamptz,timestamptz,timestamptz,timestamptz)','EXECUTE') THEN
  RAISE EXCEPTION 'M108: anonymous aggregate grant'; END IF;
END $$;
ROLLBACK;
