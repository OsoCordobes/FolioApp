BEGIN;
CREATE SCHEMA folio_operations_private;
REVOKE ALL ON SCHEMA folio_operations_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE folio_operations_private.operator_account(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,granted_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,revoked_at timestamptz,reference text NOT NULL);
CREATE TABLE folio_operations_private.operator_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,user_id uuid NOT NULL,enabled boolean NOT NULL,changed_at timestamptz NOT NULL DEFAULT now(),reference text NOT NULL);
CREATE TABLE folio_operations_private.policy(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),warning_percent int NOT NULL DEFAULT 60,pause_percent int NOT NULL DEFAULT 70,backup_max_age_hours int NOT NULL DEFAULT 24 CHECK(backup_max_age_hours=24),CHECK(warning_percent>0 AND warning_percent<pause_percent AND pause_percent<=100));
INSERT INTO folio_operations_private.policy(singleton) VALUES(true);
CREATE TABLE folio_operations_private.quota(metric text PRIMARY KEY CHECK(metric IN('database_bytes','storage_bytes','active_members','email_accepted_month')),limit_value bigint NOT NULL CHECK(limit_value>0),verified_at timestamptz NOT NULL DEFAULT now(),valid_until timestamptz NOT NULL,reference text NOT NULL);
CREATE TABLE folio_operations_private.backup_report(run_id uuid PRIMARY KEY,reported_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz NOT NULL,finished_at timestamptz NOT NULL,outcome text NOT NULL CHECK(outcome IN('success','partial','failed')),archive_bytes bigint NOT NULL CHECK(archive_bytes>=0),object_count bigint NOT NULL CHECK(object_count>=0),integrity_verified boolean NOT NULL,restore_scope text NOT NULL CHECK(restore_scope IN('none','structure','full')),restore_verified_at timestamptz,content_hash text NOT NULL);
ALTER TABLE folio_operations_private.operator_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_operations_private.operator_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_operations_private.policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_operations_private.quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_operations_private.backup_report ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA folio_operations_private FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION folio_operations_private.assert_operator() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE security jsonb;BEGIN
 PERFORM folio_mfa_private.assert_access();
 security:=public.mfa_access_status();
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'aal','')<>'aal2' OR NOT coalesce((security->>'sessionValid')::boolean,false) OR NOT coalesce((security->>'hasVerifiedFactor')::boolean,false) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Verified operator session required';END IF;
 PERFORM 1 FROM folio_operations_private.operator_account WHERE user_id=auth.uid() AND revoked_at IS NULL AND expires_at>now() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Operator access required';END IF;
