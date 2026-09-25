-- M130 · Shared miniweb layout, confirmed map and self-owned Clinic page consent.
-- Additive; a missing consent row is disabled. No member UPDATE permission changes.

ALTER TABLE public.organization
  ADD COLUMN miniweb_layout text,
  ADD COLUMN maps_embed_url text,
  ADD COLUMN maps_confirmed_address text;

ALTER TABLE public.organization
  ADD CONSTRAINT organization_miniweb_layout_check
    CHECK (miniweb_layout IS NULL OR miniweb_layout IN ('perfil', 'consultorio')),
  ADD CONSTRAINT organization_miniweb_map_pair_check
    CHECK ((maps_embed_url IS NULL AND maps_confirmed_address IS NULL)
      OR (maps_embed_url IS NOT NULL AND maps_confirmed_address IS NOT NULL
        AND direccion_completa IS NOT NULL
        AND maps_confirmed_address = direccion_completa));

CREATE FUNCTION public.clear_miniweb_map_on_address_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.direccion_completa IS DISTINCT FROM OLD.direccion_completa THEN
    NEW.maps_embed_url := NULL;
    NEW.maps_confirmed_address := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.clear_miniweb_map_on_address_change() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER organization_miniweb_map_address_guard
  BEFORE UPDATE OF direccion_completa ON public.organization
  FOR EACH ROW EXECUTE FUNCTION public.clear_miniweb_map_on_address_change();

CREATE TABLE public.member_miniweb_consent (
  id uuid PRIMARY KEY REFERENCES public.member(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_miniweb_consent_org_idx ON public.member_miniweb_consent(organization_id);
ALTER TABLE public.member_miniweb_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_miniweb_consent FORCE ROW LEVEL SECURITY;
CREATE POLICY folio_mfa_gate ON public.member_miniweb_consent AS RESTRICTIVE
  FOR ALL TO authenticated USING (public.mfa_access_allowed())
  WITH CHECK (public.mfa_access_allowed());
REVOKE ALL ON public.member_miniweb_consent FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.member_miniweb_consent TO authenticated, service_role;
GRANT INSERT (id, organization_id, enabled) ON public.member_miniweb_consent TO authenticated;
GRANT UPDATE (enabled) ON public.member_miniweb_consent TO authenticated;

-- A member's OWNER may update member broadly under M02. This separate table
-- has no OWNER branch: only that professional's current auth identity can opt in.
CREATE POLICY member_miniweb_consent_self_select ON public.member_miniweb_consent
  FOR SELECT TO authenticated USING (
    public.mfa_access_allowed() AND EXISTS (
      SELECT 1 FROM public.member m JOIN public.organization o ON o.id = m.organization_id
      WHERE m.id = member_miniweb_consent.id
        AND m.organization_id = member_miniweb_consent.organization_id
        AND m.profile_id = auth.uid() AND m.es_colegiado
        AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
        AND o.tipo = 'CLINICA' AND o.deleted_at IS NULL
    )
  );
CREATE POLICY member_miniweb_consent_self_insert ON public.member_miniweb_consent
  FOR INSERT TO authenticated WITH CHECK (
    enabled AND public.mfa_access_allowed() AND EXISTS (
      SELECT 1 FROM public.member m JOIN public.organization o ON o.id = m.organization_id
      WHERE m.id = member_miniweb_consent.id
        AND m.organization_id = member_miniweb_consent.organization_id
        AND m.profile_id = auth.uid() AND m.es_colegiado
        AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
        AND o.tipo = 'CLINICA' AND o.deleted_at IS NULL
    )
  );
CREATE POLICY member_miniweb_consent_self_update ON public.member_miniweb_consent
  FOR UPDATE TO authenticated USING (
    public.mfa_access_allowed() AND EXISTS (
      SELECT 1 FROM public.member m JOIN public.organization o ON o.id = m.organization_id
      WHERE m.id = member_miniweb_consent.id
        AND m.organization_id = member_miniweb_consent.organization_id
        AND m.profile_id = auth.uid() AND m.es_colegiado
        AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
        AND o.tipo = 'CLINICA' AND o.deleted_at IS NULL
    )
  ) WITH CHECK (
    public.mfa_access_allowed() AND EXISTS (
      SELECT 1 FROM public.member m JOIN public.organization o ON o.id = m.organization_id
      WHERE m.id = member_miniweb_consent.id
        AND m.organization_id = member_miniweb_consent.organization_id
        AND m.profile_id = auth.uid() AND m.es_colegiado
        AND m.deleted_at IS NULL AND (m.accepted_at IS NOT NULL OR m.invited_by_id IS NULL)
        AND o.tipo = 'CLINICA' AND o.deleted_at IS NULL
    )
  );

-- A repeated enabled value does not create another audit transition.
CREATE FUNCTION public.member_miniweb_consent_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.enabled IS NOT DISTINCT FROM OLD.enabled THEN RETURN NULL; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.member_miniweb_consent_transition() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER member_miniweb_consent_noop_guard
  BEFORE UPDATE ON public.member_miniweb_consent
  FOR EACH ROW EXECUTE FUNCTION public.member_miniweb_consent_transition();
CREATE TRIGGER member_miniweb_consent_audit
  AFTER INSERT OR UPDATE ON public.member_miniweb_consent
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();
