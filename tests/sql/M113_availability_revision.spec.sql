BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.availability_uid',true),'')::uuid $$;
INSERT INTO auth.users(id,email) VALUES('11300000-0000-4000-8000-000000000001','availability@synthetic.invalid');
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES('11300000-0000-4000-8000-000000000001','availability@synthetic.invalid',now(),'synthetic');
INSERT INTO public.organization(id,slug,nombre,is_synthetic) VALUES('11300000-0000-4000-8000-000000000010','m113-synthetic','Synthetic',true);
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES('11300000-0000-4000-8000-000000000011','11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000001','OWNER',true,now());
SELECT set_config('test.availability_uid','11300000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE org uuid:='11300000-0000-4000-8000-000000000010';member_id uuid:='11300000-0000-4000-8000-000000000011';snapshot jsonb;r jsonb;r2 jsonb;BEGIN
 snapshot:=public.read_availability_snapshot(org,member_id);
 r:=public.save_availability_revision(org,member_id,(snapshot->>'revision')::bigint,'11300000-0000-4000-8000-000000000020',repeat('a',64),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"12:00"}]');
 r2:=public.save_availability_revision(org,member_id,(snapshot->>'revision')::bigint,'11300000-0000-4000-8000-000000000020',repeat('a',64),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"12:00"}]');
 IF r IS DISTINCT FROM r2 THEN RAISE EXCEPTION 'M113 response replay changed';END IF;
 BEGIN PERFORM public.save_availability_revision(org,member_id,(snapshot->>'revision')::bigint,gen_random_uuid(),repeat('b',64),'[]');RAISE EXCEPTION 'M113 stale week overwrote';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM public.save_availability_revision(org,member_id,(snapshot->>'revision')::bigint,'11300000-0000-4000-8000-000000000020',repeat('a',64),'[]');RAISE EXCEPTION 'M113 receipt accepted different payload with same client hash';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM public.save_availability_revision(org,member_id,(r->>'revision')::bigint,'11300000-0000-4000-8000-000000000020',repeat('a',64),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"12:00"}]');RAISE EXCEPTION 'M113 receipt accepted different baseline';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM public.save_availability_revision(org,member_id,(r->>'revision')::bigint,gen_random_uuid(),repeat('b',64),'[{"dia_semana":1,"hora_inicio":"12:00","hora_fin":"09:00"}]');RAISE EXCEPTION 'M113 inverted interval saved';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN PERFORM public.save_availability_revision(org,member_id,(r->>'revision')::bigint,gen_random_uuid(),repeat('b',64),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"12:00"},{"dia_semana":1,"hora_inicio":"11:00","hora_fin":"13:00"}]');RAISE EXCEPTION 'M113 overlap saved';EXCEPTION WHEN check_violation THEN NULL;END;
 -- Alternate JSON encodings of the same weekday must not bypass overlap checks.
 BEGIN PERFORM public.save_availability_revision(org,member_id,(r->>'revision')::bigint,gen_random_uuid(),repeat('b',64),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"12:00"},{"dia_semana":"01","hora_inicio":"11:00","hora_fin":"13:00"}]');RAISE EXCEPTION 'M113 alternate weekday encoding overlap saved';EXCEPTION WHEN check_violation THEN NULL;END;
 -- The additive phase leaves the old UI callable; its changes invalidate new editors.
 PERFORM public.reemplazar_disponibilidad(org,member_id,'[{"dia_semana":2,"hora_inicio":"10:00","hora_fin":"14:00"}]');
 snapshot:=public.read_availability_snapshot(org,member_id);
 IF (snapshot->>'revision')::bigint<=(r->>'revision')::bigint THEN RAISE EXCEPTION 'M113 legacy update invisible';END IF;
 BEGIN PERFORM public.read_availability_snapshot(org,'11300000-0000-4000-8000-000000000099');RAISE EXCEPTION 'M113 foreign member accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
