-- M107: complete-window reconciliation and a reference-only outbound intent queue.
-- Additive; no provider calls. Workers remain inactive until separately scheduled.
ALTER TABLE public.integration
 ADD COLUMN google_sync_lease uuid,
 ADD COLUMN google_sync_lease_until timestamptz,
 ADD COLUMN google_sync_requested bigint NOT NULL DEFAULT 0,
 ADD COLUMN google_sync_claimed bigint NOT NULL DEFAULT 0,
 ADD COLUMN google_next_sync_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX google_sync_due ON public.integration(google_next_sync_at,id) WHERE proveedor='GOOGLE_CALENDAR';

CREATE TABLE public.google_outbound_job (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organization(id),
 integration_id uuid NOT NULL REFERENCES public.integration(id) ON DELETE CASCADE,
 turno_id uuid NOT NULL REFERENCES public.turno(id) ON DELETE CASCADE,
 calendar_id text NOT NULL,
 event_id text NOT NULL,
 desired_version bigint NOT NULL DEFAULT 1,
 claimed_version bigint,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','leased','complete','terminal')),
 available_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,
 lease_until timestamptz,
 attempts int NOT NULL DEFAULT 0,
 sanitized_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(integration_id,turno_id,calendar_id)
);
ALTER TABLE public.google_outbound_job ENABLE ROW LEVEL SECURITY;
CREATE POLICY folio_mfa_gate ON public.google_outbound_job AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT public.mfa_access_allowed())) WITH CHECK ((SELECT public.mfa_access_allowed()));
REVOKE ALL ON public.google_outbound_job FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.google_outbound_job TO service_role;
CREATE INDEX google_outbound_due ON public.google_outbound_job(available_at,id) WHERE status IN('pending','leased');

CREATE FUNCTION public.google_queue_turno() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- A professional reassignment also wakes the old calendar job for cancellation.
 UPDATE public.google_outbound_job SET desired_version=desired_version+1,
  status=CASE WHEN status='leased' THEN 'leased' ELSE 'pending' END,available_at=now()
 WHERE turno_id=NEW.id;
 INSERT INTO public.google_outbound_job(organization_id,integration_id,turno_id,calendar_id,event_id)
 SELECT NEW.organization_id,i.id,NEW.id,coalesce(nullif(i.meta_json->>'calendar_id',''),'primary'),
  coalesce(CASE WHEN NOT EXISTS(SELECT 1 FROM public.google_outbound_job oldjob WHERE oldjob.turno_id=NEW.id AND oldjob.integration_id<>i.id) THEN NEW.gcal_event_id END,'f'||md5(i.id::text||':'||NEW.id::text||':'||coalesce(nullif(i.meta_json->>'calendar_id',''),'primary')))
 FROM public.integration i JOIN public.member m ON m.id=i.profesional_id AND m.organization_id=i.organization_id
 JOIN public.organization o ON o.id=i.organization_id AND o.deleted_at IS NULL AND NOT o.is_synthetic
 WHERE i.organization_id=NEW.organization_id AND i.profesional_id=NEW.profesional_id AND i.proveedor='GOOGLE_CALENDAR'
  AND i.refresh_token_cifrado IS NOT NULL AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
 ON CONFLICT(integration_id,turno_id,calendar_id) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER google_turno_intent AFTER INSERT OR UPDATE OF inicio,duracion_min,estado,profesional_id ON public.turno
 FOR EACH ROW EXECUTE FUNCTION public.google_queue_turno();

