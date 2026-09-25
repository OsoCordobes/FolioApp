-- Rollback-only authorization contract for M133. Requires migrations through M133.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('public.agenda_recepcion_rango(uuid,date,date,uuid)') IS NULL
 OR to_regprocedure('public.agenda_recepcion_pedidos(uuid,date,uuid)') IS NULL
 OR to_regprocedure('public.agenda_recepcion_profesionales(uuid,date)') IS NULL
 OR to_regprocedure('public.agenda_recepcion_bloqueos(uuid,date,timestamptz,timestamptz,uuid)') IS NULL
 OR to_regprocedure('public.agenda_recepcion_disponibilidad(uuid,date,uuid)') IS NULL
 OR to_regprocedure('public.agenda_recepcion_dia(uuid,date,uuid)') IS NULL THEN
  RAISE EXCEPTION 'M133 or its M122 day reader is missing';
 END IF;
END $$;
\ir ../fixtures/M121_payment_settlement.sql
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.m131_jwt',true),''),'{}')::jsonb $$;
INSERT INTO auth.mfa_factors(id,user_id,status)
 SELECT pg_temp.m121_id(800+n),pg_temp.m121_id(n),'verified' FROM generate_series(1,7) n;
INSERT INTO auth.sessions(id,user_id,aal,factor_id)
 SELECT pg_temp.m121_id(900+n),pg_temp.m121_id(n),'aal2',pg_temp.m121_id(800+n) FROM generate_series(1,7) n;
UPDATE folio_mfa_private.policy SET application_ready=true,staff_enforce_after=now();
CREATE FUNCTION pg_temp.m131_login(n integer,aal text DEFAULT 'aal2') RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('test.m121_uid',pg_temp.m121_id(n)::text,true);
 PERFORM set_config('test.m131_jwt',jsonb_build_object('aal',aal,'session_id',pg_temp.m121_id(900+n))::text,true);
END $$;
SELECT pg_temp.m131_login(1);
UPDATE organization SET timezone='America/Argentina/Cordoba' WHERE id=pg_temp.m121_id(10);
UPDATE turno SET inicio='2035-01-01T13:00:00Z',profesional_id=pg_temp.m121_id(31) WHERE id=pg_temp.m121_id(101);
UPDATE turno SET inicio='2035-01-02T02:30:00Z' WHERE id=pg_temp.m121_id(104);
UPDATE turno SET inicio='2035-01-02T03:00:00Z' WHERE id=pg_temp.m121_id(105);
GRANT SELECT ON turno_extendido,servicio TO authenticated;
INSERT INTO pedido(id,organization_id,canal,estado,nombre_cifrado,duracion_min,profesional_id,precio_cents)
VALUES
 (pg_temp.m121_id(601),pg_temp.m121_id(10),'TELEFONO','PENDIENTE','\x01',30,pg_temp.m121_id(11),1200),
 (pg_temp.m121_id(602),pg_temp.m121_id(10),'TELEFONO','PENDIENTE','\x01',30,pg_temp.m121_id(31),2400),
 (pg_temp.m121_id(603),pg_temp.m121_id(10),'TELEFONO','PENDIENTE','\x01',30,NULL,3600);
INSERT INTO bloqueo(id,organization_id,profesional_id,inicio,duracion_min,titulo,origen) VALUES
 (pg_temp.m121_id(611),pg_temp.m121_id(10),pg_temp.m121_id(11),'2035-01-01T13:00:00Z',30,'Owner private','manual'),
 (pg_temp.m121_id(612),pg_temp.m121_id(10),pg_temp.m121_id(31),'2035-01-01T14:00:00Z',30,'Managed private','manual');
INSERT INTO disponibilidad_profesional(id,organization_id,member_id,dia_semana,hora_inicio,hora_fin,vigencia_desde) VALUES
 (pg_temp.m121_id(621),pg_temp.m121_id(10),pg_temp.m121_id(11),1,'09:00','10:00','2035-01-01'),
 (pg_temp.m121_id(622),pg_temp.m121_id(10),pg_temp.m121_id(31),1,'09:00','10:00','2035-01-01');

