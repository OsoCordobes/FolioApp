BEGIN;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON organization,member,paciente,paciente_identidad,turno,paciente_directorio_lite TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.m114_uid',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"aal":"aal1"}'::jsonb $$;
CREATE FUNCTION pg_temp.volume_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT ('11410000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(pg_temp.volume_id(1),'directory-volume@synthetic.invalid',now());
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES(pg_temp.volume_id(1),'directory-volume@synthetic.invalid',now(),'synthetic');
INSERT INTO organization(id,slug,nombre,is_synthetic) VALUES(pg_temp.volume_id(2),'directory-volume','Synthetic volume',true);
INSERT INTO member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES(pg_temp.volume_id(3),pg_temp.volume_id(2),pg_temp.volume_id(1),'OWNER',true,now());
INSERT INTO paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,nombre_hash,telefono_hash,cobertura_nombre)
 SELECT pg_temp.volume_id(2000+n),pg_temp.volume_id(2),'\x01','\x02','\x03',CASE WHEN n=1 THEN repeat('a',64) ELSE md5(n::text)||md5(n::text) END,
 CASE WHEN n<=2 THEN repeat('b',64) ELSE NULL END,CASE WHEN n<=2 THEN 'LAST PAGE COVERAGE' ELSE NULL END FROM generate_series(1,1205)n;
INSERT INTO paciente(id,organization_id,identidad_id,profesional_principal_id,tags,created_at)
 SELECT pg_temp.volume_id(4000+n),pg_temp.volume_id(2),pg_temp.volume_id(2000+n),pg_temp.volume_id(3),CASE WHEN n<=2 THEN ARRAY['ALTA'] ELSE '{}'::text[] END,
 '2026-01-01T00:00:00.123456Z'::timestamptz FROM generate_series(1,1205)n;
ANALYZE paciente,paciente_identidad,member,organization;
SELECT set_config('test.m114_uid',pg_temp.volume_id(1)::text,true);
SET LOCAL ROLE authenticated;
DO $$DECLARE r jsonb; c jsonb; cutoff timestamptz; ids uuid[]:='{}'; revision text; pages int:=0;BEGIN
 r:=pacientes_directory_page(pg_temp.volume_id(2)); cutoff:=(r->>'cutoff')::timestamptz;revision:=r->>'revision';
 IF r->>'total'<>'1205' OR jsonb_array_length(r->'rows')<>50 OR r->'counts'->>'alta'<>'2' THEN RAISE EXCEPTION 'M114 volume truncated';END IF;
 LOOP
  pages:=pages+1;
  IF pages>25 OR r->>'revision'<>revision THEN RAISE EXCEPTION 'M114 unstable traversal';END IF;
  ids:=ids||ARRAY(SELECT (x->>'paciente_id')::uuid FROM jsonb_array_elements(r->'rows')x);
  c:=r->'next_cursor';EXIT WHEN c='null'::jsonb;
  r:=pacientes_directory_page(pg_temp.volume_id(2),p_before_created=>(c->>'createdAt')::timestamptz,p_before_id=>(c->>'id')::uuid,p_cutoff=>cutoff);
 END LOOP;
 IF cardinality(ids)<>1205 OR (SELECT count(DISTINCT x) FROM unnest(ids)x)<>1205 OR ids[1205]<>pg_temp.volume_id(4001) THEN RAISE EXCEPTION 'M114 missing/duplicate tied row beyond 1000';END IF;
 r:=pacientes_directory_page(pg_temp.volume_id(2),p_hashes=>ARRAY[repeat('a',64)],p_search=>true);
 IF r->>'total'<>'1' OR r->'rows'->0->>'paciente_id'<>pg_temp.volume_id(4001)::text THEN RAISE EXCEPTION 'M114 exact search cannot reach last page';END IF;
 r:=pacientes_directory_page(pg_temp.volume_id(2),p_phone_hashes=>ARRAY[repeat('b',64)],p_search=>true,p_coverage=>'LAST PAGE COVERAGE',p_status=>'alta');
 IF r->>'total'<>'2' OR r->'counts'->>'todos'<>'1205' THEN RAISE EXCEPTION 'M114 family/filter/global count mismatch';END IF;
 PERFORM set_config('test.m114_revision',revision,true);
 PERFORM set_config('test.m114_cutoff',cutoff::text,true);
END$$;
RESET ROLE;
-- Same number of rows but a changed classification must invalidate export.
UPDATE paciente SET tags=ARRAY['PAUSA'] WHERE id=pg_temp.volume_id(4001);
SET LOCAL ROLE authenticated;
DO $$DECLARE r jsonb;BEGIN r:=pacientes_directory_page(pg_temp.volume_id(2),p_cutoff=>current_setting('test.m114_cutoff')::timestamptz);
 IF r->>'revision'=current_setting('test.m114_revision') OR r->>'total'<>'1205' THEN RAISE EXCEPTION 'M114 same-count mutation invisible';END IF;END$$;
RESET ROLE;
ROLLBACK;
