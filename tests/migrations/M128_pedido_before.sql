-- Read-only reproduction at M127, before applying M128. Run only on a
-- disposable, synthetic hosted PG16 harness; never on production.
\ir M128_pedido_scope_fixture.sql
-- CI's vanilla Postgres has no Supabase default Data API grants; model the
-- authenticated SELECT privilege independently from the RLS row decision.
GRANT SELECT ON public.pedido TO authenticated;
SET ROLE authenticated;
SET LOCAL folio.test_uid = 'b1280000-0000-4000-8000-000000000001';
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.pedido WHERE organization_id='a1280000-0000-4000-8000-000000000001';
  IF n <> 3 THEN RAISE EXCEPTION 'M127 baseline expected P1 org-wide leak (3), got %',n; END IF;
  SELECT count(*) INTO n FROM public.pedido WHERE id='d1280000-0000-4000-8000-000000000002' AND motivo_cifrado='\xa2'::bytea;
  IF n <> 1 THEN RAISE EXCEPTION 'M127 baseline expected direct P2 reason ciphertext'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
