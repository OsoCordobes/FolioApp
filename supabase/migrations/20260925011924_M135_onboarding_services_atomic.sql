-- M135: one authenticated, versioned transaction for onboarding services.
-- Existing service IDs and dependent bookings/assignments are never deleted.
ALTER TABLE public.organization
  ADD COLUMN onboarding_services_revision bigint NOT NULL DEFAULT 0
  CONSTRAINT organization_onboarding_services_revision_nonnegative
  CHECK (onboarding_services_revision >= 0);

CREATE SCHEMA folio_onboarding_services_private;
REVOKE ALL ON SCHEMA folio_onboarding_services_private FROM PUBLIC, anon, service_role;

CREATE TABLE folio_onboarding_services_private.authority (
  tx bigint NOT NULL,
  organization_id uuid NOT NULL,
  PRIMARY KEY (tx, organization_id)
);
CREATE TABLE folio_onboarding_services_private.receipt (
  organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, operation_id)
);
ALTER TABLE folio_onboarding_services_private.authority ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_onboarding_services_private.receipt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA folio_onboarding_services_private FROM PUBLIC, anon, authenticated, service_role;

-- A direct organization UPDATE cannot forge the catalog revision used by CAS.
CREATE FUNCTION folio_onboarding_services_private.guard_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.onboarding_services_revision IS DISTINCT FROM OLD.onboarding_services_revision
    AND NOT EXISTS (
      SELECT 1 FROM folio_onboarding_services_private.authority a
      WHERE a.tx=txid_current() AND a.organization_id=NEW.id
    ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Service revision is managed by the database';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_onboarding_services_revision_guard
  BEFORE UPDATE OF onboarding_services_revision ON public.organization
  FOR EACH ROW EXECUTE FUNCTION folio_onboarding_services_private.guard_revision();

-- Legacy/direct service writes invalidate snapshots until all writers use the
-- RPC. The RPC's private authority suppresses per-row bumps and makes one bump.
CREATE FUNCTION folio_onboarding_services_private.bump_one(p_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM folio_onboarding_services_private.authority a
    WHERE a.tx=txid_current() AND a.organization_id=p_org
  ) AND EXISTS (
    SELECT 1 FROM public.organization o WHERE o.id=p_org
      AND o.deleted_at IS NULL AND NOT o.onboarding_completed
  ) THEN
    INSERT INTO folio_onboarding_services_private.authority(tx,organization_id)
      VALUES(txid_current(),p_org) ON CONFLICT DO NOTHING;
    UPDATE public.organization SET onboarding_services_revision=onboarding_services_revision+1
      WHERE id=p_org;
    DELETE FROM folio_onboarding_services_private.authority
      WHERE tx=txid_current() AND organization_id=p_org;
  END IF;
END $$;
CREATE FUNCTION folio_onboarding_services_private.bump_on_service_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM folio_onboarding_services_private.bump_one(NEW.organization_id);
  ELSIF TG_OP='DELETE' THEN
    PERFORM folio_onboarding_services_private.bump_one(OLD.organization_id);
  ELSE
    PERFORM folio_onboarding_services_private.bump_one(NEW.organization_id);
    IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
      PERFORM folio_onboarding_services_private.bump_one(OLD.organization_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER servicio_onboarding_revision
  AFTER INSERT OR UPDATE OR DELETE ON public.servicio
  FOR EACH ROW EXECUTE FUNCTION folio_onboarding_services_private.bump_on_service_change();

CREATE FUNCTION folio_onboarding_services_private.assert_owner(p_org uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid();
BEGIN
  PERFORM folio_mfa_private.assert_access();
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.member m
    WHERE m.organization_id=p_org AND m.profile_id=actor
      AND m.role='OWNER' AND m.deleted_at IS NULL
      AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
    FOR SHARE
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current setup owner required';
  END IF;
  RETURN actor;
END $$;

CREATE FUNCTION folio_onboarding_services_private.read_snapshot(p_org uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE version bigint;
BEGIN
  PERFORM folio_onboarding_services_private.assert_owner(p_org);
  SELECT o.onboarding_services_revision INTO version FROM public.organization o
    WHERE o.id=p_org AND o.deleted_at IS NULL AND NOT o.onboarding_completed;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Onboarding is no longer open';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'revision',version,
    'servicios',COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',s.id,'nombre',s.nombre,'dur',s.duracion_min,
        'precioCents',s.precio_cents,'tipoCanonico',s.tipo_canonico
      ) ORDER BY s.created_at,s.id)
      FROM public.servicio s WHERE s.organization_id=p_org AND s.deleted_at IS NULL
    ),'[]'::jsonb)
  );
