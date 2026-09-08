BEGIN;
-- Vanilla local bootstrap lacks Supabase's auth schema usage for invoker auth.uid().
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
GRANT SELECT ON public.organization,public.member,public.paciente,public.paciente_identidad,public.turno,public.paciente_directorio_lite TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.directory_uid',true),'')::uuid$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('test.directory_jwt',true),''),'{}')::jsonb$$;
CREATE FUNCTION pg_temp.directory_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT ('11400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
INSERT INTO auth.users(id,email,email_confirmed_at) SELECT pg_temp.directory_id(n),'directory-'||n||'@synthetic.invalid',now() FROM generate_series(1,4)n;
INSERT INTO public.profile(id,email,consent_pii_signed_at,consent_pii_text_version) SELECT pg_temp.directory_id(n),'directory-'||n||'@synthetic.invalid',now(),'synthetic' FROM generate_series(1,4)n;
INSERT INTO public.organization(id,slug,nombre,is_synthetic) VALUES(pg_temp.directory_id(100),'directory-independent','Synthetic',true),(pg_temp.directory_id(200),'directory-other','Synthetic other',true);
INSERT INTO public.member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES
 (pg_temp.directory_id(11),pg_temp.directory_id(100),pg_temp.directory_id(1),'OWNER',true,now()),
 (pg_temp.directory_id(12),pg_temp.directory_id(100),pg_temp.directory_id(2),'PROFESIONAL',true,now()),
 (pg_temp.directory_id(13),pg_temp.directory_id(100),pg_temp.directory_id(3),'ASISTENTE',false,now()),
 (pg_temp.directory_id(14),pg_temp.directory_id(200),pg_temp.directory_id(4),'OWNER',true,now());
INSERT INTO public.paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,nombre_hash,telefono_hash,cobertura_nombre)
 SELECT pg_temp.directory_id(2000+n),pg_temp.directory_id(100),'\x01','\x02','\x03',repeat(n::text,64),repeat(CASE WHEN n<=2 THEN 'a' ELSE 'b' END,64),CASE WHEN n<=2 THEN 'FAMILY' ELSE NULL END FROM generate_series(1,6)n;
INSERT INTO public.paciente(id,organization_id,identidad_id,profesional_principal_id,caja_fuerte_profesional,tags,created_at)
 SELECT pg_temp.directory_id(1000+n),pg_temp.directory_id(100),pg_temp.directory_id(2000+n),pg_temp.directory_id(CASE WHEN n<=4 THEN 12 ELSE 11 END),CASE WHEN n=4 THEN pg_temp.directory_id(12) END,
 CASE WHEN n=3 THEN ARRAY['ALTA'] WHEN n=5 THEN ARRAY['PAUSA'] ELSE '{}'::text[] END,
 '2026-01-01T00:00:00.123455Z'::timestamptz + (CASE WHEN n<=2 THEN 0 WHEN n<=5 THEN 1 ELSE 2 END)*interval '1 microsecond' FROM generate_series(1,6)n;
