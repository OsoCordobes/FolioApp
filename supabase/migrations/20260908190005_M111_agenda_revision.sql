CREATE SCHEMA folio_agenda_private;
REVOKE ALL ON SCHEMA folio_agenda_private FROM PUBLIC, anon, authenticated;
CREATE TABLE folio_agenda_private.revision (
 organization_id uuid PRIMARY KEY REFERENCES public.organization(id) ON DELETE CASCADE,
 value bigint NOT NULL DEFAULT 0 CHECK(value>=0)
);
REVOKE ALL ON TABLE folio_agenda_private.revision FROM PUBLIC,anon,authenticated;

CREATE FUNCTION folio_agenda_private.record_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n jsonb; o jsonb; org_ids uuid[]; org_id uuid;
BEGIN
 IF TG_OP<>'DELETE' THEN n:=to_jsonb(NEW);END IF;
 IF TG_OP<>'INSERT' THEN o:=to_jsonb(OLD);END IF;
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

DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['organization','member','turno','pedido','bloqueo','disponibilidad_profesional','servicio','paciente_identidad','paciente','pago','sesion','profile','suscripcion'] LOOP
  EXECUTE format('CREATE TRIGGER folio_agenda_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION folio_agenda_private.record_change()',t);
 END LOOP;
END $$;

-- Private clock parameter enables deterministic boundary tests. No client can
-- choose the clock; the public RPC below always uses the database clock.
CREATE FUNCTION folio_agenda_private.revision_at(p_org uuid,p_at timestamptz) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(r.value,0)::text || ':' || to_char(p_at AT TIME ZONE o.timezone,'YYYY-MM-DD')
 FROM public.organization o LEFT JOIN folio_agenda_private.revision r ON r.organization_id=o.id
 WHERE o.id=p_org
$$;
REVOKE ALL ON FUNCTION folio_agenda_private.revision_at(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_agenda_revision(p_org uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM folio_mfa_private.assert_access();
 IF auth.uid() IS NULL OR p_org IS NULL OR p_org NOT IN(SELECT public.user_org_ids()) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Agenda access denied';
 END IF;
 RETURN folio_agenda_private.revision_at(p_org,CURRENT_TIMESTAMP);
END $$;
REVOKE ALL ON FUNCTION public.read_agenda_revision(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.read_agenda_revision(uuid) TO authenticated;
COMMENT ON FUNCTION public.read_agenda_revision(uuid) IS 'M111: scoped, MFA-gated counter:local-date marker without patient data. Counter commits/rolls back with source mutations; local date detects midnight even without writes.';
