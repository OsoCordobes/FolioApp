-- M118: payment-provider state, trial dates and exemptions are platform-owned facts.
-- No clinical gate or data rewrite. Safe before or after the current app release.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE SCHEMA folio_billing_authority_private;
REVOKE ALL ON SCHEMA folio_billing_authority_private FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION folio_billing_authority_private.guard_subscription_write() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  -- Checking the original SQL role prevents a SECURITY DEFINER helper called
  -- by an authenticated account from inheriting the platform exception.
  IF coalesce(current_setting('role',true),'') IN ('anon','authenticated')
    OR current_user NOT IN ('postgres','service_role','supabase_admin') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Subscription changes require platform billing authority';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION folio_billing_authority_private.guard_subscription_write() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER subscription_platform_write BEFORE INSERT OR UPDATE OR DELETE ON public.suscripcion
  FOR EACH ROW EXECUTE FUNCTION folio_billing_authority_private.guard_subscription_write();
CREATE TRIGGER subscription_platform_truncate BEFORE TRUNCATE ON public.suscripcion
  FOR EACH STATEMENT EXECUTE FUNCTION folio_billing_authority_private.guard_subscription_write();

DROP POLICY suscripcion_write_owner ON public.suscripcion;
-- The historical no-delete policy is permissive: false does not override a
-- permissive FOR ALL policy. Removing that writer restores the SELECT-only RLS.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.suscripcion FROM PUBLIC,anon,authenticated;
-- Table revocation does not remove any independently granted column privileges.
DO $$ DECLARE col record; BEGIN
  FOR col IN SELECT attname FROM pg_attribute WHERE attrelid='public.suscripcion'::regclass AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.suscripcion FROM PUBLIC, anon, authenticated',col.attname,col.attname,col.attname);
  END LOOP;
END $$;

CREATE FUNCTION folio_billing_authority_private.guard_platform_org_settings() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF coalesce(current_setting('role',true),'') IN ('anon','authenticated')
    OR current_user NOT IN ('postgres','service_role','supabase_admin') THEN
    -- Same authority as M98, with separate objects: this patch also works on
    -- the published M97 schema before the other security migrations arrive.
    IF (TG_OP='INSERT' AND NEW.is_internal_account IS TRUE)
      OR (TG_OP='UPDATE' AND NEW.is_internal_account IS DISTINCT FROM OLD.is_internal_account) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Internal account status requires platform administration';
    END IF;
    IF (TG_OP='UPDATE' AND NEW.created_at IS DISTINCT FROM OLD.created_at)
      OR (TG_OP='INSERT' AND NEW.created_at IS DISTINCT FROM transaction_timestamp()) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Organization creation date is managed by the platform';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION folio_billing_authority_private.guard_platform_org_settings() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER organization_platform_settings_guard BEFORE INSERT OR UPDATE OF created_at,is_internal_account ON public.organization
  FOR EACH ROW EXECUTE FUNCTION folio_billing_authority_private.guard_platform_org_settings();
COMMIT;