SELECT set_config('test.directory_uid',pg_temp.directory_id(1)::text,true);
SELECT set_config('test.directory_jwt','{"aal":"aal1"}',true);
SET LOCAL ROLE authenticated;
DO $$DECLARE first_page jsonb;page jsonb; ids uuid[]:='{}'; cursor jsonb;cutoff timestamptz;revision text; n integer:=0;BEGIN
 first_page:=public.pacientes_directory_page(pg_temp.directory_id(100),p_limit=>2);
 IF first_page->>'total'<>'5' OR first_page->'counts'->>'todos'<>'5' OR first_page->'counts'->>'alta'<>'1' OR first_page->'counts'->>'activos'<>'3' THEN RAISE EXCEPTION 'M114 global counts or owner vault scope changed';END IF;
 cutoff:=(first_page->>'cutoff')::timestamptz;revision:=first_page->>'revision';page:=first_page;
 LOOP
  ids:=ids||ARRAY(SELECT (r->>'paciente_id')::uuid FROM jsonb_array_elements(page->'rows') r);n:=n+1;
  IF page->>'revision'<>revision THEN RAISE EXCEPTION 'M114 revision changes without mutation';END IF;
  cursor:=page->'next_cursor';EXIT WHEN cursor='null'::jsonb;
  IF n>5 THEN RAISE EXCEPTION 'M114 cursor loop';END IF;
  page:=public.pacientes_directory_page(pg_temp.directory_id(100),p_limit=>2,p_before_created=>(cursor->>'createdAt')::timestamptz,p_before_id=>(cursor->>'id')::uuid,p_cutoff=>cutoff);
 END LOOP;
 IF array_length(ids,1)<>5 OR (SELECT count(DISTINCT x) FROM unnest(ids)x)<>5 OR pg_temp.directory_id(1004)=ANY(ids) THEN RAISE EXCEPTION 'M114 tied cursor lost/duplicated/out-of-scope patient';END IF;
 page:=public.pacientes_directory_page(pg_temp.directory_id(100),p_phone_hashes=>ARRAY[repeat('a',64)],p_search=>true,p_limit=>1);
 IF page->>'total'<>'2' OR jsonb_array_length(page->'rows')<>1 OR page->'counts'->>'todos'<>'5' THEN RAISE EXCEPTION 'M114 family merged or search only page-local';END IF;
 page:=public.pacientes_directory_page(pg_temp.directory_id(100),p_status=>'alta',p_coverage=>'todas');
 IF page->>'total'<>'1' OR page->'rows'->0->>'paciente_id'<>pg_temp.directory_id(1003)::text OR page->'coberturas'<>'["FAMILY"]'::jsonb THEN RAISE EXCEPTION 'M114 filter/global coverage incomplete';END IF;
 BEGIN PERFORM public.pacientes_directory_page(pg_temp.directory_id(200));RAISE EXCEPTION 'M114 foreign org';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.pacientes_directory_page(pg_temp.directory_id(100),p_before_id=>pg_temp.directory_id(1001));RAISE EXCEPTION 'M114 half cursor';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.pacientes_directory_page(pg_temp.directory_id(100),p_limit=>101);RAISE EXCEPTION 'M114 unbounded page';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 PERFORM set_config('test.directory_revision',first_page->>'revision',true);
 PERFORM set_config('test.directory_cutoff',first_page->>'cutoff',true);
END $$;
RESET ROLE;
UPDATE public.paciente_identidad SET cobertura_nombre='CHANGED' WHERE id=pg_temp.directory_id(2001);
SET LOCAL ROLE authenticated;
DO $$BEGIN IF public.pacientes_directory_page(pg_temp.directory_id(100),p_cutoff=>current_setting('test.directory_cutoff')::timestamptz)->>'revision'=current_setting('test.directory_revision') THEN RAISE EXCEPTION 'M114 identity change invisible';END IF;END$$;
SELECT set_config('test.directory_uid',pg_temp.directory_id(2)::text,true);
DO $$DECLARE page jsonb;BEGIN page:=public.pacientes_directory_page(pg_temp.directory_id(100));IF page->>'total'<>'4' THEN RAISE EXCEPTION 'M114 professional assignment/vault scope changed';END IF;END$$;
SELECT set_config('test.directory_uid',pg_temp.directory_id(3)::text,true);
DO $$BEGIN IF public.pacientes_directory_page(pg_temp.directory_id(100))->>'total'<>'0' THEN RAISE EXCEPTION 'M114 widened receptionist patient RLS';END IF;END$$;
RESET ROLE;
UPDATE public.member SET deleted_at=now() WHERE id=pg_temp.directory_id(13);
SET LOCAL ROLE authenticated;
DO $$BEGIN BEGIN PERFORM public.pacientes_directory_page(pg_temp.directory_id(100));RAISE EXCEPTION 'M114 revoked membership';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END$$;
RESET ROLE;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now()-interval '1 minute';
SELECT set_config('test.directory_uid',pg_temp.directory_id(1)::text,true);
SET LOCAL ROLE authenticated;
DO $$BEGIN BEGIN PERFORM public.pacientes_directory_page(pg_temp.directory_id(100));RAISE EXCEPTION 'M114 AAL1 during enforcement';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END$$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$BEGIN BEGIN PERFORM public.pacientes_directory_page(pg_temp.directory_id(100));RAISE EXCEPTION 'M114 anonymous execution';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END$$;
RESET ROLE;
ROLLBACK;