DO $$ BEGIN
 IF has_function_privilege('anon','public.agenda_recepcion_rango(uuid,date,date,uuid)','EXECUTE')
 OR has_function_privilege('service_role','public.agenda_recepcion_rango(uuid,date,date,uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.agenda_recepcion_rango(uuid,date,date,uuid)','EXECUTE')
 OR has_function_privilege('anon','public.agenda_recepcion_pedidos(uuid,date,uuid)','EXECUTE')
 OR has_function_privilege('service_role','public.agenda_recepcion_pedidos(uuid,date,uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.agenda_recepcion_pedidos(uuid,date,uuid)','EXECUTE')
 OR has_function_privilege('anon','public.agenda_recepcion_profesionales(uuid,date)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.agenda_recepcion_profesionales(uuid,date)','EXECUTE')
 OR has_function_privilege('anon','public.agenda_recepcion_bloqueos(uuid,date,timestamptz,timestamptz,uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.agenda_recepcion_bloqueos(uuid,date,timestamptz,timestamptz,uuid)','EXECUTE')
 OR has_function_privilege('anon','public.agenda_recepcion_disponibilidad(uuid,date,uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.agenda_recepcion_disponibilidad(uuid,date,uuid)','EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_proc WHERE oid IN (
   'public.agenda_recepcion_pedidos(uuid,date,uuid)'::regprocedure,
   'public.agenda_recepcion_profesionales(uuid,date)'::regprocedure,
   'public.agenda_recepcion_bloqueos(uuid,date,timestamptz,timestamptz,uuid)'::regprocedure,
   'public.agenda_recepcion_disponibilidad(uuid,date,uuid)'::regprocedure
  ) AND prosecdef)
 OR (SELECT count(*) FROM pg_proc WHERE oid IN (
   'folio_agenda_private.recepcion_pedidos(uuid,date,uuid)'::regprocedure,
   'folio_agenda_private.recepcion_profesionales(uuid,date)'::regprocedure,
   'folio_agenda_private.recepcion_bloqueos(uuid,date,timestamptz,timestamptz,uuid)'::regprocedure,
   'folio_agenda_private.recepcion_disponibilidad(uuid,date,uuid)'::regprocedure
  ) AND prosecdef AND provolatile='s' AND 'search_path=pg_catalog'=ANY(proconfig))<>4
 OR has_function_privilege('anon','folio_agenda_private.recepcion_pedidos(uuid,date,uuid)','EXECUTE')
 OR has_function_privilege('service_role','folio_agenda_private.recepcion_pedidos(uuid,date,uuid)','EXECUTE')
 OR NOT has_function_privilege('authenticated','folio_agenda_private.recepcion_pedidos(uuid,date,uuid)','EXECUTE')
 OR has_function_privilege('anon','folio_agenda_private.recepcion_profesionales(uuid,date)','EXECUTE')
 OR has_function_privilege('service_role','folio_agenda_private.recepcion_profesionales(uuid,date)','EXECUTE')
 OR has_function_privilege('anon','folio_agenda_private.recepcion_bloqueos(uuid,date,timestamptz,timestamptz,uuid)','EXECUTE')
 OR has_function_privilege('service_role','folio_agenda_private.recepcion_bloqueos(uuid,date,timestamptz,timestamptz,uuid)','EXECUTE')
 OR has_function_privilege('anon','folio_agenda_private.recepcion_disponibilidad(uuid,date,uuid)','EXECUTE')
 OR has_function_privilege('service_role','folio_agenda_private.recepcion_disponibilidad(uuid,date,uuid)','EXECUTE')
 OR (SELECT prosecdef FROM pg_proc WHERE oid='public.agenda_recepcion_rango(uuid,date,date,uuid)'::regprocedure)
 OR (SELECT provolatile<>'s' OR NOT proretset OR NOT ('search_path=pg_catalog'=ANY(proconfig))
     FROM pg_proc WHERE oid='public.agenda_recepcion_rango(uuid,date,date,uuid)'::regprocedure)
 OR (SELECT proargnames[1:4] FROM pg_proc WHERE oid='public.agenda_recepcion_rango(uuid,date,date,uuid)'::regprocedure)
    IS DISTINCT FROM ARRAY['p_org','p_desde','p_hasta','p_profesional']::text[]
 THEN RAISE EXCEPTION 'M133 unsafe privilege, search path, or RPC contract';END IF;
END $$;

