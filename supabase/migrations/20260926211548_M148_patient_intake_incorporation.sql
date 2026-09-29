-- B09: selective incorporation of immutable admin.v1 contributions.
-- Additive foundation only. PostgreSQL cannot verify application AES ciphertext:
-- materialization is service-only; the authenticated caller can only commit it.

ALTER TABLE public.paciente_identidad ADD COLUMN admin_revision bigint NOT NULL DEFAULT 0
  CONSTRAINT paciente_identidad_admin_revision_nonnegative CHECK (admin_revision >= 0);

-- The name sorts after M86's portal guard. Portal contact edits remain allowed;
-- neither portal nor staff may supply their own revision.
CREATE FUNCTION public.paciente_identidad_admin_revision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.admin_revision IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Administrative revision must start at zero';
    END IF;
  ELSE
    IF NEW.admin_revision IS DISTINCT FROM OLD.admin_revision THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Administrative revision is database managed';
    END IF;
    IF NEW.nombre_cifrado IS DISTINCT FROM OLD.nombre_cifrado
      OR NEW.apellido_cifrado IS DISTINCT FROM OLD.apellido_cifrado
      OR NEW.nombre_hash IS DISTINCT FROM OLD.nombre_hash
      OR NEW.tipo_doc IS DISTINCT FROM OLD.tipo_doc
      OR NEW.numero_doc_cifrado IS DISTINCT FROM OLD.numero_doc_cifrado
      OR NEW.dni_hash IS DISTINCT FROM OLD.dni_hash
      OR NEW.fecha_nacimiento IS DISTINCT FROM OLD.fecha_nacimiento
      OR NEW.email_cifrado IS DISTINCT FROM OLD.email_cifrado
      OR NEW.email_hash IS DISTINCT FROM OLD.email_hash
      OR NEW.telefono_cifrado IS DISTINCT FROM OLD.telefono_cifrado
      OR NEW.telefono_hash IS DISTINCT FROM OLD.telefono_hash
      OR NEW.cobertura_nombre IS DISTINCT FROM OLD.cobertura_nombre
      OR NEW.cobertura_plan IS DISTINCT FROM OLD.cobertura_plan
      OR NEW.cobertura_nro_afiliado_cifrado IS DISTINCT FROM OLD.cobertura_nro_afiliado_cifrado
      OR NEW.domicilio_calle_cifrado IS DISTINCT FROM OLD.domicilio_calle_cifrado
      OR NEW.domicilio_numero_cifrado IS DISTINCT FROM OLD.domicilio_numero_cifrado
      OR NEW.domicilio_ciudad IS DISTINCT FROM OLD.domicilio_ciudad
      OR NEW.domicilio_provincia IS DISTINCT FROM OLD.domicilio_provincia
      OR NEW.domicilio_cp IS DISTINCT FROM OLD.domicilio_cp
      OR NEW.ocupacion_cifrado IS DISTINCT FROM OLD.ocupacion_cifrado
      OR NEW.recomendado_por_cifrado IS DISTINCT FROM OLD.recomendado_por_cifrado
      OR NEW.sexo_biologico IS DISTINCT FROM OLD.sexo_biologico
      OR NEW.genero_autopercibido IS DISTINCT FROM OLD.genero_autopercibido THEN
      IF OLD.admin_revision=9223372036854775807 THEN
        RAISE EXCEPTION USING ERRCODE='22003',MESSAGE='Administrative revision exhausted';
      END IF;
      NEW.admin_revision:=OLD.admin_revision+1;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_paciente_identidad_admin_revision_guard
  BEFORE INSERT OR UPDATE ON public.paciente_identidad
  FOR EACH ROW EXECUTE FUNCTION public.paciente_identidad_admin_revision_guard();