END $$;
CREATE FUNCTION public.operations_set_operator(p_user uuid,p_enabled boolean,p_expires_at timestamptz,p_reference text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF p_user IS NULL OR p_enabled IS NULL OR coalesce(p_reference,'')!~'^[A-Z0-9_:-]{8,80}$' OR (p_enabled AND (p_expires_at IS NULL OR p_expires_at<=now() OR p_expires_at>now()+interval '366 days')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Reviewed operator grant required';END IF;
 IF p_enabled THEN
  INSERT INTO folio_operations_private.operator_account(user_id,expires_at,reference) VALUES(p_user,p_expires_at,p_reference) ON CONFLICT(user_id) DO UPDATE SET granted_at=now(),expires_at=excluded.expires_at,revoked_at=NULL,reference=excluded.reference;
 ELSE UPDATE folio_operations_private.operator_account SET revoked_at=now(),reference=p_reference WHERE user_id=p_user;END IF;
 INSERT INTO folio_operations_private.operator_history(user_id,enabled,reference) VALUES(p_user,p_enabled,p_reference);
END $$;
CREATE FUNCTION public.operations_set_quota(p_metric text,p_limit bigint,p_valid_until timestamptz,p_reference text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF p_metric NOT IN('database_bytes','storage_bytes','active_members','email_accepted_month') OR p_metric IS NULL OR p_limit IS NULL OR p_limit<=0 OR p_valid_until IS NULL OR p_valid_until<=now() OR p_valid_until>now()+interval '93 days' OR coalesce(p_reference,'')!~'^[A-Z0-9_:-]{8,80}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Verified capacity reference required';END IF;
 INSERT INTO folio_operations_private.quota(metric,limit_value,valid_until,reference) VALUES(p_metric,p_limit,p_valid_until,p_reference) ON CONFLICT(metric) DO UPDATE SET limit_value=excluded.limit_value,valid_until=excluded.valid_until,reference=excluded.reference,verified_at=now();
END $$;
CREATE FUNCTION public.operations_report_backup(p_run uuid,p_started_at timestamptz,p_finished_at timestamptz,p_outcome text,p_archive_bytes bigint,p_object_count bigint,p_integrity_verified boolean,p_restore_scope text,p_restore_verified_at timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE fingerprint text;prior text;BEGIN
 IF p_run IS NULL OR p_started_at IS NULL OR p_finished_at IS NULL OR p_finished_at<p_started_at OR p_finished_at>now()+interval '5 minutes' OR p_outcome IS NULL OR p_outcome NOT IN('success','partial','failed') OR p_archive_bytes IS NULL OR p_archive_bytes<0 OR p_object_count IS NULL OR p_object_count<0 OR p_integrity_verified IS NULL OR p_restore_scope IS NULL OR p_restore_scope NOT IN('none','structure','full') OR (p_restore_scope='none' AND p_restore_verified_at IS NOT NULL) OR (p_restore_scope<>'none' AND (p_restore_verified_at IS NULL OR p_restore_verified_at>now()+interval '5 minutes' OR p_restore_verified_at<p_started_at)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Valid metadata-only backup report required';END IF;
 -- Equal instants have the same receipt regardless of the reporter's SQL time zone.
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(extract(epoch FROM p_started_at),extract(epoch FROM p_finished_at),p_outcome,p_archive_bytes,p_object_count,p_integrity_verified,p_restore_scope,extract(epoch FROM p_restore_verified_at))::text,'UTF8')),'hex');
 INSERT INTO folio_operations_private.backup_report(run_id,started_at,finished_at,outcome,archive_bytes,object_count,integrity_verified,restore_scope,restore_verified_at,content_hash) VALUES(p_run,p_started_at,p_finished_at,p_outcome,p_archive_bytes,p_object_count,p_integrity_verified,p_restore_scope,p_restore_verified_at,fingerprint) ON CONFLICT DO NOTHING;
 SELECT content_hash INTO prior FROM folio_operations_private.backup_report WHERE run_id=p_run;
 IF prior<>fingerprint THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Backup report identity changed';END IF;
END $$;
CREATE FUNCTION public.operations_snapshot() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='1s' AS $$
DECLARE queues jsonb:='[]';metrics jsonb:='[]';item jsonb;source text;table_name text;value bigint;bad bigint;limit_row folio_operations_private.quota;policy folio_operations_private.policy;backup jsonb;report folio_operations_private.backup_report;last_verified_at timestamptz;BEGIN
 PERFORM folio_mfa_private.assert_access();PERFORM folio_operations_private.assert_operator();
 SELECT * INTO policy FROM folio_operations_private.policy WHERE singleton;
 FOREACH source IN ARRAY ARRAY['billing_followup','email_delivery','google_outbound','booking_followup','billing_provider','billing_webhook'] LOOP
  BEGIN
   table_name:=CASE source WHEN 'billing_followup' THEN 'billing_followup_job' WHEN 'email_delivery' THEN 'email_delivery' WHEN 'google_outbound' THEN 'google_outbound_job' WHEN 'booking_followup' THEN 'booking_followup_job' WHEN 'billing_provider' THEN 'billing_provider_operation' WHEN 'billing_webhook' THEN 'billing_webhook_receipt' END;
   EXECUTE format($q$SELECT jsonb_build_object('key',$1,'state','known','pending',count(*) FILTER(WHERE status IN('pending','retryable')),'leased',count(*) FILTER(WHERE status IN('leased','processing')),'terminal',count(*) FILTER(WHERE status='terminal'),'uncertain',count(*) FILTER(WHERE status='uncertain'),'due',count(*) FILTER(WHERE status IN('pending','retryable','leased','processing','uncertain') AND available_at<=now() AND (lease_until IS NULL OR lease_until<=now())),'oldestPendingAt',min(created_at) FILTER(WHERE status IN('pending','retryable','leased','processing','uncertain'))) FROM public.%I$q$,table_name) INTO item USING source;
  EXCEPTION WHEN OTHERS THEN item:=jsonb_build_object('key',source,'state','unknown','code','source_error');END;
  queues:=queues||jsonb_build_array(item);
 END LOOP;
 FOREACH source IN ARRAY ARRAY['database_bytes','storage_bytes','active_members','email_accepted_month'] LOOP
  BEGIN
   value:=NULL;
   CASE source
    WHEN 'database_bytes' THEN value:=pg_database_size(current_database());
    WHEN 'storage_bytes' THEN
     SELECT count(*) FILTER(WHERE coalesce(metadata->>'size','')!~'^[0-9]{1,16}$'),coalesce(sum(CASE WHEN metadata->>'size'~'^[0-9]{1,16}$' THEN (metadata->>'size')::bigint ELSE 0 END),0)::bigint INTO bad,value FROM storage.objects;
     IF bad>0 THEN value:=NULL;END IF;
    WHEN 'active_members' THEN SELECT count(*) INTO value FROM public.member m JOIN public.organization o ON o.id=m.organization_id WHERE m.deleted_at IS NULL AND o.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL);
    WHEN 'email_accepted_month' THEN SELECT count(*) INTO value FROM public.email_delivery WHERE accepted_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND accepted_at<=now() AND status IN('accepted','delivered');
   END CASE;
   SELECT * INTO limit_row FROM folio_operations_private.quota WHERE metric=source AND valid_until>now();
   item:=jsonb_build_object('key',source,'state',CASE WHEN value IS NULL THEN 'unknown' ELSE 'known' END,'value',value,'limit',limit_row.limit_value,'limitVerifiedAt',limit_row.verified_at,'limitValidUntil',limit_row.valid_until);
  EXCEPTION WHEN OTHERS THEN item:=jsonb_build_object('key',source,'state','unknown','code','source_error','value',NULL,'limit',NULL);END;
  metrics:=metrics||jsonb_build_array(item);
 END LOOP;
 BEGIN
  SELECT max(finished_at) INTO last_verified_at FROM folio_operations_private.backup_report WHERE outcome IN('success','partial') AND integrity_verified AND archive_bytes>0;
  SELECT * INTO report FROM folio_operations_private.backup_report ORDER BY finished_at DESC,reported_at DESC LIMIT 1;
  IF NOT FOUND THEN backup:=jsonb_build_object('state','no_report');
  ELSE backup:=jsonb_build_object('state','reported','outcome',report.outcome,'finishedAt',report.finished_at,'reportedAt',report.reported_at,'lastVerifiedAt',last_verified_at,'stale',last_verified_at IS NULL OR last_verified_at<now()-make_interval(hours=>policy.backup_max_age_hours),'archiveBytes',report.archive_bytes,'objectCount',report.object_count,'integrityVerified',report.integrity_verified,'restoreScope',report.restore_scope,'restoreVerifiedAt',report.restore_verified_at);END IF;
 EXCEPTION WHEN OTHERS THEN backup:=jsonb_build_object('state','unknown','code','source_error');END;
 RETURN jsonb_build_object('generatedAt',now(),'warningPercent',policy.warning_percent,'pausePercent',policy.pause_percent,'backupMaxAgeHours',policy.backup_max_age_hours,'queues',queues,'metrics',metrics,'backup',backup);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA folio_operations_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.operations_snapshot() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.operations_snapshot() TO authenticated;
REVOKE ALL ON FUNCTION public.operations_set_operator(uuid,boolean,timestamptz,text),public.operations_set_quota(text,bigint,timestamptz,text),public.operations_report_backup(uuid,timestamptz,timestamptz,text,bigint,bigint,boolean,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.operations_set_operator(uuid,boolean,timestamptz,text),public.operations_set_quota(text,bigint,timestamptz,text),public.operations_report_backup(uuid,timestamptz,timestamptz,text,bigint,bigint,boolean,text,timestamptz) TO service_role;
COMMIT;
