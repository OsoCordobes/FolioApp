-- M139: reception caller. No clinical state transition, PII or exposed table.
-- All rows remain in an unexposed schema; the public functions are invoker-only.
CREATE SCHEMA folio_caller_private;
REVOKE ALL ON SCHEMA folio_caller_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE folio_caller_private.ticket (
 organization_id uuid NOT NULL REFERENCES public.organization(id),
 local_day date NOT NULL,
 turno_id uuid NOT NULL REFERENCES public.turno(id),
 sequence_no integer NOT NULL CHECK (sequence_no BETWEEN 1 AND 9999),
 code text NOT NULL CHECK (code ~ '^A[0-9]{4}$'),
 issued_by uuid NOT NULL REFERENCES public.member(id),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (organization_id,local_day,turno_id),
 UNIQUE (organization_id,local_day,sequence_no),
 UNIQUE (organization_id,local_day,code)
);
CREATE TABLE folio_caller_private.display_clock (
 organization_id uuid PRIMARY KEY REFERENCES public.organization(id),
 cursor_no bigint NOT NULL DEFAULT 0 CHECK (cursor_no >= 0)
);
CREATE TABLE folio_caller_private.call_event (
 organization_id uuid NOT NULL REFERENCES public.organization(id),
 cursor_no bigint NOT NULL,
 operation_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.member(id),
 turno_id uuid NOT NULL REFERENCES public.turno(id),
 local_day date NOT NULL,
 code text NOT NULL,
 destination_kind text NOT NULL CHECK (destination_kind IN ('RECEPCION','CONSULTORIO')),
 room_number integer CHECK (room_number BETWEEN 1 AND 99),
 called_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (organization_id,cursor_no),
 UNIQUE (organization_id,operation_id),
 FOREIGN KEY (organization_id,local_day,turno_id)
   REFERENCES folio_caller_private.ticket(organization_id,local_day,turno_id),
 CHECK ((destination_kind='RECEPCION' AND room_number IS NULL)
     OR (destination_kind='CONSULTORIO' AND room_number IS NOT NULL))
);
CREATE INDEX call_event_org_recent_idx ON folio_caller_private.call_event(organization_id,local_day,cursor_no DESC);
CREATE TABLE folio_caller_private.screen (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES public.organization(id),
 issuer_id uuid NOT NULL REFERENCES public.member(id),
 operation_id uuid NOT NULL,
 pair_hash bytea NOT NULL UNIQUE,
 pair_expires_at timestamptz NOT NULL,
 pair_used_at timestamptz,
 token_hash bytea UNIQUE,
 token_expires_at timestamptz,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (organization_id,issuer_id,operation_id),
 CHECK ((token_hash IS NULL AND token_expires_at IS NULL) OR
        (token_hash IS NOT NULL AND token_expires_at IS NOT NULL))
);
CREATE INDEX screen_org_idx ON folio_caller_private.screen(organization_id);
ALTER TABLE folio_caller_private.ticket ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_caller_private.display_clock ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_caller_private.call_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_caller_private.screen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA folio_caller_private FROM PUBLIC,anon,authenticated,service_role;