-- Both reception roles see exactly the union of the authorized local days.
SELECT pg_temp.m131_login(4);
SET LOCAL ROLE authenticated;
DO $$ DECLARE actual uuid[]; expected uuid[]; keys text[]; BEGIN
 SELECT array_agg(id ORDER BY inicio,id) INTO actual
 FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),'2035-01-01','2035-01-02');
 SELECT array_agg(id ORDER BY inicio,id) INTO expected FROM (
  SELECT id,inicio FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-01')
  UNION ALL SELECT id,inicio FROM public.agenda_recepcion_dia(pg_temp.m121_id(10),'2035-01-02')
 ) days;
 IF actual IS DISTINCT FROM expected OR cardinality(actual)<3 THEN
  RAISE EXCEPTION 'M133 assistant calendar is incomplete or out of order';END IF;
 IF (SELECT count(*) FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),'2035-01-01','2035-01-01',pg_temp.m121_id(11)))<>2
 OR (SELECT id FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),'2035-01-01','2035-01-02') ORDER BY inicio,id LIMIT 1 OFFSET 2)
    IS DISTINCT FROM pg_temp.m121_id(104) THEN RAISE EXCEPTION 'M133 scope or pagination drift';END IF;
 SELECT array_agg(key ORDER BY key) INTO keys FROM jsonb_object_keys(
  (SELECT to_jsonb(r) FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),'2035-01-01','2035-01-01') r LIMIT 1)
 ) AS fields(key);
 IF keys IS DISTINCT FROM ARRAY['duracion_min','estado','id','inicio','modalidad','organization_id','origen',
  'paciente_apellido_cifrado','paciente_id','paciente_nombre_cifrado','paciente_telefono_cifrado',
  'profesional_id','servicio_nombre']::text[] THEN RAISE EXCEPTION 'M133 exposed fields outside calendar contract: %',keys;END IF;
 IF EXISTS(SELECT 1 FROM turno_extendido WHERE id=pg_temp.m121_id(100))
 THEN RAISE EXCEPTION 'M133 widened clinical view RLS';END IF;
 IF (SELECT count(*) FROM public.agenda_recepcion_pedidos(pg_temp.m121_id(10),'2035-01-01'))<>3
 OR (SELECT precio_cents FROM public.agenda_recepcion_pedidos(pg_temp.m121_id(10),'2035-01-01') WHERE id=pg_temp.m121_id(601)) IS DISTINCT FROM 1200
 OR (SELECT array_agg(id ORDER BY id) FROM public.agenda_recepcion_pedidos(pg_temp.m121_id(10),'2035-01-01',pg_temp.m121_id(31)))
    IS DISTINCT FROM ARRAY[pg_temp.m121_id(602),pg_temp.m121_id(603)]::uuid[]
 OR (SELECT array_agg(id ORDER BY id) FROM public.agenda_recepcion_pedidos(pg_temp.m121_id(10),'2035-01-01',pg_temp.m121_id(11)))
    IS DISTINCT FROM ARRAY[pg_temp.m121_id(601),pg_temp.m121_id(603)]::uuid[]
 OR (SELECT array_agg(id ORDER BY id) FROM public.agenda_recepcion_profesionales(pg_temp.m121_id(10),'2035-01-01'))
    IS DISTINCT FROM ARRAY[pg_temp.m121_id(11),pg_temp.m121_id(31),pg_temp.m121_id(61)]::uuid[]
 OR (SELECT count(*) FROM public.agenda_recepcion_bloqueos(pg_temp.m121_id(10),'2035-01-01','2035-01-01T03:00:00Z','2035-01-03T03:00:00Z'))<>2
 OR EXISTS(SELECT 1 FROM public.agenda_recepcion_bloqueos(pg_temp.m121_id(10),'2035-01-01','2035-01-01T03:00:00Z','2035-01-03T03:00:00Z') WHERE titulo IS NOT NULL)
 OR (SELECT count(*) FROM public.agenda_recepcion_disponibilidad(pg_temp.m121_id(10),'2035-01-01'))<>2
 THEN RAISE EXCEPTION 'M133 assistant inbox or picker contract broken';END IF;
 IF EXISTS(SELECT 1 FROM public.agenda_recepcion_pedidos(pg_temp.m121_id(10),'2035-01-01') p
   WHERE to_jsonb(p) ? 'motivo_cifrado')
 THEN RAISE EXCEPTION 'M133 inbox exposed clinical motive';END IF;
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_rango(pg_temp.m121_id(20),''2035-01-01'',''2035-01-02'')','42501');
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),''2035-01-01'',''2035-01-02'',pg_temp.m121_id(21))','42501');
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_rango(NULL,''2035-01-01'',''2035-01-02'')','22023');
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),NULL,''2035-01-02'')','22023');
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),''2035-01-02'',''2035-01-01'')','22023');
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),''2035-01-01'',''2035-02-12'')','22023');
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),''infinity'',''infinity'')','22023');
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_bloqueos(pg_temp.m121_id(10),''2035-01-01'',''2035-01-01T03:00:00Z'',''2035-01-10T03:00:00Z'')','22023');
END $$;
RESET ROLE;

SELECT pg_temp.m131_login(5);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),'2035-01-01','2035-01-02'))<3
 THEN RAISE EXCEPTION 'M133 coordinator lost calendar rows';END IF;
 IF EXISTS(SELECT 1 FROM public.agenda_recepcion_pedidos(pg_temp.m121_id(10),'2035-01-01') WHERE precio_cents IS NOT NULL)
 THEN RAISE EXCEPTION 'M133 coordinator received request price';END IF;
