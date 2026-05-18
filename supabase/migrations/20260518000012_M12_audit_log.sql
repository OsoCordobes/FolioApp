-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M12 · Audit log particionado + triggers automáticos
-- ════════════════════════════════════════════════════════════════════════════
-- Tabla particionada por mes con triggers genéricos en tablas clínicas.
-- Cada INSERT/UPDATE/DELETE sobre datos sensibles deja una fila en
-- `audit_log`. La fila incluye actor, acción, recurso, payload, IP, UA.
--
-- Particionamiento por mes:
--   - audit_log_2026_05, audit_log_2026_06, ...
--   - El partman crea las particiones automáticamente (si está disponible).
--   - Sin partman, las particiones se crean a mano vía cron (F9).
--
-- Retención: 10 años (Ley 26.529). Vacuum/archive a S3 cold storage cuando
-- una partición tenga > 5 años.
--
-- RLS: solo OWNER puede ver el audit log de su org. No es PHI directa pero
-- contiene metadata sensible que el resto no necesita.
--
-- Triggers de audit:
--   - paciente, paciente_identidad, sesion, sesion_enmienda
--   - diagnostico, alergia, medicacion
--   - consentimiento, documento_clinico
--   - turno (transitions), pago
--
-- Audit es APPEND-ONLY: ningún UPDATE, ningún DELETE.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE audit_log (
  id              bigserial NOT NULL,
  organization_id uuid NOT NULL,
  actor_id        uuid,                                      -- profile.id
  actor_role      text,                                      -- snapshot del role al momento
  ip              inet,
  user_agent      text,
  action          text NOT NULL,                             -- 'paciente.insert', 'sesion.lock', ...
  resource_type   text NOT NULL,                             -- 'paciente', 'sesion', ...
  resource_id     text NOT NULL,                             -- uuid como text (puede ser cualquier PK)
  payload         jsonb,                                     -- diff o snapshot relevante
  ts              timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id, ts)                                       -- PK incluye partition key
) PARTITION BY RANGE (ts);

CREATE INDEX audit_log_org_ts_idx ON audit_log (organization_id, ts DESC);
CREATE INDEX audit_log_resource_idx ON audit_log (resource_type, resource_id, ts DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, ts DESC) WHERE actor_id IS NOT NULL;

COMMENT ON TABLE audit_log IS
  'Folio · audit log particionado por mes (TS RANGE). Append-only. Retención 10 años (Ley 26.529 art. 18). RLS: solo OWNER de la org.';

-- ─── Crear particiones iniciales (12 meses) ───────────────────────────────
-- Particiones se generan vía cron (F9) o partman. Pre-creamos las próximas
-- 12 meses para que el sistema no falle al INSERT en el primer mes.

DO $$
DECLARE
  start_date date;
  end_date   date;
  part_name  text;
  i          integer;
BEGIN
  FOR i IN 0..11 LOOP
    start_date := date_trunc('month', CURRENT_DATE)::date + (i || ' months')::interval;
    end_date   := start_date + interval '1 month';
    part_name  := format('audit_log_%s', to_char(start_date, 'YYYY_MM'));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
      part_name, start_date, end_date
    );
  END LOOP;
END
$$;

-- Función para crear las próximas particiones (llamada vía cron F9).
CREATE OR REPLACE FUNCTION audit_log_ensure_future_partitions(months_ahead integer DEFAULT 3)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  start_date date;
  end_date   date;
  part_name  text;
  i          integer;
BEGIN
  FOR i IN 0..months_ahead LOOP
    start_date := date_trunc('month', CURRENT_DATE)::date + (i || ' months')::interval;
    end_date   := start_date + interval '1 month';
    part_name  := format('audit_log_%s', to_char(start_date, 'YYYY_MM'));
    BEGIN
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
        part_name, start_date, end_date
      );
    EXCEPTION
      WHEN duplicate_table THEN NULL;
    END;
  END LOOP;
END
$$;

-- ─── Trigger genérico de audit ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION audit_log_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_action        text;
  v_resource_type text;
  v_resource_id   text;
  v_org_id        uuid;
  v_actor_id      uuid;
  v_actor_role    text;
  v_payload       jsonb;
BEGIN
  v_resource_type := TG_TABLE_NAME;
  v_action := TG_TABLE_NAME || '.' || lower(TG_OP);

  IF TG_OP = 'DELETE' THEN
    v_resource_id := OLD.id::text;
    v_org_id      := OLD.organization_id;
    v_payload     := to_jsonb(OLD);
  ELSE
    v_resource_id := NEW.id::text;
    v_org_id      := NEW.organization_id;
    IF TG_OP = 'UPDATE' THEN
      -- Payload de UPDATE: solo campos que cambiaron (diff sintético)
      v_payload := jsonb_build_object(
        'before', to_jsonb(OLD),
        'after',  to_jsonb(NEW)
      );
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
    v_action, v_resource_type, v_resource_id, v_payload, now()
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$$;

-- ─── Aplicar audit trigger a tablas críticas ──────────────────────────────

CREATE TRIGGER paciente_audit
  AFTER INSERT OR UPDATE OR DELETE ON paciente
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

CREATE TRIGGER paciente_identidad_audit
  AFTER INSERT OR UPDATE OR DELETE ON paciente_identidad
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

CREATE TRIGGER sesion_audit
  AFTER INSERT OR UPDATE OR DELETE ON sesion
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

CREATE TRIGGER sesion_enmienda_audit
  AFTER INSERT ON sesion_enmienda
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

CREATE TRIGGER diagnostico_audit
  AFTER INSERT OR UPDATE OR DELETE ON diagnostico
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

CREATE TRIGGER alergia_audit
  AFTER INSERT OR UPDATE OR DELETE ON alergia
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

CREATE TRIGGER medicacion_audit
  AFTER INSERT OR UPDATE OR DELETE ON medicacion
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

CREATE TRIGGER consentimiento_audit
  AFTER INSERT OR UPDATE ON consentimiento
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

CREATE TRIGGER documento_clinico_audit
  AFTER INSERT OR UPDATE OR DELETE ON documento_clinico
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

CREATE TRIGGER turno_audit
  AFTER INSERT OR UPDATE OR DELETE ON turno
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

CREATE TRIGGER pago_audit
  AFTER INSERT OR UPDATE ON pago
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

-- ════════════════════════════════════════════════════════════════════════════
-- RLS · audit_log
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE  ROW LEVEL SECURITY;

-- Solo OWNER puede leer audit log de su org. La inserción la hace el trigger
-- con SECURITY DEFINER (bypassea RLS).
CREATE POLICY audit_log_select_owner
  ON audit_log FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) = 'OWNER'
  );

-- INSERT, UPDATE, DELETE → no-op para todos (solo via SECURITY DEFINER trigger).
CREATE POLICY audit_log_no_direct_insert ON audit_log FOR INSERT WITH CHECK (false);
CREATE POLICY audit_log_no_update ON audit_log FOR UPDATE USING (false);
CREATE POLICY audit_log_no_delete ON audit_log FOR DELETE USING (false);
