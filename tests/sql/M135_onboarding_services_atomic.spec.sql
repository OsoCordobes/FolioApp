-- Synthetic, rollback-only contract for the Step 6 catalog writer.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.m135_uid',true),'')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('test.m135_jwt',true),''),'{}')::jsonb
$$;
INSERT INTO auth.users(id,email) VALUES
 ('13500000-0000-4000-8000-000000000001','m135-owner@synthetic.invalid'),
 ('13500000-0000-4000-8000-000000000002','m135-other@synthetic.invalid');
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES
 ('13500000-0000-4000-8000-000000000001','m135-owner@synthetic.invalid',now(),'synthetic'),
 ('13500000-0000-4000-8000-000000000002','m135-other@synthetic.invalid',now(),'synthetic');
INSERT INTO public.organization(id,slug,nombre,tipo,onboarding_step_max,is_synthetic) VALUES
 ('13500000-0000-4000-8000-000000000010','m135-solo','Synthetic Solo','INDEPENDIENTE',5,true),
 ('13500000-0000-4000-8000-000000000020','m135-other','Synthetic Other','CLINICA',4,true);
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
 ('13500000-0000-4000-8000-000000000011','13500000-0000-4000-8000-000000000010','13500000-0000-4000-8000-000000000001','OWNER',true,now()),
 ('13500000-0000-4000-8000-000000000021','13500000-0000-4000-8000-000000000020','13500000-0000-4000-8000-000000000002','OWNER',false,NULL);
INSERT INTO auth.mfa_factors(id,user_id,status) VALUES
 ('13500000-0000-4000-8000-000000000031','13500000-0000-4000-8000-000000000002','verified');
INSERT INTO auth.sessions(id,user_id,aal,factor_id) VALUES
 ('13500000-0000-4000-8000-000000000041','13500000-0000-4000-8000-000000000002','aal2','13500000-0000-4000-8000-000000000031');
INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES
 ('13500000-0000-4000-8000-000000000101','13500000-0000-4000-8000-000000000010','Synthetic consult','CONSULTA_INICIAL',30,100000),
 ('13500000-0000-4000-8000-000000000102','13500000-0000-4000-8000-000000000010','Synthetic follow-up','SEGUIMIENTO_ESTANDAR',45,150000),
 ('13500000-0000-4000-8000-000000000201','13500000-0000-4000-8000-000000000020','Other tenant','CONSULTA_INICIAL',30,100000);
INSERT INTO public.servicio_profesional(organization_id,servicio_id,member_id) VALUES
 ('13500000-0000-4000-8000-000000000010','13500000-0000-4000-8000-000000000102','13500000-0000-4000-8000-000000000011');
INSERT INTO public.paciente(id,organization_id) VALUES
 ('13500000-0000-4000-8000-000000000301','13500000-0000-4000-8000-000000000010');
INSERT INTO public.turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents)
VALUES('13500000-0000-4000-8000-000000000401','13500000-0000-4000-8000-000000000010',
 '13500000-0000-4000-8000-000000000301','13500000-0000-4000-8000-000000000102',
 '13500000-0000-4000-8000-000000000011',now()+interval '2 hours',45,150000);
SELECT set_config('test.m135_uid','13500000-0000-4000-8000-000000000001',true);

CREATE FUNCTION pg_temp.m135_fail_progress() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id='13500000-0000-4000-8000-000000000010'
   AND NEW.onboarding_step_max>=6 AND OLD.onboarding_step_max<6 THEN
   RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Synthetic progress failure';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER m135_fail_progress BEFORE UPDATE OF onboarding_step_max ON public.organization
 FOR EACH ROW EXECUTE FUNCTION pg_temp.m135_fail_progress();
SET LOCAL ROLE authenticated;
DO $$
DECLARE org uuid:='13500000-0000-4000-8000-000000000010'; before_state jsonb;
  command jsonb:='[{"id":"13500000-0000-4000-8000-000000000101","nombre":"Synthetic consult revised","dur":35,"precioCents":110000,"tipoCanonico":"CONSULTA_INICIAL"},
                   {"id":"13500000-0000-4000-8000-000000000103","nombre":"Synthetic new","dur":30,"precioCents":120000,"tipoCanonico":"SERVICIO_ESPECIALIZADO"}]';
