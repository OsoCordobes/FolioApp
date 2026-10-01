-- B09: durable optimistic fence for manual invitation issue/revoke.
-- M144/M146 are already applied and must remain byte-for-byte unchanged.
-- The application chooses a 32-byte random token and sends only its SHA-256.
-- Database functions cannot certify the entropy of a caller-chosen token.

CREATE TABLE folio_intake_private.link_state (
  turno_id uuid PRIMARY KEY REFERENCES public.turno(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0)
);
CREATE TABLE folio_intake_private.link_operation (
  turno_id uuid NOT NULL REFERENCES folio_intake_private.link_state(turno_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ISSUE','REVOKE')),
  actor_member_id uuid NOT NULL REFERENCES public.member(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  actor_session_id uuid NOT NULL,
  expected_generation bigint NOT NULL CHECK (expected_generation >= 0),
  expected_context text NOT NULL CHECK (expected_context ~ '^[0-9a-f]{64}$'),
  token_hash text CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  result_generation bigint NOT NULL CHECK (result_generation > 0),
  invitation_id uuid REFERENCES folio_intake_private.invitation(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  revoked boolean,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (turno_id,operation_id),
  CHECK ((kind='ISSUE' AND token_hash IS NOT NULL AND invitation_id IS NOT NULL AND revoked IS NULL)
    OR (kind='REVOKE' AND token_hash IS NULL AND revoked IS NOT NULL))
);
CREATE INDEX intake_link_operation_actor ON folio_intake_private.link_operation(actor_member_id,occurred_at DESC);
ALTER TABLE folio_intake_private.link_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_intake_private.link_operation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON folio_intake_private.link_state,folio_intake_private.link_operation
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION folio_intake_private.link_context_hash(p_ctx folio_intake_private.visit_context)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    (p_ctx).organization_id,(p_ctx).turno_id,(p_ctx).paciente_id,(p_ctx).identidad_id,
    (p_ctx).identity_link_revision,(p_ctx).organization_intake_revision,
    (p_ctx).paciente_intake_revision,(p_ctx).identidad_intake_revision,
    (p_ctx).profesional_id,extract(epoch FROM (p_ctx).turno_inicio),
    (p_ctx).turno_intake_revision)::text,'UTF8')),'hex')
$$;
REVOKE ALL ON FUNCTION folio_intake_private.link_context_hash(folio_intake_private.visit_context)
  FROM PUBLIC,anon,authenticated,service_role;

