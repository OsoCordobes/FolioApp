-- B05a final contract after M128 + updated app + M129. This spec runs under
-- SET ROLE authenticated (actual RLS), with synthetic P1/P2, reception scopes
-- and two organizations. Fixture and auth.uid override roll back at the end.
\ir ../migrations/M128_pedido_scope_fixture.sql

DO $$ BEGIN
  IF has_table_privilege('authenticated','public.pedido','SELECT') THEN
    RAISE EXCEPTION 'M129: broad SELECT grant remains';
  END IF;
  IF NOT has_column_privilege('authenticated','public.pedido','id','SELECT')
     OR NOT has_column_privilege('authenticated','public.pedido','nombre_cifrado','SELECT')
     OR has_column_privilege('authenticated','public.pedido','motivo_cifrado','SELECT')
     OR has_column_privilege('authenticated','public.pedido','profesional_id','UPDATE')
     OR NOT has_column_privilege('authenticated','public.pedido','estado','UPDATE') THEN
    RAISE EXCEPTION 'M129: column grants do not match the inbox contract';
  END IF;
END $$;

SET ROLE authenticated;
SET LOCAL folio.test_uid = 'b1280000-0000-4000-8000-000000000001';
DO $$ DECLARE n int; BEGIN
  SELECT count(id) INTO n FROM public.pedido WHERE organization_id='a1280000-0000-4000-8000-000000000001';
  IF n <> 2 THEN RAISE EXCEPTION 'P1 must see own + unassigned, got %',n; END IF;
  SELECT count(id) INTO n FROM public.pedido WHERE id IN ('d1280000-0000-4000-8000-000000000002','d1280000-0000-4000-8000-000000000004');
  IF n <> 0 THEN RAISE EXCEPTION 'P1 sees P2 or organization B'; END IF;
  SELECT count(id) INTO n FROM public.pedido_motivos_clinicos(
    'a1280000-0000-4000-8000-000000000001',
    ARRAY['d1280000-0000-4000-8000-000000000001','d1280000-0000-4000-8000-000000000002','d1280000-0000-4000-8000-000000000003','d1280000-0000-4000-8000-000000000004']::uuid[]);
  IF n <> 2 THEN RAISE EXCEPTION 'P1 clinical RPC must return only own + unassigned, got %',n; END IF;
  BEGIN
    PERFORM motivo_cifrado FROM public.pedido WHERE id='d1280000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Direct clinical column SELECT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.pedido SET profesional_id=NULL WHERE id='d1280000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Direct reassignment unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.pedido SET estado='RECHAZADO', rechazado_motivo='synthetic rejection'
    WHERE id='d1280000-0000-4000-8000-000000000002' AND estado='PENDIENTE';
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'P1 rejected P2 request'; END IF;
  UPDATE public.pedido SET estado='RECHAZADO', rechazado_motivo='synthetic rejection'
    WHERE id='d1280000-0000-4000-8000-000000000001' AND estado='PENDIENTE';
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'P1 cannot reject own request'; END IF;
END $$;

SET LOCAL folio.test_uid = 'b1280000-0000-4000-8000-000000000002';
DO $$ DECLARE n int; BEGIN
  SELECT count(id) INTO n FROM public.pedido WHERE id='d1280000-0000-4000-8000-000000000001';
  IF n <> 0 THEN RAISE EXCEPTION 'P2 sees P1 request'; END IF;
  SELECT count(id) INTO n FROM public.pedido WHERE id='d1280000-0000-4000-8000-000000000002';
  IF n <> 1 THEN RAISE EXCEPTION 'P2 cannot see own request'; END IF;
END $$;

SET LOCAL folio.test_uid = 'b1280000-0000-4000-8000-000000000003';
DO $$ DECLARE n int; BEGIN
  SELECT count(id) INTO n FROM public.pedido WHERE organization_id='a1280000-0000-4000-8000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'LISTA reception must see P1 only, got %',n; END IF;
  BEGIN
    PERFORM * FROM public.pedido_motivos_clinicos('a1280000-0000-4000-8000-000000000001',ARRAY['d1280000-0000-4000-8000-000000000001']::uuid[]);
    RAISE EXCEPTION 'Reception clinical RPC unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.pedido SET rechazado_motivo='synthetic reception correction'
    WHERE id='d1280000-0000-4000-8000-000000000002';
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'LISTA reception updated P2 request'; END IF;
  UPDATE public.pedido SET rechazado_motivo='synthetic reception correction'
    WHERE id='d1280000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'LISTA reception cannot update P1 request'; END IF;
