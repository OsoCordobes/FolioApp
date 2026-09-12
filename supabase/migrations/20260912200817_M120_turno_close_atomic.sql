-- M120: additive close boundary. No providers; runner owns transaction/ledger.
CREATE SCHEMA folio_close_private;
REVOKE ALL ON SCHEMA folio_close_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE folio_close_private.policy(singleton boolean PRIMARY KEY CHECK(singleton),enabled_at timestamptz);
INSERT INTO folio_close_private.policy VALUES(true,NULL);
CREATE TABLE folio_close_private.activation_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 executor text NOT NULL,reason text NOT NULL
);
CREATE TABLE folio_close_private.authority(
 tx bigint NOT NULL,turno_id uuid NOT NULL,actor_id uuid NOT NULL,PRIMARY KEY(tx,turno_id)
);
CREATE TABLE folio_close_private.close_record(
 turno_id uuid PRIMARY KEY REFERENCES public.turno(id),organization_id uuid NOT NULL REFERENCES public.organization(id),
 actor_id uuid REFERENCES public.member(id),closed_at timestamptz,
 origen text NOT NULL CHECK(origen IN('AGENDA','CLINICAL','LEGACY','HISTORICO')),
 clasificacion text NOT NULL CHECK(clasificacion IN('REQUIERE_REGISTRO','SIN_CARGO','REGISTRADO')),
 pago_id uuid UNIQUE REFERENCES public.pago(id),
 CHECK((clasificacion='REGISTRADO')=(pago_id IS NOT NULL))
);
CREATE TABLE folio_close_private.receipt(
 organization_id uuid NOT NULL REFERENCES public.organization(id),actor_id uuid NOT NULL REFERENCES public.member(id),
 operation_id uuid NOT NULL,turno_id uuid NOT NULL REFERENCES public.turno(id),bound_input jsonb NOT NULL,
 result jsonb NOT NULL,financial boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organization_id,actor_id,operation_id)
);
ALTER TABLE folio_close_private.policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_close_private.activation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_close_private.authority ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_close_private.close_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_close_private.receipt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA folio_close_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA folio_close_private FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION folio_close_private.enable(p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF length(trim(coalesce(p_reason,'')))<20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Record compatible close, recovery and clinical rollout verification'; END IF;
 IF NOT EXISTS(SELECT 1 FROM folio_session_private.policy WHERE enabled_at IS NOT NULL) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Activate the compatible clinical writer first';
 END IF;
 UPDATE folio_close_private.policy SET enabled_at=clock_timestamp() WHERE singleton AND enabled_at IS NULL;
 IF FOUND THEN INSERT INTO folio_close_private.activation_history(executor,reason) VALUES(session_user,p_reason); END IF;
END $$;

-- Authority is a private transaction row. Caller-controlled claims/GUCs are
-- never a substitute. Includes a legacy redundant CERRADO -> CERRADO write.
CREATE FUNCTION folio_close_private.close_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.estado='CERRADO' AND EXISTS(SELECT 1 FROM folio_close_private.policy WHERE enabled_at IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM folio_close_private.authority WHERE tx=txid_current() AND turno_id=NEW.id AND actor_id=auth.uid())
 AND NOT EXISTS(SELECT 1 FROM folio_session_private.authority WHERE tx=txid_current() AND turno_id=NEW.id AND actor_id=auth.uid() AND mode='WRITE') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Reload and use the atomic close writer';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aa_turno_atomic_close_guard BEFORE INSERT OR UPDATE OF estado ON public.turno
 FOR EACH ROW EXECUTE FUNCTION folio_close_private.close_guard();

CREATE FUNCTION folio_close_private.capture_close() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stamp timestamptz:=clock_timestamp(); payment uuid; source text;
BEGIN
 IF NEW.estado<>'CERRADO' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.estado='CERRADO' THEN RETURN NEW; END IF;
 SELECT id INTO payment FROM public.pago WHERE turno_id=NEW.id;
 source:=CASE WHEN EXISTS(SELECT 1 FROM folio_session_private.authority WHERE tx=txid_current() AND turno_id=NEW.id AND actor_id=auth.uid() AND mode='WRITE') THEN 'CLINICAL'
  WHEN EXISTS(SELECT 1 FROM folio_close_private.authority WHERE tx=txid_current() AND turno_id=NEW.id AND actor_id=auth.uid()) THEN 'AGENDA' ELSE 'LEGACY' END;
 INSERT INTO folio_close_private.close_record(turno_id,organization_id,actor_id,closed_at,origen,clasificacion,pago_id)
 VALUES(NEW.id,NEW.organization_id,public.user_member_id_in(NEW.organization_id),stamp,source,CASE WHEN payment IS NULL THEN 'REQUIERE_REGISTRO' ELSE 'REGISTRADO' END,payment)
 ON CONFLICT(turno_id) DO NOTHING;
 INSERT INTO public.recordatorio_job(organization_id,turno_id,tipo,scheduled_ts)
 SELECT organization_id,turno_id,'POST_VISITA',closed_at+interval '2 hours' FROM folio_close_private.close_record WHERE turno_id=NEW.id AND closed_at IS NOT NULL
 ON CONFLICT(turno_id,tipo) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER turno_capture_atomic_close AFTER INSERT OR UPDATE OF estado ON public.turno
 FOR EACH ROW EXECUTE FUNCTION folio_close_private.capture_close();

-- No alternative initial payment insert can bypass the explicit decision after
-- activation. In particular ON CONFLICT DO NOTHING still runs BEFORE INSERT.
-- UPDATE of an existing PENDIENTE payment remains the separate settlement path.
CREATE FUNCTION folio_close_private.payment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.turno_id IS DISTINCT FROM OLD.turno_id AND EXISTS(SELECT 1 FROM folio_close_private.policy WHERE enabled_at IS NOT NULL) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Payment visit association is immutable';
  END IF;
  RETURN NEW;
 END IF;
 IF EXISTS(SELECT 1 FROM folio_close_private.policy WHERE enabled_at IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM folio_close_private.authority WHERE tx=txid_current() AND turno_id=NEW.turno_id AND actor_id=auth.uid()) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Use explicit atomic payment registration';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pago_atomic_registration_guard BEFORE INSERT OR UPDATE OF turno_id ON public.pago FOR EACH ROW EXECUTE FUNCTION folio_close_private.payment_guard();

-- Keeps the marker accurate during expansion when old callers still register
-- after closing. Only metadata changes; no second visit UPDATE or enqueue.
CREATE FUNCTION folio_close_private.capture_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 UPDATE folio_close_private.close_record SET clasificacion='REGISTRADO',pago_id=NEW.id WHERE turno_id=NEW.turno_id;
 RETURN NEW;
END $$;
CREATE TRIGGER pago_capture_close_registration AFTER INSERT ON public.pago FOR EACH ROW EXECUTE FUNCTION folio_close_private.capture_payment();

-- Caller must hold turno first, matching M106. Lock every mutable agenda
-- authorization source before evaluating it; after waits re-read MFA/session.
CREATE FUNCTION folio_close_private.authorize(p_org uuid,p_turno public.turno,p_financial boolean) RETURNS public.member
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; professional public.member; claims jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_turno.id IS NULL OR p_turno.organization_id IS DISTINCT FROM p_org OR p_turno.deleted_at IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current staff visit required';
 END IF;
 PERFORM 1 FROM public.organization WHERE id=p_org AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current organization required'; END IF;
 SELECT * INTO actor FROM public.member WHERE organization_id=p_org AND profile_id=auth.uid() AND deleted_at IS NULL
  AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
 IF NOT FOUND OR actor.role NOT IN('OWNER','DIRECTOR','PROFESIONAL','ASISTENTE','COORDINADOR') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current accepted staff required';
 END IF;
 SELECT * INTO professional FROM public.member WHERE id=p_turno.profesional_id AND organization_id=p_org AND deleted_at IS NULL
  AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
 IF NOT FOUND OR NOT (actor.role IN('OWNER','DIRECTOR') OR (actor.role='PROFESIONAL' AND actor.id=professional.id)
  OR (actor.role IN('ASISTENTE','COORDINADOR') AND public.user_has_scope_over(p_org,professional.id))) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current agenda assignment required';
 END IF;
 IF p_financial AND actor.role='COORDINADOR' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Financial registration permission required'; END IF;
 claims:=auth.jwt();
 PERFORM 1 FROM folio_mfa_private.policy WHERE singleton FOR SHARE;
 PERFORM 1 FROM auth.sessions WHERE user_id=auth.uid() AND id::text=claims->>'session_id' FOR SHARE;
 PERFORM 1 FROM auth.mfa_factors WHERE user_id=auth.uid() FOR SHARE;
 PERFORM folio_mfa_private.assert_access();
 RETURN actor;
END $$;

CREATE FUNCTION folio_close_private.status_value(p_turno public.turno,p_actor public.member) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE marker folio_close_private.close_record; payment public.pago;
BEGIN
 SELECT * INTO marker FROM folio_close_private.close_record WHERE turno_id=p_turno.id;
 SELECT * INTO payment FROM public.pago WHERE turno_id=p_turno.id;
 RETURN jsonb_build_object('turnoId',p_turno.id,'estado',p_turno.estado,'closedAt',marker.closed_at,
  'origen',coalesce(marker.origen,CASE WHEN p_turno.estado='CERRADO' THEN 'HISTORICO' END),
  'clasificacion',CASE WHEN payment.id IS NOT NULL THEN 'REGISTRADO' ELSE coalesce(marker.clasificacion,CASE WHEN p_turno.estado='CERRADO' THEN 'REQUIERE_REGISTRO' END) END,
  'puedeRegistrar',p_actor.role IN('OWNER','DIRECTOR','PROFESIONAL','ASISTENTE'),
  'pago',CASE WHEN payment.id IS NOT NULL AND p_actor.role<>'COORDINADOR' THEN jsonb_build_object('id',payment.id,'montoCents',payment.monto_cents,'metodo',payment.metodo,'estado',payment.estado,'pagadoTs',payment.pagado_ts,'updatedAt',payment.updated_at) END);
END $$;

CREATE FUNCTION folio_close_private.status(p_org uuid,p_turno uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.turno; actor public.member;
BEGIN
 PERFORM folio_mfa_private.assert_access();
 SELECT * INTO t FROM public.turno WHERE id=p_turno FOR SHARE;
 actor:=folio_close_private.authorize(p_org,t,false);
 RETURN folio_close_private.status_value(t,actor);
END $$;

CREATE FUNCTION folio_close_private.execute(p_org uuid,p_operation uuid,p_turno uuid,p_action text,p_duracion integer,p_decision jsonb,p_probe boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.turno; actor public.member; prior folio_close_private.receipt; marker folio_close_private.close_record;
 payment public.pago; bound jsonb; result jsonb; amount numeric; method public.metodo_pago; paid boolean; source text;
BEGIN
 PERFORM folio_mfa_private.assert_access();
 IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current staff required'; END IF;
 IF p_operation IS NULL OR p_turno IS NULL OR p_action IS NULL OR p_action NOT IN('CLOSE','RESOLVE')
 OR (p_duracion IS NOT NULL AND p_duracion NOT BETWEEN 0 AND 480)
 OR (p_action='RESOLVE' AND (p_duracion IS NOT NULL OR p_decision IS NULL)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Explicit operation and valid close intent required';
 END IF;
 IF p_decision IS NOT NULL THEN
  IF jsonb_typeof(p_decision) IS DISTINCT FROM 'object' OR jsonb_typeof(p_decision->'montoCents') IS DISTINCT FROM 'number' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Explicit numeric financial decision required';
  END IF;
  amount:=(p_decision->>'montoCents')::numeric;
  IF amount<0 OR amount>2147483647 OR amount<>trunc(amount) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid cents amount'; END IF;
  IF amount=0 THEN
   IF p_decision<>jsonb_build_object('montoCents',0) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Zero decision has only montoCents'; END IF;
  ELSE
   IF NOT(p_decision ?& ARRAY['montoCents','metodo','pagado']) OR (p_decision-ARRAY['montoCents','metodo','pagado'])<>'{}'::jsonb
    OR jsonb_typeof(p_decision->'pagado') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_decision->'metodo') IS DISTINCT FROM 'string'
    OR NOT EXISTS(SELECT 1 FROM unnest(enum_range(NULL::public.metodo_pago)) e WHERE e::text=p_decision->>'metodo') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Positive decision requires exact amount, method and paid boolean';
   END IF;
   method:=(p_decision->>'metodo')::public.metodo_pago; paid:=(p_decision->>'pagado')::boolean;
  END IF;
 END IF;
 bound:=jsonb_build_array(p_turno,p_action,p_duracion,p_decision);
 PERFORM pg_advisory_xact_lock(hashtextextended('close:'||p_org::text||':'||auth.uid()::text||':'||p_operation::text,0));
 SELECT * INTO t FROM public.turno WHERE id=p_turno FOR UPDATE;
 actor:=folio_close_private.authorize(p_org,t,p_decision IS NOT NULL);
 SELECT * INTO prior FROM folio_close_private.receipt WHERE organization_id=p_org AND actor_id=actor.id AND operation_id=p_operation;
 IF FOUND THEN
  IF prior.bound_input IS DISTINCT FROM bound THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Operation reused for different intent'; END IF;
  IF prior.financial AND actor.role='COORDINADOR' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current financial receipt permission required'; END IF;
  RETURN prior.result;
 END IF;
 IF p_probe THEN RETURN NULL; END IF;
 IF p_action='CLOSE' THEN
  PERFORM 1 FROM folio_session_private.policy WHERE singleton AND enabled_at IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Activate the compatible clinical writer before atomic close'; END IF;
 END IF;
 IF (p_action='CLOSE' AND t.estado<>'ATENDIENDO') OR (p_action='RESOLVE' AND t.estado<>'CERRADO') THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Review current close status; closed visits use administrative resolution';
 END IF;
 SELECT * INTO payment FROM public.pago WHERE turno_id=t.id FOR UPDATE;
 SELECT * INTO marker FROM folio_close_private.close_record WHERE turno_id=t.id;
 IF p_decision IS NOT NULL AND payment.id IS NOT NULL AND (amount=0 OR payment.monto_cents<>amount OR payment.metodo IS DISTINCT FROM method OR payment.estado::text IS DISTINCT FROM CASE WHEN paid THEN 'PAGADO' ELSE 'PENDIENTE' END) THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Existing financial registration differs; review current payment';
 END IF;
 IF marker.clasificacion='SIN_CARGO' AND amount>0 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Existing no-charge decision differs'; END IF;
 INSERT INTO folio_close_private.authority VALUES(txid_current(),t.id,auth.uid());
 IF p_action='CLOSE' THEN
  UPDATE public.turno SET estado='CERRADO',atendiendo_desde=NULL,duracion_real_min=coalesce(p_duracion,duracion_real_min) WHERE id=t.id RETURNING * INTO t;
 ELSE
  -- Historical recovery does not invent time, reopen history or enqueue messages.
  INSERT INTO folio_close_private.close_record(turno_id,organization_id,actor_id,closed_at,origen,clasificacion,pago_id)
  VALUES(t.id,p_org,NULL,NULL,'HISTORICO',CASE WHEN payment.id IS NULL THEN 'REQUIERE_REGISTRO' ELSE 'REGISTRADO' END,payment.id) ON CONFLICT(turno_id) DO NOTHING;
 END IF;
 source:=CASE WHEN payment.id IS NOT NULL THEN 'EXISTENTE' WHEN amount=0 THEN 'SIN_CARGO' ELSE 'SIN_DECISION' END;
 IF payment.id IS NULL AND amount>0 THEN
  INSERT INTO public.pago(turno_id,monto_cents,metodo,estado,pagado_ts)
  VALUES(t.id,amount::integer,method,CASE WHEN paid THEN 'PAGADO'::public.estado_pago ELSE 'PENDIENTE'::public.estado_pago END,CASE WHEN paid THEN clock_timestamp() END) RETURNING * INTO payment;
  source:='CREADO';
 END IF;
 IF payment.id IS NOT NULL THEN UPDATE folio_close_private.close_record SET clasificacion='REGISTRADO',pago_id=payment.id WHERE turno_id=t.id;
 ELSIF amount=0 THEN UPDATE folio_close_private.close_record SET clasificacion='SIN_CARGO' WHERE turno_id=t.id;
 END IF;
 result:=folio_close_private.status_value(t,actor)||jsonb_build_object('operationId',p_operation,'pagoOrigen',source);
 INSERT INTO folio_close_private.receipt(organization_id,actor_id,operation_id,turno_id,bound_input,result,financial)
 VALUES(p_org,actor.id,p_operation,t.id,bound,result,p_decision IS NOT NULL OR result->'pago'<>'null'::jsonb);
 DELETE FROM folio_close_private.authority WHERE tx=txid_current() AND turno_id=t.id;
 RETURN result;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA folio_close_private FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA folio_close_private TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION folio_close_private.execute(uuid,uuid,uuid,text,integer,jsonb,boolean),folio_close_private.status(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION folio_close_private.enable(text) TO service_role;
CREATE FUNCTION public.close_turno_atomic(p_org uuid,p_operation uuid,p_turno uuid,p_duracion integer DEFAULT NULL,p_decision jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT folio_close_private.execute(p_org,p_operation,p_turno,'CLOSE',p_duracion,p_decision,false) $$;
CREATE FUNCTION public.resolve_turno_close(p_org uuid,p_operation uuid,p_turno uuid,p_decision jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT folio_close_private.execute(p_org,p_operation,p_turno,'RESOLVE',NULL,p_decision,false) $$;
CREATE FUNCTION public.get_turno_close_receipt(p_org uuid,p_operation uuid,p_turno uuid,p_action text,p_duracion integer DEFAULT NULL,p_decision jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT folio_close_private.execute(p_org,p_operation,p_turno,p_action,p_duracion,p_decision,true) $$;
CREATE FUNCTION public.get_turno_close_status(p_org uuid,p_turno uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT folio_close_private.status(p_org,p_turno) $$;
CREATE FUNCTION public.enable_turno_atomic_close(p_reason text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT folio_close_private.enable(p_reason) $$;
REVOKE ALL ON FUNCTION public.close_turno_atomic(uuid,uuid,uuid,integer,jsonb),public.resolve_turno_close(uuid,uuid,uuid,jsonb),
 public.get_turno_close_receipt(uuid,uuid,uuid,text,integer,jsonb),public.get_turno_close_status(uuid,uuid),public.enable_turno_atomic_close(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.close_turno_atomic(uuid,uuid,uuid,integer,jsonb),public.resolve_turno_close(uuid,uuid,uuid,jsonb),
 public.get_turno_close_receipt(uuid,uuid,uuid,text,integer,jsonb),public.get_turno_close_status(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enable_turno_atomic_close(text) TO service_role;
COMMENT ON TABLE folio_close_private.receipt IS 'Immutable administrative operation confirmations, no clinical plaintext; no automatic expiration.';
