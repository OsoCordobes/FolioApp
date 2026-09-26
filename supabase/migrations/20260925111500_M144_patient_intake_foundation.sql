-- B09a: private, administrative patient contribution. No clinical merge or delivery.
-- The migration runner owns the transaction and canonical version ledger.
ALTER TABLE public.organization ADD COLUMN intake_revision bigint NOT NULL DEFAULT 0
  CONSTRAINT organization_intake_revision_nonnegative CHECK (intake_revision >= 0);
CREATE FUNCTION public.organization_intake_revision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.intake_revision IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Organization intake revision must start at zero';
    END IF;
  ELSE
    IF NEW.intake_revision IS DISTINCT FROM OLD.intake_revision THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Organization intake revision is database managed';
    END IF;
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      IF OLD.intake_revision=9223372036854775807 THEN
        RAISE EXCEPTION USING ERRCODE='22003',MESSAGE='Organization intake revision exhausted';
      END IF;
      NEW.intake_revision:=OLD.intake_revision+1;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_intake_revision_guard BEFORE INSERT OR UPDATE ON public.organization
  FOR EACH ROW EXECUTE FUNCTION public.organization_intake_revision_guard();
REVOKE ALL ON FUNCTION public.organization_intake_revision_guard() FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.paciente ADD COLUMN intake_revision bigint NOT NULL DEFAULT 0
  CONSTRAINT paciente_intake_revision_nonnegative CHECK (intake_revision >= 0);
CREATE FUNCTION public.paciente_intake_revision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.intake_revision IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Patient intake revision must start at zero';
    END IF;
  ELSE
    IF NEW.intake_revision IS DISTINCT FROM OLD.intake_revision THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Patient intake revision is database managed';
    END IF;
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.pseudonimizado_en IS DISTINCT FROM OLD.pseudonimizado_en THEN
      IF OLD.intake_revision=9223372036854775807 THEN
        RAISE EXCEPTION USING ERRCODE='22003',MESSAGE='Patient intake revision exhausted';
      END IF;
      NEW.intake_revision:=OLD.intake_revision+1;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER paciente_intake_revision_guard BEFORE INSERT OR UPDATE ON public.paciente
  FOR EACH ROW EXECUTE FUNCTION public.paciente_intake_revision_guard();
REVOKE ALL ON FUNCTION public.paciente_intake_revision_guard() FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.paciente_identidad ADD COLUMN intake_revision bigint NOT NULL DEFAULT 0
  CONSTRAINT paciente_identidad_intake_revision_nonnegative CHECK (intake_revision >= 0);
CREATE FUNCTION public.identidad_intake_revision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.intake_revision IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Identity intake revision must start at zero';
    END IF;
  ELSE
    IF NEW.intake_revision IS DISTINCT FROM OLD.intake_revision THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Identity intake revision is database managed';
    END IF;
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      IF OLD.intake_revision=9223372036854775807 THEN
        RAISE EXCEPTION USING ERRCODE='22003',MESSAGE='Identity intake revision exhausted';
      END IF;
      NEW.intake_revision:=OLD.intake_revision+1;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER identidad_intake_revision_guard BEFORE INSERT OR UPDATE ON public.paciente_identidad
  FOR EACH ROW EXECUTE FUNCTION public.identidad_intake_revision_guard();
REVOKE ALL ON FUNCTION public.identidad_intake_revision_guard() FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.turno ADD COLUMN intake_revision bigint NOT NULL DEFAULT 0
  CONSTRAINT turno_intake_revision_nonnegative CHECK (intake_revision >= 0);
