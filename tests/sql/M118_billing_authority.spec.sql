-- Synthetic only; rollback leaves no subscription or organization changes.
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.billing_authority_uid',true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON public.organization,public.member,public.suscripcion TO authenticated;
GRANT UPDATE ON public.organization TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.organization,public.suscripcion TO service_role;
INSERT INTO auth.users(id,email) VALUES('11800000-0000-4000-8000-000000000001','billing-authority@synthetic.invalid'),
 ('11800000-0000-4000-8000-000000000002','billing-new@synthetic.invalid');
INSERT INTO profile(id,email,consent_pii_signed_at,consent_pii_text_version) VALUES('11800000-0000-4000-8000-000000000001','billing-authority@synthetic.invalid',now(),'v1');
INSERT INTO organization(id,slug,nombre,created_at) VALUES('11800000-0000-4000-8000-000000000010','m118-billing-authority','Synthetic expired account',now()-interval '120 days');
INSERT INTO member(id,organization_id,profile_id,role,es_colegiado,accepted_at) VALUES('11800000-0000-4000-8000-000000000011','11800000-0000-4000-8000-000000000010','11800000-0000-4000-8000-000000000001','OWNER',true,now());
INSERT INTO suscripcion(id,organization_id,payer_email,estado,proxima_cobro) VALUES('11800000-0000-4000-8000-000000000030','11800000-0000-4000-8000-000000000010','billing-authority@synthetic.invalid','PAUSADA',now()-interval '1 day');
DO $$ BEGIN
 IF has_table_privilege('authenticated','public.suscripcion','INSERT')
 OR has_table_privilege('authenticated','public.suscripcion','UPDATE')
 OR has_table_privilege('authenticated','public.suscripcion','DELETE')
 OR has_table_privilege('authenticated','public.suscripcion','TRUNCATE')
 OR has_column_privilege('authenticated','public.suscripcion','estado','UPDATE')
 OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.suscripcion'::regclass AND polname='suscripcion_write_owner') THEN RAISE EXCEPTION 'M118 client billing writer remains granted';END IF;
