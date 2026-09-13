-- M121: settlement retains current authority through commit. Additive rollout;
-- runner owns transaction/ledger. M120's reviewed migration remains unchanged.
CREATE SCHEMA folio_settlement_private;
REVOKE ALL ON SCHEMA folio_settlement_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE folio_settlement_private.policy(singleton boolean PRIMARY KEY CHECK(singleton),enabled_at timestamptz);
INSERT INTO folio_settlement_private.policy VALUES(true,NULL);
CREATE TABLE folio_settlement_private.activation_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 executor text NOT NULL,reason text NOT NULL
);
CREATE TABLE folio_settlement_private.authority(
 tx bigint NOT NULL,pago_id uuid NOT NULL,actor_id uuid NOT NULL,PRIMARY KEY(tx,pago_id)
);
ALTER TABLE folio_settlement_private.policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_settlement_private.activation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_settlement_private.authority ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA folio_settlement_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA folio_settlement_private FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION folio_settlement_private.enable(p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF length(trim(coalesce(p_reason,'')))<20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Record verified finance and agenda settlement callers'; END IF;
 IF NOT EXISTS(SELECT 1 FROM folio_session_private.policy WHERE enabled_at IS NOT NULL)
  OR NOT EXISTS(SELECT 1 FROM folio_close_private.policy WHERE enabled_at IS NOT NULL) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Activate compatible clinical and close policies first';
 END IF;
 UPDATE folio_settlement_private.policy SET enabled_at=clock_timestamp() WHERE singleton AND enabled_at IS NULL;
 IF FOUND THEN INSERT INTO folio_settlement_private.activation_history(executor,reason) VALUES(session_user,p_reason); END IF;
END $$;

-- This callable checker grants no authority, creates no rows and exposes no
-- payment data. The invoker trigger needs it to read the private policy/rows.
CREATE FUNCTION folio_settlement_private.assert_update_authority(p_pago uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM folio_settlement_private.policy WHERE enabled_at IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM folio_settlement_private.authority WHERE tx=txid_current() AND pago_id=p_pago AND actor_id=auth.uid()) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Reload and use the authorized settlement transaction';
 END IF;
END $$;

CREATE FUNCTION folio_settlement_private.guard_update() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_ARGV[0]='changed' AND NEW.estado IS NOT DISTINCT FROM OLD.estado AND NEW.pagado_ts IS NOT DISTINCT FROM OLD.pagado_ts THEN RETURN NEW; END IF;
 -- Same trusted SQL-role boundary as M118. A SECURITY DEFINER helper invoked
 -- by authenticated retains role=authenticated and cannot inherit this bypass.
 -- No JWT role or caller-defined GUC grants platform or transactional authority.
 IF current_user IN('postgres','service_role','supabase_admin')
  AND coalesce(current_setting('role',true),'') NOT IN('anon','authenticated') THEN RETURN NEW; END IF;
 PERFORM folio_settlement_private.assert_update_authority(NEW.id);
 RETURN NEW;
END $$;
-- Explicit SET of settlement fields is guarded even when redundant/mixed.
CREATE TRIGGER pago_settlement_explicit_guard BEFORE UPDATE OF estado,pagado_ts ON public.pago
 FOR EACH ROW EXECUTE FUNCTION folio_settlement_private.guard_update('explicit');
-- Also catch changed fields produced by other BEFORE triggers from an UPDATE
-- whose original target list only mentioned metadata. No lock order inversion.
CREATE TRIGGER zz_pago_settlement_changed_guard BEFORE UPDATE ON public.pago
 FOR EACH ROW EXECUTE FUNCTION folio_settlement_private.guard_update('changed');

CREATE FUNCTION folio_settlement_private.settle(p_org uuid,p_turno uuid,p_pago uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.turno; actor public.member; payment public.pago; was_paid boolean;
BEGIN
 PERFORM folio_mfa_private.assert_access();
 IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current financial staff required'; END IF;
 IF p_org IS NULL OR p_turno IS NULL OR p_pago IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Explicit organization, visit and existing payment required'; END IF;
 -- Never start at pago: a raw UPDATE may have waited with stale RLS scope.
 -- Retain the same turno -> authorization -> pago order as M120.
 SELECT * INTO t FROM public.turno WHERE id=p_turno FOR UPDATE;
 actor:=folio_close_private.authorize(p_org,t,true);
 IF actor.role='ASISTENTE' AND t.estado<>'CERRADO' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Reception settlement requires a closed visit'; END IF;
 SELECT * INTO payment FROM public.pago WHERE id=p_pago AND turno_id=p_turno FOR UPDATE;
 IF NOT FOUND OR payment.turno_id IS DISTINCT FROM t.id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current payment and requested visit association required'; END IF;
 -- Existing source locks remain held. Recheck after the pago wait too, including
 -- current session/MFA conditions rather than treating a prior read as authority.
 actor:=folio_close_private.authorize(p_org,t,true);
 was_paid:=payment.estado='PAGADO';
 IF NOT was_paid THEN
  IF payment.estado NOT IN('PENDIENTE','PARCIAL') THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Payment is not eligible for settlement'; END IF;
  INSERT INTO folio_settlement_private.authority(tx,pago_id,actor_id) VALUES(txid_current(),payment.id,auth.uid());
  UPDATE public.pago SET estado='PAGADO',pagado_ts=clock_timestamp() WHERE id=payment.id RETURNING * INTO payment;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Existing payment changed during settlement'; END IF;
  DELETE FROM folio_settlement_private.authority WHERE tx=txid_current() AND pago_id=payment.id;
 END IF;
 RETURN jsonb_build_object('turnoId',t.id,'alreadyPaid',was_paid,'pago',jsonb_build_object(
  'id',payment.id,'montoCents',payment.monto_cents,'metodo',payment.metodo,'estado',payment.estado,
  'pagadoTs',payment.pagado_ts,'updatedAt',payment.updated_at));
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA folio_settlement_private FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA folio_settlement_private TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION folio_settlement_private.settle(uuid,uuid,uuid),folio_settlement_private.assert_update_authority(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION folio_settlement_private.enable(text) TO service_role;
CREATE FUNCTION public.settle_pago_atomic(p_org uuid,p_turno uuid,p_pago uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT folio_settlement_private.settle(p_org,p_turno,p_pago) $$;
CREATE FUNCTION public.enable_payment_settlement_authority(p_reason text) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT folio_settlement_private.enable(p_reason) $$;
REVOKE ALL ON FUNCTION public.settle_pago_atomic(uuid,uuid,uuid),public.enable_payment_settlement_authority(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.settle_pago_atomic(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enable_payment_settlement_authority(text) TO service_role;