REVOKE ALL ON FUNCTION public.paciente_identidad_admin_revision_guard()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE folio_intake_private.incorporation_operation (
  organization_id uuid NOT NULL REFERENCES public.organization(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  preparation_id uuid UNIQUE,
  actor_member_id uuid NOT NULL REFERENCES public.member(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  actor_session_id uuid NOT NULL,
  turno_id uuid NOT NULL REFERENCES public.turno(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  paciente_id uuid REFERENCES public.paciente(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  identidad_id uuid,
  receipt_id uuid REFERENCES folio_intake_private.submission(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  questionnaire_version text CHECK (questionnaire_version='admin.v1'),
  selected_keys text[],
  expected_admin_revision bigint CHECK (expected_admin_revision >= 0),
  expected_context_hash text CHECK (expected_context_hash ~ '^[0-9a-f]{64}$'),
  source_fingerprint text CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_cipher bytea,
  snapshot jsonb,
  patch jsonb,
  changed_keys text[],
  status text NOT NULL CHECK (status IN ('pending','materialized','applied','unchanged','conflict','cancelled')),
  terminal_reason text,
  revision_before bigint,
  revision_after bigint,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz,
  finished_at timestamptz,
  PRIMARY KEY (organization_id,operation_id),
  CHECK (
    (status='cancelled' AND preparation_id IS NULL AND paciente_id IS NULL
      AND identidad_id IS NULL AND receipt_id IS NULL AND selected_keys IS NULL
      AND expected_admin_revision IS NULL AND expected_context_hash IS NULL
      AND source_fingerprint IS NULL AND source_cipher IS NULL AND snapshot IS NULL
      AND patch IS NULL AND changed_keys IS NULL AND finished_at IS NOT NULL)
    OR
    (preparation_id IS NOT NULL AND paciente_id IS NOT NULL AND identidad_id IS NOT NULL
      AND receipt_id IS NOT NULL AND questionnaire_version='admin.v1'
      AND selected_keys IS NOT NULL AND cardinality(selected_keys)>0
      AND expected_admin_revision IS NOT NULL AND expected_context_hash IS NOT NULL
      AND source_fingerprint IS NOT NULL AND source_cipher IS NOT NULL AND snapshot IS NOT NULL
      AND expires_at IS NOT NULL
      AND ((status='pending' AND patch IS NULL AND changed_keys IS NULL AND finished_at IS NULL)
        OR (status='materialized' AND patch IS NOT NULL AND changed_keys IS NOT NULL AND finished_at IS NULL)
        OR (status IN ('applied','unchanged','conflict','cancelled') AND finished_at IS NOT NULL))
    )
  )
);
CREATE INDEX intake_incorporation_actor ON folio_intake_private.incorporation_operation
  (actor_member_id,actor_session_id,created_at DESC);
CREATE INDEX intake_incorporation_receipt ON folio_intake_private.incorporation_operation
  (receipt_id,created_at DESC);
ALTER TABLE folio_intake_private.incorporation_operation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON folio_intake_private.incorporation_operation FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE folio_intake_private.incorporation_provenance (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  turno_id uuid NOT NULL REFERENCES public.turno(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  paciente_id uuid NOT NULL REFERENCES public.paciente(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  identidad_id uuid NOT NULL,
  receipt_id uuid NOT NULL REFERENCES folio_intake_private.submission(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  actor_member_id uuid NOT NULL REFERENCES public.member(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  actor_session_id uuid NOT NULL,
  selected_keys text[] NOT NULL,
  changed_keys text[] NOT NULL,
  revision_before bigint NOT NULL,
  revision_after bigint NOT NULL,
  origin text NOT NULL DEFAULT 'PACIENTE_APORTO_PERSONAL_INCORPORO_SIN_VERIFICAR'
    CHECK (origin='PACIENTE_APORTO_PERSONAL_INCORPORO_SIN_VERIFICAR'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id,operation_id),
  FOREIGN KEY (organization_id,operation_id)
    REFERENCES folio_intake_private.incorporation_operation(organization_id,operation_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);
ALTER TABLE folio_intake_private.incorporation_provenance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON folio_intake_private.incorporation_provenance FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE folio_intake_private.incorporation_provenance_id_seq
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER intake_incorporation_provenance_immutable BEFORE UPDATE OR DELETE
  ON folio_intake_private.incorporation_provenance FOR EACH ROW
  EXECUTE FUNCTION folio_intake_private.reject_submission_mutation();
CREATE TRIGGER intake_incorporation_provenance_no_truncate BEFORE TRUNCATE
  ON folio_intake_private.incorporation_provenance FOR EACH STATEMENT
  EXECUTE FUNCTION folio_intake_private.reject_submission_mutation();

CREATE FUNCTION folio_intake_private.incorporation_operation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='TRUNCATE' OR TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Incorporation operations are durable';
  END IF;
  IF OLD.status IN ('applied','unchanged','conflict','cancelled') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Terminal incorporation is immutable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.preparation_id IS DISTINCT FROM OLD.preparation_id
    OR NEW.actor_member_id IS DISTINCT FROM OLD.actor_member_id
    OR NEW.actor_session_id IS DISTINCT FROM OLD.actor_session_id
    OR NEW.turno_id IS DISTINCT FROM OLD.turno_id
    OR NEW.paciente_id IS DISTINCT FROM OLD.paciente_id
    OR NEW.identidad_id IS DISTINCT FROM OLD.identidad_id
    OR NEW.receipt_id IS DISTINCT FROM OLD.receipt_id
    OR NEW.questionnaire_version IS DISTINCT FROM OLD.questionnaire_version
    OR NEW.selected_keys IS DISTINCT FROM OLD.selected_keys
    OR NEW.expected_admin_revision IS DISTINCT FROM OLD.expected_admin_revision
    OR NEW.expected_context_hash IS DISTINCT FROM OLD.expected_context_hash
    OR NEW.source_fingerprint IS DISTINCT FROM OLD.source_fingerprint
    OR NEW.source_cipher IS DISTINCT FROM OLD.source_cipher
    OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Prepared source is immutable';
  END IF;
  IF OLD.status='pending' AND NEW.status NOT IN ('materialized','cancelled','conflict')
    OR OLD.status='materialized' AND NEW.status NOT IN ('applied','unchanged','cancelled','conflict') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Invalid incorporation transition';
  END IF;
  IF OLD.status='materialized' AND (NEW.patch IS DISTINCT FROM OLD.patch
    OR NEW.changed_keys IS DISTINCT FROM OLD.changed_keys) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Materialized patch is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER intake_incorporation_operation_guard BEFORE UPDATE OR DELETE
  ON folio_intake_private.incorporation_operation FOR EACH ROW
  EXECUTE FUNCTION folio_intake_private.incorporation_operation_guard();
CREATE TRIGGER intake_incorporation_operation_no_truncate BEFORE TRUNCATE
  ON folio_intake_private.incorporation_operation FOR EACH STATEMENT
  EXECUTE FUNCTION folio_intake_private.incorporation_operation_guard();
REVOKE ALL ON FUNCTION folio_intake_private.incorporation_operation_guard()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION folio_intake_private.incorporation_editor(p_actor public.member) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF (p_actor).id IS NULL OR (p_actor).role NOT IN ('OWNER','DIRECTOR','PROFESIONAL','ASISTENTE') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current identity editor required';
  END IF;
END $$;
REVOKE ALL ON FUNCTION folio_intake_private.incorporation_editor(public.member)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION folio_intake_private.incorporation_receipt(
  p_receipt uuid,p_ctx folio_intake_private.visit_context)
RETURNS folio_intake_private.submission
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE result folio_intake_private.submission;
BEGIN
  SELECT s.* INTO result FROM folio_intake_private.submission s
    JOIN folio_intake_private.invitation i ON i.id=s.invitation_id
    WHERE s.id=p_receipt AND s.questionnaire_version='admin.v1'
      AND i.organization_id=(p_ctx).organization_id AND i.turno_id=(p_ctx).turno_id
      AND i.paciente_id=(p_ctx).paciente_id AND i.identidad_id=(p_ctx).identidad_id
      AND i.identity_link_revision=(p_ctx).identity_link_revision
      AND i.organization_intake_revision=(p_ctx).organization_intake_revision
      AND i.paciente_intake_revision=(p_ctx).paciente_intake_revision
      AND i.identidad_intake_revision=(p_ctx).identidad_intake_revision
      AND i.profesional_id=(p_ctx).profesional_id AND i.turno_inicio=(p_ctx).turno_inicio
      AND i.turno_intake_revision=(p_ctx).turno_intake_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current contribution required';
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION folio_intake_private.incorporation_receipt(uuid,folio_intake_private.visit_context)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION folio_intake_private.incorporation_current(p_identity public.paciente_identidad)
RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object(
    'nombre_cifrado',encode((p_identity).nombre_cifrado,'base64'),
    'apellido_cifrado',encode((p_identity).apellido_cifrado,'base64'),
    'tipo_doc',(p_identity).tipo_doc::text,
    'numero_doc_cifrado',encode((p_identity).numero_doc_cifrado,'base64'),
    'fecha_nacimiento',(p_identity).fecha_nacimiento,
    'email_cifrado',encode((p_identity).email_cifrado,'base64'),
    'telefono_cifrado',encode((p_identity).telefono_cifrado,'base64'),
    'cobertura_nombre',(p_identity).cobertura_nombre,
    'cobertura_plan',(p_identity).cobertura_plan,
    'cobertura_nro_afiliado_cifrado',encode((p_identity).cobertura_nro_afiliado_cifrado,'base64'))
$$;
REVOKE ALL ON FUNCTION folio_intake_private.incorporation_current(public.paciente_identidad)
  FROM PUBLIC,anon,authenticated,service_role;

-- M144 locks patient/identity FOR SHARE; a write must never upgrade those locks.
-- This narrow copy retains its supporting authority locks and scope predicates.
CREATE FUNCTION folio_intake_private.current_visit_for_identity_write(
  p_org uuid,p_turno uuid,p_actor public.member)
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
    OR visit.estado::text NOT IN ('AGENDADO','CONFIRMADO','EN_SALA','ATENDIENDO','CERRADO') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Visit no longer accepts contribution review';
  END IF;
  IF (p_actor).role='PROFESIONAL' THEN
    PERFORM 1 FROM public.turno history WHERE history.organization_id=p_org
      AND history.paciente_id=visit.paciente_id AND history.profesional_id=(p_actor).id
      AND history.deleted_at IS NULL AND history.estado::text IN ('EN_SALA','ATENDIENDO','CERRADO')
      ORDER BY history.id LIMIT 1 FOR SHARE;
    attended:=FOUND;
  END IF;
  SELECT * INTO patient FROM public.paciente WHERE id=visit.paciente_id AND organization_id=p_org
    AND deleted_at IS NULL AND pseudonimizado_en IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current patient required'; END IF;
  IF patient.caja_fuerte_profesional IS NOT NULL
    AND patient.caja_fuerte_profesional IS DISTINCT FROM (p_actor).id THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current patient scope required';
  END IF;
  IF ((p_actor).role IN ('OWNER','DIRECTOR')
    OR ((p_actor).role='PROFESIONAL' AND (p_actor).id=target
      AND (patient.profesional_principal_id=(p_actor).id OR attended))
    OR ((p_actor).role='ASISTENTE' AND patient.caja_fuerte_profesional IS NULL
      AND public.user_has_scope_over(p_org,target))) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current visit scope required';
  END IF;
  SELECT * INTO identity_row FROM public.paciente_identidad
    WHERE id=patient.identidad_id AND organization_id=p_org AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current identity required'; END IF;
  result:=(p_org,visit.id,patient.id,identity_row.id,patient.identity_link_revision,
    organization_revision,patient.intake_revision,identity_row.intake_revision,
    target,visit.inicio,visit.intake_revision)::folio_intake_private.visit_context;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION folio_intake_private.current_visit_for_identity_write(uuid,uuid,public.member)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION folio_intake_private.incorporation_keys_valid(p_keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT p_keys IS NOT NULL AND cardinality(p_keys) BETWEEN 1 AND 10
    AND NOT EXISTS (SELECT 1 FROM unnest(p_keys) k WHERE k IS NULL OR k NOT IN
      ('nombre','apellido','tipoDocumento','numeroDocumento','fechaNacimiento',
       'email','telefono','cobertura.nombre','cobertura.plan','cobertura.numeroAfiliado'))
    AND (SELECT count(DISTINCT k)=count(*) FROM unnest(p_keys) k)
    AND (array_position(p_keys,'tipoDocumento') IS NULL)
      = (array_position(p_keys,'numeroDocumento') IS NULL)
$$;
REVOKE ALL ON FUNCTION folio_intake_private.incorporation_keys_valid(text[])
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.patient_intake_incorporation_snapshot(
  p_org uuid,p_turno uuid,p_receipt uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; ctx folio_intake_private.visit_context;
  source folio_intake_private.submission; identity_row public.paciente_identidad;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  actor:=folio_intake_private.staff(p_org);
  PERFORM folio_intake_private.incorporation_editor(actor);
  ctx:=folio_intake_private.current_visit(p_org,p_turno,actor,true);
  source:=folio_intake_private.incorporation_receipt(p_receipt,ctx);
  SELECT * INTO identity_row FROM public.paciente_identidad
    WHERE id=ctx.identidad_id AND organization_id=p_org AND deleted_at IS NULL FOR SHARE;
  RETURN jsonb_build_object('receiptId',source.id,'questionnaireVersion',source.questionnaire_version,
    'contextHash',folio_intake_private.link_context_hash(ctx),'identityId',identity_row.id,
    'adminRevision',identity_row.admin_revision::text,
    'sourceCipherBase64',encode(source.answers_cifrado,'base64'),
    'current',folio_intake_private.incorporation_current(identity_row));
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_incorporation_snapshot(uuid,uuid,uuid)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.patient_intake_incorporation_snapshot(uuid,uuid,uuid)
  TO authenticated;

CREATE FUNCTION folio_intake_private.incorporation_result(
  p_op folio_intake_private.incorporation_operation)
RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('status',(p_op).status,'operationId',(p_op).operation_id,
    'preparationId',(p_op).preparation_id,'receiptId',(p_op).receipt_id,
    'identityId',(p_op).identidad_id,'selectedKeys',(p_op).selected_keys,
    'changedKeys',(p_op).changed_keys,'revisionBefore',(p_op).revision_before,
    'revisionAfter',(p_op).revision_after,'reason',(p_op).terminal_reason,
    'expiresAt',CASE WHEN (p_op).status IN ('pending','materialized') THEN (p_op).expires_at END)
$$;
REVOKE ALL ON FUNCTION folio_intake_private.incorporation_result(folio_intake_private.incorporation_operation)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.patient_intake_incorporation_prepare(
  p_org uuid,p_turno uuid,p_receipt uuid,p_keys text[],p_expected_identity uuid,
  p_expected_revision bigint,p_expected_context text,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; ctx folio_intake_private.visit_context;
  source folio_intake_private.submission; identity_row public.paciente_identidad;
  prior folio_intake_private.incorporation_operation; actor_session uuid;
  result jsonb; context_hash text;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  actor:=folio_intake_private.staff(p_org);
  PERFORM folio_intake_private.incorporation_editor(actor);
  IF p_operation IS NULL OR p_receipt IS NULL OR p_expected_identity IS NULL
    OR p_expected_revision IS NULL OR p_expected_revision<0
    OR p_expected_context IS NULL OR p_expected_context !~ '^[0-9a-f]{64}$'
    OR NOT folio_intake_private.incorporation_keys_valid(p_keys) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid incorporation preparation';
  END IF;
  ctx:=folio_intake_private.current_visit(p_org,p_turno,actor,true);
  context_hash:=folio_intake_private.link_context_hash(ctx);
  actor_session:=(auth.jwt()->>'session_id')::uuid;
  SELECT * INTO identity_row FROM public.paciente_identidad
    WHERE id=ctx.identidad_id AND organization_id=p_org AND deleted_at IS NULL FOR SHARE;
  SELECT * INTO prior FROM folio_intake_private.incorporation_operation
    WHERE organization_id=p_org AND operation_id=p_operation FOR UPDATE;
  IF FOUND THEN
    IF prior.actor_member_id<>actor.id OR prior.actor_session_id<>actor_session
      OR prior.turno_id<>p_turno THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Incorporation operation belongs to another scope';
    END IF;
    IF prior.status='cancelled' AND prior.preparation_id IS NULL THEN
      RETURN folio_intake_private.incorporation_result(prior);
    END IF;
    IF prior.receipt_id<>p_receipt OR prior.selected_keys<>p_keys
      OR prior.identidad_id<>p_expected_identity
      OR prior.expected_admin_revision<>p_expected_revision
      OR prior.expected_context_hash<>p_expected_context THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Incorporation operation payload changed';
    END IF;
    IF prior.status IN ('pending','materialized') AND
      (prior.paciente_id IS DISTINCT FROM ctx.paciente_id
        OR prior.identidad_id IS DISTINCT FROM ctx.identidad_id
        OR prior.expected_context_hash IS DISTINCT FROM context_hash
        OR prior.expected_admin_revision IS DISTINCT FROM identity_row.admin_revision) THEN
      UPDATE folio_intake_private.incorporation_operation SET status='conflict',
        terminal_reason=CASE WHEN prior.paciente_id IS DISTINCT FROM ctx.paciente_id
          OR prior.identidad_id IS DISTINCT FROM ctx.identidad_id
          OR prior.expected_context_hash IS DISTINCT FROM context_hash
          THEN 'context_changed' ELSE 'snapshot_changed' END,
        finished_at=clock_timestamp()
        WHERE organization_id=p_org AND operation_id=p_operation RETURNING * INTO prior;
      RETURN folio_intake_private.incorporation_result(prior);
    END IF;
    result:=folio_intake_private.incorporation_result(prior);
    IF prior.status='pending' THEN
      result:=result||jsonb_build_object('sourceCipherBase64',encode(prior.source_cipher,'base64'),
        'sourceFingerprint',prior.source_fingerprint,'current',prior.snapshot);
    END IF;
    RETURN result;
  END IF;
  source:=folio_intake_private.incorporation_receipt(p_receipt,ctx);
  INSERT INTO folio_intake_private.incorporation_operation
    (organization_id,operation_id,preparation_id,actor_member_id,actor_session_id,
     turno_id,paciente_id,identidad_id,receipt_id,questionnaire_version,selected_keys,
     expected_admin_revision,expected_context_hash,source_fingerprint,source_cipher,
     snapshot,status,expires_at,finished_at,terminal_reason,revision_before,revision_after)
  VALUES(p_org,p_operation,gen_random_uuid(),actor.id,actor_session,p_turno,
    ctx.paciente_id,ctx.identidad_id,p_receipt,source.questionnaire_version,p_keys,
    p_expected_revision,p_expected_context,source.content_fingerprint,source.answers_cifrado,
    folio_intake_private.incorporation_current(identity_row),
    CASE WHEN identity_row.id=p_expected_identity AND identity_row.admin_revision=p_expected_revision
      AND context_hash=p_expected_context THEN 'pending' ELSE 'conflict' END,
    clock_timestamp()+interval '15 minutes',
    CASE WHEN identity_row.id=p_expected_identity AND identity_row.admin_revision=p_expected_revision
      AND context_hash=p_expected_context THEN NULL ELSE clock_timestamp() END,
    CASE WHEN identity_row.id=p_expected_identity AND identity_row.admin_revision=p_expected_revision
      AND context_hash=p_expected_context THEN NULL ELSE 'snapshot_changed' END,
    CASE WHEN identity_row.id=p_expected_identity AND identity_row.admin_revision=p_expected_revision
      AND context_hash=p_expected_context THEN NULL ELSE identity_row.admin_revision END,
    CASE WHEN identity_row.id=p_expected_identity AND identity_row.admin_revision=p_expected_revision
      AND context_hash=p_expected_context THEN NULL ELSE identity_row.admin_revision END)
  ON CONFLICT (organization_id,operation_id) DO NOTHING;
  SELECT * INTO prior FROM folio_intake_private.incorporation_operation
    WHERE organization_id=p_org AND operation_id=p_operation FOR UPDATE;
  IF prior.actor_member_id<>actor.id OR prior.actor_session_id<>actor_session
    OR prior.turno_id<>p_turno THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Incorporation operation belongs to another scope';
  END IF;
  IF prior.status='cancelled' AND prior.preparation_id IS NULL THEN
    RETURN folio_intake_private.incorporation_result(prior);
  END IF;
  IF prior.receipt_id<>p_receipt OR prior.selected_keys<>p_keys
    OR prior.identidad_id<>p_expected_identity
    OR prior.expected_admin_revision<>p_expected_revision
    OR prior.expected_context_hash<>p_expected_context THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Incorporation operation payload changed';
  END IF;
  IF prior.status IN ('pending','materialized') AND
    (prior.paciente_id IS DISTINCT FROM ctx.paciente_id
      OR prior.identidad_id IS DISTINCT FROM ctx.identidad_id
      OR prior.expected_context_hash IS DISTINCT FROM context_hash
      OR prior.expected_admin_revision IS DISTINCT FROM identity_row.admin_revision) THEN
    UPDATE folio_intake_private.incorporation_operation SET status='conflict',
      terminal_reason=CASE WHEN prior.paciente_id IS DISTINCT FROM ctx.paciente_id
        OR prior.identidad_id IS DISTINCT FROM ctx.identidad_id
        OR prior.expected_context_hash IS DISTINCT FROM context_hash
        THEN 'context_changed' ELSE 'snapshot_changed' END,
      finished_at=clock_timestamp()
      WHERE organization_id=p_org AND operation_id=p_operation RETURNING * INTO prior;
    RETURN folio_intake_private.incorporation_result(prior);
  END IF;
  result:=folio_intake_private.incorporation_result(prior);
  IF prior.status='pending' THEN
    result:=result||jsonb_build_object('sourceCipherBase64',encode(prior.source_cipher,'base64'),
      'sourceFingerprint',prior.source_fingerprint,'current',prior.snapshot);
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_incorporation_prepare(uuid,uuid,uuid,text[],uuid,bigint,text,uuid)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.patient_intake_incorporation_prepare(uuid,uuid,uuid,text[],uuid,bigint,text,uuid)
  TO authenticated;

-- The service cannot attest the clinical truth of AES content; it is trusted to
-- derive this patch from the immutable source. Validate all DB-shape constraints.
CREATE FUNCTION folio_intake_private.incorporation_patch_valid(
  p_patch jsonb,p_selected text[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE field text; value jsonb; base64_fields text[]:=ARRAY[
  'nombre_cifrado','apellido_cifrado','numero_doc_cifrado','email_cifrado',
  'telefono_cifrado','cobertura_nro_afiliado_cifrado'];
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object'
    OR pg_column_size(p_patch)>32768 THEN RETURN false; END IF;
  FOR field,value IN SELECT key,value FROM jsonb_each(p_patch) LOOP
    IF field NOT IN ('nombre_cifrado','apellido_cifrado','nombre_hash','tipo_doc',
      'numero_doc_cifrado','dni_hash','fecha_nacimiento','email_cifrado','email_hash',
      'telefono_cifrado','telefono_hash','cobertura_nombre','cobertura_plan',
      'cobertura_nro_afiliado_cifrado') THEN RETURN false; END IF;
    IF (field IN ('nombre_cifrado','nombre_hash') AND NOT 'nombre'=ANY(p_selected)
        AND NOT (field='nombre_hash' AND 'apellido'=ANY(p_selected)))
      OR (field='apellido_cifrado' AND NOT 'apellido'=ANY(p_selected))
      OR (field IN ('tipo_doc','numero_doc_cifrado','dni_hash')
        AND NOT 'tipoDocumento'=ANY(p_selected))
      OR (field='fecha_nacimiento' AND NOT 'fechaNacimiento'=ANY(p_selected))
      OR (field IN ('email_cifrado','email_hash') AND NOT 'email'=ANY(p_selected))
      OR (field IN ('telefono_cifrado','telefono_hash') AND NOT 'telefono'=ANY(p_selected))
      OR (field='cobertura_nombre' AND NOT 'cobertura.nombre'=ANY(p_selected))
      OR (field='cobertura_plan' AND NOT 'cobertura.plan'=ANY(p_selected))
      OR (field='cobertura_nro_afiliado_cifrado'
        AND NOT 'cobertura.numeroAfiliado'=ANY(p_selected)) THEN RETURN false; END IF;
    IF field=ANY(base64_fields) THEN
      IF jsonb_typeof(value)<>'string' OR length(value#>>'{}')>17408 THEN RETURN false; END IF;
      BEGIN
        IF octet_length(decode(value#>>'{}','base64'))<29 THEN RETURN false; END IF;
      EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation THEN RETURN false;
      END;
    ELSIF field IN ('nombre_hash','dni_hash','email_hash','telefono_hash') THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
    ELSIF field='tipo_doc' THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') NOT IN
        ('DNI','LE','LC','CI','PASAPORTE') THEN RETURN false; END IF;
    ELSIF field='fecha_nacimiento' THEN
      IF jsonb_typeof(value)<>'string' OR (value#>>'{}') !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN false; END IF;
    ELSIF field='cobertura_nombre' THEN
      IF jsonb_typeof(value) NOT IN ('null','string') OR
        (jsonb_typeof(value)='string' AND (length(value#>>'{}') NOT BETWEEN 1 AND 120)) THEN RETURN false; END IF;
    ELSIF field='cobertura_plan' THEN
      IF jsonb_typeof(value)<>'string' OR length(value#>>'{}') NOT BETWEEN 1 AND 40 THEN RETURN false; END IF;
  END LOOP;
  IF (p_patch ? 'nombre_cifrado' OR p_patch ? 'apellido_cifrado')
    AND NOT p_patch ? 'nombre_hash' THEN RETURN false; END IF;
  IF (p_patch ? 'numero_doc_cifrado') <> (p_patch ? 'dni_hash')
    OR (p_patch ? 'email_cifrado') <> (p_patch ? 'email_hash')
    OR (p_patch ? 'telefono_cifrado') <> (p_patch ? 'telefono_hash') THEN RETURN false; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION folio_intake_private.incorporation_patch_valid(jsonb,text[])
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.patient_intake_incorporation_materialize(
  p_preparation uuid,p_patch jsonb,p_source_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior folio_intake_private.incorporation_operation; changed text[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_preparation IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Service materializer required';
  END IF;
  SELECT * INTO prior FROM folio_intake_private.incorporation_operation
    WHERE preparation_id=p_preparation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Preparation unavailable'; END IF;
  IF prior.source_fingerprint IS DISTINCT FROM p_source_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Contribution source changed';
  END IF;
  IF prior.status<>'pending' THEN RETURN folio_intake_private.incorporation_result(prior); END IF;
  IF clock_timestamp()>=prior.expires_at THEN
    UPDATE folio_intake_private.incorporation_operation SET status='cancelled',
      terminal_reason='expired',finished_at=clock_timestamp()
      WHERE organization_id=prior.organization_id AND operation_id=prior.operation_id RETURNING * INTO prior;
    RETURN folio_intake_private.incorporation_result(prior);
  END IF;
  IF NOT folio_intake_private.incorporation_patch_valid(p_patch,prior.selected_keys) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid selective incorporation patch';
  END IF;
  IF p_patch ? 'cobertura_nombre'
    AND (p_patch->>'cobertura_nombre') IS DISTINCT FROM (prior.snapshot->>'cobertura_nombre')
    AND ((prior.snapshot->>'cobertura_plan' IS NOT NULL
        AND NOT 'cobertura.plan'=ANY(prior.selected_keys))
      OR (prior.snapshot->>'cobertura_nro_afiliado_cifrado' IS NOT NULL
        AND NOT 'cobertura.numeroAfiliado'=ANY(prior.selected_keys))) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Coverage dependents must be selected';
  END IF;
  IF p_patch ? 'cobertura_nombre' AND (p_patch->>'cobertura_nombre') IS NULL
    AND ((prior.snapshot->>'cobertura_plan' IS NOT NULL)
      OR (prior.snapshot->>'cobertura_nro_afiliado_cifrado' IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Particular cannot discard coverage dependents';
  END IF;
  IF (p_patch ? 'cobertura_plan' OR p_patch ? 'cobertura_nro_afiliado_cifrado')
    AND coalesce(p_patch->>'cobertura_nombre',prior.snapshot->>'cobertura_nombre') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Coverage name required for dependents';
  END IF;
  SELECT coalesce(array_agg(key ORDER BY key),ARRAY[]::text[]) INTO changed
    FROM (SELECT DISTINCT CASE key
      WHEN 'nombre_cifrado' THEN 'nombre' WHEN 'apellido_cifrado' THEN 'apellido'
      WHEN 'tipo_doc' THEN 'tipoDocumento' WHEN 'numero_doc_cifrado' THEN 'numeroDocumento'
      WHEN 'fecha_nacimiento' THEN 'fechaNacimiento' WHEN 'email_cifrado' THEN 'email'
      WHEN 'telefono_cifrado' THEN 'telefono' WHEN 'cobertura_nombre' THEN 'cobertura.nombre'
      WHEN 'cobertura_plan' THEN 'cobertura.plan'
      WHEN 'cobertura_nro_afiliado_cifrado' THEN 'cobertura.numeroAfiliado'
      ELSE NULL END AS key FROM jsonb_object_keys(p_patch) key) mapped WHERE key IS NOT NULL;
  UPDATE folio_intake_private.incorporation_operation
    SET status='materialized',patch=p_patch,changed_keys=changed
    WHERE organization_id=prior.organization_id AND operation_id=prior.operation_id RETURNING * INTO prior;
  RETURN folio_intake_private.incorporation_result(prior);
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_incorporation_materialize(uuid,jsonb,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.patient_intake_incorporation_materialize(uuid,jsonb,text)
  TO service_role;

CREATE FUNCTION public.patient_intake_incorporation_apply(
  p_org uuid,p_turno uuid,p_preparation uuid,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; ctx folio_intake_private.visit_context;
  prior folio_intake_private.incorporation_operation;
  identity_row public.paciente_identidad; before_revision bigint; actor_session uuid;
  current_context text; patch jsonb;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  actor:=folio_intake_private.staff(p_org);
  PERFORM folio_intake_private.incorporation_editor(actor);
  IF p_operation IS NULL OR p_preparation IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Incorporation operation required';
  END IF;
  -- Acquires patient and identity UPDATE directly; never upgrades M144 SHARE.
  ctx:=folio_intake_private.current_visit_for_identity_write(p_org,p_turno,actor);
  actor_session:=(auth.jwt()->>'session_id')::uuid;
  SELECT * INTO prior FROM folio_intake_private.incorporation_operation
    WHERE organization_id=p_org AND operation_id=p_operation FOR UPDATE;
  IF NOT FOUND OR prior.actor_member_id IS DISTINCT FROM actor.id
    OR prior.actor_session_id IS DISTINCT FROM actor_session OR prior.turno_id IS DISTINCT FROM p_turno
    OR prior.preparation_id IS DISTINCT FROM p_preparation THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Current incorporation preparation required';
  END IF;
  IF prior.status IN ('applied','unchanged','conflict','cancelled') THEN
    RETURN folio_intake_private.incorporation_result(prior);
  END IF;
  IF prior.status='pending' AND clock_timestamp()<prior.expires_at THEN
    RETURN folio_intake_private.incorporation_result(prior);
  END IF;
  IF clock_timestamp()>=prior.expires_at THEN
    UPDATE folio_intake_private.incorporation_operation SET status='cancelled',
      terminal_reason='expired',finished_at=clock_timestamp()
      WHERE organization_id=p_org AND operation_id=p_operation RETURNING * INTO prior;
    RETURN folio_intake_private.incorporation_result(prior);
  END IF;
  SELECT * INTO identity_row FROM public.paciente_identidad WHERE id=ctx.identidad_id;
  current_context:=folio_intake_private.link_context_hash(ctx);
  IF prior.identidad_id IS DISTINCT FROM identity_row.id
    OR prior.paciente_id IS DISTINCT FROM ctx.paciente_id
    OR prior.expected_context_hash IS DISTINCT FROM current_context
    OR prior.expected_admin_revision IS DISTINCT FROM identity_row.admin_revision THEN
    UPDATE folio_intake_private.incorporation_operation SET status='conflict',
      terminal_reason='snapshot_changed',revision_before=identity_row.admin_revision,
      revision_after=identity_row.admin_revision,finished_at=clock_timestamp()
      WHERE organization_id=p_org AND operation_id=p_operation RETURNING * INTO prior;
    RETURN folio_intake_private.incorporation_result(prior);
  END IF;
  before_revision:=identity_row.admin_revision;
  patch:=prior.patch;
  IF patch='{}'::jsonb THEN
    UPDATE folio_intake_private.incorporation_operation SET status='unchanged',
      revision_before=before_revision,revision_after=before_revision,finished_at=clock_timestamp()
      WHERE organization_id=p_org AND operation_id=p_operation RETURNING * INTO prior;
    RETURN folio_intake_private.incorporation_result(prior);
  END IF;
  -- Static column list: no SQL identifier or patient value comes from the caller.
  UPDATE public.paciente_identidad SET
    nombre_cifrado=CASE WHEN patch ? 'nombre_cifrado' THEN decode(patch->>'nombre_cifrado','base64') ELSE nombre_cifrado END,
    apellido_cifrado=CASE WHEN patch ? 'apellido_cifrado' THEN decode(patch->>'apellido_cifrado','base64') ELSE apellido_cifrado END,
    nombre_hash=CASE WHEN patch ? 'nombre_hash' THEN patch->>'nombre_hash' ELSE nombre_hash END,
    tipo_doc=CASE WHEN patch ? 'tipo_doc' THEN (patch->>'tipo_doc')::public.tipo_doc ELSE tipo_doc END,
    numero_doc_cifrado=CASE WHEN patch ? 'numero_doc_cifrado' THEN decode(patch->>'numero_doc_cifrado','base64') ELSE numero_doc_cifrado END,
    dni_hash=CASE WHEN patch ? 'dni_hash' THEN patch->>'dni_hash' ELSE dni_hash END,
    fecha_nacimiento=CASE WHEN patch ? 'fecha_nacimiento' THEN (patch->>'fecha_nacimiento')::date ELSE fecha_nacimiento END,
    email_cifrado=CASE WHEN patch ? 'email_cifrado' THEN decode(patch->>'email_cifrado','base64') ELSE email_cifrado END,
    email_hash=CASE WHEN patch ? 'email_hash' THEN patch->>'email_hash' ELSE email_hash END,
    telefono_cifrado=CASE WHEN patch ? 'telefono_cifrado' THEN decode(patch->>'telefono_cifrado','base64') ELSE telefono_cifrado END,
    telefono_hash=CASE WHEN patch ? 'telefono_hash' THEN patch->>'telefono_hash' ELSE telefono_hash END,
    cobertura_nombre=CASE WHEN patch ? 'cobertura_nombre' THEN patch->>'cobertura_nombre' ELSE cobertura_nombre END,
    cobertura_plan=CASE WHEN patch ? 'cobertura_plan' THEN patch->>'cobertura_plan' ELSE cobertura_plan END,
    cobertura_nro_afiliado_cifrado=CASE WHEN patch ? 'cobertura_nro_afiliado_cifrado' THEN decode(patch->>'cobertura_nro_afiliado_cifrado','base64') ELSE cobertura_nro_afiliado_cifrado END
    WHERE id=identity_row.id AND organization_id=p_org AND admin_revision=before_revision
    RETURNING * INTO identity_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Identity CAS lost under lock';
  END IF;
  IF identity_row.admin_revision<>before_revision+1 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='Administrative revision did not advance';
  END IF;
  UPDATE folio_intake_private.incorporation_operation SET status='applied',
    revision_before=before_revision,revision_after=identity_row.admin_revision,
    finished_at=clock_timestamp()
    WHERE organization_id=p_org AND operation_id=p_operation RETURNING * INTO prior;
  INSERT INTO folio_intake_private.incorporation_provenance
    (organization_id,operation_id,turno_id,paciente_id,identidad_id,receipt_id,
     actor_member_id,actor_session_id,selected_keys,changed_keys,revision_before,revision_after)
    VALUES(p_org,p_operation,p_turno,ctx.paciente_id,identity_row.id,prior.receipt_id,
      actor.id,actor_session,prior.selected_keys,prior.changed_keys,
      before_revision,identity_row.admin_revision);
  RETURN folio_intake_private.incorporation_result(prior);
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_incorporation_apply(uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.patient_intake_incorporation_apply(uuid,uuid,uuid,uuid)
  TO authenticated;

CREATE FUNCTION public.patient_intake_incorporation_status(
  p_org uuid,p_turno uuid,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; ctx folio_intake_private.visit_context;
  prior folio_intake_private.incorporation_operation; actor_session uuid;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  actor:=folio_intake_private.staff(p_org);
  PERFORM folio_intake_private.incorporation_editor(actor);
  IF p_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Operation required'; END IF;
  ctx:=folio_intake_private.current_visit(p_org,p_turno,actor,true);
  actor_session:=(auth.jwt()->>'session_id')::uuid;
  SELECT * INTO prior FROM folio_intake_private.incorporation_operation
    WHERE organization_id=p_org AND operation_id=p_operation;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_recorded','operationId',p_operation); END IF;
  IF prior.actor_member_id<>actor.id OR prior.actor_session_id<>actor_session
    OR prior.turno_id<>p_turno THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Incorporation operation belongs to another scope';
  END IF;
  RETURN folio_intake_private.incorporation_result(prior);
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_incorporation_status(uuid,uuid,uuid)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.patient_intake_incorporation_status(uuid,uuid,uuid)
  TO authenticated;

CREATE FUNCTION public.patient_intake_incorporation_cancel(
  p_org uuid,p_turno uuid,p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor public.member; ctx folio_intake_private.visit_context;
  prior folio_intake_private.incorporation_operation; actor_session uuid;
BEGIN
  PERFORM folio_mfa_private.assert_access();
  actor:=folio_intake_private.staff(p_org);
  PERFORM folio_intake_private.incorporation_editor(actor);
  IF p_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Operation required'; END IF;
  ctx:=folio_intake_private.current_visit(p_org,p_turno,actor,true);
  actor_session:=(auth.jwt()->>'session_id')::uuid;
  INSERT INTO folio_intake_private.incorporation_operation
    (organization_id,operation_id,actor_member_id,actor_session_id,turno_id,
     status,terminal_reason,finished_at)
    VALUES(p_org,p_operation,actor.id,actor_session,p_turno,'cancelled','cancel_before_prepare',clock_timestamp())
    ON CONFLICT (organization_id,operation_id) DO NOTHING;
  SELECT * INTO prior FROM folio_intake_private.incorporation_operation
    WHERE organization_id=p_org AND operation_id=p_operation FOR UPDATE;
  IF prior.actor_member_id<>actor.id OR prior.actor_session_id<>actor_session
    OR prior.turno_id<>p_turno THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Incorporation operation belongs to another scope';
  END IF;
  IF prior.status IN ('pending','materialized') THEN
    UPDATE folio_intake_private.incorporation_operation SET status='cancelled',
      terminal_reason='cancelled_by_actor',finished_at=clock_timestamp()
      WHERE organization_id=p_org AND operation_id=p_operation RETURNING * INTO prior;
  END IF;
  RETURN folio_intake_private.incorporation_result(prior);
END $$;
REVOKE ALL ON FUNCTION public.patient_intake_incorporation_cancel(uuid,uuid,uuid)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.patient_intake_incorporation_cancel(uuid,uuid,uuid)
  TO authenticated;
