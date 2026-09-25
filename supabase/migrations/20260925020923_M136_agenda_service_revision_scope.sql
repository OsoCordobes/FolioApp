-- M135 records a service-catalog revision on organization for each direct
-- service write. M111 already records that same write on servicio. Ignore only
-- the bookkeeping UPDATE, including its automatic updated_at touch, so one
-- service change still produces exactly one agenda invalidation.
CREATE OR REPLACE FUNCTION folio_agenda_private.record_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n jsonb; o jsonb; org_ids uuid[]; org_id uuid;
BEGIN
 IF TG_OP<>'DELETE' THEN n:=to_jsonb(NEW);END IF;
 IF TG_OP<>'INSERT' THEN o:=to_jsonb(OLD);END IF;
 IF TG_TABLE_NAME='organization' AND TG_OP='UPDATE'
   AND n->'onboarding_services_revision' IS DISTINCT FROM o->'onboarding_services_revision'
   AND (n-'onboarding_services_revision'-'updated_at')
     IS NOT DISTINCT FROM (o-'onboarding_services_revision'-'updated_at') THEN
  RETURN NULL;
 END IF;
 IF n IS NOT DISTINCT FROM o THEN RETURN NULL;END IF;
 IF TG_TABLE_NAME='organization' THEN
  org_ids:=ARRAY[(n->>'id')::uuid,(o->>'id')::uuid];
 ELSIF TG_TABLE_NAME='pago' THEN
  SELECT array_agg(DISTINCT organization_id) INTO org_ids FROM public.turno
   WHERE id IN ((n->>'turno_id')::uuid,(o->>'turno_id')::uuid);
 ELSIF TG_TABLE_NAME='profile' THEN
  -- The professional label comes from profile, shared by memberships. Never
  -- expose its content in the marker or invalidate unrelated organizations.
  SELECT array_agg(DISTINCT organization_id) INTO org_ids FROM public.member
   WHERE profile_id IN ((n->>'id')::uuid,(o->>'id')::uuid) AND deleted_at IS NULL;
 ELSE
  org_ids:=ARRAY[(n->>'organization_id')::uuid,(o->>'organization_id')::uuid];
 END IF;
 FOR org_id IN SELECT DISTINCT v FROM unnest(org_ids) v WHERE v IS NOT NULL ORDER BY v LOOP
  IF EXISTS(SELECT 1 FROM public.organization WHERE id=org_id) THEN
   INSERT INTO folio_agenda_private.revision(organization_id,value) VALUES(org_id,1)
   ON CONFLICT(organization_id) DO UPDATE SET value=folio_agenda_private.revision.value+1;
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION folio_agenda_private.record_change() FROM PUBLIC,anon,authenticated;