BEGIN
 before_state:=public.read_onboarding_services(org);
 IF (before_state->>'revision')::bigint<>2 OR jsonb_array_length(before_state->'servicios')<>2 THEN
   RAISE EXCEPTION 'M135 initial snapshot or direct-write revision incorrect';
 END IF;
 BEGIN
   PERFORM public.save_onboarding_services(org,2,'13500000-0000-4000-8000-000000000501',command);
   RAISE EXCEPTION 'M135 progress failure accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF public.read_onboarding_services(org) IS DISTINCT FROM before_state THEN
   RAISE EXCEPTION 'M135 progress failure changed catalog or revision';
 END IF;
 BEGIN
   PERFORM public.save_onboarding_services(org,2,gen_random_uuid(),'[]');
   RAISE EXCEPTION 'M135 Solo empty catalog accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.save_onboarding_services(org,2,gen_random_uuid(),
    '[{"id":"13500000-0000-4000-8000-000000000101","nombre":"Incomplete","dur":30,"precioCents":1}]');
  RAISE EXCEPTION 'M135 incomplete service accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.save_onboarding_services(org,2,gen_random_uuid(),
    '[{"id":"13500000-0000-4000-8000-000000000101","nombre":"Wrong type","dur":"30","precioCents":1,"tipoCanonico":"CONSULTA_INICIAL"}]');
  RAISE EXCEPTION 'M135 wrong service type accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.save_onboarding_services(org,2,gen_random_uuid(),
    '[{"id":"13500000-0000-4000-8000-000000000101","nombre":"Extra key","dur":30,"precioCents":1,"tipoCanonico":"CONSULTA_INICIAL","other":true}]');
  RAISE EXCEPTION 'M135 extra service key accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
   PERFORM public.save_onboarding_services(org,2,gen_random_uuid(),
     '[{"id":"13500000-0000-4000-8000-000000000201","nombre":"Cross tenant","dur":30,"precioCents":1,"tipoCanonico":"CONSULTA_INICIAL"}]');
   RAISE EXCEPTION 'M135 cross-tenant service ID accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF public.read_onboarding_services(org) IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'M135 rejected payload changed catalog or revision'; END IF;
END $$;
RESET ROLE;
DROP TRIGGER m135_fail_progress ON public.organization;
DO $$ BEGIN
 BEGIN
  UPDATE public.organization SET onboarding_services_revision=99
   WHERE id='13500000-0000-4000-8000-000000000010';
  RAISE EXCEPTION 'M135 direct revision change accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT onboarding_services_revision FROM public.organization
     WHERE id='13500000-0000-4000-8000-000000000010')<>2 THEN
  RAISE EXCEPTION 'M135 direct revision denial changed state';
 END IF;
END $$;
UPDATE public.organization SET onboarding_step_max=4
 WHERE id='13500000-0000-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.save_onboarding_services('13500000-0000-4000-8000-000000000010',2,
    gen_random_uuid(),
    '[{"id":"13500000-0000-4000-8000-000000000101","nombre":"Too early","dur":30,"precioCents":1,"tipoCanonico":"CONSULTA_INICIAL"}]');
  RAISE EXCEPTION 'M135 treating Solo wrote before Step 5';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.organization SET onboarding_step_max=5
 WHERE id='13500000-0000-4000-8000-000000000010';
CREATE FUNCTION pg_temp.m135_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id='13500000-0000-4000-8000-000000000103' THEN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Synthetic insert failure';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER m135_fail_insert BEFORE INSERT ON public.servicio
 FOR EACH ROW EXECUTE FUNCTION pg_temp.m135_fail_insert();
SET LOCAL ROLE authenticated;
DO $$
DECLARE org uuid:='13500000-0000-4000-8000-000000000010'; before_state jsonb;
  command jsonb:='[{"id":"13500000-0000-4000-8000-000000000101","nombre":"Synthetic consult revised","dur":35,"precioCents":110000,"tipoCanonico":"CONSULTA_INICIAL"},
                   {"id":"13500000-0000-4000-8000-000000000103","nombre":"Synthetic new","dur":30,"precioCents":120000,"tipoCanonico":"SERVICIO_ESPECIALIZADO"}]';