END $$;

SET LOCAL folio.test_uid = 'b1280000-0000-4000-8000-000000000004';
DO $$ DECLARE n int; BEGIN
  SELECT count(id) INTO n FROM public.pedido WHERE organization_id='a1280000-0000-4000-8000-000000000001';
  IF n <> 3 THEN RAISE EXCEPTION 'TODOS reception must see assigned + unassigned, got %',n; END IF;
END $$;

SET LOCAL folio.test_uid = 'b1280000-0000-4000-8000-000000000008';
DO $$ DECLARE n int; BEGIN
  SELECT count(id) INTO n FROM public.pedido WHERE id='d1280000-0000-4000-8000-000000000003';
  IF n <> 0 THEN RAISE EXCEPTION 'EQUIPO reception sees unassigned request'; END IF;
END $$;

SET LOCAL folio.test_uid = 'b1280000-0000-4000-8000-000000000005';
DO $$ DECLARE n int; BEGIN
  SELECT count(id) INTO n FROM public.pedido WHERE organization_id='a1280000-0000-4000-8000-000000000001';
  IF n <> 3 THEN RAISE EXCEPTION 'OWNER A row authority changed, got %',n; END IF;
  SELECT count(id) INTO n FROM public.pedido WHERE organization_id='a1280000-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'OWNER A sees organization B'; END IF;
  SELECT count(id) INTO n FROM public.pedido_motivos_clinicos('a1280000-0000-4000-8000-000000000001',ARRAY['d1280000-0000-4000-8000-000000000001','d1280000-0000-4000-8000-000000000002','d1280000-0000-4000-8000-000000000003']::uuid[]);
  IF n <> 3 THEN RAISE EXCEPTION 'OWNER clinical matrix changed'; END IF;
END $$;

SET LOCAL folio.test_uid = 'b1280000-0000-4000-8000-000000000007';
DO $$ DECLARE n int; BEGIN
  SELECT count(id) INTO n FROM public.pedido WHERE organization_id='a1280000-0000-4000-8000-000000000001';
  IF n <> 3 THEN RAISE EXCEPTION 'DIRECTOR row matrix changed'; END IF;
  BEGIN
    PERFORM * FROM public.pedido_motivos_clinicos('a1280000-0000-4000-8000-000000000001',ARRAY['d1280000-0000-4000-8000-000000000001']::uuid[]);
    RAISE EXCEPTION 'Non-collegiate DIRECTOR gained clinical access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SET LOCAL folio.test_uid = 'b1280000-0000-4000-8000-000000000006';
DO $$ DECLARE n int; BEGIN
  SELECT count(id) INTO n FROM public.pedido WHERE organization_id='a1280000-0000-4000-8000-000000000002';
  IF n <> 1 THEN RAISE EXCEPTION 'OWNER B cannot see own organization'; END IF;
END $$;

SET LOCAL folio.test_uid = 'b1280000-0000-4000-8000-000000000001';
DO $$ DECLARE n uuid; BEGIN
  INSERT INTO public.pedido(organization_id,canal,estado,nombre_cifrado,duracion_min,profesional_id,motivo_cifrado)
  VALUES ('a1280000-0000-4000-8000-000000000001','WHATSAPP','PENDIENTE','\x05',45,NULL,'\xa5')
  RETURNING id INTO n;
  IF n IS NULL THEN RAISE EXCEPTION 'P1 cannot create an unassigned request'; END IF;
  BEGIN
    INSERT INTO public.pedido(organization_id,canal,estado,nombre_cifrado,duracion_min,profesional_id)
    VALUES ('a1280000-0000-4000-8000-000000000001','WHATSAPP','PENDIENTE','\x06',45,'c1280000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'P1 inserted a request assigned to P2';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK;