CREATE FUNCTION pg_temp.availability_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='11300000-0000-4000-8000-000000000010' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='synthetic failure after delete';END IF;RETURN NEW;END $$;
CREATE TRIGGER m113_failure BEFORE INSERT ON public.disponibilidad_profesional FOR EACH ROW EXECUTE FUNCTION pg_temp.availability_failure();
SET LOCAL ROLE authenticated;
DO $$ DECLARE snapshot jsonb;BEGIN
 snapshot:=public.read_availability_snapshot('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011');
 BEGIN PERFORM public.save_availability_revision('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011',(snapshot->>'revision')::bigint,gen_random_uuid(),repeat('c',64),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"12:00"}]');RAISE EXCEPTION 'M113 injected failure committed';EXCEPTION WHEN check_violation THEN NULL;END;
 IF public.read_availability_snapshot('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011') IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'M113 rollback lost schedule or revision';END IF;
END $$;
RESET ROLE;
DROP TRIGGER m113_failure ON public.disponibilidad_profesional;
INSERT INTO public.disponibilidad_profesional(organization_id,member_id,dia_semana,hora_inicio,hora_fin,vigencia_desde)
 VALUES('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011',3,'15:00','17:00',current_date+30);
SET LOCAL ROLE authenticated;
DO $$ DECLARE snapshot jsonb;BEGIN
 snapshot:=public.read_availability_snapshot('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011');
 IF NOT(snapshot->>'protectedDates')::boolean THEN RAISE EXCEPTION 'M113 future schedule not protected';END IF;
 BEGIN PERFORM public.save_availability_revision('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011',(snapshot->>'revision')::bigint,gen_random_uuid(),repeat('d',64),'[]');RAISE EXCEPTION 'M113 future schedule deleted';EXCEPTION WHEN check_violation THEN NULL;END;
END $$;
RESET ROLE;
DELETE FROM public.disponibilidad_profesional WHERE organization_id='11300000-0000-4000-8000-000000000010' AND vigencia_desde>current_date;
SELECT public.enable_availability_revision('Synthetic authenticated smoke completed');
SET LOCAL ROLE authenticated;
DO $$ DECLARE snapshot jsonb;BEGIN
 BEGIN PERFORM public.reemplazar_disponibilidad('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011','[]');RAISE EXCEPTION 'M113 legacy bypass after activation';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 snapshot:=public.read_availability_snapshot('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011');
 PERFORM public.save_availability_revision('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011',(snapshot->>'revision')::bigint,gen_random_uuid(),repeat('e',64),'[]');
END $$;
RESET ROLE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM folio_availability_private.authority) THEN RAISE EXCEPTION 'M113 authority leaked';END IF;END $$;
-- Initial setup must be the same transaction, authorized for the current OWNER/state.
UPDATE public.organization SET onboarding_completed=false,onboarding_step_max=4 WHERE id='11300000-0000-4000-8000-000000000010';
INSERT INTO public.disponibilidad_profesional(organization_id,member_id,dia_semana,hora_inicio,hora_fin,activa,vigencia_desde,vigencia_hasta) VALUES
 ('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011',6,'08:00','09:00',false,current_date-60,NULL),
 ('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011',0,'08:00','09:00',true,current_date-60,current_date-30);
CREATE TRIGGER m113_failure BEFORE INSERT ON public.disponibilidad_profesional FOR EACH ROW EXECUTE FUNCTION pg_temp.availability_failure();
SET LOCAL ROLE authenticated;
DO $$ DECLARE snapshot jsonb;BEGIN
 snapshot:=public.read_onboarding_availability('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011');
 BEGIN PERFORM public.save_onboarding_availability('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011',(snapshot->>'revision')::bigint,gen_random_uuid(),repeat('f',64),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"12:00"}]');RAISE EXCEPTION 'M113 initializer partial commit';EXCEPTION WHEN check_violation THEN NULL;END;
 IF public.read_onboarding_availability('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011') IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'M113 initializer lost previous week';END IF;
