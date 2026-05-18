-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M11 · Integraciones externas + Seguro Profesional + Recordatorios
-- ════════════════════════════════════════════════════════════════════════════
-- Tablas de sistemas externos conectados:
--
--   - integration       · OAuth tokens (Google Calendar, WhatsApp, Mercado
--                         Pago, Resend, ARCA/AFIP). access_token + refresh_token
--                         cifrados app-side. meta_json para fields específicos
--                         del proveedor (calendar_id, phone_number_id, etc).
--   - seguro_profesional · póliza de responsabilidad civil profesional (RCP).
--                         numero_poliza cifrado. Documentación PDF en Storage.
--                         Importante para clínicas (obligatorio en AR).
--   - recordatorio_job   · cola de jobs programados (envío 24h antes, 2h antes,
--                         post-visita 2h después). F9 los procesa con Vercel
--                         Cron.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TYPE proveedor_integracion AS ENUM (
  'GOOGLE_CALENDAR',
  'WHATSAPP',
  'MERCADOPAGO',
  'RESEND',
  'ARCA_AFIP'
);

CREATE TYPE tipo_recordatorio AS ENUM (
  'CONFIRMACION_24H',
  'RECORDATORIO_2H',
  'POST_VISITA'
);

-- ─── Integration ──────────────────────────────────────────────────────────

CREATE TABLE integration (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  profesional_id           uuid REFERENCES member(id) ON DELETE CASCADE,  -- NULL = org-level
  proveedor                proveedor_integracion NOT NULL,

  access_token_cifrado     bytea NOT NULL,                    -- AES-256-GCM app-side
  refresh_token_cifrado    bytea,
  expira_ts                timestamptz,
  scopes                   text[] NOT NULL DEFAULT '{}',

  -- Fields específicos del proveedor (calendar_id, phone_number_id, etc.)
  meta_json                jsonb NOT NULL DEFAULT '{}',

  -- Health check / debugging
  ultimo_uso_ts            timestamptz,
  ultimo_error             text,
  ultimo_error_ts          timestamptz,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- Una sola integración activa por (org, profesional NULL/ID, proveedor)
  CONSTRAINT integration_unique
    UNIQUE (organization_id, profesional_id, proveedor)
);

CREATE INDEX integration_org_proveedor_idx ON integration (organization_id, proveedor);
CREATE INDEX integration_expira_idx ON integration (expira_ts) WHERE expira_ts IS NOT NULL;

CREATE TRIGGER integration_set_updated_at
  BEFORE UPDATE ON integration FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE integration IS
  'Folio · tokens OAuth de integraciones externas. Tokens cifrados con FOLIO_ENC_KEY antes de INSERT. profesional_id NULL = integración a nivel org (ej. WhatsApp Business Number único de la clínica). expira_ts dispara refresh via cron F9.';

-- ─── SeguroProfesional ────────────────────────────────────────────────────

CREATE TABLE seguro_profesional (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  profile_id               uuid NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  compania                 text NOT NULL,                      -- "Sancor", "Provincia ART", etc.
  numero_poliza_cifrado    bytea NOT NULL,                     -- AES-256-GCM app-side
  vigencia_desde           date NOT NULL,
  vigencia_hasta           date NOT NULL,
  monto_cobertura          numeric(15, 2),                     -- ARS
  documento_path           text,                                -- Storage bucket 'seguros'

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT seguro_vigencia_orden CHECK (vigencia_hasta >= vigencia_desde),
  CONSTRAINT seguro_compania_len CHECK (length(compania) BETWEEN 2 AND 100)
);

CREATE INDEX seguro_org_profile_idx ON seguro_profesional (organization_id, profile_id);
CREATE INDEX seguro_vigencia_idx ON seguro_profesional (vigencia_hasta)
  WHERE vigencia_hasta >= CURRENT_DATE;

CREATE TRIGGER seguro_set_updated_at
  BEFORE UPDATE ON seguro_profesional FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE seguro_profesional IS
  'Folio · póliza de responsabilidad civil profesional (RCP). Obligatorio en AR para clínicas. Tracking de vigencia + alertas de vencimiento (F9).';

-- ─── RecordatorioJob ──────────────────────────────────────────────────────

CREATE TABLE recordatorio_job (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  turno_id            uuid NOT NULL REFERENCES turno(id) ON DELETE CASCADE,
  tipo                tipo_recordatorio NOT NULL,
  scheduled_ts        timestamptz NOT NULL,
  enviado_ts          timestamptz,
  intentos            smallint NOT NULL DEFAULT 0,
  error_msg           text,

  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT recordatorio_intentos_limite CHECK (intentos BETWEEN 0 AND 10),
  CONSTRAINT recordatorio_unico_por_turno UNIQUE (turno_id, tipo)
);

-- Index para el cron job de F9: pickear jobs listos para enviar.
CREATE INDEX recordatorio_due_idx
  ON recordatorio_job (scheduled_ts, enviado_ts)
  WHERE enviado_ts IS NULL AND intentos < 5;

COMMENT ON TABLE recordatorio_job IS
  'Folio · cola de mensajes programados (WhatsApp/email). F9 (Vercel Cron) procesa cada 5 min jobs con scheduled_ts <= now() AND enviado_ts IS NULL AND intentos < 5.';

-- ════════════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE integration         ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration         FORCE  ROW LEVEL SECURITY;
ALTER TABLE seguro_profesional  ENABLE ROW LEVEL SECURITY;
ALTER TABLE seguro_profesional  FORCE  ROW LEVEL SECURITY;
ALTER TABLE recordatorio_job    ENABLE ROW LEVEL SECURITY;
ALTER TABLE recordatorio_job    FORCE  ROW LEVEL SECURITY;

-- ─── Integration: OWNER + DIRECTOR + el profesional dueño ────────────────

CREATE POLICY integration_select_admin_or_self
  ON integration FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND (
      public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
      OR (profesional_id IS NOT NULL
          AND profesional_id = public.user_member_id_in(organization_id))
    )
  );

CREATE POLICY integration_write_admin
  ON integration FOR ALL
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND (
      public.user_role_in(organization_id) = 'OWNER'
      OR (profesional_id IS NOT NULL
          AND profesional_id = public.user_member_id_in(organization_id))
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND (
      public.user_role_in(organization_id) = 'OWNER'
      OR (profesional_id IS NOT NULL
          AND profesional_id = public.user_member_id_in(organization_id))
    )
  );

-- ─── SeguroProfesional: OWNER + el profesional dueño ─────────────────────

CREATE POLICY seguro_select_admin_or_self
  ON seguro_profesional FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND (
      public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
      OR profile_id = auth.uid()
    )
  );

CREATE POLICY seguro_write_admin_or_self
  ON seguro_profesional FOR ALL
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND (
      public.user_role_in(organization_id) = 'OWNER'
      OR profile_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND (
      public.user_role_in(organization_id) = 'OWNER'
      OR profile_id = auth.uid()
    )
  );

-- ─── RecordatorioJob: admin de la org ────────────────────────────────────

CREATE POLICY recordatorio_select_admin
  ON recordatorio_job FOR SELECT
  USING (organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY recordatorio_write_admin
  ON recordatorio_job FOR ALL
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR', 'PROFESIONAL', 'ASISTENTE')
  )
  WITH CHECK (organization_id IN (SELECT public.user_org_ids()));
