-- M98: apply before the application release that calls portal_link_verified_patient.
-- No data rewrite. Direct SaaS clients cannot grant their own billing exemption.
CREATE OR REPLACE FUNCTION public.guard_organization_internal_account()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.is_internal_account IS TRUE) OR
     (TG_OP = 'UPDATE' AND NEW.is_internal_account IS DISTINCT FROM OLD.is_internal_account) THEN
    -- Inspect the calling SQL role, not membership/OWNER and not user metadata.
    -- The role setting also prevents a client invoking a definer helper from
    -- accidentally inheriting the function owner's administrative exception.
    IF coalesce(current_setting('role', true), '') IN ('anon', 'authenticated') OR
       current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
      RAISE EXCEPTION 'Internal account status requires platform administration'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_organization_internal_account() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER organization_internal_account_guard
  BEFORE INSERT OR UPDATE OF is_internal_account ON public.organization
  FOR EACH ROW EXECUTE FUNCTION public.guard_organization_internal_account();

-- Invoker functions preserve caller RLS, including patient assignment and vault.
-- The explicit clinical predicate also prevents a dual staff/portal identity
-- using its portal SELECT policy to widen its staff permissions.
CREATE OR REPLACE FUNCTION public.paciente_tiene_alergias_severas(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.alergia a JOIN public.paciente p ON p.id = a.paciente_id
    WHERE p.id = p_id AND a.organization_id = p.organization_id
      AND a.activa = true AND a.severidad IN ('SEVERA', 'ANAFILAXIA')
      AND public.can_read_clinical(p.organization_id)
      AND (p.caja_fuerte_profesional IS NULL OR
           p.caja_fuerte_profesional = public.user_member_id_in(p.organization_id))
      AND (public.user_role_in(p.organization_id) IN ('OWNER', 'DIRECTOR') OR
           (public.user_role_in(p.organization_id) = 'PROFESIONAL' AND
            (p.profesional_principal_id = public.user_member_id_in(p.organization_id) OR
             public.profesional_attended_paciente(p.id, p.organization_id))))
  );
$$;
CREATE OR REPLACE FUNCTION public.paciente_es_pseudonimizado(p_paciente_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT p.pseudonimizado_en IS NOT NULL FROM public.paciente p
  WHERE p.id = p_paciente_id
    AND public.can_read_clinical(p.organization_id)
    AND (p.caja_fuerte_profesional IS NULL OR
         p.caja_fuerte_profesional = public.user_member_id_in(p.organization_id))
    AND (public.user_role_in(p.organization_id) IN ('OWNER', 'DIRECTOR') OR
         (public.user_role_in(p.organization_id) = 'PROFESIONAL' AND
          (p.profesional_principal_id = public.user_member_id_in(p.organization_id) OR
           public.profesional_attended_paciente(p.id, p.organization_id))));
$$;
REVOKE ALL ON FUNCTION public.paciente_tiene_alergias_severas(uuid),
  public.paciente_es_pseudonimizado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paciente_tiene_alergias_severas(uuid),
  public.paciente_es_pseudonimizado(uuid) TO authenticated, service_role;

-- Only the server computes these salted HMACs from getUser().email. Neither
-- verified email nor hashes are accepted at a public server-action boundary.
-- The DB independently rechecks the verified Auth email under a row lock.
CREATE OR REPLACE FUNCTION public.portal_link_verified_patient(
  p_auth_user_id uuid, p_cuenta_id uuid, p_paciente_id uuid,
  p_organization_id uuid, p_verified_email text, p_email_hash text,
  p_dni_hash text DEFAULT NULL, p_telefono_hash text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user auth.users%ROWTYPE;
  v_account public.paciente_cuenta%ROWTYPE;
  v_org public.organization%ROWTYPE;
  v_patient public.paciente%ROWTYPE;
  v_identity public.paciente_identidad%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM auth.users WHERE id=p_auth_user_id FOR SHARE;
  IF NOT FOUND OR v_user.email_confirmed_at IS NULL OR
     nullif(lower(btrim(v_user.email)), '') IS NULL OR
     lower(btrim(v_user.email)) IS DISTINCT FROM p_verified_email THEN RETURN false; END IF;
  SELECT * INTO v_account FROM public.paciente_cuenta WHERE id=p_cuenta_id FOR SHARE;
  IF NOT FOUND OR v_account.deleted_at IS NOT NULL OR
     v_account.auth_user_id IS DISTINCT FROM p_auth_user_id THEN RETURN false; END IF;
  SELECT * INTO v_org FROM public.organization WHERE id=p_organization_id FOR SHARE;
  IF NOT FOUND OR v_org.deleted_at IS NOT NULL THEN RETURN false; END IF;
  SELECT * INTO v_patient FROM public.paciente WHERE id=p_paciente_id FOR UPDATE;
  IF NOT FOUND OR v_patient.organization_id IS DISTINCT FROM p_organization_id OR
     v_patient.deleted_at IS NOT NULL OR v_patient.pseudonimizado_en IS NOT NULL OR
     v_patient.cuenta_id IS NOT NULL OR v_patient.identidad_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_identity FROM public.paciente_identidad WHERE id=v_patient.identidad_id FOR SHARE;
  IF NOT FOUND OR v_identity.organization_id IS DISTINCT FROM p_organization_id OR
     v_identity.deleted_at IS NOT NULL OR v_identity.fecha_nacimiento IS NULL OR
     v_identity.fecha_nacimiento > (timezone('America/Argentina/Cordoba', now())::date - interval '18 years')::date OR
     p_email_hash IS NULL OR v_identity.email_hash IS DISTINCT FROM p_email_hash OR
     NOT (coalesce(v_identity.dni_hash = p_dni_hash, false) OR
          coalesce(v_identity.telefono_hash = p_telefono_hash, false)) THEN RETURN false; END IF;

  -- Recheck all live matching rows, including linked/minor/unknown-age patients:
  -- a family contact is never sufficient to choose one of several records.
  IF EXISTS (
    SELECT 1 FROM public.paciente p
      JOIN public.paciente_identidad i ON i.id=p.identidad_id AND i.organization_id=p.organization_id
    WHERE p.organization_id=p_organization_id AND p.id<>p_paciente_id
      AND p.deleted_at IS NULL AND p.pseudonimizado_en IS NULL
      AND i.deleted_at IS NULL
      AND (i.email_hash=p_email_hash OR i.dni_hash=p_dni_hash OR i.telefono_hash=p_telefono_hash)
  ) THEN RETURN false; END IF;

  UPDATE public.paciente SET cuenta_id=p_cuenta_id WHERE id=p_paciente_id;
  INSERT INTO public.audit_log(organization_id,actor_id,actor_role,action,resource_type,resource_id,payload)
  VALUES(p_organization_id,p_auth_user_id,'PACIENTE','paciente.portal_auto_link','paciente',p_paciente_id::text,
    jsonb_build_object('paciente_cuenta_id',p_cuenta_id,'reason',
      CASE WHEN v_identity.dni_hash=p_dni_hash THEN 'dni_email' ELSE 'telefono_email' END));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_link_verified_patient(uuid,uuid,uuid,uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_link_verified_patient(uuid,uuid,uuid,uuid,text,text,text,text)
  TO service_role;