CREATE FUNCTION public.google_queue_integration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.refresh_token_cifrado IS NOT DISTINCT FROM NEW.refresh_token_cifrado AND (OLD.meta_json->>'calendar_id') IS NOT DISTINCT FROM (NEW.meta_json->>'calendar_id') THEN RETURN NEW; END IF;
 IF NEW.proveedor<>'GOOGLE_CALENDAR' OR NEW.profesional_id IS NULL OR NEW.refresh_token_cifrado IS NULL OR NOT EXISTS(SELECT 1 FROM public.organization o WHERE o.id=NEW.organization_id AND o.deleted_at IS NULL AND NOT o.is_synthetic) THEN RETURN NEW; END IF;
 -- Keep existing event IDs: legacy records require ownership review before writing.
 INSERT INTO public.google_outbound_job(organization_id,integration_id,turno_id,calendar_id,event_id)
 SELECT NEW.organization_id,NEW.id,t.id,coalesce(nullif(NEW.meta_json->>'calendar_id',''),'primary'),
  CASE WHEN TG_OP='UPDATE' AND (OLD.meta_json->>'calendar_id') IS DISTINCT FROM (NEW.meta_json->>'calendar_id')
    THEN 'f'||md5(NEW.id::text||':'||t.id::text||':'||coalesce(nullif(NEW.meta_json->>'calendar_id',''),'primary'))
    ELSE coalesce(t.gcal_event_id,'f'||md5(NEW.id::text||':'||t.id::text||':'||coalesce(nullif(NEW.meta_json->>'calendar_id',''),'primary'))) END
 FROM public.turno t WHERE t.organization_id=NEW.organization_id AND t.profesional_id=NEW.profesional_id AND t.inicio>=now()-interval '1 day'
 ON CONFLICT(integration_id,turno_id,calendar_id) DO UPDATE SET desired_version=google_outbound_job.desired_version+1,
 status=CASE WHEN google_outbound_job.status='leased' THEN 'leased' ELSE 'pending' END,available_at=now();
 RETURN NEW;
END $$;
CREATE TRIGGER google_integration_intent AFTER INSERT OR UPDATE OF refresh_token_cifrado,meta_json ON public.integration
 FOR EACH ROW WHEN (NEW.proveedor='GOOGLE_CALENDAR') EXECUTE FUNCTION public.google_queue_integration();

CREATE FUNCTION public.google_claim_outbound(p_limit int DEFAULT 10,p_turno uuid DEFAULT NULL)
 RETURNS SETOF public.google_outbound_job LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN QUERY WITH selected AS (
  SELECT j.id FROM public.google_outbound_job j JOIN public.integration i ON i.id=j.integration_id AND i.organization_id=j.organization_id
   JOIN public.organization o ON o.id=j.organization_id AND o.deleted_at IS NULL AND NOT o.is_synthetic
   JOIN public.member m ON m.id=i.profesional_id AND m.organization_id=i.organization_id AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
  WHERE j.status IN('pending','leased') AND j.available_at<=now() AND (j.lease_until IS NULL OR j.lease_until<=now())
   AND (p_turno IS NULL OR j.turno_id=p_turno) AND i.proveedor='GOOGLE_CALENDAR' AND i.refresh_token_cifrado IS NOT NULL
  ORDER BY j.available_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT greatest(1,least(p_limit,20))
 ) UPDATE public.google_outbound_job j SET status='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',
  claimed_version=desired_version,attempts=attempts+1 FROM selected s WHERE j.id=s.id RETURNING j.*;
END $$;
CREATE FUNCTION public.google_finish_outbound(p_id uuid,p_lease uuid,p_success boolean,p_error text DEFAULT NULL,p_terminal boolean DEFAULT false)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.google_outbound_job; BEGIN
 SELECT * INTO j FROM public.google_outbound_job WHERE id=p_id AND lease_token=p_lease AND status='leased' AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_error='invalid_grant' THEN UPDATE public.integration SET ultimo_error='invalid_grant',ultimo_error_ts=now() WHERE id=j.integration_id AND organization_id=j.organization_id; END IF;
 IF p_success THEN
  UPDATE public.turno t SET gcal_event_id=j.event_id FROM public.integration i
   WHERE t.id=j.turno_id AND t.organization_id=j.organization_id AND i.id=j.integration_id AND i.profesional_id=t.profesional_id
   AND coalesce(nullif(i.meta_json->>'calendar_id',''),'primary')=j.calendar_id AND t.estado NOT IN('CANCELADO','NO_ASISTIO','REAGENDADO');
 END IF;
 UPDATE public.google_outbound_job SET status=CASE WHEN desired_version<>claimed_version THEN 'pending' WHEN p_success THEN 'complete' WHEN p_terminal THEN 'terminal' ELSE 'pending' END,
  available_at=CASE WHEN desired_version<>claimed_version THEN now() ELSE now()+make_interval(secs=>least(3600,30*greatest(1,attempts))) END,
  lease_token=NULL,lease_until=NULL,sanitized_error=CASE WHEN p_success THEN NULL WHEN p_error IN('invalid_grant','ownership_review','provider_unavailable','calendar_scope_changed','source_unavailable') THEN p_error ELSE 'sync_failed' END
 WHERE id=p_id;
 RETURN true;
