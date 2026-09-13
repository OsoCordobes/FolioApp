-- M100: durable encrypted email envelopes; no recipient, subject or PHI plaintext.
ALTER TABLE public.organization ADD COLUMN is_synthetic boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.guard_organization_synthetic()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.is_synthetic AND NOT NEW.is_synthetic THEN
    RAISE EXCEPTION 'Synthetic organizations cannot enable external delivery' USING ERRCODE='42501';
  END IF;
  IF (TG_OP='INSERT' AND NEW.is_synthetic) OR
     (TG_OP='UPDATE' AND NEW.is_synthetic IS DISTINCT FROM OLD.is_synthetic) THEN
    IF coalesce(current_setting('role',true),'') IN ('anon','authenticated') OR
       current_user NOT IN ('postgres','service_role','supabase_admin') THEN
      RAISE EXCEPTION 'Synthetic status requires platform administration' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_organization_synthetic() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER organization_synthetic_guard BEFORE INSERT OR UPDATE OF is_synthetic ON public.organization
  FOR EACH ROW EXECUTE FUNCTION public.guard_organization_synthetic();

CREATE TABLE public.email_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organization(id),
  dedupe_key text NOT NULL UNIQUE CHECK(dedupe_key ~ '^[a-f0-9]{64}$'),
  kind text NOT NULL CHECK(kind ~ '^[a-z0-9_]{1,80}$'),
  payload_cifrado text,
  turno_id uuid REFERENCES public.turno(id),
  billing_followup_id uuid REFERENCES public.billing_followup_job(id),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','retryable','terminal','accepted','delivered')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  first_attempt_at timestamptz,
  lease_token uuid, lease_until timestamptz,
  provider_id text,
  sanitized_error text CHECK(sanitized_error IS NULL OR sanitized_error ~ '^[a-z0-9_:-]{1,100}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz, delivered_at timestamptz
);
ALTER TABLE public.email_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_delivery FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.email_delivery TO service_role;
CREATE INDEX email_delivery_due_idx ON public.email_delivery(available_at,id)
  WHERE status IN ('pending','retryable','leased');

CREATE OR REPLACE FUNCTION public.email_enqueue(
 p_org uuid,p_key text,p_kind text,p_payload text,p_expires_at timestamptz DEFAULT NULL,p_legacy_key text DEFAULT NULL,p_turno uuid DEFAULT NULL,p_billing_job uuid DEFAULT NULL
) RETURNS SETOF public.email_delivery LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_blocked boolean; v_legacy boolean;
BEGIN
  SELECT (o.is_synthetic OR o.deleted_at IS NOT NULL OR (p_kind LIKE 'billing_%' AND o.is_internal_account))
    INTO v_blocked FROM public.organization o WHERE o.id=p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization unavailable'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.email_notificacion WHERE dedupe_key=p_legacy_key) INTO v_legacy;
  IF p_turno IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.turno WHERE id=p_turno AND organization_id=p_org) THEN RAISE EXCEPTION 'Appointment organization mismatch'; END IF;
  IF p_billing_job IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.billing_followup_job WHERE id=p_billing_job AND organization_id=p_org) THEN RAISE EXCEPTION 'Billing job organization mismatch'; END IF;
  INSERT INTO public.email_delivery(organization_id,dedupe_key,kind,payload_cifrado,status,expires_at,sanitized_error,turno_id,billing_followup_id)
  VALUES(p_org,p_key,p_kind,CASE WHEN v_blocked OR v_legacy THEN NULL ELSE p_payload END,
    CASE WHEN v_blocked OR v_legacy THEN 'terminal' ELSE 'pending' END,p_expires_at,
    CASE WHEN v_blocked THEN 'organization_delivery_blocked' WHEN v_legacy THEN 'legacy_delivery_unverified' END,p_turno,p_billing_job)
  ON CONFLICT(dedupe_key) DO NOTHING;
  RETURN QUERY SELECT * FROM public.email_delivery WHERE dedupe_key=p_key AND organization_id=p_org;
END; $$;

CREATE OR REPLACE FUNCTION public.email_claim(p_limit integer DEFAULT 10,p_id uuid DEFAULT NULL)
RETURNS SETOF public.email_delivery LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  -- Any attempt may have reached the provider before a process crash. Never replay
  -- after the 24h idempotency retention; 23h leaves a conservative safety margin.
  UPDATE public.email_delivery e SET status='terminal',payload_cifrado=NULL,lease_token=NULL,lease_until=NULL,
    sanitized_error=CASE WHEN e.first_attempt_at <= now()-interval '23 hours' THEN 'idempotency_window_expired'
      WHEN e.expires_at <= now() THEN 'message_expired' ELSE 'organization_delivery_blocked' END
  FROM public.organization o WHERE e.organization_id=o.id AND e.status IN ('pending','retryable','leased')
    AND (e.lease_until IS NULL OR e.lease_until<=now())
    AND (e.first_attempt_at <= now()-interval '23 hours' OR e.expires_at<=now() OR o.is_synthetic OR o.deleted_at IS NOT NULL
      OR (e.kind LIKE 'billing_%' AND o.is_internal_account));
  RETURN QUERY WITH picked AS (
    SELECT id FROM public.email_delivery WHERE (p_id IS NULL OR id=p_id)
      AND ((status IN ('pending','retryable') AND available_at<=now()) OR (status='leased' AND lease_until<=now()))
      AND attempts<10 ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(p_limit,25))
  ) UPDATE public.email_delivery e SET status='leased',attempts=e.attempts+1,
      lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',first_attempt_at=coalesce(e.first_attempt_at,now())
    FROM picked p WHERE e.id=p.id RETURNING e.*;
  UPDATE public.email_delivery SET status='terminal',sanitized_error='attempts_exhausted',payload_cifrado=NULL
    WHERE attempts>=10 AND status='leased' AND lease_until<=now();
