-- M132 · A member row keeps the same Auth principal and tenant for its life.
-- M02 owner UPDATE rights otherwise permit a temporary profile_id swap that
-- forges M130's self-consent and remains visible after the principal is restored.
-- Invitation acceptance inserts or revives the same (organization_id, profile_id);
-- visual profile, role, scope and soft-delete updates remain available.

CREATE FUNCTION public.member_identity_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Member identity cannot be reassigned';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.member_identity_immutable() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER member_identity_immutable_guard
  BEFORE UPDATE OF profile_id, organization_id ON public.member
  FOR EACH ROW EXECUTE FUNCTION public.member_identity_immutable();
