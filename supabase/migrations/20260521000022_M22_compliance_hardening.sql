-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M22 · Compliance hardening (Ley 25.326 + Ley 26.529)
-- ════════════════════════════════════════════════════════════════════════════
-- Resultado de la auditoría legal del 2026-05-21. Esta migration NO cambia
-- modelo de datos; cierra gaps detectados:
--
--   1. Audit triggers en `member`, `organization`, `profile`. Hasta acá los
--      cambios de rol / scope / matrícula no quedaban registrados. Ley 26.529
--      art. 15 exige trazabilidad de quién podía ver qué (no solo qué se vio).
--
--   2. Hardening de `sesion_update_clinical`: incluye explícitamente
--      `locked_at IS NULL` en USING. El trigger BEFORE UPDATE ya bloquea
--      modificaciones a una sesión lockeada (M10) pero defensa-en-profundidad
--      a nivel policy es trivial y elimina dependencia del orden de ejecución.
--
--   3. Columnas de consentimiento al booking público: `pedido.consent_aceptado_en`,
--      `consent_ip`. La acción pública del booking (CRIT-1) ahora obliga al
--      visitante a aceptar Privacidad/Términos antes del INSERT (Ley 25.326
--      art. 5: consentimiento libre, expreso, informado).
--
--   4. `audit_log_purge_expired(years_back integer)`: helper para retención
--      automatizada del audit log (Ley 26.529 art. 18: 10 años). Drop de
--      particiones cuya cota superior sea < (now - years_back). NO se invoca
--      en esta migration — se llama desde un cron job (Vercel) o pg_cron.
--
--   5. Pseudonimización del propio profesional (`pseudonimizar_member`): la
--      versión existente (M13) solo borraba PII de pacientes. Cuando el
--      profesional ejerce su propio derecho ARCO de supresión, hay que borrar
--      el `profile.*_cifrado` PII manteniendo la PHI clínica huérfana 10 años.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Audit triggers adicionales ────────────────────────────────────────

CREATE TRIGGER member_audit
  AFTER INSERT OR UPDATE OR DELETE ON member
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

-- `organization` no tiene la columna `organization_id` (es sí misma la org),
-- así que el trigger genérico fallaría al leer NEW.organization_id. Usamos
-- una variante que toma NEW.id como org.
CREATE OR REPLACE FUNCTION audit_log_trigger_self_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id        uuid;
  v_actor_id      uuid;
  v_actor_role    text;
  v_payload       jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_org_id  := OLD.id;
    v_payload := to_jsonb(OLD);
  ELSE
    v_org_id := NEW.id;
    IF TG_OP = 'UPDATE' THEN
      v_payload := jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW));
    ELSE
      v_payload := to_jsonb(NEW);
    END IF;
  END IF;

  v_actor_id := auth.uid();
  IF v_actor_id IS NOT NULL AND v_org_id IS NOT NULL THEN
    SELECT role::text INTO v_actor_role
    FROM member
    WHERE profile_id = v_actor_id AND organization_id = v_org_id
    LIMIT 1;
  END IF;

  INSERT INTO audit_log (
    organization_id, actor_id, actor_role,
    action, resource_type, resource_id, payload, ts
  ) VALUES (
    v_org_id, v_actor_id, v_actor_role,
    TG_TABLE_NAME || '.' || lower(TG_OP),
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id)::text,
    v_payload, now()
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$$;

CREATE TRIGGER organization_audit
  AFTER UPDATE OR DELETE ON organization
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger_self_org();