END; $$;

CREATE OR REPLACE FUNCTION public.email_finish(p_id uuid,p_token uuid,p_status text,p_provider_id text DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
  IF p_status NOT IN ('retryable','terminal','accepted','delivered') THEN RAISE EXCEPTION 'Invalid finish state'; END IF;
  IF p_status IN ('accepted','delivered') AND nullif(p_provider_id,'') IS NULL THEN RAISE EXCEPTION 'Provider receipt required'; END IF;
  UPDATE public.email_delivery SET status=CASE WHEN p_status='retryable' AND attempts>=10 THEN 'terminal' ELSE p_status END,
    sanitized_error=p_error,provider_id=coalesce(p_provider_id,provider_id),lease_token=NULL,lease_until=NULL,
    available_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,10)))::integer),
    accepted_at=CASE WHEN p_status IN ('accepted','delivered') THEN now() ELSE accepted_at END,
    delivered_at=CASE WHEN p_status='delivered' THEN now() ELSE delivered_at END,
    payload_cifrado=CASE WHEN p_status IN ('terminal','accepted','delivered') OR attempts>=10 THEN NULL ELSE payload_cifrado END
  WHERE id=p_id AND status='leased' AND lease_token=p_token AND lease_until>now();
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count=1 AND p_status IN ('accepted','delivered') THEN
    UPDATE public.billing_followup_job SET status=p_status,provider_id=p_provider_id,sanitized_error=NULL,
      lease_token=NULL,lease_until=NULL
      WHERE id=(SELECT billing_followup_id FROM public.email_delivery WHERE id=p_id);
  END IF;
  RETURN v_count=1;
END; $$;
REVOKE ALL ON FUNCTION public.email_enqueue(uuid,text,text,text,timestamptz,text,uuid,uuid),public.email_claim(integer,uuid),
  public.email_finish(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.email_enqueue(uuid,text,text,text,timestamptz,text,uuid,uuid),public.email_claim(integer,uuid),
  public.email_finish(uuid,uuid,text,text,text) TO service_role;

-- Recordatorios retain their own source references. Their lease prevents a second
-- picker taking an in-flight job. Provider acceptance is separate from delivery.
ALTER TABLE public.recordatorio_job
 ADD COLUMN delivery_state text NOT NULL DEFAULT 'pending' CHECK(delivery_state IN ('pending','leased','retryable','terminal','accepted','delivered')),
 ADD COLUMN lease_token uuid, ADD COLUMN lease_until timestamptz,
 ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN provider_id text, ADD COLUMN external_started_at timestamptz;
-- Historical enviado_ts was overloaded for skips/simulation: no delivery claim.
UPDATE public.recordatorio_job SET delivery_state='terminal' WHERE enviado_ts IS NOT NULL;
CREATE OR REPLACE FUNCTION public.recordatorio_claim(p_limit integer DEFAULT 5)
RETURNS SETOF public.recordatorio_job LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 UPDATE public.recordatorio_job SET delivery_state='terminal',error_msg='provider_response_unknown'
 WHERE delivery_state='leased' AND lease_until<=now() AND external_started_at IS NOT NULL AND canal='whatsapp';
 UPDATE public.recordatorio_job SET delivery_state='terminal',error_msg='reminder_expired'
 WHERE delivery_state IN ('pending','retryable','leased') AND (lease_until IS NULL OR lease_until<=now())
   AND (scheduled_ts<now()-interval '6 hours' OR intentos>=5);
 RETURN QUERY WITH picked AS (
 SELECT id FROM public.recordatorio_job WHERE enviado_ts IS NULL AND scheduled_ts<=now()
   AND scheduled_ts>=now()-interval '6 hours' AND available_at<=now() AND intentos<5
   AND (delivery_state IN ('pending','retryable') OR (delivery_state='leased' AND lease_until<=now()))
 ORDER BY scheduled_ts,id FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(p_limit,10))
 ) UPDATE public.recordatorio_job j SET delivery_state='leased',lease_token=gen_random_uuid(),
   lease_until=now()+interval '2 minutes',intentos=j.intentos+1 FROM picked p WHERE j.id=p.id RETURNING j.*;
END; $$;
CREATE OR REPLACE FUNCTION public.recordatorio_finish(p_id uuid,p_token uuid,p_status text,p_canal text DEFAULT NULL,p_provider_id text DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
 IF p_status NOT IN ('retryable','terminal','accepted','delivered') THEN RAISE EXCEPTION 'Invalid finish state'; END IF;
 IF p_error IS NOT NULL AND p_error !~ '^[a-z0-9_:-]{1,100}$' THEN RAISE EXCEPTION 'Invalid error code'; END IF;
 UPDATE public.recordatorio_job SET delivery_state=CASE WHEN p_status='retryable' AND intentos>=5 THEN 'terminal' ELSE p_status END,
   canal=coalesce(p_canal,canal),provider_id=coalesce(p_provider_id,provider_id),error_msg=p_error,
   enviado_ts=CASE WHEN p_status IN ('accepted','delivered') THEN now() ELSE enviado_ts END,
   lease_token=NULL,lease_until=NULL,available_at=now()+make_interval(secs=>least(3600,30*power(2,intentos))::integer)
 WHERE id=p_id AND delivery_state='leased' AND lease_token=p_token AND lease_until>now();
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count=1;
END; $$;
REVOKE ALL ON FUNCTION public.recordatorio_claim(integer),public.recordatorio_finish(uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recordatorio_claim(integer),public.recordatorio_finish(uuid,uuid,text,text,text,text) TO service_role;
