-- Local synthetic fixture, no providers. Caller owns transaction.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('test.m120_uid',true),'')::uuid
$$;
CREATE FUNCTION pg_temp.m120_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('12000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO auth.users(id,email) SELECT pg_temp.m120_id(n),'m120-'||n||'@synthetic.invalid' FROM generate_series(1,7) n;
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version)
 SELECT id,email,now(),'v1' FROM auth.users WHERE id IN(SELECT pg_temp.m120_id(n) FROM generate_series(1,7) n);
INSERT INTO organization(id,slug,nombre) VALUES (pg_temp.m120_id(10),'m120-synthetic','M120 synthetic'),(pg_temp.m120_id(20),'m120-foreign','M120 foreign');
INSERT INTO member(id,organization_id,profile_id,role,es_colegiado,accepted_at,alcance) VALUES
 (pg_temp.m120_id(11),pg_temp.m120_id(10),pg_temp.m120_id(1),'OWNER',true,now(),'TODOS'),
 (pg_temp.m120_id(21),pg_temp.m120_id(20),pg_temp.m120_id(2),'OWNER',true,now(),'TODOS'),
 (pg_temp.m120_id(31),pg_temp.m120_id(10),pg_temp.m120_id(3),'PROFESIONAL',true,now(),'TODOS'),
 (pg_temp.m120_id(41),pg_temp.m120_id(10),pg_temp.m120_id(4),'ASISTENTE',false,now(),'TODOS'),
 (pg_temp.m120_id(51),pg_temp.m120_id(10),pg_temp.m120_id(5),'COORDINADOR',false,now(),'TODOS'),
 (pg_temp.m120_id(61),pg_temp.m120_id(10),pg_temp.m120_id(6),'DIRECTOR',true,now(),'TODOS');
INSERT INTO servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents)
 VALUES(pg_temp.m120_id(12),pg_temp.m120_id(10),'Synthetic',enum_first(null::tipo_servicio_canonico),30,12345);
INSERT INTO paciente_identidad(id,organization_id,nombre_cifrado,apellido_cifrado,telefono_cifrado)
 VALUES(pg_temp.m120_id(13),pg_temp.m120_id(10),'\x01','\x02','\x03');
INSERT INTO paciente(id,organization_id,identidad_id,profesional_principal_id)
 VALUES(pg_temp.m120_id(14),pg_temp.m120_id(10),pg_temp.m120_id(13),pg_temp.m120_id(11));
INSERT INTO turno(id,organization_id,paciente_id,servicio_id,profesional_id,inicio,duracion_min,precio_cents,estado,atendiendo_desde)
 SELECT pg_temp.m120_id(n),pg_temp.m120_id(10),pg_temp.m120_id(14),pg_temp.m120_id(12),pg_temp.m120_id(11),
 '2026-11-01T12:00:00Z'::timestamptz+make_interval(days=>n-100),30,12345,'ATENDIENDO',now()-interval '10 minutes'
 FROM generate_series(100,125) n;
INSERT INTO sesion(organization_id,turno_id,paciente_id,soap_s_cifrado)
 SELECT pg_temp.m120_id(10),pg_temp.m120_id(n),pg_temp.m120_id(14),'\x01' FROM generate_series(100,125) n;
CREATE FUNCTION pg_temp.m120_context(n integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('profesional_id',t.profesional_id,'inicio',t.inicio,'member_especialidad',m.especialidad,
 'organization_especialidad',o.especialidad,'identity_id',p.identidad_id,'fecha_nacimiento',i.fecha_nacimiento,'identity_deleted_at',i.deleted_at)
 FROM public.turno t JOIN public.member m ON m.id=t.profesional_id JOIN public.organization o ON o.id=t.organization_id
 JOIN public.paciente p ON p.id=t.paciente_id JOIN public.paciente_identidad i ON i.id=p.identidad_id WHERE t.id=pg_temp.m120_id(n)
$$;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.turno,public.pago,public.sesion TO authenticated;
GRANT SELECT ON public.organization,public.member,public.paciente,public.paciente_identidad TO authenticated;
SELECT public.enable_session_atomic_writes('M120 synthetic compatible clinical writer verified');
SELECT set_config('test.m120_uid',pg_temp.m120_id(1)::text,true);
CREATE FUNCTION pg_temp.m120_close(op integer,n integer,d jsonb DEFAULT NULL,duration integer DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.close_turno_atomic(pg_temp.m120_id(10),pg_temp.m120_id(op),pg_temp.m120_id(n),duration,d)
$$;
CREATE FUNCTION pg_temp.m120_resolve(op integer,n integer,d jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.resolve_turno_close(pg_temp.m120_id(10),pg_temp.m120_id(op),pg_temp.m120_id(n),d)
$$;
CREATE FUNCTION pg_temp.m120_probe(op integer,n integer,action text,d jsonb DEFAULT NULL,duration integer DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.get_turno_close_receipt(pg_temp.m120_id(10),pg_temp.m120_id(op),pg_temp.m120_id(n),action,duration,d)
$$;
CREATE FUNCTION pg_temp.m120_expect(query text,code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE query; EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=code THEN RETURN; END IF;
  RAISE EXCEPTION 'M120 expected %, received %: %',code,SQLSTATE,SQLERRM;
 END;
 RAISE EXCEPTION 'M120 expected failure % but statement succeeded: %',code,query;
END $$;
