-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M19 · Suscripción mensual de la org a Folio (Mercado Pago)
-- ════════════════════════════════════════════════════════════════════════════
-- Modelo de negocio: 30.000 ARS/mes fijos por organización, cobrados vía MP
-- preapproval (suscripción recurrente). Folio es merchant directo — recibe
-- el cobro a su propia cuenta MP. El profesional autoriza una sola vez en MP
-- y se cobra automáticamente cada mes.
--
-- Por qué NO usar la tabla `integration` existente:
--   `integration` guarda tokens OAuth donde Folio recibe permisos sobre una
--   cuenta externa del profesional (Google Calendar, WhatsApp). Acá el flujo
--   es opuesto: el profesional paga a Folio. Modelarlo como `integration`
--   confunde el mental model. Tabla propia, propósito único.
--
-- Tablas:
--   - suscripcion       · una por org, estado sincronizado vía webhook.
--   - cargo_suscripcion · historial de cobros mensuales, idempotente por
--                         mp_payment_id (MP puede reenviar webhooks).
--
-- Estados de suscripción:
--   - PENDIENTE_ACTIVACION · preapproval creado, esperando autorización del usuario en MP.
--   - ACTIVA               · MP cobrando OK.
--   - PAUSADA              · pausada por usuario (futuro — enum lista pero UI no expone).
--   - CANCELADA            · cancelada por usuario o por MP (tras 3 fallos consecutivos).
--   - MOROSA               · fallo de cobro reciente, en ventana de reintentos de MP.
--
-- Gating (implementado en middleware.ts):
--   organization.created_at + 7 días < now() AND suscripcion.estado != 'ACTIVA'
--   → redirect a /configuracion/billing (grace period vencido).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TYPE estado_suscripcion AS ENUM (
  'PENDIENTE_ACTIVACION',
  'ACTIVA',
  'PAUSADA',
  'CANCELADA',
  'MOROSA'
);

CREATE TYPE estado_cargo AS ENUM (
  'PENDIENTE',
  'APROBADO',
  'RECHAZADO',
  'REFUNDED'
);

-- ─── Suscripción ──────────────────────────────────────────────────────────

CREATE TABLE suscripcion (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,

  -- ID del preapproval en MP. NULL hasta que la Server Action lo crea.
  mp_preapproval_id        text UNIQUE,

  -- Email del pagador (lo manda Folio al crear preapproval; MP lo asocia
  -- a la cuenta MP del pagador). NO es PII médica, no se cifra.
  payer_email              text NOT NULL,

  -- Plan: 30.000 ARS = 3.000.000 centavos. Default por consistencia, pero el
  -- code-side `MP_PLAN_PRICE_CENTS` (lib/mercadopago/client.ts) es el source
  -- of truth real al crear preapproval.
  monto_cents              integer NOT NULL DEFAULT 3000000,
  moneda                   text NOT NULL DEFAULT 'ARS',

  estado                   estado_suscripcion NOT NULL DEFAULT 'PENDIENTE_ACTIVACION',

  fecha_alta               timestamptz NOT NULL DEFAULT now(),
  fecha_activacion         timestamptz,                   -- cuando MP confirmó status=authorized
  proxima_cobro            timestamptz,                   -- siguiente debit_date conocido (de MP)
  ultimo_cobro_ts          timestamptz,                   -- último cobro exitoso
  ultimo_error             text,                          -- último error visible al usuario
  fecha_cancelacion        timestamptz,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- Una sola suscripción por org. Si se cancela y reactiva, se crea preapproval
  -- nuevo y se actualiza esta fila (no se crea una segunda).
  CONSTRAINT suscripcion_unica_por_org UNIQUE (organization_id),
  CONSTRAINT suscripcion_monto_positivo CHECK (monto_cents > 0),
  CONSTRAINT suscripcion_payer_email_len CHECK (length(payer_email) BETWEEN 3 AND 254)
);

CREATE INDEX suscripcion_estado_idx ON suscripcion (estado);
CREATE INDEX suscripcion_proxima_cobro_idx
  ON suscripcion (proxima_cobro)
  WHERE estado IN ('ACTIVA', 'MOROSA');

CREATE TRIGGER suscripcion_set_updated_at
  BEFORE UPDATE ON suscripcion FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE suscripcion IS
  'Folio · suscripción mensual de la org a Folio vía Mercado Pago. Una por org. Estado sincronizado con MP por webhook (push) + lazy reconcile en /configuracion/billing. Folio es merchant directo: mp_preapproval_id es el ID del recurso en MP, NO tokens OAuth del profesional.';

-- ─── Cargo de suscripción ─────────────────────────────────────────────────

CREATE TABLE cargo_suscripcion (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suscripcion_id              uuid NOT NULL REFERENCES suscripcion(id) ON DELETE CASCADE,

  -- ID del payment en MP. UNIQUE para idempotencia (MP reenvía webhooks).
  mp_payment_id               text NOT NULL UNIQUE,
  -- ID del authorized_payment (recurso intermedio que devuelve el webhook
  -- subscription_authorized_payment antes de resolver al payment final).
  mp_authorized_payment_id    text,

  monto_cents                 integer NOT NULL,
  estado                      estado_cargo NOT NULL,
  fecha_intento               timestamptz NOT NULL,        -- debit_date de MP
  fecha_acreditacion          timestamptz,                 -- date_approved si aprobado
  raw_payload                 jsonb,                       -- snapshot del payload de MP para debug/replay

  created_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cargo_monto_positivo CHECK (monto_cents > 0)
);

CREATE INDEX cargo_suscripcion_susc_idx
  ON cargo_suscripcion (suscripcion_id, fecha_intento DESC);
CREATE INDEX cargo_suscripcion_estado_idx ON cargo_suscripcion (estado);

COMMENT ON TABLE cargo_suscripcion IS
  'Folio · historial de cargos mensuales. UNIQUE(mp_payment_id) garantiza idempotencia frente a reentregas del webhook. raw_payload permite re-procesar si cambiamos la lógica.';

-- ════════════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE suscripcion        ENABLE ROW LEVEL SECURITY;
ALTER TABLE suscripcion        FORCE  ROW LEVEL SECURITY;
ALTER TABLE cargo_suscripcion  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargo_suscripcion  FORCE  ROW LEVEL SECURITY;

-- ─── Suscripción: solo OWNER de la org ─────────────────────────────────────
-- DIRECTOR/PROFESIONAL/ASISTENTE NO tienen acceso a la suscripción. Solo el
-- OWNER paga y ve el billing.

CREATE POLICY suscripcion_select_owner
  ON suscripcion FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) = 'OWNER'
  );

CREATE POLICY suscripcion_write_owner
  ON suscripcion FOR ALL
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) = 'OWNER'
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) = 'OWNER'
  );

-- ─── Cargo: solo lectura para OWNER. Escritura solo via service_role (webhook). ──
-- El webhook usa createSupabaseServiceClient() que bypassa RLS (FORCE no aplica
-- a service_role). Si alguien intenta INSERT como user normal, falla.

CREATE POLICY cargo_select_owner
  ON cargo_suscripcion FOR SELECT
  USING (
    suscripcion_id IN (
      SELECT id FROM suscripcion
      WHERE organization_id IN (SELECT public.user_org_ids())
        AND public.user_role_in(organization_id) = 'OWNER'
    )
  );

-- No hay policy de write para cargo_suscripcion: solo service_role escribe.