CREATE FUNCTION public.turno_intake_revision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.intake_revision IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Visit intake revision must start at zero';
    END IF;
  ELSE
    IF NEW.intake_revision IS DISTINCT FROM OLD.intake_revision THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Visit intake revision is database managed';
    END IF;
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.paciente_id IS DISTINCT FROM OLD.paciente_id
      OR NEW.profesional_id IS DISTINCT FROM OLD.profesional_id
      OR NEW.inicio IS DISTINCT FROM OLD.inicio
      OR (NEW.estado IS DISTINCT FROM OLD.estado AND NOT (
        OLD.estado::text IN ('AGENDADO','CONFIRMADO','EN_SALA')
        AND NEW.estado::text IN ('AGENDADO','CONFIRMADO','EN_SALA')))
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      IF OLD.intake_revision=9223372036854775807 THEN
        RAISE EXCEPTION USING ERRCODE='22003',MESSAGE='Visit intake revision exhausted';
      END IF;
      NEW.intake_revision:=OLD.intake_revision+1;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER turno_intake_revision_guard BEFORE INSERT OR UPDATE ON public.turno
  FOR EACH ROW EXECUTE FUNCTION public.turno_intake_revision_guard();
REVOKE ALL ON FUNCTION public.turno_intake_revision_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE SCHEMA folio_intake_private;
REVOKE ALL ON SCHEMA folio_intake_private FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE folio_intake_private.invitation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organization(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  turno_id uuid NOT NULL REFERENCES public.turno(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  paciente_id uuid NOT NULL REFERENCES public.paciente(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  identidad_id uuid NOT NULL,
  identity_link_revision bigint NOT NULL CHECK (identity_link_revision >= 0),
  organization_intake_revision bigint NOT NULL CHECK (organization_intake_revision >= 0),
  paciente_intake_revision bigint NOT NULL CHECK (paciente_intake_revision >= 0),
  identidad_intake_revision bigint NOT NULL CHECK (identidad_intake_revision >= 0),
  profesional_id uuid NOT NULL REFERENCES public.member(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  issued_by_member_id uuid NOT NULL REFERENCES public.member(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  turno_inicio timestamptz NOT NULL,
  turno_intake_revision bigint NOT NULL CHECK (turno_intake_revision >= 0),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  fingerprint_key_cifrado bytea NOT NULL CHECK (octet_length(fingerprint_key_cifrado) >= 60),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '24 hours')
);
CREATE UNIQUE INDEX intake_one_live_invitation ON folio_intake_private.invitation(turno_id)
  WHERE revoked_at IS NULL;
CREATE INDEX intake_invitation_patient ON folio_intake_private.invitation(organization_id,paciente_id,issued_at DESC);

CREATE TABLE folio_intake_private.session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES folio_intake_private.invitation(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '24 hours')
);
CREATE INDEX intake_session_invitation ON folio_intake_private.session(invitation_id);
CREATE FUNCTION folio_intake_private.session_expiry_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM 1 FROM folio_intake_private.invitation WHERE id=NEW.invitation_id
    AND expires_at>=NEW.expires_at FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Session cannot outlive invitation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER intake_session_expiry BEFORE INSERT OR UPDATE OF invitation_id,expires_at
  ON folio_intake_private.session FOR EACH ROW EXECUTE FUNCTION folio_intake_private.session_expiry_guard();
REVOKE ALL ON FUNCTION folio_intake_private.session_expiry_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE folio_intake_private.submission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES folio_intake_private.invitation(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES folio_intake_private.session(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  questionnaire_version text NOT NULL CHECK (questionnaire_version = 'admin.v1'),
  content_fingerprint text NOT NULL CHECK (content_fingerprint ~ '^[0-9a-f]{64}$'),
  answers_cifrado bytea NOT NULL CHECK (octet_length(answers_cifrado) BETWEEN 29 AND 17408),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  origin text NOT NULL DEFAULT 'PACIENTE' CHECK (origin = 'PACIENTE'),
  UNIQUE (invitation_id,operation_id)
);
CREATE INDEX intake_submission_invitation ON folio_intake_private.submission(invitation_id,received_at DESC);

CREATE TABLE folio_intake_private.event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invitation_id uuid NOT NULL REFERENCES folio_intake_private.invitation(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('ISSUED','REVOKED','SESSION_ISSUED','SUBMISSION_RECEIVED')),
  actor_member_id uuid REFERENCES public.member(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  session_id uuid REFERENCES folio_intake_private.session(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  submission_id uuid REFERENCES folio_intake_private.submission(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX intake_event_invitation ON folio_intake_private.event(invitation_id,occurred_at,id);

ALTER TABLE folio_intake_private.invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_intake_private.session ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_intake_private.submission ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_intake_private.event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA folio_intake_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA folio_intake_private FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION folio_intake_private.reject_submission_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Patient contributions are append-only';
END $$;
CREATE TRIGGER intake_submission_immutable BEFORE UPDATE OR DELETE ON folio_intake_private.submission
  FOR EACH ROW EXECUTE FUNCTION folio_intake_private.reject_submission_mutation();
CREATE TRIGGER intake_submission_no_truncate BEFORE TRUNCATE ON folio_intake_private.submission
  FOR EACH STATEMENT EXECUTE FUNCTION folio_intake_private.reject_submission_mutation();
CREATE TRIGGER intake_event_immutable BEFORE UPDATE OR DELETE ON folio_intake_private.event
  FOR EACH ROW EXECUTE FUNCTION folio_intake_private.reject_submission_mutation();
CREATE TRIGGER intake_event_no_truncate BEFORE TRUNCATE ON folio_intake_private.event
  FOR EACH STATEMENT EXECUTE FUNCTION folio_intake_private.reject_submission_mutation();
REVOKE ALL ON FUNCTION folio_intake_private.reject_submission_mutation() FROM PUBLIC,anon,authenticated,service_role;

-- This guard deliberately ignores the global MFA activation switch.
CREATE FUNCTION folio_intake_private.staff(p_org uuid) RETURNS public.member
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; mfa jsonb; claims jsonb;
BEGIN
  IF p_org IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current staff required';
  END IF;
  PERFORM 1 FROM public.organization WHERE id=p_org AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current organization required'; END IF;
  SELECT * INTO actor FROM public.member WHERE organization_id=p_org AND profile_id=auth.uid()
    AND deleted_at IS NULL AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
  IF NOT FOUND OR actor.role NOT IN ('OWNER','DIRECTOR','PROFESIONAL','ASISTENTE','COORDINADOR') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current accepted staff required';
  END IF;
  -- Hold both mutable Auth sources through commit. Evaluate status only after
  -- any competing revocation has committed, as in M120's authorization guard.
  claims:=auth.jwt();
  PERFORM 1 FROM auth.sessions WHERE user_id=auth.uid()
    AND id::text=claims->>'session_id' FOR SHARE;
  PERFORM 1 FROM auth.mfa_factors WHERE user_id=auth.uid() FOR SHARE;
  mfa:=public.mfa_access_status();
  IF (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2'
    OR (mfa->>'hasVerifiedFactor')::boolean IS DISTINCT FROM true
    OR (mfa->>'sessionValid')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current verified session required';
  END IF;
  RETURN actor;
END $$;
REVOKE ALL ON FUNCTION folio_intake_private.staff(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE TYPE folio_intake_private.visit_context AS (
  organization_id uuid,turno_id uuid,paciente_id uuid,identidad_id uuid,
  identity_link_revision bigint,organization_intake_revision bigint,
  paciente_intake_revision bigint,identidad_intake_revision bigint,
  profesional_id uuid,turno_inicio timestamptz,
  turno_intake_revision bigint
);

-- Same order as M119: organization and actor (staff()), professional,
-- booking-slot advisory, turno, patient, identity. Recheck the target after
-- acquiring the advisory lock. Share locks block cancellation/link updates.
CREATE FUNCTION folio_intake_private.current_visit(
  p_org uuid,p_turno uuid,p_actor public.member,p_for_review boolean DEFAULT false)
RETURNS folio_intake_private.visit_context
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target uuid; professional public.member; visit public.turno;
  patient public.paciente; identity_row public.paciente_identidad;
  organization_revision bigint; attended boolean:=false;
  result folio_intake_private.visit_context;
BEGIN
  IF p_org IS NULL OR p_turno IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Organization and visit required';
  END IF;
  SELECT intake_revision INTO organization_revision FROM public.organization
    WHERE id=p_org AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current organization required'; END IF;
  SELECT profesional_id INTO target FROM public.turno
    WHERE id=p_turno AND organization_id=p_org AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current visit required'; END IF;
  SELECT * INTO professional FROM public.member WHERE id=target AND organization_id=p_org
    AND deleted_at IS NULL AND es_colegiado AND (accepted_at IS NOT NULL OR invited_by_id IS NULL) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current professional required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('booking-slot:'||p_org::text||':'||target::text,0));
  SELECT * INTO visit FROM public.turno WHERE id=p_turno AND organization_id=p_org
    AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND OR visit.profesional_id IS DISTINCT FROM target
    OR (NOT p_for_review AND visit.estado::text NOT IN ('AGENDADO','CONFIRMADO','EN_SALA'))
    OR (p_for_review AND visit.estado::text NOT IN
      ('AGENDADO','CONFIRMADO','EN_SALA','ATENDIENDO','CERRADO')) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Visit no longer accepts contributions';
  END IF;
  -- Lock one supporting historical visit before the patient row. M32's
  -- EXISTS helper alone cannot retain professional scope through commit.
  IF (p_actor).role='PROFESIONAL' THEN
    PERFORM 1 FROM public.turno history WHERE history.organization_id=p_org
      AND history.paciente_id=visit.paciente_id AND history.profesional_id=(p_actor).id
      AND history.deleted_at IS NULL AND history.estado::text IN ('EN_SALA','ATENDIENDO','CERRADO')
      ORDER BY history.id LIMIT 1 FOR SHARE;
    attended:=FOUND;
  END IF;
  SELECT * INTO patient FROM public.paciente WHERE id=visit.paciente_id AND organization_id=p_org
    AND deleted_at IS NULL AND pseudonimizado_en IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current patient required'; END IF;
  IF (p_actor).id IS NOT NULL THEN
    IF patient.caja_fuerte_profesional IS NOT NULL AND patient.caja_fuerte_profesional IS DISTINCT FROM (p_actor).id THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current patient scope required';
    END IF;
    IF ((p_actor).role IN ('OWNER','DIRECTOR')
      OR ((p_actor).role='PROFESIONAL' AND (p_actor).id=target
        AND (patient.profesional_principal_id=(p_actor).id OR attended))
      OR ((p_actor).role IN ('ASISTENTE','COORDINADOR')
        AND patient.caja_fuerte_profesional IS NULL AND public.user_has_scope_over(p_org,target)))
      IS DISTINCT FROM true THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current visit scope required';
    END IF;
  END IF;
  SELECT * INTO identity_row FROM public.paciente_identidad
    WHERE id=patient.identidad_id AND organization_id=p_org AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current identity required'; END IF;
  result:=(p_org,visit.id,patient.id,identity_row.id,patient.identity_link_revision,
    organization_revision,patient.intake_revision,identity_row.intake_revision,
    target,visit.inicio,visit.intake_revision)
    ::folio_intake_private.visit_context;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION folio_intake_private.current_visit(uuid,uuid,public.member,boolean)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION folio_intake_private.valid_invitation(p_inv folio_intake_private.invitation,
  p_ctx folio_intake_private.visit_context) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
  SELECT (p_inv).revoked_at IS NULL AND (p_inv).expires_at>clock_timestamp()
    AND (p_inv).organization_id=(p_ctx).organization_id AND (p_inv).turno_id=(p_ctx).turno_id
    AND (p_inv).paciente_id=(p_ctx).paciente_id AND (p_inv).identidad_id=(p_ctx).identidad_id
    AND (p_inv).identity_link_revision=(p_ctx).identity_link_revision
    AND (p_inv).organization_intake_revision=(p_ctx).organization_intake_revision
    AND (p_inv).paciente_intake_revision=(p_ctx).paciente_intake_revision
    AND (p_inv).identidad_intake_revision=(p_ctx).identidad_intake_revision
    AND (p_inv).profesional_id=(p_ctx).profesional_id AND (p_inv).turno_inicio=(p_ctx).turno_inicio
    AND (p_inv).turno_intake_revision=(p_ctx).turno_intake_revision
$$;
REVOKE ALL ON FUNCTION folio_intake_private.valid_invitation(folio_intake_private.invitation,folio_intake_private.visit_context)
  FROM PUBLIC,anon,authenticated,service_role;

-- The app supplies a freshly encrypted 32-byte per-invitation HMAC key. The
-- link token itself is generated by the database and returned exactly once.
CREATE FUNCTION public.patient_intake_issue(p_org uuid,p_turno uuid,p_fingerprint_key_cifrado bytea)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; ctx folio_intake_private.visit_context;
  prior folio_intake_private.invitation; raw_token text; event_id uuid; event_expiry timestamptz;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  actor:=folio_intake_private.staff(p_org);
  IF p_fingerprint_key_cifrado IS NULL OR octet_length(p_fingerprint_key_cifrado) NOT BETWEEN 60 AND 256 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Encrypted invitation key required';
  END IF;
  ctx:=folio_intake_private.current_visit(p_org,p_turno,actor);
  -- All writers take the visit lock before the invitation lock.
  SELECT * INTO prior FROM folio_intake_private.invitation
    WHERE turno_id=p_turno AND revoked_at IS NULL FOR UPDATE;
  IF FOUND THEN
    UPDATE folio_intake_private.invitation SET revoked_at=clock_timestamp() WHERE id=prior.id;
    UPDATE folio_intake_private.session SET revoked_at=clock_timestamp()
      WHERE invitation_id=prior.id AND revoked_at IS NULL;
    INSERT INTO folio_intake_private.event(invitation_id,kind,actor_member_id)
      VALUES(prior.id,'REVOKED',actor.id);
  END IF;
  raw_token:=folio_caller_private.random_hex(32);
  event_expiry:=clock_timestamp()+interval '24 hours';
  INSERT INTO folio_intake_private.invitation
    (organization_id,turno_id,paciente_id,identidad_id,identity_link_revision,
     organization_intake_revision,paciente_intake_revision,identidad_intake_revision,profesional_id,
     issued_by_member_id,turno_inicio,turno_intake_revision,token_hash,fingerprint_key_cifrado,expires_at)
    VALUES(ctx.organization_id,ctx.turno_id,ctx.paciente_id,ctx.identidad_id,ctx.identity_link_revision,
      ctx.organization_intake_revision,ctx.paciente_intake_revision,ctx.identidad_intake_revision,
      ctx.profesional_id,actor.id,ctx.turno_inicio,ctx.turno_intake_revision,
      encode(sha256(decode(raw_token,'hex')),'hex'),
      p_fingerprint_key_cifrado,event_expiry) RETURNING id INTO event_id;
  INSERT INTO folio_intake_private.event(invitation_id,kind,actor_member_id)
    VALUES(event_id,'ISSUED',actor.id);
  RETURN jsonb_build_object('invitationId',event_id,'token',raw_token,'expiresAt',event_expiry);
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_issue(uuid,uuid,bytea) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.patient_intake_issue(uuid,uuid,bytea) TO authenticated;

CREATE FUNCTION public.patient_intake_revoke(p_org uuid,p_turno uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; ctx folio_intake_private.visit_context; prior folio_intake_private.invitation;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  actor:=folio_intake_private.staff(p_org);
  ctx:=folio_intake_private.current_visit(p_org,p_turno,actor);
  SELECT * INTO prior FROM folio_intake_private.invitation
    WHERE turno_id=ctx.turno_id AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('revoked',false); END IF;
  UPDATE folio_intake_private.invitation SET revoked_at=clock_timestamp() WHERE id=prior.id;
  UPDATE folio_intake_private.session SET revoked_at=clock_timestamp()
    WHERE invitation_id=prior.id AND revoked_at IS NULL;
  INSERT INTO folio_intake_private.event(invitation_id,kind,actor_member_id)
    VALUES(prior.id,'REVOKED',actor.id);
  RETURN jsonb_build_object('revoked',true);
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_revoke(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.patient_intake_revoke(uuid,uuid) TO authenticated;

-- Service-only: the browser never gets schema access, ciphertext, or a list.
CREATE FUNCTION public.patient_intake_exchange(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate folio_intake_private.invitation; inv folio_intake_private.invitation;
  ctx folio_intake_private.visit_context; raw_session text; session_expiry timestamptz;
  session_id uuid;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invalid invitation';
  END IF;
  SELECT * INTO candidate FROM folio_intake_private.invitation WHERE token_hash=p_token_hash;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invalid invitation'; END IF;
  ctx:=folio_intake_private.current_visit(candidate.organization_id,candidate.turno_id,NULL::public.member);
  SELECT * INTO inv FROM folio_intake_private.invitation WHERE id=candidate.id FOR UPDATE;
  IF NOT FOUND OR NOT folio_intake_private.valid_invitation(inv,ctx) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invitation unavailable';
  END IF;
  raw_session:=folio_caller_private.random_hex(32);
  session_expiry:=least(clock_timestamp()+interval '24 hours',inv.expires_at);
  INSERT INTO folio_intake_private.session(invitation_id,token_hash,expires_at)
    VALUES(inv.id,encode(sha256(decode(raw_session,'hex')),'hex'),session_expiry)
    RETURNING id INTO session_id;
  INSERT INTO folio_intake_private.event(invitation_id,kind,session_id)
    VALUES(inv.id,'SESSION_ISSUED',session_id);
  RETURN jsonb_build_object('session',raw_session,'expiresAt',session_expiry);
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_exchange(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_intake_exchange(text) TO service_role;

CREATE FUNCTION folio_intake_private.current_session(p_session_hash text)
RETURNS folio_intake_private.session
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate folio_intake_private.session; inv folio_intake_private.invitation;
  ctx folio_intake_private.visit_context; active_session folio_intake_private.session;
BEGIN
  IF p_session_hash IS NULL OR p_session_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invalid session';
  END IF;
  SELECT * INTO candidate FROM folio_intake_private.session WHERE token_hash=p_session_hash;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invalid session'; END IF;
  SELECT * INTO inv FROM folio_intake_private.invitation WHERE id=candidate.invitation_id;
  ctx:=folio_intake_private.current_visit(inv.organization_id,inv.turno_id,NULL::public.member);
  SELECT * INTO inv FROM folio_intake_private.invitation WHERE id=candidate.invitation_id FOR UPDATE;
  SELECT * INTO active_session FROM folio_intake_private.session WHERE id=candidate.id FOR UPDATE;
  IF NOT FOUND OR NOT folio_intake_private.valid_invitation(inv,ctx)
    OR active_session.revoked_at IS NOT NULL OR active_session.expires_at<=clock_timestamp()
    OR active_session.expires_at>inv.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Session unavailable';
  END IF;
  RETURN active_session;
END $$;
REVOKE ALL ON FUNCTION folio_intake_private.current_session(text) FROM PUBLIC,anon,authenticated,service_role;

-- Only the trusted server helper receives the encrypted per-invitation key.
CREATE FUNCTION public.patient_intake_submission_key(p_session_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE active_session folio_intake_private.session; key_cipher bytea;
BEGIN
  active_session:=folio_intake_private.current_session(p_session_hash);
  SELECT fingerprint_key_cifrado INTO key_cipher FROM folio_intake_private.invitation
    WHERE id=active_session.invitation_id;
  RETURN jsonb_build_object('invitationId',active_session.invitation_id,
    'keyCipherBase64',encode(key_cipher,'base64'));
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_submission_key(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_intake_submission_key(text) TO service_role;

CREATE FUNCTION public.patient_intake_submit(p_session_hash text,p_operation uuid,
  p_version text,p_fingerprint text,p_answers_cifrado bytea)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE active_session folio_intake_private.session; prior folio_intake_private.submission;
  receipt_id uuid; received timestamptz;
BEGIN
  IF p_operation IS NULL OR p_version IS DISTINCT FROM 'admin.v1'
    OR p_fingerprint IS NULL OR p_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_answers_cifrado IS NULL OR octet_length(p_answers_cifrado) NOT BETWEEN 29 AND 17408 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid administrative contribution';
  END IF;
  active_session:=folio_intake_private.current_session(p_session_hash);
  SELECT * INTO prior FROM folio_intake_private.submission
    WHERE invitation_id=active_session.invitation_id AND operation_id=p_operation;
  IF FOUND THEN
    IF prior.questionnaire_version IS DISTINCT FROM p_version
      OR prior.content_fingerprint IS DISTINCT FROM p_fingerprint THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Operation reused with different content';
    END IF;
    RETURN jsonb_build_object('status','received','receiptId',prior.id,
      'receivedAt',prior.received_at,'reused',true);
  END IF;
  INSERT INTO folio_intake_private.submission
    (invitation_id,session_id,operation_id,questionnaire_version,content_fingerprint,answers_cifrado)
    VALUES(active_session.invitation_id,active_session.id,p_operation,p_version,p_fingerprint,p_answers_cifrado)
    RETURNING id,received_at INTO receipt_id,received;
  INSERT INTO folio_intake_private.event(invitation_id,kind,session_id,submission_id)
    VALUES(active_session.invitation_id,'SUBMISSION_RECEIVED',active_session.id,receipt_id);
  RETURN jsonb_build_object('status','received','receiptId',receipt_id,'receivedAt',received,'reused',false);
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_submit(text,uuid,text,text,bytea) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_intake_submit(text,uuid,text,text,bytea) TO service_role;

CREATE FUNCTION public.patient_intake_operation_status(p_session_hash text,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE active_session folio_intake_private.session; prior folio_intake_private.submission;
BEGIN
  IF p_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Operation required'; END IF;
  active_session:=folio_intake_private.current_session(p_session_hash);
  SELECT * INTO prior FROM folio_intake_private.submission
    WHERE invitation_id=active_session.invitation_id AND operation_id=p_operation;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_received'); END IF;
  RETURN jsonb_build_object('status','received','receiptId',prior.id,'receivedAt',prior.received_at);
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_operation_status(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_intake_operation_status(text,uuid) TO service_role;

CREATE FUNCTION public.patient_intake_review(p_org uuid,p_turno uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; ctx folio_intake_private.visit_context;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  actor:=folio_intake_private.staff(p_org);
  ctx:=folio_intake_private.current_visit(p_org,p_turno,actor,true);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('receiptId',s.id,
      'questionnaireVersion',s.questionnaire_version,'receivedAt',s.received_at,
      'answersCipherBase64',encode(s.answers_cifrado,'base64')) ORDER BY s.received_at,s.id)
    FROM folio_intake_private.submission s JOIN folio_intake_private.invitation i ON i.id=s.invitation_id
    WHERE i.turno_id=ctx.turno_id AND i.paciente_id=ctx.paciente_id
      AND i.identidad_id=ctx.identidad_id AND i.identity_link_revision=ctx.identity_link_revision
      AND i.organization_intake_revision=ctx.organization_intake_revision
      AND i.paciente_intake_revision=ctx.paciente_intake_revision
      AND i.identidad_intake_revision=ctx.identidad_intake_revision
      AND i.turno_inicio=ctx.turno_inicio
      AND i.profesional_id=ctx.profesional_id), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_review(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.patient_intake_review(uuid,uuid) TO authenticated;

COMMENT ON TABLE folio_intake_private.submission IS
  'Immutable patient-proposed administrative data only. No identity, clinical history or contact field is changed here.';
COMMENT ON COLUMN folio_intake_private.invitation.fingerprint_key_cifrado IS
  'App-encrypted random per-invitation HMAC key. Add to encryption rotation inventory before retiring the old key.';
COMMENT ON COLUMN folio_intake_private.submission.answers_cifrado IS
  'App-encrypted canonical admin.v1 JSON. Add to encryption rotation inventory before retiring the old key.';
