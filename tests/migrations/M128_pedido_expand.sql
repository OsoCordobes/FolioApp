-- Old reader + M128 expand, before M129 contract. Run only on a disposable,
-- synthetic hosted PG16 harness. M128 retains SELECT on motivo_cifrado until
-- the updated app is deployed; scoped rows and UPDATE columns are enforced.
\ir M128_pedido_scope_fixture.sql
GRANT SELECT ON public.pedido TO authenticated;
SET ROLE authenticated;
SET LOCAL folio.test_uid = 'b1280000-0000-4000-8000-000000000001';
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.pedido WHERE organization_id='a1280000-0000-4000-8000-000000000001';
  IF n <> 2 THEN RAISE EXCEPTION 'M128 expand: P1 must see assigned + unassigned, got %',n; END IF;
  SELECT count(*) INTO n FROM public.pedido WHERE id='d1280000-0000-4000-8000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'M128 expand: P1 sees P2 request'; END IF;
  SELECT count(*) INTO n FROM public.pedido WHERE id='d1280000-0000-4000-8000-000000000001' AND motivo_cifrado='\xa1'::bytea;
  IF n <> 1 THEN RAISE EXCEPTION 'M128 expand: old clinical reader lost own reason'; END IF;
  IF has_column_privilege('authenticated','public.pedido','profesional_id','UPDATE') THEN
    RAISE EXCEPTION 'M128 expand: direct professional reassignment still granted';
  END IF;
END $$;
SET LOCAL folio.test_uid = 'b1280000-0000-4000-8000-000000000003';
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.pedido WHERE organization_id='a1280000-0000-4000-8000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'M128 expand: LISTA reception must see P1 only, got %',n; END IF;
END $$;
RESET ROLE;
ROLLBACK;
