-- Rollback-only synthetic fixtures; no real Auth service is exercised.
BEGIN;
INSERT INTO organization(id,slug,nombre) VALUES
 ('10500000-0000-4000-8000-000000000001','m105-fixture','M105 synthetic');
INSERT INTO paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado,fecha_nacimiento)
 VALUES('10500000-0000-4000-8000-000000000002','10500000-0000-4000-8000-000000000001','\x01','\x02','\x03',(current_date-interval '12 years')::date);
INSERT INTO paciente(id,organization_id,identidad_id)
 VALUES('10500000-0000-4000-8000-000000000003','10500000-0000-4000-8000-000000000001','10500000-0000-4000-8000-000000000002');
-- Preparation permits old application code; this row becomes original history.
INSERT INTO instrumento_respuesta(id,organization_id,paciente_id,instrumento_id,instrumento_version,respuestas_cifrado,score_total,banda,completado_por)
 VALUES('10500000-0000-4000-8000-000000000004','10500000-0000-4000-8000-000000000001','10500000-0000-4000-8000-000000000003','phq9.v1',1,'\x07',19,'original_warning','profesional');
DO $$ BEGIN
 IF to_regprocedure('public.enable_instrument_population_policy(text)') IS NOT NULL THEN
   PERFORM public.enable_instrument_population_policy('Synthetic deployed UI verification');
 END IF;
END $$;

-- A permissive policy deliberately isolates the trigger from ordinary RLS.
GRANT SELECT,INSERT,UPDATE ON instrumento_respuesta TO authenticated;
GRANT SELECT ON paciente,sesion TO authenticated;
CREATE POLICY m105_fixture_allow ON instrumento_respuesta FOR ALL TO authenticated USING(true) WITH CHECK(true);
CREATE POLICY m105_fixture_read ON paciente FOR SELECT TO authenticated USING(true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  INSERT INTO instrumento_respuesta(organization_id,paciente_id,instrumento_id,instrumento_version,score_total,banda,completado_por,created_at)
   VALUES('10500000-0000-4000-8000-000000000001','10500000-0000-4000-8000-000000000003','phq9.v1',1,0,'sin_riesgo','profesional',now()+interval '30 years');
  RAISE EXCEPTION 'M105 FAIL: pediatric insert was accepted';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM<>'instrument_population_not_eligible' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.enable_instrument_population_policy('Unauthorized synthetic caller');
  RAISE EXCEPTION 'M105 FAIL: authenticated can enable policy';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE folio_instrument_private.population_policy SET enabled_at=null;
  RAISE EXCEPTION 'M105 FAIL: authenticated can disable policy';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

DO $$ DECLARE v_age int; v_id uuid; BEGIN
 FOREACH v_age IN ARRAY ARRAY[12,14,16,17] LOOP
  UPDATE paciente_identidad SET fecha_nacimiento=((statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date-make_interval(years=>v_age))::date
    WHERE id='10500000-0000-4000-8000-000000000002';
  BEGIN
   INSERT INTO instrumento_respuesta(organization_id,paciente_id,instrumento_id,instrumento_version,completado_por)
    VALUES('10500000-0000-4000-8000-000000000001','10500000-0000-4000-8000-000000000003','phq9.v1',1,'profesional');
   RAISE EXCEPTION 'M105 FAIL: protected age accepted';
  EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'instrument_population_not_eligible' THEN RAISE; END IF;
  END;
 END LOOP;
 UPDATE paciente_identidad SET fecha_nacimiento=null WHERE id='10500000-0000-4000-8000-000000000002';
 BEGIN
  INSERT INTO instrumento_respuesta(organization_id,paciente_id,instrumento_id,instrumento_version,completado_por)
   VALUES('10500000-0000-4000-8000-000000000001','10500000-0000-4000-8000-000000000003','phq9.v1',1,'profesional');
  RAISE EXCEPTION 'M105 FAIL: absent DOB accepted';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM<>'instrument_population_not_eligible' THEN RAISE; END IF;
 END;
 -- Unchanged historical answers and warning can be locked, never rewritten.
 UPDATE instrumento_respuesta SET locked_at=now(),score_total=19 WHERE id='10500000-0000-4000-8000-000000000004';
 IF NOT EXISTS(SELECT 1 FROM instrumento_respuesta WHERE id='10500000-0000-4000-8000-000000000004'
   AND respuestas_cifrado='\x07' AND banda='original_warning' AND population_policy_version IS NULL) THEN
  RAISE EXCEPTION 'M105 FAIL: historical data was rewritten';
 END IF;
 BEGIN
  UPDATE instrumento_respuesta SET score_total=0,banda='sin_riesgo' WHERE id='10500000-0000-4000-8000-000000000004';
  RAISE EXCEPTION 'M105 FAIL: historical classification rewritten';
 EXCEPTION WHEN check_violation THEN NULL;
 WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Instrumento bloqueado%' THEN RAISE; END IF;
 END;
 UPDATE paciente_identidad SET fecha_nacimiento=((statement_timestamp() AT TIME ZONE 'America/Argentina/Cordoba')::date-interval '18 years')::date
   WHERE id='10500000-0000-4000-8000-000000000002';
 INSERT INTO instrumento_respuesta(organization_id,paciente_id,instrumento_id,instrumento_version,completado_por)
  VALUES('10500000-0000-4000-8000-000000000001','10500000-0000-4000-8000-000000000003','phq9.v1',1,'profesional') RETURNING id INTO v_id;
 IF (SELECT population_policy_version FROM instrumento_respuesta WHERE id=v_id)<>'adult-only-pending-validation.v1' THEN
  RAISE EXCEPTION 'M105 FAIL: missing policy provenance';
 END IF;
 UPDATE paciente_identidad SET fecha_nacimiento=current_date+1 WHERE id='10500000-0000-4000-8000-000000000002';
 BEGIN
  UPDATE instrumento_respuesta SET score_total=1 WHERE id=v_id;
  RAISE EXCEPTION 'M105 FAIL: future DOB accepted';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM<>'instrument_population_not_eligible' THEN RAISE; END IF;
 END;
END $$;
-- A present-day adult must not receive a fresh classification for an encounter
-- that took place before their eighteenth birthday in Cordoba.
INSERT INTO auth.users(id,email) VALUES('10500000-0000-4000-8000-000000000010','m105-synthetic@spec.invalid');
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version)
 VALUES('10500000-0000-4000-8000-000000000010','m105-synthetic@spec.invalid',now(),'v1');
INSERT INTO member(id,organization_id,profile_id,role,accepted_at)
 VALUES('10500000-0000-4000-8000-000000000011','10500000-0000-4000-8000-000000000001','10500000-0000-4000-8000-000000000010','OWNER',now());
INSERT INTO servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
 VALUES('10500000-0000-4000-8000-000000000012','10500000-0000-4000-8000-000000000001','Synthetic',enum_first(null::tipo_servicio_canonico),30,100);
INSERT INTO turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents)
 VALUES('10500000-0000-4000-8000-000000000013','10500000-0000-4000-8000-000000000001','10500000-0000-4000-8000-000000000003',
 '10500000-0000-4000-8000-000000000012','10500000-0000-4000-8000-000000000011','2018-09-09T02:59:00Z',30,100);