END $$;
SELECT set_config('test.billing_authority_uid','11800000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.suscripcion WHERE id='11800000-0000-4000-8000-000000000030' AND estado='PAUSADA') THEN RAISE EXCEPTION 'M118 owner lost subscription read';END IF;
 BEGIN UPDATE public.organization SET is_internal_account=true WHERE id='11800000-0000-4000-8000-000000000010';RAISE EXCEPTION 'M118 owner granted internal exemption';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE public.organization SET created_at=now()+interval '365 days' WHERE id='11800000-0000-4000-8000-000000000010';RAISE EXCEPTION 'M118 owner reset trial';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE public.suscripcion SET estado='ACTIVA',proxima_cobro=now()+interval '365 days' WHERE id='11800000-0000-4000-8000-000000000030';RAISE EXCEPTION 'M118 owner forged paid state';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN DELETE FROM public.suscripcion WHERE id='11800000-0000-4000-8000-000000000030';RAISE EXCEPTION 'M118 owner removed billing record';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN INSERT INTO public.suscripcion(organization_id,payer_email,estado) VALUES('11800000-0000-4000-8000-000000000010','forged@synthetic.invalid','ACTIVA');RAISE EXCEPTION 'M118 owner inserted paid state';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE public.organization SET nombre='Allowed metadata edit' WHERE id='11800000-0000-4000-8000-000000000010';
 IF NOT FOUND THEN RAISE EXCEPTION 'M118 ordinary owner metadata edit blocked';END IF;
 UPDATE public.organization SET created_at=created_at WHERE id='11800000-0000-4000-8000-000000000010';
END $$;
RESET ROLE;
-- Defense remains when an accidental grant AND a permissive policy return.
GRANT INSERT,UPDATE,DELETE ON public.suscripcion TO authenticated;
CREATE POLICY m118_accidental_subscription_writer ON public.suscripcion FOR ALL TO authenticated USING(true) WITH CHECK(true);
CREATE FUNCTION pg_temp.elevated_trial_rewrite() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ UPDATE public.organization SET created_at=now() WHERE id='11800000-0000-4000-8000-000000000010' $$;
CREATE FUNCTION pg_temp.elevated_billing_rewrite() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ UPDATE public.suscripcion SET estado='ACTIVA' WHERE id='11800000-0000-4000-8000-000000000030' $$;
CREATE FUNCTION pg_temp.elevated_internal_rewrite() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ UPDATE public.organization SET is_internal_account=true WHERE id='11800000-0000-4000-8000-000000000010' $$;
CREATE FUNCTION pg_temp.invoker_internal_rewrite() RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ UPDATE public.organization SET is_internal_account=true WHERE id='11800000-0000-4000-8000-000000000010' $$;
GRANT INSERT ON public.organization TO authenticated;
CREATE POLICY m118_accidental_org_insert ON public.organization FOR INSERT TO authenticated WITH CHECK(true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN UPDATE public.suscripcion SET estado='ACTIVA' WHERE id='11800000-0000-4000-8000-000000000030';RAISE EXCEPTION 'M118 accidental grant bypassed trigger';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN DELETE FROM public.suscripcion WHERE id='11800000-0000-4000-8000-000000000030';RAISE EXCEPTION 'M118 accidental grant permitted deletion';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM pg_temp.elevated_billing_rewrite();RAISE EXCEPTION 'M118 definer inherited platform billing permission';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM pg_temp.elevated_trial_rewrite();RAISE EXCEPTION 'M118 definer inherited platform trial permission';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM pg_temp.elevated_internal_rewrite();RAISE EXCEPTION 'M118 definer inherited platform internal exemption';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM pg_temp.invoker_internal_rewrite();RAISE EXCEPTION 'M118 invoker inherited platform internal exemption';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN INSERT INTO public.organization(slug,nombre,created_at) VALUES('m118-forged-future','Synthetic',now()+interval '365 days');RAISE EXCEPTION 'M118 future trial accepted on INSERT';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN INSERT INTO public.organization(slug,nombre,is_internal_account) VALUES('m118-forged-internal','Synthetic',true);RAISE EXCEPTION 'M118 internal exemption accepted on INSERT';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 INSERT INTO public.organization(slug,nombre) VALUES('m118-default-clock','Synthetic default timestamp');
END $$;
RESET ROLE;
SELECT set_config('test.billing_authority_uid','',true);
SET LOCAL ROLE service_role;
DO $$ DECLARE receipt jsonb; BEGIN
 UPDATE public.suscripcion SET estado='ACTIVA',proxima_cobro=now()+interval '30 days' WHERE id='11800000-0000-4000-8000-000000000030';
 IF NOT FOUND THEN RAISE EXCEPTION 'M118 trusted provider persistence blocked';END IF;
 -- Trusted restore/admin can retain a historical creation date; regular settings cannot.
 UPDATE public.organization SET created_at=now()-interval '120 days' WHERE id='11800000-0000-4000-8000-000000000010';
 UPDATE public.organization SET is_internal_account=true WHERE id='11800000-0000-4000-8000-000000000010';
 IF NOT EXISTS(SELECT 1 FROM public.organization WHERE id='11800000-0000-4000-8000-000000000010' AND is_internal_account) THEN RAISE EXCEPTION 'M118 platform exemption grant blocked';END IF;
 UPDATE public.organization SET is_internal_account=false WHERE id='11800000-0000-4000-8000-000000000010';
 INSERT INTO public.organization(slug,nombre,is_internal_account) VALUES('m118-trusted-internal','Synthetic platform demo',true);
 receipt:=public.bootstrap_org_atomic('11800000-0000-4000-8000-000000000001','billing-authority@synthetic.invalid','m118-repeat-bootstrap',NULL,NULL,'v1');
 IF (receipt->>'created')::boolean OR receipt->>'organization_id'<>'11800000-0000-4000-8000-000000000010' THEN RAISE EXCEPTION 'M118 bootstrap no longer reuses active organization';END IF;
 receipt:=public.bootstrap_org_atomic('11800000-0000-4000-8000-000000000002','billing-new@synthetic.invalid','m118-trusted-new',NULL,NULL,'v1');
 IF NOT (receipt->>'created')::boolean THEN RAISE EXCEPTION 'M118 trusted signup bootstrap blocked';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization WHERE id=(receipt->>'organization_id')::uuid AND created_at=transaction_timestamp()) THEN RAISE EXCEPTION 'M118 trusted signup lost database clock';END IF;
 -- Published master persists provider state using direct service INSERT/UPSERT
 -- and UPDATE (without M99). Exercise each shape before accepting a standalone rollout.
 INSERT INTO public.suscripcion(organization_id,payer_email,mp_preapproval_id,estado,monto_cents)
 VALUES((receipt->>'organization_id')::uuid,'billing-new@synthetic.invalid','m118-synthetic-provider','PENDIENTE_ACTIVACION',3000000)
 ON CONFLICT(organization_id) DO UPDATE SET estado=excluded.estado;
 INSERT INTO public.suscripcion(organization_id,payer_email,mp_preapproval_id,estado,monto_cents)
 VALUES((receipt->>'organization_id')::uuid,'billing-new@synthetic.invalid','m118-synthetic-provider','ACTIVA',3000000)
 ON CONFLICT(organization_id) DO UPDATE SET estado=excluded.estado;
 IF NOT EXISTS(SELECT 1 FROM public.suscripcion WHERE organization_id=(receipt->>'organization_id')::uuid AND estado='ACTIVA') THEN RAISE EXCEPTION 'M118 trusted activation upsert failed';END IF;
 UPDATE public.suscripcion SET monto_cents=3100000,proxima_cobro=now()+interval '30 days',ultimo_cobro_ts=now()
 WHERE organization_id=(receipt->>'organization_id')::uuid;
 UPDATE public.suscripcion SET estado='CANCELADA',fecha_cancelacion=now()
 WHERE organization_id=(receipt->>'organization_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.suscripcion WHERE organization_id=(receipt->>'organization_id')::uuid AND estado='CANCELADA' AND monto_cents=3100000 AND proxima_cobro>now() AND ultimo_cobro_ts IS NOT NULL AND fecha_cancelacion IS NOT NULL) THEN RAISE EXCEPTION 'M118 trusted charge, seat sync or cancellation failed';END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT estado FROM public.suscripcion WHERE id='11800000-0000-4000-8000-000000000030')<>'ACTIVA'
 OR (SELECT nombre FROM public.organization WHERE id='11800000-0000-4000-8000-000000000010')<>'Allowed metadata edit'
 OR (SELECT is_internal_account FROM public.organization WHERE id='11800000-0000-4000-8000-000000000010')
 OR NOT EXISTS(SELECT 1 FROM public.organization WHERE slug='m118-trusted-internal' AND is_internal_account)
 OR EXISTS(SELECT 1 FROM public.organization WHERE slug IN('m118-forged-future','m118-forged-internal')) THEN RAISE EXCEPTION 'M118 final invariants failed';END IF;
END $$;
ROLLBACK;