-- Shared current-authority gate. Reception retains M122's explicit current AAL2
-- requirement; owners/directors and clinicians retain the active MFA policy.
CREATE FUNCTION folio_caller_private.random_hex(p_bytes integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE extension_schema text; result text;
BEGIN
 IF p_bytes NOT IN (8,32) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Unsupported caller secret size';
 END IF;
 -- pgcrypto is in public on vanilla PG16 and extensions on hosted Supabase.
 -- Resolve the actual extension-owned function, never caller search_path.
 SELECT n.nspname INTO extension_schema FROM pg_extension e
 JOIN pg_depend d ON d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid
  AND d.classid='pg_proc'::regclass AND d.deptype='e'
 JOIN pg_proc p ON p.oid=d.objid AND p.proname='gen_random_bytes'
  AND p.pronargs=1 AND p.proargtypes[0]=23
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE e.extname='pgcrypto';
 IF NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='pgcrypto random source unavailable';
 END IF;
 EXECUTE format('SELECT pg_catalog.encode(%I.gen_random_bytes($1),''hex'')',extension_schema)
  INTO result USING p_bytes;
 RETURN result;
END $$;

CREATE FUNCTION folio_caller_private.staff(p_org uuid,p_pair boolean DEFAULT false)
RETURNS public.member LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; mfa jsonb;
BEGIN
 IF p_org IS NULL OR auth.uid() IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current staff required';
 END IF;
 PERFORM folio_mfa_private.assert_access();
 PERFORM 1 FROM public.organization WHERE id=p_org AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current organization required';END IF;
 SELECT * INTO actor FROM public.member WHERE organization_id=p_org AND profile_id=auth.uid()
   AND deleted_at IS NULL AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
 IF NOT FOUND OR actor.role NOT IN ('OWNER','DIRECTOR','PROFESIONAL','ASISTENTE','COORDINADOR')
  OR (p_pair AND actor.role NOT IN ('OWNER','DIRECTOR')) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current accepted staff role required';
 END IF;
 IF p_pair OR actor.role IN ('ASISTENTE','COORDINADOR') THEN
  mfa:=public.mfa_access_status();
  IF (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2'
   OR (mfa->>'allowed')::boolean IS DISTINCT FROM true
   OR (mfa->>'isStaff')::boolean IS DISTINCT FROM true
   OR (mfa->>'hasVerifiedFactor')::boolean IS DISTINCT FROM true
   OR (mfa->>'sessionValid')::boolean IS DISTINCT FROM true THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current verified staff required';
  END IF;
 END IF;
 RETURN actor;
END $$;

-- Row locks follow organization -> actor -> professional -> turno -> patient ->
-- identity as in M117/M119. SHARE blocks a competing turno UPDATE; M106's
-- turno-first path can therefore wait, while its later org/member SHARE locks
-- are compatible with ours. Cross-path deadlocks remain possible with other
-- concurrent writers: propagate 40P01/55P03 and inspect the same operation,
-- never blindly retry with a new ID.
CREATE FUNCTION folio_caller_private.current_turn(p_org uuid,p_turno uuid,p_actor public.member,p_require_waiting boolean)
RETURNS public.turno LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.turno; target public.member; target_id uuid; patient public.paciente; tz text;
BEGIN
 IF p_turno IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Turn required';END IF;
 SELECT timezone INTO tz FROM public.organization WHERE id=p_org AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current organization required';END IF;
 -- Target is read before locking the turno, then checked again after the lock.
 SELECT profesional_id INTO target_id FROM public.turno WHERE id=p_turno AND organization_id=p_org;
 SELECT * INTO target FROM public.member WHERE id=target_id AND organization_id=p_org
  AND deleted_at IS NULL AND es_colegiado AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current professional required';END IF;
 IF (p_actor.role IN ('OWNER','DIRECTOR')
  OR (p_actor.role='PROFESIONAL' AND p_actor.id=target.id)
  OR (p_actor.role IN ('ASISTENTE','COORDINADOR') AND public.user_has_scope_over(p_org,target.id))) IS DISTINCT FROM true THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current professional scope required';
 END IF;
 SELECT * INTO t FROM public.turno WHERE id=p_turno AND organization_id=p_org AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR t.profesional_id IS DISTINCT FROM target.id THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current visit scope required';
 END IF;
 IF p_require_waiting IS DISTINCT FROM false AND (t.estado::text <> 'EN_SALA'
  OR (timezone(tz,t.inicio))::date IS DISTINCT FROM (timezone(tz,clock_timestamp()))::date) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Visit is no longer waiting today';
 END IF;
 SELECT * INTO patient FROM public.paciente WHERE id=t.paciente_id AND organization_id=p_org
  AND deleted_at IS NULL AND pseudonimizado_en IS NULL AND caja_fuerte_profesional IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current patient required';END IF;
 PERFORM 1 FROM public.paciente_identidad WHERE id=patient.identidad_id AND organization_id=p_org
  AND deleted_at IS NULL AND NOT public.has_caja_fuerte_blocking_access(id,p_org) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current identity required';END IF;
 RETURN t;
END $$;

CREATE FUNCTION folio_caller_private.issue_code(p_org uuid,p_turno uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; t public.turno; day date; tz text; prior folio_caller_private.ticket; n integer;
BEGIN
 actor:=folio_caller_private.staff(p_org,false);
 t:=folio_caller_private.current_turn(p_org,p_turno,actor,true);
 SELECT timezone INTO tz FROM public.organization WHERE id=p_org;
 day:=(timezone(tz,t.inicio))::date;
 -- One sequence per organization/local day, without an organization row UPDATE.
 PERFORM pg_advisory_xact_lock(hashtextextended('caller-code:'||p_org::text||':'||day::text,0));
 SELECT * INTO prior FROM folio_caller_private.ticket WHERE organization_id=p_org AND local_day=day AND turno_id=p_turno;
 IF FOUND THEN RETURN jsonb_build_object('code',prior.code,'reused',true);END IF;
 SELECT coalesce(max(sequence_no),0)+1 INTO n FROM folio_caller_private.ticket
  WHERE organization_id=p_org AND local_day=day;
 IF n>9999 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='Daily calling code capacity reached';END IF;
 INSERT INTO folio_caller_private.ticket(organization_id,local_day,turno_id,sequence_no,code,issued_by)
  VALUES(p_org,day,p_turno,n,'A'||lpad(n::text,4,'0'),actor.id);
 RETURN jsonb_build_object('code','A'||lpad(n::text,4,'0'),'reused',false);
END $$;

CREATE FUNCTION folio_caller_private.call_turn(p_org uuid,p_operation uuid,p_turno uuid,p_kind text,p_room integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; t public.turno; day date; tz text; ticket folio_caller_private.ticket;
 prior folio_caller_private.call_event; n bigint; label text;
BEGIN
 IF p_operation IS NULL OR ((p_kind='RECEPCION' AND p_room IS NULL)
  OR (p_kind='CONSULTORIO' AND p_room BETWEEN 1 AND 99)) IS DISTINCT FROM true THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Explicit operation and structured destination required';
 END IF;
 actor:=folio_caller_private.staff(p_org,false);
 PERFORM pg_advisory_xact_lock(hashtextextended('caller-operation:'||p_org::text||':'||p_operation::text,0));
 SELECT * INTO prior FROM folio_caller_private.call_event WHERE organization_id=p_org AND operation_id=p_operation;
 IF FOUND THEN
  -- Recovery confirms a committed call even if care began or the appointment
  -- was canceled afterward. Current actor/target/patient authority still holds.
  t:=folio_caller_private.current_turn(p_org,p_turno,actor,false);
  IF prior.actor_id IS DISTINCT FROM actor.id OR prior.turno_id IS DISTINCT FROM p_turno
   OR prior.destination_kind IS DISTINCT FROM p_kind OR prior.room_number IS DISTINCT FROM p_room THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Operation reused for different call';
  END IF;
  label:=CASE WHEN prior.destination_kind='RECEPCION' THEN 'Recepción'
    ELSE 'Consultorio '||prior.room_number::text END;
  RETURN jsonb_build_object('code',prior.code,'destination',label,'cursor',prior.cursor_no,'reused',true);
 END IF;
 t:=folio_caller_private.current_turn(p_org,p_turno,actor,true);
 SELECT timezone INTO tz FROM public.organization WHERE id=p_org;
 day:=(timezone(tz,t.inicio))::date;
 SELECT * INTO ticket FROM folio_caller_private.ticket
  WHERE organization_id=p_org AND local_day=day AND turno_id=p_turno;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Issue the waiting code first';END IF;
 INSERT INTO folio_caller_private.display_clock(organization_id) VALUES(p_org) ON CONFLICT DO NOTHING;
 UPDATE folio_caller_private.display_clock SET cursor_no=cursor_no+1
  WHERE organization_id=p_org RETURNING cursor_no INTO n;
 INSERT INTO folio_caller_private.call_event(organization_id,cursor_no,operation_id,actor_id,turno_id,local_day,code,destination_kind,room_number)
  VALUES(p_org,n,p_operation,actor.id,p_turno,day,ticket.code,p_kind,p_room);
 label:=CASE WHEN p_kind='RECEPCION' THEN 'Recepción' ELSE 'Consultorio '||p_room::text END;
 RETURN jsonb_build_object('code',ticket.code,'destination',label,'cursor',n,'reused',false);
END $$;

CREATE FUNCTION folio_caller_private.create_pair(p_org uuid,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; prior folio_caller_private.screen; code text; new_id uuid; expiry timestamptz;
BEGIN
 IF p_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Explicit pairing operation required';END IF;
 actor:=folio_caller_private.staff(p_org,true);
 -- One pending pairing per issuer/org. A new explicit operation invalidates
 -- the previous unconsumed code, including a code whose response was lost.
 PERFORM pg_advisory_xact_lock(hashtextextended('caller-pair:'||p_org::text||':'||actor.id::text,0));
 SELECT * INTO prior FROM folio_caller_private.screen WHERE organization_id=p_org AND issuer_id=actor.id AND operation_id=p_operation;
 IF FOUND THEN RETURN jsonb_build_object('screenId',prior.id,'alreadyIssued',true);END IF;
 UPDATE folio_caller_private.screen SET revoked_at=clock_timestamp()
  WHERE organization_id=p_org AND issuer_id=actor.id AND pair_used_at IS NULL AND revoked_at IS NULL;
 code:=folio_caller_private.random_hex(8);
 expiry:=clock_timestamp()+interval '5 minutes';
 INSERT INTO folio_caller_private.screen(organization_id,issuer_id,operation_id,pair_hash,pair_expires_at)
  VALUES(p_org,actor.id,p_operation,pg_catalog.sha256(convert_to(code,'UTF8')),expiry)
  RETURNING id INTO new_id;
 RETURN jsonb_build_object('screenId',new_id,'pairCode',code,'expiresAt',expiry,'alreadyIssued',false);
END $$;

CREATE FUNCTION folio_caller_private.revoke_screen(p_org uuid,p_screen uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member;
BEGIN
 IF p_screen IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Screen required';END IF;
 actor:=folio_caller_private.staff(p_org,true);
 UPDATE folio_caller_private.screen SET revoked_at=clock_timestamp()
  WHERE id=p_screen AND organization_id=p_org AND revoked_at IS NULL;
 IF FOUND THEN RETURN true;END IF;
 PERFORM 1 FROM folio_caller_private.screen WHERE id=p_screen AND organization_id=p_org;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Screen unavailable';END IF;
 RETURN false;
END $$;

CREATE FUNCTION folio_caller_private.pair_screen(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s folio_caller_private.screen; token text;
BEGIN
 IF auth.uid() IS NOT NULL OR auth.role() IS DISTINCT FROM 'anon' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Dedicated anonymous screen required';
 END IF;
 IF coalesce(p_code,'') !~ '^[a-f0-9]{16}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid pairing code';
 END IF;
 SELECT * INTO s FROM folio_caller_private.screen WHERE pair_hash=pg_catalog.sha256(convert_to(p_code,'UTF8')) FOR UPDATE;
 IF NOT FOUND OR s.revoked_at IS NOT NULL OR s.pair_used_at IS NOT NULL
  OR s.pair_expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Pairing unavailable';
 END IF;
 PERFORM 1 FROM public.organization WHERE id=s.organization_id AND deleted_at IS NULL;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.member m WHERE m.id=s.issuer_id AND m.organization_id=s.organization_id
  AND m.role IN ('OWNER','DIRECTOR') AND m.deleted_at IS NULL
  AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Pairing issuer unavailable';
 END IF;
 token:=folio_caller_private.random_hex(32);
 UPDATE folio_caller_private.screen SET pair_used_at=clock_timestamp(),
  token_hash=pg_catalog.sha256(convert_to(token,'UTF8')),
  token_expires_at=clock_timestamp()+interval '12 hours' WHERE id=s.id;
 RETURN jsonb_build_object('screenId',s.id,'organizationId',s.organization_id,'token',token,
  'expiresAt',clock_timestamp()+interval '12 hours');
END $$;

CREATE FUNCTION folio_caller_private.screen_read(p_org uuid,p_token text,p_cursor bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s folio_caller_private.screen; current_cursor bigint; oldest bigint; calls jsonb; tz text;
BEGIN
 IF auth.uid() IS NOT NULL OR auth.role() IS DISTINCT FROM 'anon' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Dedicated anonymous screen required';
 END IF;
 IF p_org IS NULL OR coalesce(p_token,'') !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Screen unavailable';
 END IF;
 -- FOR SHARE is the revocation barrier: a committed revoke wins before read;
 -- a concurrent revoke waits for this read, then the next request rejects.
 SELECT * INTO s FROM folio_caller_private.screen
  WHERE organization_id=p_org AND token_hash=pg_catalog.sha256(convert_to(p_token,'UTF8')) FOR SHARE;
 IF NOT FOUND OR s.revoked_at IS NOT NULL OR s.token_expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Screen unavailable';
 END IF;
 SELECT timezone INTO tz FROM public.organization WHERE id=p_org AND deleted_at IS NULL;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.member m WHERE m.id=s.issuer_id
  AND m.organization_id=p_org AND m.role IN ('OWNER','DIRECTOR') AND m.deleted_at IS NULL
  AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Screen issuer unavailable';
 END IF;
 SELECT coalesce(cursor_no,0) INTO current_cursor FROM folio_caller_private.display_clock WHERE organization_id=p_org;
 current_cursor:=coalesce(current_cursor,0);
 -- Full, bounded snapshot on every read. Clients use cursor to decide whether
 -- a new call is audible; reconnection is silent regardless of cursor.
 WITH latest AS (
  SELECT DISTINCT ON (e.code) e.code,e.cursor_no,e.destination_kind,e.room_number,e.called_at
  FROM folio_caller_private.call_event e
  JOIN public.turno t ON t.id=e.turno_id AND t.organization_id=p_org AND t.deleted_at IS NULL
    AND t.estado::text='EN_SALA' AND (timezone(tz,t.inicio))::date=(timezone(tz,clock_timestamp()))::date
  JOIN public.member m ON m.id=t.profesional_id AND m.organization_id=p_org AND m.deleted_at IS NULL
    AND m.es_colegiado AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
  JOIN public.paciente p ON p.id=t.paciente_id AND p.organization_id=p_org AND p.deleted_at IS NULL
    AND p.pseudonimizado_en IS NULL AND p.caja_fuerte_profesional IS NULL
  JOIN public.paciente_identidad pi ON pi.id=p.identidad_id AND pi.organization_id=p_org
    AND pi.deleted_at IS NULL AND NOT public.has_caja_fuerte_blocking_access(pi.id,p_org)
  WHERE e.organization_id=p_org AND e.local_day=(timezone(tz,clock_timestamp()))::date
  ORDER BY e.code,e.cursor_no DESC
 ), top20 AS (SELECT * FROM latest ORDER BY cursor_no DESC LIMIT 20)
 SELECT coalesce(jsonb_agg(jsonb_build_object('code',code,'destination',
   CASE WHEN destination_kind='RECEPCION' THEN 'Recepción' ELSE 'Consultorio '||room_number::text END,
   'cursor',cursor_no) ORDER BY cursor_no DESC),'[]'::jsonb),min(cursor_no)
 INTO calls,oldest FROM top20;
 RETURN jsonb_build_object('cursor',current_cursor,'reset',
  p_cursor IS NULL OR p_cursor<0 OR p_cursor>current_cursor OR (oldest IS NOT NULL AND p_cursor<oldest-1),
  'snapshot',calls);
END $$;

-- The private implementation has no default EXECUTE and no table grants.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA folio_caller_private FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA folio_caller_private TO anon,authenticated;
GRANT EXECUTE ON FUNCTION folio_caller_private.issue_code(uuid,uuid),
 folio_caller_private.call_turn(uuid,uuid,uuid,text,integer),
 folio_caller_private.create_pair(uuid,uuid),
 folio_caller_private.revoke_screen(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION folio_caller_private.pair_screen(text),
 folio_caller_private.screen_read(uuid,text,bigint) TO anon;

CREATE FUNCTION public.caller_issue_code(p_org uuid,p_turno uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT folio_caller_private.issue_code(p_org,p_turno)
$$;
CREATE FUNCTION public.caller_call(p_org uuid,p_operation uuid,p_turno uuid,p_kind text,p_room integer DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT folio_caller_private.call_turn(p_org,p_operation,p_turno,p_kind,p_room)
$$;
CREATE FUNCTION public.caller_create_pair(p_org uuid,p_operation uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT folio_caller_private.create_pair(p_org,p_operation)
$$;
CREATE FUNCTION public.caller_revoke_screen(p_org uuid,p_screen uuid) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT folio_caller_private.revoke_screen(p_org,p_screen)
$$;
CREATE FUNCTION public.caller_pair(p_code text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT folio_caller_private.pair_screen(p_code)
$$;
CREATE FUNCTION public.caller_screen_read(p_org uuid,p_token text,p_cursor bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT folio_caller_private.screen_read(p_org,p_token,p_cursor)
$$;
REVOKE ALL ON FUNCTION public.caller_issue_code(uuid,uuid),public.caller_call(uuid,uuid,uuid,text,integer),
 public.caller_create_pair(uuid,uuid),public.caller_revoke_screen(uuid,uuid),
 public.caller_pair(text),public.caller_screen_read(uuid,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.caller_issue_code(uuid,uuid),public.caller_call(uuid,uuid,uuid,text,integer),
 public.caller_create_pair(uuid,uuid),public.caller_revoke_screen(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.caller_pair(text),public.caller_screen_read(uuid,text,bigint) TO anon;