INSERT INTO sesion(id,organization_id,paciente_id,turno_id)
 VALUES('10500000-0000-4000-8000-000000000014','10500000-0000-4000-8000-000000000001','10500000-0000-4000-8000-000000000003','10500000-0000-4000-8000-000000000013');
UPDATE paciente_identidad SET fecha_nacimiento='2000-09-09' WHERE id='10500000-0000-4000-8000-000000000002';
DO $$ BEGIN
 BEGIN
  INSERT INTO instrumento_respuesta(organization_id,paciente_id,sesion_id,instrumento_id,instrumento_version,completado_por)
   VALUES('10500000-0000-4000-8000-000000000001','10500000-0000-4000-8000-000000000003','10500000-0000-4000-8000-000000000014','phq9.v1',1,'profesional');
  RAISE EXCEPTION 'M105 FAIL: historical pediatric encounter classified';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM<>'instrument_population_not_eligible' THEN RAISE; END IF;
 END;
END $$;
UPDATE turno SET inicio='2018-09-09T03:00:00Z' WHERE id='10500000-0000-4000-8000-000000000013';
INSERT INTO instrumento_respuesta(organization_id,paciente_id,sesion_id,instrumento_id,instrumento_version,completado_por)
 VALUES('10500000-0000-4000-8000-000000000001','10500000-0000-4000-8000-000000000003','10500000-0000-4000-8000-000000000014','phq9.v1',1,'profesional');
ROLLBACK;
