-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M58 · plan_tratamiento (editable, genérico para todas las especialidades)
-- ════════════════════════════════════════════════════════════════════════════
-- El card "Plan de tratamiento" de la ficha tenía el botón "Editar" como stub
-- (disabled). Los campos se derivaban read-only de los turnos. Esta tabla 1:1
-- por paciente persiste los campos editables del plan. Genérica: NO contiene
-- nada específico de una especialidad (eso vive en sesion.tool_data_cifrado).
--
-- PHI: diagnostico + notas se cifran AES-256-GCM app-side. El resto (sesiones
-- objetivo, frecuencia, próximo control) es no-PHI (consistente con
-- sesion.eva_*/vertebras_json).
--
-- Convenciones espejadas de M10 (sesion): validate_same_org dedicado,
-- set_updated_at (M02), audit_log_trigger (M12), RLS clinical-scoped. El INSERT
-- usa el predicado de M03 paciente_insert_clinical (OWNER/PROFESIONAL/DIRECTOR)
-- y NO can_read_clinical, para que un DIRECTOR no-colegiado pueda crearlo igual
-- que crea el paciente. Todos los objetos referenciados pre-existen → sin
-- `set check_function_bodies = off`.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE plan_tratamiento (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  paciente_id         uuid NOT NULL UNIQUE REFERENCES paciente(id) ON DELETE CASCADE,

  sesiones_objetivo   integer,
  frecuencia          text,
  diagnostico_cifrado bytea,                              -- PHI · AES-256-GCM app-side
  proximo_control     date,
  notas_cifrado       bytea,                              -- PHI · AES-256-GCM app-side

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT plan_tratamiento_sesiones_objetivo_valid
    CHECK (sesiones_objetivo IS NULL OR sesiones_objetivo BETWEEN 0 AND 1000),
  CONSTRAINT plan_tratamiento_frecuencia_len
    CHECK (frecuencia IS NULL OR length(frecuencia) <= 60)
);

CREATE INDEX plan_tratamiento_org_idx ON plan_tratamiento (organization_id);

COMMENT ON TABLE plan_tratamiento IS
  'Folio M58 · plan de tratamiento editable (1:1 por paciente). Genérico (sin campos por especialidad). diagnostico/notas cifrados AES-256-GCM app-side.';

-- ─── Triggers: same-org, updated_at, audit ───────────────────────────────────

CREATE OR REPLACE FUNCTION plan_tratamiento_validate_same_org()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM paciente p
    WHERE p.id = NEW.paciente_id
      AND p.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'plan_tratamiento.paciente_id debe coincidir en org con el paciente';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER plan_tratamiento_same_org_guard
  BEFORE INSERT OR UPDATE OF paciente_id, organization_id ON plan_tratamiento
  FOR EACH ROW EXECUTE FUNCTION plan_tratamiento_validate_same_org();

CREATE TRIGGER plan_tratamiento_set_updated_at
  BEFORE UPDATE ON plan_tratamiento
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER plan_tratamiento_audit
  AFTER INSERT OR UPDATE OR DELETE ON plan_tratamiento
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

-- ─── RLS (clinical-scoped, espejo de M10/M03) ────────────────────────────────

ALTER TABLE plan_tratamiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_tratamiento FORCE  ROW LEVEL SECURITY;

CREATE POLICY plan_tratamiento_select_clinical
  ON plan_tratamiento FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  );

-- INSERT: mismo predicado que M03 paciente_insert_clinical (no can_read_clinical)
-- para que un DIRECTOR no-colegiado pueda crearlo igual que crea el paciente.
CREATE POLICY plan_tratamiento_insert_clinical
  ON plan_tratamiento FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'PROFESIONAL', 'DIRECTOR')
  );

CREATE POLICY plan_tratamiento_update_clinical
  ON plan_tratamiento FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'PROFESIONAL', 'DIRECTOR')
  );

CREATE POLICY plan_tratamiento_no_delete
  ON plan_tratamiento FOR DELETE
  USING (false);