-- `profile` tampoco es tenant-scoped (vive 1:1 con auth.users). Insertamos
-- audit en TODAS las orgs donde el profile sea member. Para MVP basta con
-- escribir un solo log con organization_id = primera org del profile.
CREATE OR REPLACE FUNCTION audit_log_trigger_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id        uuid;
  v_actor_id      uuid;
  v_payload       jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_payload := to_jsonb(OLD);
    SELECT organization_id INTO v_org_id FROM member WHERE profile_id = OLD.id LIMIT 1;
  ELSIF TG_OP = 'UPDATE' THEN
    v_payload := jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW));
    SELECT organization_id INTO v_org_id FROM member WHERE profile_id = NEW.id LIMIT 1;
  ELSE
    v_payload := to_jsonb(NEW);
    SELECT organization_id INTO v_org_id FROM member WHERE profile_id = NEW.id LIMIT 1;
  END IF;

  v_actor_id := auth.uid();

  -- Si el profile no es miembro de ninguna org todavía (signup en curso),
  -- saltamos el audit log: la siguiente operación (crear member) sí queda
  -- registrada con su organization_id.
  IF v_org_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  INSERT INTO audit_log (
    organization_id, actor_id, actor_role,
    action, resource_type, resource_id, payload, ts
  ) VALUES (
    v_org_id, v_actor_id, NULL,
    'profile.' || lower(TG_OP),
    'profile',
    COALESCE(NEW.id, OLD.id)::text,
    v_payload, now()
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$$;

CREATE TRIGGER profile_audit
  AFTER UPDATE OR DELETE ON profile
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger_profile();

-- ─── 2. Hardening sesion_update_clinical ──────────────────────────────────

DROP POLICY IF EXISTS sesion_update_clinical ON sesion;

CREATE POLICY sesion_update_clinical
  ON sesion FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND locked_at IS NULL                         -- defense-in-depth (M22)
    AND (
      public.user_role_in(organization_id) = 'OWNER'
      OR EXISTS (
        SELECT 1 FROM turno t
        WHERE t.id = sesion.turno_id
          AND t.profesional_id = public.user_member_id_in(sesion.organization_id)
      )
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  );

-- ─── 3. Consentimiento explícito en pedido público ────────────────────────

ALTER TABLE pedido
  ADD COLUMN IF NOT EXISTS consent_aceptado_en timestamptz,
  ADD COLUMN IF NOT EXISTS consent_ip          inet,
  ADD COLUMN IF NOT EXISTS consent_user_agent  text,
  ADD COLUMN IF NOT EXISTS consent_version     text;

COMMENT ON COLUMN pedido.consent_aceptado_en IS
  'Folio · timestamp del checkbox de aceptación de Política de Privacidad + Términos en el booking público (Ley 25.326 art. 5).';
COMMENT ON COLUMN pedido.consent_ip IS
  'Folio · IP del visitante al aceptar consentimiento (evidencia legal).';
COMMENT ON COLUMN pedido.consent_version IS
  'Folio · versión de la política aceptada (ej. "2026-05-21"). Permite reconstruir qué texto vió el titular.';

-- Sólo aplica a pedidos creados por canal WEB (booking público). Pedidos
-- creados por el profesional desde el dashboard no requieren este consent
-- (el profesional es el responsable y ya tiene consentimiento del paciente
-- vía tabla `consentimiento`).
ALTER TABLE pedido
  ADD CONSTRAINT pedido_web_requires_consent
  CHECK (canal <> 'WEB' OR consent_aceptado_en IS NOT NULL)
  NOT VALID;                                       -- backfill-friendly: filas viejas no se validan

-- ─── 4. Retención del audit log (Ley 26.529 art. 18) ──────────────────────

CREATE OR REPLACE FUNCTION public.audit_log_purge_expired(years_back integer DEFAULT 10)
RETURNS TABLE(partition_name text, dropped_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec        record;
  cutoff     timestamptz;
  upper_b    timestamptz;
BEGIN
  cutoff := (now() - make_interval(years => years_back));

  FOR rec IN
    SELECT c.relname AS part_name,
           pg_get_expr(c.relpartbound, c.oid) AS bound_expr
    FROM pg_inherits i
    JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_class c ON c.oid = i.inhrelid
    WHERE p.relname = 'audit_log'
  LOOP
    -- Extraer la cota superior 'TO (...)' del bound expression.
    -- Formato Postgres: "FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-06-01 00:00:00+00')"
    BEGIN
      upper_b := substring(rec.bound_expr FROM 'TO \(''([^'']+)')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;                                   -- partition con bound no parseable, skip
    END;

    IF upper_b IS NOT NULL AND upper_b <= cutoff THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', rec.part_name);
      partition_name := rec.part_name;
      dropped_at := now();
      RETURN NEXT;
    END IF;
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION public.audit_log_purge_expired FROM PUBLIC;
-- Solo invocable desde service_role (cron job). No grant a authenticated.

COMMENT ON FUNCTION public.audit_log_purge_expired IS
  'Folio · drop de particiones de audit_log con cota superior < (now - years_back). Default 10 años (Ley 26.529 art. 18). Invocar desde Vercel Cron con CRON_SECRET.';

-- ─── 5. Pseudonimización del profesional (ARCO art. 16 self-service) ──────

CREATE OR REPLACE FUNCTION public.pseudonimizar_member(
  p_motivo   text,
  p_dry_run  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id       uuid;
  v_orgs           jsonb;
  v_resumen        jsonb;
  v_pseudo_email   text;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'pseudonimizar_member: requiere auth.uid()';
  END IF;

  IF p_motivo IS NULL OR length(trim(p_motivo)) < 20 THEN
    RAISE EXCEPTION 'pseudonimizar_member: motivo requerido (>=20 chars). Ley 25.326 art. 16.';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('organization_id', organization_id, 'role', role))
    INTO v_orgs
  FROM member
  WHERE profile_id = v_actor_id AND deleted_at IS NULL;

  v_resumen := jsonb_build_object(
    'profile_id', v_actor_id,
    'memberships', COALESCE(v_orgs, '[]'::jsonb),
    'motivo', p_motivo,
    'dry_run', p_dry_run
  );

  IF p_dry_run THEN
    RETURN v_resumen || jsonb_build_object('status', 'dry_run_ok_no_changes');
  END IF;

  -- Audit log en cada org donde el profile fue member (preserva trazabilidad).
  INSERT INTO audit_log (organization_id, actor_id, actor_role, action, resource_type, resource_id, payload)
  SELECT organization_id, v_actor_id, role::text,
         'profile.pseudonimizar', 'profile', v_actor_id::text, v_resumen
  FROM member
  WHERE profile_id = v_actor_id;

  -- Reemplazar PII del profile con placeholders cifrados ("[ELIMINADO]")
  -- Mantenemos el row (FKs apuntan a profile.id desde turno.creado_por, etc.)
  -- pero la identidad queda irrecuperable.
  v_pseudo_email := 'eliminado+' || substring(v_actor_id::text from 1 for 8) || '@folio.invalid';

  UPDATE profile
  SET email = v_pseudo_email,
      nombre_cifrado = E'\\x00',                  -- placeholder bytea (1 byte NUL)
      apellido_cifrado = E'\\x00',
      matricula = NULL,
      avatar_url = NULL,
      updated_at = now()
  WHERE id = v_actor_id;

  -- Soft-delete todas las memberships
  UPDATE member
  SET deleted_at = now(), updated_at = now()
  WHERE profile_id = v_actor_id AND deleted_at IS NULL;

  RETURN v_resumen || jsonb_build_object('status', 'pseudonimizado_ok', 'ejecutado_en', now());
END
$$;

REVOKE ALL ON FUNCTION public.pseudonimizar_member FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pseudonimizar_member TO authenticated;

COMMENT ON FUNCTION public.pseudonimizar_member IS
  'Folio · ARCO art. 16: el profesional pseudonimiza su propio profile. PII reemplazada por placeholders, PHI clínica permanece huérfana 10 años (Ley 26.529 art. 18). Irreversible.';
