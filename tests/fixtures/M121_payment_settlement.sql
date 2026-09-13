-- Caller owns transaction; all identity/payment values are synthetic.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.m121_uid',true),'')::uuid $$;
CREATE FUNCTION pg_temp.m121_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('12100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
INSERT INTO auth.users(id,email) SELECT pg_temp.m121_id(n),'m121-'||n||'@synthetic.invalid' FROM generate_series(1,7) n;
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version) SELECT pg_temp.m121_id(n),'m121-'||n||'@synthetic.invalid',now(),'v1' FROM generate_series(1,7) n;
INSERT INTO organization(id,slug,nombre) VALUES(pg_temp.m121_id(10),'m121-synthetic','M121 synthetic'),(pg_temp.m121_id(20),'m121-foreign','M121 foreign');
INSERT INTO member(id,organization_id,profile_id,role,es_colegiado,accepted_at,alcance) VALUES
 (pg_temp.m121_id(11),pg_temp.m121_id(10),pg_temp.m121_id(1),'OWNER',true,now(),'TODOS'),
 (pg_temp.m121_id(21),pg_temp.m121_id(20),pg_temp.m121_id(2),'OWNER',true,now(),'TODOS'),
 (pg_temp.m121_id(31),pg_temp.m121_id(10),pg_temp.m121_id(3),'PROFESIONAL',true,now(),'TODOS'),
 (pg_temp.m121_id(41),pg_temp.m121_id(10),pg_temp.m121_id(4),'ASISTENTE',false,now(),'TODOS'),
 (pg_temp.m121_id(51),pg_temp.m121_id(10),pg_temp.m121_id(5),'COORDINADOR',false,now(),'TODOS'),
 (pg_temp.m121_id(61),pg_temp.m121_id(10),pg_temp.m121_id(6),'DIRECTOR',true,now(),'TODOS');
INSERT INTO servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents) VALUES(pg_temp.m121_id(12),pg_temp.m121_id(10),'Synthetic',enum_first(null::tipo_servicio_canonico),30,1200);
INSERT INTO paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado) VALUES(pg_temp.m121_id(13),pg_temp.m121_id(10),'\x01','\x02','\x03');
INSERT INTO paciente(id,organization_id,identidad_id,profesional_principal_id) VALUES(pg_temp.m121_id(14),pg_temp.m121_id(10),pg_temp.m121_id(13),pg_temp.m121_id(11));
INSERT INTO turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,estado,atendiendo_desde)
 SELECT pg_temp.m121_id(n),pg_temp.m121_id(10),pg_temp.m121_id(14),pg_temp.m121_id(12),pg_temp.m121_id(11),
 '2035-01-01T12:00:00Z'::timestamptz+make_interval(days=>n-100),30,1200,'ATENDIENDO',now()-interval '10 minutes' FROM generate_series(100,120) n;
INSERT INTO sesion(organization_id,turno_id,paciente_id,soap_s_cifrado) SELECT pg_temp.m121_id(10),pg_temp.m121_id(n),pg_temp.m121_id(14),'\x01' FROM generate_series(100,120) n;
-- Pre-existing finance rows predate M120 cutover. No policy is changed here.
INSERT INTO pago(id,turno_id,monto_cents,metodo,estado,notas,factura_afip_numero)
 SELECT pg_temp.m121_id(n+100),pg_temp.m121_id(n),1200,'EFECTIVO',CASE WHEN n=101 THEN 'PARCIAL'::estado_pago ELSE 'PENDIENTE'::estado_pago END,'preserve notes','synthetic-'||n FROM generate_series(100,120) n;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT,INSERT,UPDATE ON pago,turno,sesion TO authenticated;
GRANT SELECT ON organization,member,paciente,paciente_identidad TO authenticated;
SELECT public.enable_session_atomic_writes('M121 synthetic compatible original writer');
SELECT public.enable_turno_atomic_close('M121 synthetic compatible close and administrative recovery');
SELECT set_config('test.m121_uid',pg_temp.m121_id(1)::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN FOR n IN 100..118 LOOP PERFORM public.close_turno_atomic(pg_temp.m121_id(10),pg_temp.m121_id(n+300),pg_temp.m121_id(n));END LOOP;END $$;
RESET ROLE;
CREATE FUNCTION pg_temp.m121_settle(n integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT public.settle_pago_atomic(pg_temp.m121_id(10),pg_temp.m121_id(n),pg_temp.m121_id(n+100)) $$;
CREATE FUNCTION pg_temp.m121_expect(query text,code text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN EXECUTE query; EXCEPTION WHEN OTHERS THEN IF SQLSTATE=code THEN RETURN;END IF;RAISE EXCEPTION 'M121 expected %, got %: %',code,SQLSTATE,SQLERRM;END;
 RAISE EXCEPTION 'M121 expected failure %, statement succeeded: %',code,query;
END $$;