-- Under the same visit locks, serialize all link operations on one durable row.
CREATE FUNCTION folio_intake_private.lock_link_state(p_turno uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result bigint;
BEGIN
  INSERT INTO folio_intake_private.link_state(turno_id) VALUES(p_turno) ON CONFLICT DO NOTHING;
  SELECT generation INTO result FROM folio_intake_private.link_state
    WHERE turno_id=p_turno FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Intake link state unavailable'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION folio_intake_private.lock_link_state(uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.patient_intake_link_state(p_org uuid,p_turno uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; ctx folio_intake_private.visit_context;
  current_link folio_intake_private.invitation; current_generation bigint:=0;
  active_link boolean:=false;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  actor:=folio_intake_private.staff(p_org);
  ctx:=folio_intake_private.current_visit(p_org,p_turno,actor,true);
  SELECT generation INTO current_generation FROM folio_intake_private.link_state
    WHERE turno_id=ctx.turno_id FOR SHARE;
  current_generation:=coalesce(current_generation,0);
  SELECT * INTO current_link FROM folio_intake_private.invitation
    WHERE turno_id=ctx.turno_id AND revoked_at IS NULL;
  IF FOUND THEN active_link:=folio_intake_private.valid_invitation(current_link,ctx); END IF;
  RETURN jsonb_build_object('generation',current_generation::text,
    'contextHash',folio_intake_private.link_context_hash(ctx),
    'active',active_link,'invitationId',CASE WHEN active_link THEN current_link.id END,
    'expiresAt',CASE WHEN active_link THEN current_link.expires_at END);
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_link_state(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.patient_intake_link_state(uuid,uuid) TO authenticated;

CREATE FUNCTION public.patient_intake_issue_v2(
  p_org uuid,p_turno uuid,p_operation uuid,p_expected_generation bigint,
  p_expected_context text,p_token_hash text,p_fingerprint_key_cifrado bytea)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; ctx folio_intake_private.visit_context;
  current_generation bigint; context_hash text; actor_session uuid;
  previous_operation folio_intake_private.link_operation;
  previous_link folio_intake_private.invitation; issued_link folio_intake_private.invitation;
  event_expiry timestamptz;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  actor:=folio_intake_private.staff(p_org);
  ctx:=folio_intake_private.current_visit(p_org,p_turno,actor);
  context_hash:=folio_intake_private.link_context_hash(ctx);
  actor_session:=(auth.jwt()->>'session_id')::uuid;
  IF p_operation IS NULL OR p_expected_generation IS NULL OR p_expected_generation<0
    OR p_expected_context IS NULL OR p_expected_context !~ '^[0-9a-f]{64}$'
    OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Intake link operation parameters invalid';
  END IF;
  current_generation:=folio_intake_private.lock_link_state(ctx.turno_id);
  SELECT * INTO previous_operation FROM folio_intake_private.link_operation
    WHERE turno_id=ctx.turno_id AND operation_id=p_operation;
  IF FOUND THEN
    IF previous_operation.kind<>'ISSUE' OR previous_operation.actor_member_id<>actor.id
      OR previous_operation.actor_session_id<>actor_session
      OR previous_operation.expected_generation<>p_expected_generation
      OR previous_operation.expected_context<>p_expected_context
      OR previous_operation.token_hash<>p_token_hash THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Intake link operation payload changed';
    END IF;
    SELECT * INTO issued_link FROM folio_intake_private.invitation
      WHERE id=previous_operation.invitation_id;
    IF current_generation=previous_operation.result_generation
      AND context_hash=previous_operation.expected_context
      AND FOUND AND folio_intake_private.valid_invitation(issued_link,ctx) THEN
      RETURN jsonb_build_object('status','issued','generation',current_generation::text,
        'invitationId',issued_link.id,'expiresAt',issued_link.expires_at);
    END IF;
    RETURN jsonb_build_object('status','superseded','generation',current_generation::text);
  END IF;
  IF current_generation<>p_expected_generation OR context_hash<>p_expected_context THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Intake link generation or context changed';
  END IF;
  IF current_generation=9223372036854775807 THEN
    RAISE EXCEPTION USING ERRCODE='22003',MESSAGE='Intake link generation exhausted';
  END IF;
  IF p_fingerprint_key_cifrado IS NULL OR octet_length(p_fingerprint_key_cifrado) NOT BETWEEN 60 AND 256 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Encrypted invitation key required';
  END IF;
  SELECT * INTO previous_link FROM folio_intake_private.invitation
    WHERE turno_id=ctx.turno_id AND revoked_at IS NULL FOR UPDATE;
  IF FOUND THEN
    UPDATE folio_intake_private.invitation SET revoked_at=clock_timestamp() WHERE id=previous_link.id;
    UPDATE folio_intake_private.session SET revoked_at=clock_timestamp()
      WHERE invitation_id=previous_link.id AND revoked_at IS NULL;
    INSERT INTO folio_intake_private.event(invitation_id,kind,actor_member_id)
      VALUES(previous_link.id,'REVOKED',actor.id);
  END IF;
  event_expiry:=clock_timestamp()+interval '24 hours';
  INSERT INTO folio_intake_private.invitation
    (organization_id,turno_id,paciente_id,identidad_id,identity_link_revision,
     organization_intake_revision,paciente_intake_revision,identidad_intake_revision,profesional_id,
     issued_by_member_id,turno_inicio,turno_intake_revision,token_hash,fingerprint_key_cifrado,expires_at)
    VALUES(ctx.organization_id,ctx.turno_id,ctx.paciente_id,ctx.identidad_id,ctx.identity_link_revision,
      ctx.organization_intake_revision,ctx.paciente_intake_revision,ctx.identidad_intake_revision,
      ctx.profesional_id,actor.id,ctx.turno_inicio,ctx.turno_intake_revision,
      p_token_hash,p_fingerprint_key_cifrado,event_expiry)
    RETURNING * INTO issued_link;
  INSERT INTO folio_intake_private.event(invitation_id,kind,actor_member_id)
    VALUES(issued_link.id,'ISSUED',actor.id);
  UPDATE folio_intake_private.link_state SET generation=current_generation+1 WHERE turno_id=ctx.turno_id;
  INSERT INTO folio_intake_private.link_operation
    (turno_id,operation_id,kind,actor_member_id,actor_session_id,
     expected_generation,expected_context,token_hash,result_generation,invitation_id)
    VALUES(ctx.turno_id,p_operation,'ISSUE',actor.id,actor_session,
      p_expected_generation,p_expected_context,p_token_hash,current_generation+1,issued_link.id);
  RETURN jsonb_build_object('status','issued','generation',(current_generation+1)::text,
    'invitationId',issued_link.id,'expiresAt',issued_link.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_issue_v2(uuid,uuid,uuid,bigint,text,text,bytea)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.patient_intake_issue_v2(uuid,uuid,uuid,bigint,text,text,bytea)
  TO authenticated;

CREATE FUNCTION public.patient_intake_revoke_v2(
  p_org uuid,p_turno uuid,p_operation uuid,p_expected_generation bigint,p_expected_context text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; ctx folio_intake_private.visit_context;
  current_generation bigint; context_hash text; actor_session uuid;
  previous_operation folio_intake_private.link_operation;
  previous_link folio_intake_private.invitation; did_revoke boolean:=false;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  actor:=folio_intake_private.staff(p_org);
  ctx:=folio_intake_private.current_visit(p_org,p_turno,actor);
  context_hash:=folio_intake_private.link_context_hash(ctx);
  actor_session:=(auth.jwt()->>'session_id')::uuid;
  IF p_operation IS NULL OR p_expected_generation IS NULL OR p_expected_generation<0
    OR p_expected_context IS NULL OR p_expected_context !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Intake link operation parameters invalid';
  END IF;
  current_generation:=folio_intake_private.lock_link_state(ctx.turno_id);
  SELECT * INTO previous_operation FROM folio_intake_private.link_operation
    WHERE turno_id=ctx.turno_id AND operation_id=p_operation;
  IF FOUND THEN
    IF previous_operation.kind<>'REVOKE' OR previous_operation.actor_member_id<>actor.id
      OR previous_operation.actor_session_id<>actor_session
      OR previous_operation.expected_generation<>p_expected_generation
      OR previous_operation.expected_context<>p_expected_context THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Intake link operation payload changed';
    END IF;
    IF current_generation=previous_operation.result_generation
      AND context_hash=previous_operation.expected_context THEN
      RETURN jsonb_build_object('status','revoked','generation',current_generation::text,
        'revoked',previous_operation.revoked);
    END IF;
    RETURN jsonb_build_object('status','superseded','generation',current_generation::text);
  END IF;
  IF current_generation<>p_expected_generation OR context_hash<>p_expected_context THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Intake link generation or context changed';
  END IF;
  IF current_generation=9223372036854775807 THEN
    RAISE EXCEPTION USING ERRCODE='22003',MESSAGE='Intake link generation exhausted';
  END IF;
  SELECT * INTO previous_link FROM folio_intake_private.invitation
    WHERE turno_id=ctx.turno_id AND revoked_at IS NULL FOR UPDATE;
  IF FOUND THEN
    did_revoke:=true;
    UPDATE folio_intake_private.invitation SET revoked_at=clock_timestamp() WHERE id=previous_link.id;
    UPDATE folio_intake_private.session SET revoked_at=clock_timestamp()
      WHERE invitation_id=previous_link.id AND revoked_at IS NULL;
    INSERT INTO folio_intake_private.event(invitation_id,kind,actor_member_id)
      VALUES(previous_link.id,'REVOKED',actor.id);
  END IF;
  UPDATE folio_intake_private.link_state SET generation=current_generation+1 WHERE turno_id=ctx.turno_id;
  INSERT INTO folio_intake_private.link_operation
    (turno_id,operation_id,kind,actor_member_id,actor_session_id,
     expected_generation,expected_context,result_generation,invitation_id,revoked)
    VALUES(ctx.turno_id,p_operation,'REVOKE',actor.id,actor_session,
      p_expected_generation,p_expected_context,current_generation+1,previous_link.id,did_revoke);
  RETURN jsonb_build_object('status','revoked','generation',(current_generation+1)::text,
    'revoked',did_revoke);
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_revoke_v2(uuid,uuid,uuid,bigint,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.patient_intake_revoke_v2(uuid,uuid,uuid,bigint,text)
  TO authenticated;

CREATE FUNCTION public.patient_intake_link_operation_status(p_org uuid,p_turno uuid,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; ctx folio_intake_private.visit_context;
  current_generation bigint:=0; context_hash text;
  prior folio_intake_private.link_operation; issued_link folio_intake_private.invitation;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  actor:=folio_intake_private.staff(p_org);
  ctx:=folio_intake_private.current_visit(p_org,p_turno,actor,true);
  IF p_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Operation required'; END IF;
  context_hash:=folio_intake_private.link_context_hash(ctx);
  SELECT generation INTO current_generation FROM folio_intake_private.link_state
    WHERE turno_id=ctx.turno_id FOR SHARE;
  current_generation:=coalesce(current_generation,0);
  SELECT * INTO prior FROM folio_intake_private.link_operation
    WHERE turno_id=ctx.turno_id AND operation_id=p_operation;
  IF NOT FOUND OR prior.actor_member_id<>actor.id
    OR prior.actor_session_id IS DISTINCT FROM (auth.jwt()->>'session_id')::uuid THEN
    RETURN jsonb_build_object('status','not_recorded','generation',current_generation::text);
  END IF;
  IF current_generation<>prior.result_generation OR context_hash<>prior.expected_context THEN
    RETURN jsonb_build_object('status','superseded','generation',current_generation::text);
  END IF;
  IF prior.kind='REVOKE' THEN
    RETURN jsonb_build_object('status','revoked','generation',current_generation::text,
      'revoked',prior.revoked);
  END IF;
  SELECT * INTO issued_link FROM folio_intake_private.invitation WHERE id=prior.invitation_id;
  IF NOT FOUND OR NOT folio_intake_private.valid_invitation(issued_link,ctx) THEN
    RETURN jsonb_build_object('status','superseded','generation',current_generation::text);
  END IF;
  RETURN jsonb_build_object('status','issued','generation',current_generation::text,
    'invitationId',issued_link.id,'expiresAt',issued_link.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_link_operation_status(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.patient_intake_link_operation_status(uuid,uuid,uuid)
  TO authenticated;

-- M144's one-shot functions must not remain an alternate route around the fence.
REVOKE ALL ON FUNCTION public.patient_intake_issue(uuid,uuid,bytea)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.patient_intake_revoke(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