BEGIN
 before_state:=public.read_onboarding_services(org);
 BEGIN
  PERFORM public.save_onboarding_services(org,2,'13500000-0000-4000-8000-000000000503',command);
  RAISE EXCEPTION 'M135 insert failure accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF public.read_onboarding_services(org) IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'M135 insert failure changed existing service or revision';
 END IF;
END $$;
RESET ROLE;
DROP TRIGGER m135_fail_insert ON public.servicio;
SET LOCAL ROLE authenticated;
DO $$
DECLARE org uuid:='13500000-0000-4000-8000-000000000010'; result jsonb; replay jsonb;
  command jsonb:='[{"id":"13500000-0000-4000-8000-000000000101","nombre":" Synthetic consult revised ","dur":35,"precioCents":110000,"tipoCanonico":"CONSULTA_INICIAL"},
                   {"id":"13500000-0000-4000-8000-000000000103","nombre":"Synthetic new","dur":30,"precioCents":120000,"tipoCanonico":"SERVICIO_ESPECIALIZADO"}]';
BEGIN
 result:=public.save_onboarding_services(org,2,'13500000-0000-4000-8000-000000000502',command);
 IF (result->>'revision')::bigint<>3 THEN RAISE EXCEPTION 'M135 revision did not advance once'; END IF;
 IF result->'servicios'->0->>'nombre' IS DISTINCT FROM 'Synthetic consult revised' THEN
  RAISE EXCEPTION 'M135 receipt did not report normalized stored service'; END IF;
 replay:=public.save_onboarding_services(org,2,'13500000-0000-4000-8000-000000000502',command);
 IF replay IS DISTINCT FROM result THEN RAISE EXCEPTION 'M135 receipt replay changed result'; END IF;
 BEGIN
  PERFORM public.save_onboarding_services(org,2,'13500000-0000-4000-8000-000000000502','[]');
  RAISE EXCEPTION 'M135 reused operation accepted new payload';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
  PERFORM public.save_onboarding_services(org,2,gen_random_uuid(),command);
  RAISE EXCEPTION 'M135 stale revision accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
-- A legacy direct service write must invalidate a previously read revision.
UPDATE public.servicio SET precio_cents=111000
 WHERE id='13500000-0000-4000-8000-000000000101';
SET LOCAL ROLE authenticated;
DO $$
DECLARE org uuid:='13500000-0000-4000-8000-000000000010'; before_state jsonb;
BEGIN
 before_state:=public.read_onboarding_services(org);
 IF (before_state->>'revision')::bigint<>4 THEN
  RAISE EXCEPTION 'M135 direct service update did not invalidate snapshot'; END IF;
 BEGIN
  PERFORM public.save_onboarding_services(org,3,gen_random_uuid(),
    '[{"id":"13500000-0000-4000-8000-000000000101","nombre":"Stale overwrite","dur":35,"precioCents":1,"tipoCanonico":"CONSULTA_INICIAL"}]');
  RAISE EXCEPTION 'M135 stale direct-write snapshot accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 IF public.read_onboarding_services(org) IS DISTINCT FROM before_state THEN
  RAISE EXCEPTION 'M135 stale direct-write denial changed catalog'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT onboarding_step_max FROM public.organization WHERE id='13500000-0000-4000-8000-000000000010')<6
  OR (SELECT nombre FROM public.servicio WHERE id='13500000-0000-4000-8000-000000000101')<>'Synthetic consult revised'
  OR NOT EXISTS(SELECT 1 FROM public.servicio WHERE id='13500000-0000-4000-8000-000000000102' AND deleted_at IS NOT NULL)
  OR NOT EXISTS(SELECT 1 FROM public.servicio_profesional WHERE servicio_id='13500000-0000-4000-8000-000000000102')
  OR NOT EXISTS(SELECT 1 FROM public.turno WHERE id='13500000-0000-4000-8000-000000000401' AND servicio_id='13500000-0000-4000-8000-000000000102')
  OR (SELECT count(*) FROM public.servicio WHERE organization_id='13500000-0000-4000-8000-000000000010' AND deleted_at IS NULL)<>2
  OR EXISTS(SELECT 1 FROM folio_onboarding_services_private.authority)
 THEN RAISE EXCEPTION 'M135 failed service/assignment/booking/progress preservation'; END IF;