END $$;

CREATE FUNCTION folio_onboarding_services_private.save_snapshot(
  p_org uuid,p_expected_revision bigint,p_operation uuid,p_services jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid; org_row public.organization%ROWTYPE; prior folio_onboarding_services_private.receipt%ROWTYPE;
        digest text; next_revision bigint; next_step smallint; result jsonb;
        normalized_services jsonb; row_count int; written_count int; owner_treating boolean;
BEGIN
  actor:=folio_onboarding_services_private.assert_owner(p_org);
  IF p_expected_revision IS NULL OR p_expected_revision<0 OR p_operation IS NULL
    OR p_services IS NULL OR pg_catalog.jsonb_typeof(p_services)<>'array'
    OR pg_catalog.jsonb_array_length(p_services)>30 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Complete versioned service command required';
  END IF;
  row_count:=pg_catalog.jsonb_array_length(p_services);
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_services) AS e(value)
    WHERE pg_catalog.jsonb_typeof(e.value) IS DISTINCT FROM 'object'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid service snapshot';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_services) AS e(value)
    WHERE (SELECT pg_catalog.array_agg(keys.key ORDER BY keys.key)
           FROM pg_catalog.jsonb_object_keys(e.value) AS keys(key))
      IS DISTINCT FROM ARRAY['dur','id','nombre','precioCents','tipoCanonico']::text[]
      OR pg_catalog.jsonb_typeof(e.value->'id') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(e.value->'nombre') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(e.value->'dur') IS DISTINCT FROM 'number'
      OR pg_catalog.jsonb_typeof(e.value->'precioCents') IS DISTINCT FROM 'number'
      OR pg_catalog.jsonb_typeof(e.value->'tipoCanonico') IS DISTINCT FROM 'string'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid service snapshot';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_services) AS e(value)
    WHERE (e.value->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR length(btrim(e.value->>'nombre')) NOT BETWEEN 1 AND 120
      OR (e.value->>'dur') !~ '^[0-9]+$'
      OR (e.value->>'precioCents') !~ '^[0-9]+$'
      OR (e.value->>'tipoCanonico') NOT IN (
        'CONSULTA_INICIAL','SEGUIMIENTO_ESTANDAR','SEGUIMIENTO_EXTENDIDO',
        'PACK_SESIONES','SERVICIO_ESPECIALIZADO'
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid service snapshot';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_services) AS e(value)
    WHERE (e.value->>'dur')::numeric NOT BETWEEN 5 AND 480
      OR (e.value->>'precioCents')::numeric NOT BETWEEN 0 AND 2147483647
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid service snapshot';
  END IF;
  IF (SELECT count(DISTINCT (e.value->>'id')::uuid)
      FROM pg_catalog.jsonb_array_elements(p_services) AS e(value))<>row_count THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Duplicate service IDs';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_set(e.value,'{nombre}',pg_catalog.to_jsonb(btrim(e.value->>'nombre')))
    ORDER BY e.ordinality),'[]'::jsonb) INTO normalized_services
    FROM pg_catalog.jsonb_array_elements(p_services) WITH ORDINALITY AS e(value,ordinality);
  SELECT * INTO org_row FROM public.organization WHERE id=p_org FOR UPDATE;
  IF NOT FOUND OR org_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Organization unavailable';
  END IF;
  SELECT m.es_colegiado INTO owner_treating FROM public.member m
    WHERE m.organization_id=p_org AND m.profile_id=actor AND m.role='OWNER'
      AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
    LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current setup owner required';
  END IF;
  digest:=encode(pg_catalog.sha256(convert_to(
    pg_catalog.jsonb_build_array(p_expected_revision,normalized_services)::text,'UTF8'
  )),'hex');
  SELECT * INTO prior FROM folio_onboarding_services_private.receipt
    WHERE organization_id=p_org AND operation_id=p_operation;
  IF FOUND THEN
    IF prior.actor_id IS DISTINCT FROM actor OR prior.request_hash IS DISTINCT FROM digest THEN
      RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Service operation changed';
    END IF;
    RETURN prior.result;
  END IF;
  -- A clinic administrator skips availability: Step 4 goes straight to 6.
  IF org_row.onboarding_completed OR org_row.onboarding_step_max <
      CASE WHEN org_row.tipo='CLINICA' AND owner_treating IS FALSE THEN 4 ELSE 5 END THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Onboarding service step unavailable';
  END IF;
  IF org_row.tipo='INDEPENDIENTE' AND row_count=0 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Solo practice requires a service';
  END IF;
  IF org_row.onboarding_services_revision<>p_expected_revision THEN
    RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Services changed since reading';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.servicio s
    JOIN pg_catalog.jsonb_array_elements(normalized_services) AS e(value)
      ON s.id=(e.value->>'id')::uuid
    WHERE s.organization_id<>p_org
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Service belongs to another organization';
  END IF;
  INSERT INTO folio_onboarding_services_private.authority(tx,organization_id)
    VALUES(txid_current(),p_org);
  INSERT INTO public.servicio(id,organization_id,nombre,tipo_canonico,duracion_min,precio_cents,activo,deleted_at)
    SELECT s.id,p_org,btrim(s.nombre),s."tipoCanonico"::public.tipo_servicio_canonico,
      s.dur,s."precioCents",true,NULL
    FROM pg_catalog.jsonb_to_recordset(normalized_services) AS s(
      id uuid,nombre text,dur smallint,"precioCents" integer,"tipoCanonico" text
    )
    ORDER BY s.id
    ON CONFLICT (id) DO UPDATE SET
      nombre=EXCLUDED.nombre,tipo_canonico=EXCLUDED.tipo_canonico,
      duracion_min=EXCLUDED.duracion_min,precio_cents=EXCLUDED.precio_cents,
      activo=true,deleted_at=NULL
      WHERE public.servicio.organization_id=p_org;
  GET DIAGNOSTICS written_count = ROW_COUNT;
  IF written_count<>row_count THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Service ID scope changed';
  END IF;
  UPDATE public.servicio s SET deleted_at=now(),activo=false
    WHERE s.organization_id=p_org AND s.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(normalized_services) AS e(value)
        WHERE (e.value->>'id')::uuid=s.id
      );
  UPDATE public.organization
    SET onboarding_services_revision=onboarding_services_revision+1,
        onboarding_step_max=greatest(onboarding_step_max,6)
    WHERE id=p_org RETURNING onboarding_services_revision,onboarding_step_max
      INTO next_revision,next_step;
  IF next_revision IS DISTINCT FROM p_expected_revision+1 OR next_step IS NULL OR next_step<6 THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Service progress not confirmed';
  END IF;
  DELETE FROM folio_onboarding_services_private.authority
    WHERE tx=txid_current() AND organization_id=p_org;
  result:=pg_catalog.jsonb_build_object('revision',next_revision,'servicios',
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',s.id,'nombre',s.nombre,'dur',s.duracion_min,
      'precioCents',s.precio_cents,'tipoCanonico',s.tipo_canonico
    ) ORDER BY e.ordinality)
    FROM pg_catalog.jsonb_array_elements(normalized_services) WITH ORDINALITY AS e(value,ordinality)
    JOIN public.servicio s ON s.id=(e.value->>'id')::uuid
      AND s.organization_id=p_org AND s.deleted_at IS NULL),'[]'::jsonb));
  IF pg_catalog.jsonb_array_length(result->'servicios')<>row_count THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Service result not confirmed';
  END IF;
  INSERT INTO folio_onboarding_services_private.receipt(
    organization_id,operation_id,actor_id,request_hash,result
  ) VALUES(p_org,p_operation,actor,digest,result);
  RETURN result;
END $$;

CREATE FUNCTION public.read_onboarding_services(p_org uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT folio_onboarding_services_private.read_snapshot(p_org)
$$;
CREATE FUNCTION public.save_onboarding_services(
  p_org uuid,p_expected_revision bigint,p_operation uuid,p_services jsonb
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT folio_onboarding_services_private.save_snapshot(
    p_org,p_expected_revision,p_operation,p_services
  )
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA folio_onboarding_services_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_onboarding_services(uuid),
  public.save_onboarding_services(uuid,bigint,uuid,jsonb) FROM PUBLIC, anon, service_role;
GRANT USAGE ON SCHEMA folio_onboarding_services_private TO authenticated;
GRANT EXECUTE ON FUNCTION folio_onboarding_services_private.read_snapshot(uuid),
  folio_onboarding_services_private.save_snapshot(uuid,bigint,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_onboarding_services(uuid),
  public.save_onboarding_services(uuid,bigint,uuid,jsonb) TO authenticated;