END $$;
RESET ROLE;

UPDATE member SET alcance='LISTA_PROFESIONALES',profesionales_gestionados=ARRAY[pg_temp.m121_id(31)::text] WHERE id=pg_temp.m121_id(41);
SELECT pg_temp.m131_login(4);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),'2035-01-01','2035-01-02'))<>1
 THEN RAISE EXCEPTION 'M133 ignored current professional scope';END IF;
 IF (SELECT array_agg(id) FROM public.agenda_recepcion_pedidos(pg_temp.m121_id(10),'2035-01-01'))
    IS DISTINCT FROM ARRAY[pg_temp.m121_id(602)]::uuid[]
 OR (SELECT array_agg(id) FROM public.agenda_recepcion_pedidos(pg_temp.m121_id(10),'2035-01-01',pg_temp.m121_id(31)))
    IS DISTINCT FROM ARRAY[pg_temp.m121_id(602)]::uuid[]
 OR (SELECT array_agg(id) FROM public.agenda_recepcion_profesionales(pg_temp.m121_id(10),'2035-01-01'))
    IS DISTINCT FROM ARRAY[pg_temp.m121_id(31)]::uuid[]
 OR (SELECT array_agg(id) FROM public.agenda_recepcion_bloqueos(pg_temp.m121_id(10),'2035-01-01','2035-01-01T03:00:00Z','2035-01-03T03:00:00Z'))
    IS DISTINCT FROM ARRAY[pg_temp.m121_id(612)]::uuid[]
 OR (SELECT array_agg(id) FROM public.agenda_recepcion_disponibilidad(pg_temp.m121_id(10),'2035-01-01'))
    IS DISTINCT FROM ARRAY[pg_temp.m121_id(622)]::uuid[]
 THEN RAISE EXCEPTION 'M133 partial-scope inbox or picker leaked another professional or unassigned request';END IF;
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),''2035-01-01'',''2035-01-02'',pg_temp.m121_id(11))','42501');
 PERFORM pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_pedidos(pg_temp.m121_id(10),''2035-01-01'',pg_temp.m121_id(11))','42501');
END $$;
RESET ROLE;
UPDATE member SET alcance='LISTA_PROFESIONALES',profesionales_gestionados=ARRAY[pg_temp.m121_id(31)::text] WHERE id=pg_temp.m121_id(51);
SELECT pg_temp.m131_login(5);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT array_agg(id) FROM public.agenda_recepcion_pedidos(pg_temp.m121_id(10),'2035-01-01'))
    IS DISTINCT FROM ARRAY[pg_temp.m121_id(602)]::uuid[]
 OR EXISTS(SELECT 1 FROM public.agenda_recepcion_pedidos(pg_temp.m121_id(10),'2035-01-01') WHERE precio_cents IS NOT NULL)
 OR (SELECT array_agg(id) FROM public.agenda_recepcion_bloqueos(pg_temp.m121_id(10),'2035-01-01','2035-01-01T03:00:00Z','2035-01-03T03:00:00Z'))
    IS DISTINCT FROM ARRAY[pg_temp.m121_id(612)]::uuid[]
 THEN RAISE EXCEPTION 'M133 limited coordinator inbox leaked scope or price';END IF;
END $$;
RESET ROLE;

SELECT pg_temp.m131_login(4,'aal1');
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),''2035-01-01'',''2035-01-02'')','42501');
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_pedidos(pg_temp.m121_id(10),''2035-01-01'')','42501');
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_profesionales(pg_temp.m121_id(10),''2035-01-01'')','42501');
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_disponibilidad(pg_temp.m121_id(10),''2035-01-01'')','42501');
SELECT pg_temp.m121_expect('SELECT * FROM folio_agenda_private.recepcion_pedidos(pg_temp.m121_id(10),''2035-01-01'',NULL)','42501');
RESET ROLE;
SELECT pg_temp.m131_login(1);
SET LOCAL ROLE authenticated;
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),''2035-01-01'',''2035-01-02'')','42501');
RESET ROLE;
SELECT pg_temp.m131_login(4);
SET LOCAL ROLE anon;
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),''2035-01-01'',''2035-01-02'')','42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.m121_expect('SELECT * FROM public.agenda_recepcion_rango(pg_temp.m121_id(10),''2035-01-01'',''2035-01-02'')','42501');
RESET ROLE;
SELECT 'M133 PASS: bounded complete reception calendar, current scope, field redaction, and authorization';
ROLLBACK;