END $$;
UPDATE public.organization SET onboarding_completed=true WHERE id='13500000-0000-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb;BEGIN
 result:=public.save_onboarding_services('13500000-0000-4000-8000-000000000010',2,
  '13500000-0000-4000-8000-000000000502',
  '[{"id":"13500000-0000-4000-8000-000000000101","nombre":"Synthetic consult revised","dur":35,"precioCents":110000,"tipoCanonico":"CONSULTA_INICIAL"},
    {"id":"13500000-0000-4000-8000-000000000103","nombre":"Synthetic new","dur":30,"precioCents":120000,"tipoCanonico":"SERVICIO_ESPECIALIZADO"}]');
 IF (result->>'revision')::bigint<>3 THEN RAISE EXCEPTION 'M135 completed-org receipt lost'; END IF;
 BEGIN
  PERFORM public.save_onboarding_services('13500000-0000-4000-8000-000000000010',3,gen_random_uuid(),'[]');
  RAISE EXCEPTION 'M135 new write after completion accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('test.m135_uid','13500000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.read_onboarding_services('13500000-0000-4000-8000-000000000010');
  RAISE EXCEPTION 'M135 other tenant read accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.save_onboarding_services('13500000-0000-4000-8000-000000000010',2,
    '13500000-0000-4000-8000-000000000502','[]');
  RAISE EXCEPTION 'M135 other tenant replay accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
SELECT set_config('test.m135_uid','13500000-0000-4000-8000-000000000002',true);
SELECT set_config('test.m135_jwt','{"aal":"aal1","session_id":"13500000-0000-4000-8000-000000000041"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.read_onboarding_services('13500000-0000-4000-8000-000000000020');
  RAISE EXCEPTION 'M135 MFA read bypass';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM IS DISTINCT FROM 'mfa_required' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.save_onboarding_services('13500000-0000-4000-8000-000000000020',1,
    gen_random_uuid(),'[]');
  RAISE EXCEPTION 'M135 MFA write bypass';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM IS DISTINCT FROM 'mfa_required' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
SELECT set_config('test.m135_jwt','{"aal":"aal2","session_id":"13500000-0000-4000-8000-000000000041"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (public.read_onboarding_services('13500000-0000-4000-8000-000000000020')->>'revision')::bigint<>1
 THEN RAISE EXCEPTION 'M135 valid AAL2 owner denied'; END IF;
 IF (public.save_onboarding_services('13500000-0000-4000-8000-000000000020',1,
   '13500000-0000-4000-8000-000000000504','[]')->>'revision')::bigint<>2
 THEN RAISE EXCEPTION 'M135 administrative clinic Step 4 to 6 denied'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT onboarding_step_max FROM public.organization
     WHERE id='13500000-0000-4000-8000-000000000020')<6
 OR EXISTS(SELECT 1 FROM public.disponibilidad_profesional
     WHERE organization_id='13500000-0000-4000-8000-000000000020')
 THEN RAISE EXCEPTION 'M135 administrative clinic required fake availability'; END IF;
END $$;
DO $$ BEGIN
 IF has_function_privilege('anon','public.save_onboarding_services(uuid,bigint,uuid,jsonb)','EXECUTE')
 OR has_function_privilege('service_role','public.save_onboarding_services(uuid,bigint,uuid,jsonb)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.save_onboarding_services(uuid,bigint,uuid,jsonb)','EXECUTE')
 OR has_table_privilege('authenticated','folio_onboarding_services_private.receipt','SELECT')
 THEN RAISE EXCEPTION 'M135 RPC or receipt grants incorrect'; END IF;
END $$;
ROLLBACK;
