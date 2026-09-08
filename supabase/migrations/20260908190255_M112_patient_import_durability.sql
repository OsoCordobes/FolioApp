-- M112: additive, private import receipts; no CSV storage or external effects.
BEGIN;
CREATE SCHEMA folio_import_private;
REVOKE ALL ON SCHEMA folio_import_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE folio_import_private.run (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES public.organization(id),
 created_by uuid NOT NULL REFERENCES public.member(id),professional_id uuid REFERENCES public.member(id),content_hash text NOT NULL CHECK(content_hash~'^[a-f0-9]{64}$'),
 total_rows integer NOT NULL CHECK(total_rows BETWEEN 1 AND 500),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,content_hash),UNIQUE(id,organization_id)
);
CREATE TABLE folio_import_private.row_result (
 run_id uuid NOT NULL,organization_id uuid NOT NULL,row_number integer NOT NULL CHECK(row_number BETWEEN 2 AND 501),
 row_hash text NOT NULL CHECK(row_hash~'^[a-f0-9]{64}$'),
 status text NOT NULL CHECK(status IN('imported','review_dni','review_file','review_previous','invalid','failed')),
 code text NOT NULL CHECK(code IN('created','existing_dni','duplicate_in_file','previous_import','invalid_row','row_failed')),
 paciente_id uuid REFERENCES public.paciente(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(run_id,row_number),FOREIGN KEY(run_id,organization_id) REFERENCES folio_import_private.run(id,organization_id),
 CHECK((status='imported')=(paciente_id IS NOT NULL))
);
ALTER TABLE folio_import_private.run ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_import_private.row_result ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA folio_import_private FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX import_previous_row ON folio_import_private.row_result(organization_id,row_hash) WHERE status='imported';
CREATE FUNCTION folio_import_private.assert_access(p_org uuid) RETURNS public.member
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member;BEGIN
 PERFORM folio_mfa_private.assert_access();
 PERFORM 1 FROM public.organization WHERE id=p_org AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current organization required';END IF;
 SELECT * INTO actor FROM public.member WHERE organization_id=p_org AND profile_id=auth.uid() AND deleted_at IS NULL
  AND role IN('OWNER','DIRECTOR','PROFESIONAL') AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current patient creation capability required';END IF;
 RETURN actor;
END $$;
CREATE FUNCTION public.begin_patient_import(p_org uuid,p_operation uuid,p_hash text,p_total integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member;r folio_import_private.run;BEGIN
 PERFORM folio_mfa_private.assert_access();
 actor:=folio_import_private.assert_access(p_org);
 IF p_operation IS NULL OR coalesce(p_hash,'')!~'^[a-f0-9]{64}$' OR p_total IS NULL OR p_total NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Valid normalized import manifest required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('patient-import:'||p_org::text||':'||p_hash,0));
 SELECT * INTO r FROM folio_import_private.run WHERE organization_id=p_org AND content_hash=p_hash;
 IF FOUND THEN
  IF r.created_by<>actor.id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Original import author required';END IF;
  IF r.total_rows<>p_total THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Import manifest changed';END IF;
  RETURN r.id;
 END IF;
 INSERT INTO folio_import_private.run(id,organization_id,created_by,professional_id,content_hash,total_rows) VALUES(p_operation,p_org,actor.id,CASE WHEN actor.es_colegiado THEN actor.id ELSE NULL END,p_hash,p_total);
 RETURN p_operation;
END $$;
CREATE FUNCTION public.patient_import_status(p_org uuid,p_run uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r folio_import_private.run;actor public.member;BEGIN
 PERFORM folio_mfa_private.assert_access();
 actor:=folio_import_private.assert_access(p_org);
 SELECT * INTO r FROM folio_import_private.run WHERE id=p_run AND organization_id=p_org;
 IF NOT FOUND OR r.created_by<>actor.id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Scoped import author required';END IF;
 RETURN jsonb_build_object('id',r.id,'total',r.total_rows,'rows',coalesce((
  SELECT jsonb_agg(jsonb_build_object('fila',row_number,'status',status,'code',code) ORDER BY row_number)
  FROM folio_import_private.row_result WHERE run_id=r.id AND organization_id=p_org),'[]'::jsonb));
END $$;
CREATE FUNCTION public.import_patient_row(p_org uuid,p_run uuid,p_row integer,p_hash text,p_data jsonb,p_disposition text,p_dni_variants text[] DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member;r folio_import_private.run;receipt folio_import_private.row_result;
 identity_id uuid;patient_id uuid;out_status text;out_code text;constraint_name text;
BEGIN
 PERFORM folio_mfa_private.assert_access();
 actor:=folio_import_private.assert_access(p_org);
 SELECT * INTO r FROM folio_import_private.run WHERE id=p_run AND organization_id=p_org FOR SHARE;
 IF NOT FOUND OR r.created_by<>actor.id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Scoped import author required';END IF;
 IF p_row IS NULL OR p_row<2 OR p_row>r.total_rows+1 OR coalesce(p_hash,'')!~'^[a-f0-9]{64}$' OR p_disposition IS NULL OR p_disposition NOT IN('import','invalid','duplicate_file') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Valid import row required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('patient-import-row:'||p_run::text||':'||p_row::text,0));
 SELECT * INTO receipt FROM folio_import_private.row_result WHERE run_id=p_run AND row_number=p_row;
 IF FOUND THEN
  IF receipt.row_hash<>p_hash THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Import row changed';END IF;
  RETURN jsonb_build_object('fila',receipt.row_number,'status',receipt.status,'code',receipt.code);
 END IF;
 IF r.professional_id IS DISTINCT FROM (CASE WHEN actor.es_colegiado THEN actor.id ELSE NULL END) THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Import professional context changed';END IF;
 IF p_disposition='invalid' THEN out_status:='invalid';out_code:='invalid_row';
 ELSIF p_disposition='duplicate_file' THEN out_status:='review_file';out_code:='duplicate_in_file';
 ELSE
  -- Same data in a different run requires human review; never adopts a patient.
  -- A shared contact alone is absent from this comparison.
  PERFORM pg_advisory_xact_lock(hashtextextended('patient-import-content:'||p_org::text||':'||p_hash,0));
  IF EXISTS(SELECT 1 FROM folio_import_private.row_result WHERE organization_id=p_org AND row_hash=p_hash AND status='imported') THEN
   out_status:='review_previous';out_code:='previous_import';
  ELSE
   IF coalesce(p_data->>'dni_hash','')<>'' THEN PERFORM pg_advisory_xact_lock(hashtextextended('patient-import-dni:'||p_org::text||':'||(p_data->>'dni_hash'),0));END IF;
   IF EXISTS(SELECT 1 FROM public.paciente_identidad WHERE organization_id=p_org AND deleted_at IS NULL AND dni_hash=ANY(coalesce(p_dni_variants,'{}'::text[])||ARRAY[p_data->>'dni_hash'])) THEN
    out_status:='review_dni';out_code:='existing_dni';
   ELSE
    BEGIN
     IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR octet_length(p_data::text)>16384
      OR p_data->>'nombre_cifrado' IS NULL OR p_data->>'apellido_cifrado' IS NULL OR p_data->>'telefono_cifrado' IS NULL
      OR ((p_data->>'fecha_nacimiento')::date>current_date) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Validated patient row required';END IF;
     INSERT INTO public.paciente_identidad(organization_id,nombre_cifrado,apellido_cifrado,tipo_doc,numero_doc_cifrado,email_cifrado,telefono_cifrado,fecha_nacimiento,cobertura_nombre,cobertura_nro_afiliado_cifrado,nombre_hash,dni_hash,telefono_hash)
     VALUES(p_org,(p_data->>'nombre_cifrado')::bytea,(p_data->>'apellido_cifrado')::bytea,'DNI',(p_data->>'numero_doc_cifrado')::bytea,(p_data->>'email_cifrado')::bytea,(p_data->>'telefono_cifrado')::bytea,(p_data->>'fecha_nacimiento')::date,p_data->>'cobertura_nombre',(p_data->>'cobertura_nro_afiliado_cifrado')::bytea,p_data->>'nombre_hash',p_data->>'dni_hash',p_data->>'telefono_hash') RETURNING id INTO identity_id;
     INSERT INTO public.paciente(organization_id,identidad_id,profesional_principal_id)
     VALUES(p_org,identity_id,r.professional_id) RETURNING id INTO patient_id;
     out_status:='imported';out_code:='created';
    EXCEPTION
     WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
      IF constraint_name='paciente_identidad_dni_unique_active' THEN out_status:='review_dni';out_code:='existing_dni';
      ELSE out_status:='failed';out_code:='row_failed';END IF;
     WHEN check_violation OR not_null_violation OR foreign_key_violation OR invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
      out_status:='failed';out_code:='row_failed';
    END;
   END IF;
  END IF;
 END IF;
 INSERT INTO folio_import_private.row_result(run_id,organization_id,row_number,row_hash,status,code,paciente_id)
 VALUES(p_run,p_org,p_row,p_hash,out_status,out_code,CASE WHEN out_status='imported' THEN patient_id ELSE NULL END);
 RETURN jsonb_build_object('fila',p_row,'status',out_status,'code',out_code);
END $$;
REVOKE ALL ON FUNCTION folio_import_private.assert_access(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.begin_patient_import(uuid,uuid,text,integer),public.patient_import_status(uuid,uuid),public.import_patient_row(uuid,uuid,integer,text,jsonb,text,text[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.begin_patient_import(uuid,uuid,text,integer),public.patient_import_status(uuid,uuid),public.import_patient_row(uuid,uuid,integer,text,jsonb,text,text[]) TO authenticated;
COMMIT;