END $$;

CREATE FUNCTION public.google_claim_inbound(p_id uuid,p_notify boolean DEFAULT true) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.integration; token uuid; BEGIN
 SELECT x.* INTO i FROM public.integration x JOIN public.organization o ON o.id=x.organization_id AND o.deleted_at IS NULL AND NOT o.is_synthetic
 JOIN public.member m ON m.id=x.profesional_id AND m.organization_id=x.organization_id AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
 WHERE x.id=p_id AND x.proveedor='GOOGLE_CALENDAR' AND x.refresh_token_cifrado IS NOT NULL FOR UPDATE OF x;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF p_notify THEN UPDATE public.integration SET google_sync_requested=google_sync_requested+1,google_next_sync_at=now() WHERE id=p_id; END IF;
 IF i.google_sync_lease_until>now() THEN RETURN NULL; END IF;
 token:=gen_random_uuid();
 UPDATE public.integration SET google_sync_lease=token,google_sync_lease_until=now()+interval '90 seconds',google_sync_claimed=google_sync_requested WHERE id=p_id;
 RETURN jsonb_build_object('lease',token,'calendar_id',coalesce(nullif(i.meta_json->>'calendar_id',''),'primary'),'organization_id',i.organization_id,'profesional_id',i.profesional_id);
END $$;

CREATE FUNCTION public.google_apply_snapshot(p_id uuid,p_lease uuid,p_calendar text,p_timezone text,p_start timestamptz,p_end timestamptz,p_rows jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.integration; n_up int; n_del int; BEGIN
 SELECT x.* INTO i FROM public.integration x JOIN public.organization o ON o.id=x.organization_id AND o.deleted_at IS NULL AND NOT o.is_synthetic
 JOIN public.member m ON m.id=x.profesional_id AND m.organization_id=x.organization_id AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
 WHERE x.id=p_id AND x.proveedor='GOOGLE_CALENDAR' AND x.refresh_token_cifrado IS NOT NULL AND x.google_sync_lease=p_lease AND x.google_sync_lease_until>now() FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION 'google lease lost' USING ERRCODE='40001'; END IF;
 IF coalesce(nullif(i.meta_json->>'calendar_id',''),'primary')<>p_calendar OR NOT EXISTS(SELECT 1 FROM public.organization o WHERE o.id=i.organization_id AND coalesce(o.timezone,'America/Argentina/Cordoba')=p_timezone) THEN RAISE EXCEPTION 'google scope changed' USING ERRCODE='40001'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_rows IS NULL OR p_calendar IS NULL OR p_timezone IS NULL OR p_end<=p_start OR p_end>p_start+interval '32 days' OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>50000 THEN RAISE EXCEPTION 'invalid google snapshot' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(gcal_event_id text,inicio timestamptz,duracion_min int)
  WHERE r.gcal_event_id IS NULL OR length(r.gcal_event_id)>1100 OR r.inicio IS NULL OR r.inicio<p_start OR r.inicio>=p_end OR r.duracion_min IS NULL OR r.duracion_min NOT BETWEEN 5 AND 1440) THEN RAISE EXCEPTION 'invalid google snapshot row' USING ERRCODE='23514'; END IF;
 INSERT INTO public.bloqueo(organization_id,profesional_id,origen,gcal_event_id,inicio,duracion_min,titulo)
 SELECT i.organization_id,i.profesional_id,'google',r.gcal_event_id,r.inicio,r.duracion_min,'Ocupado (Google Calendar)'
 FROM jsonb_to_recordset(p_rows) AS r(gcal_event_id text,inicio timestamptz,duracion_min int)
 WHERE NOT EXISTS(SELECT 1 FROM public.turno t WHERE t.organization_id=i.organization_id AND t.profesional_id=i.profesional_id AND t.gcal_event_id=split_part(r.gcal_event_id,'#',1))
 AND NOT EXISTS(SELECT 1 FROM public.google_outbound_job j WHERE j.integration_id=i.id AND j.event_id=split_part(r.gcal_event_id,'#',1))
 ON CONFLICT(organization_id,profesional_id,gcal_event_id) DO UPDATE SET inicio=EXCLUDED.inicio,duracion_min=EXCLUDED.duracion_min,titulo=EXCLUDED.titulo;
 GET DIAGNOSTICS n_up=ROW_COUNT;
 DELETE FROM public.bloqueo b WHERE b.organization_id=i.organization_id AND b.profesional_id=i.profesional_id AND b.origen='google' AND b.inicio>=p_start AND b.inicio<p_end
 AND (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE r->>'gcal_event_id'=b.gcal_event_id)
 OR EXISTS(SELECT 1 FROM public.turno t WHERE t.organization_id=i.organization_id AND t.profesional_id=i.profesional_id AND t.gcal_event_id=split_part(b.gcal_event_id,'#',1))
 OR EXISTS(SELECT 1 FROM public.google_outbound_job j WHERE j.integration_id=i.id AND j.event_id=split_part(b.gcal_event_id,'#',1)));
 GET DIAGNOSTICS n_del=ROW_COUNT;
 UPDATE public.integration SET google_sync_lease=NULL,google_sync_lease_until=NULL,
  google_next_sync_at=CASE WHEN google_sync_requested<>google_sync_claimed THEN now() ELSE now()+interval '15 minutes' END,
  ultimo_uso_ts=now(),ultimo_error=NULL,ultimo_error_ts=NULL WHERE id=p_id;
 RETURN jsonb_build_object('upserted',n_up,'deleted',n_del);