END $$;
RESET ROLE;
DO $$ BEGIN IF (SELECT onboarding_step_max FROM public.organization WHERE id='11300000-0000-4000-8000-000000000010')<>4 THEN RAISE EXCEPTION 'M113 failed initializer advanced setup';END IF;END $$;
DROP TRIGGER m113_failure ON public.disponibilidad_profesional;
SET LOCAL ROLE authenticated;
DO $$ DECLARE snapshot jsonb;r jsonb;BEGIN
 snapshot:=public.read_onboarding_availability('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011');
 r:=public.save_onboarding_availability('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011',(snapshot->>'revision')::bigint,'11300000-0000-4000-8000-000000000030',repeat('f',64),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"12:00"}]');
 IF r IS DISTINCT FROM public.save_onboarding_availability('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011',(snapshot->>'revision')::bigint,'11300000-0000-4000-8000-000000000030',repeat('f',64),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"12:00"}]') THEN RAISE EXCEPTION 'M113 initializer changed receipt';END IF;
 BEGIN PERFORM public.save_onboarding_availability('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011',(snapshot->>'revision')::bigint,'11300000-0000-4000-8000-000000000030',repeat('f',64),'[{"dia_semana":1,"hora_inicio":"10:00","hora_fin":"12:00"}]');RAISE EXCEPTION 'M113 same UUID changed payload accepted';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN DELETE FROM public.disponibilidad_profesional WHERE organization_id='11300000-0000-4000-8000-000000000010';RAISE EXCEPTION 'M113 direct authenticated delete allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT onboarding_step_max FROM public.organization WHERE id='11300000-0000-4000-8000-000000000010')<>5 THEN RAISE EXCEPTION 'M113 initializer failed to advance setup';END IF;
 IF (SELECT count(*) FROM public.disponibilidad_profesional WHERE organization_id='11300000-0000-4000-8000-000000000010')<>3 THEN RAISE EXCEPTION 'M113 inactive/history rows removed';END IF;
END $$;
UPDATE public.organization SET onboarding_completed=true WHERE id='11300000-0000-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.read_onboarding_availability('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011');RAISE EXCEPTION 'M113 completed initializer readable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.save_onboarding_availability('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011',0,gen_random_uuid(),repeat('f',64),'[]');RAISE EXCEPTION 'M113 completed initializer writable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
UPDATE public.organization SET onboarding_completed=false,onboarding_step_max=3 WHERE id='11300000-0000-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.save_onboarding_availability('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011',0,gen_random_uuid(),repeat('f',64),'[]');RAISE EXCEPTION 'M113 skipped prior setup step';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
UPDATE public.organization SET onboarding_step_max=4 WHERE id='11300000-0000-4000-8000-000000000010';
UPDATE public.member SET role='PROFESIONAL' WHERE id='11300000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.read_onboarding_availability('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011');RAISE EXCEPTION 'M113 non-owner initializer';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
UPDATE public.member SET role='OWNER',deleted_at=now() WHERE id='11300000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.read_availability_snapshot('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011');RAISE EXCEPTION 'M113 revoked member reads';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.save_availability_revision('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011',0,'11300000-0000-4000-8000-000000000020',repeat('a',64),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"12:00"}]');RAISE EXCEPTION 'M113 revoked actor replayed receipt';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
UPDATE public.member SET deleted_at=NULL WHERE id='11300000-0000-4000-8000-000000000011';
INSERT INTO auth.users(id,email) VALUES('11300000-0000-4000-8000-000000000002','availability-other@synthetic.invalid');
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES('11300000-0000-4000-8000-000000000002','availability-other@synthetic.invalid',now(),'synthetic');
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES('11300000-0000-4000-8000-000000000012','11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000002','DIRECTOR',true,now());
SELECT set_config('test.availability_uid','11300000-0000-4000-8000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM public.read_availability_snapshot('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011');
 BEGIN PERFORM public.save_availability_revision('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011',0,'11300000-0000-4000-8000-000000000020',repeat('a',64),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"12:00"}]');RAISE EXCEPTION 'M113 different authorized actor replayed receipt';EXCEPTION WHEN serialization_failure THEN NULL;END;
END $$;
RESET ROLE;
SELECT set_config('test.availability_uid','11300000-0000-4000-8000-000000000001',true);
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"aal":"aal1"}'::jsonb $$;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.read_availability_snapshot('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011');RAISE EXCEPTION 'M113 MFA bypass';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.save_availability_revision('11300000-0000-4000-8000-000000000010','11300000-0000-4000-8000-000000000011',0,'11300000-0000-4000-8000-000000000020',repeat('a',64),'[{"dia_semana":1,"hora_inicio":"09:00","hora_fin":"12:00"}]');RAISE EXCEPTION 'M113 MFA receipt bypass';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK;