END $$;
CREATE FUNCTION public.google_fail_inbound(p_id uuid,p_lease uuid,p_error text DEFAULT 'sync_failed') RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 UPDATE public.integration SET google_sync_lease=NULL,google_sync_lease_until=NULL,google_next_sync_at=now()+interval '1 minute',
 ultimo_error=CASE WHEN p_error='invalid_grant' THEN 'invalid_grant' ELSE 'sync_failed' END,ultimo_error_ts=now()
 WHERE id=p_id AND google_sync_lease=p_lease;
$$;

REVOKE ALL ON FUNCTION public.google_queue_turno(),public.google_queue_integration() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.google_claim_outbound(int,uuid),public.google_finish_outbound(uuid,uuid,boolean,text,boolean),public.google_claim_inbound(uuid,boolean),public.google_apply_snapshot(uuid,uuid,text,text,timestamptz,timestamptz,jsonb),public.google_fail_inbound(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.google_claim_outbound(int,uuid),public.google_finish_outbound(uuid,uuid,boolean,text,boolean),public.google_claim_inbound(uuid,boolean),public.google_apply_snapshot(uuid,uuid,text,text,timestamptz,timestamptz,jsonb),public.google_fail_inbound(uuid,uuid,text) TO service_role;

ALTER TABLE public.integration ADD COLUMN google_watch_next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE FUNCTION public.google_commit_watch(p_id uuid,p_calendar text,p_previous text,p_channel text,p_resource text,p_token text,p_expires timestamptz) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_channel IS NULL OR p_resource IS NULL OR p_token IS NULL OR length(p_token)<32 OR p_expires IS NULL OR p_expires<=now() THEN RETURN false; END IF;
 UPDATE public.integration SET meta_json=meta_json||jsonb_build_object('watch_channel_id',p_channel,'watch_resource_id',p_resource,'watch_token',p_token,'watch_expires_at',p_expires),
  google_next_sync_at=now(),google_watch_next_attempt_at=now()+interval '1 day',ultimo_error=NULL,ultimo_error_ts=NULL
 WHERE id=p_id AND proveedor='GOOGLE_CALENDAR' AND refresh_token_cifrado IS NOT NULL AND EXISTS(SELECT 1 FROM public.organization o JOIN public.member m ON m.organization_id=o.id WHERE o.id=integration.organization_id AND m.id=integration.profesional_id AND o.deleted_at IS NULL AND NOT o.is_synthetic AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)) AND coalesce(nullif(meta_json->>'calendar_id',''),'primary')=p_calendar AND (meta_json->>'watch_channel_id') IS NOT DISTINCT FROM p_previous;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.google_commit_watch(uuid,text,text,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.google_commit_watch(uuid,text,text,text,text,text,timestamptz) TO service_role;

-- Only currently enabled scopes participate in the fair recovery scan.
CREATE FUNCTION public.google_due_integrations(p_limit int DEFAULT 10,p_watch boolean DEFAULT false) RETURNS SETOF public.integration
 LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT i.* FROM public.integration i JOIN public.organization o ON o.id=i.organization_id AND o.deleted_at IS NULL AND NOT o.is_synthetic
 JOIN public.member m ON m.id=i.profesional_id AND m.organization_id=i.organization_id AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
 WHERE i.proveedor='GOOGLE_CALENDAR' AND i.refresh_token_cifrado IS NOT NULL
 AND (CASE WHEN p_watch THEN i.google_watch_next_attempt_at ELSE i.google_next_sync_at END)<=now()
 AND (p_watch OR i.google_sync_lease_until IS NULL OR i.google_sync_lease_until<=now())
 ORDER BY CASE WHEN p_watch THEN i.google_watch_next_attempt_at ELSE i.google_next_sync_at END,i.id LIMIT greatest(1,least(p_limit,20));
$$;
REVOKE ALL ON FUNCTION public.google_due_integrations(int,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.google_due_integrations(int,boolean) TO service_role;

-- Resume already connected scopes without copying patient information or writing to Google.
INSERT INTO public.google_outbound_job(organization_id,integration_id,turno_id,calendar_id,event_id)
SELECT t.organization_id,i.id,t.id,coalesce(nullif(i.meta_json->>'calendar_id',''),'primary'),
 coalesce(t.gcal_event_id,'f'||md5(i.id::text||':'||t.id::text||':'||coalesce(nullif(i.meta_json->>'calendar_id',''),'primary')))
FROM public.turno t JOIN public.integration i ON i.organization_id=t.organization_id AND i.profesional_id=t.profesional_id
JOIN public.member m ON m.id=i.profesional_id AND m.organization_id=i.organization_id AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
JOIN public.organization o ON o.id=i.organization_id AND o.deleted_at IS NULL AND NOT o.is_synthetic
WHERE i.proveedor='GOOGLE_CALENDAR' AND i.refresh_token_cifrado IS NOT NULL AND t.inicio>=now()-interval '1 day'
ON CONFLICT(integration_id,turno_id,calendar_id) DO NOTHING;

-- Background workers have no human actor. Revalidate their current persisted
-- authority immediately before provider I/O, including after a queued claim.
CREATE FUNCTION public.google_integration_access(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.integration i
 JOIN public.organization o ON o.id=i.organization_id AND o.deleted_at IS NULL AND NOT o.is_synthetic
 JOIN public.member m ON m.id=i.profesional_id AND m.organization_id=i.organization_id AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
 WHERE i.id=p_id AND i.proveedor='GOOGLE_CALENDAR' AND i.refresh_token_cifrado IS NOT NULL);
$$;
CREATE FUNCTION public.google_outbound_access(p_id uuid,p_lease uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.google_outbound_job j JOIN public.integration i ON i.id=j.integration_id AND i.organization_id=j.organization_id
 WHERE j.id=p_id AND j.lease_token=p_lease AND j.status='leased' AND j.lease_until>now()
 AND j.desired_version=j.claimed_version AND coalesce(nullif(i.meta_json->>'calendar_id',''),'primary')=j.calendar_id
 AND public.google_integration_access(i.id));
$$;
REVOKE ALL ON FUNCTION public.google_integration_access(uuid),public.google_outbound_access(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.google_integration_access(uuid),public.google_outbound_access(uuid,uuid) TO service_role;
