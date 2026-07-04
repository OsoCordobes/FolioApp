-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M65 · email_notificacion (idempotencia de emails) + suscripcion.morosa_desde
-- ════════════════════════════════════════════════════════════════════════════
-- Base de los emails de ciclo de vida de suscripción (trial por vencer, pago
-- fallido, suspensión, reactivación, cancelación por morosidad, activación).
--
--   - email_notificacion · registro claim-before-send: cada email de lifecycle
--     INSERTa acá ANTES de enviar. UNIQUE(dedupe_key) es la garantía real de
--     idempotencia — un cron re-entrante o un webhook reenviado chocan con
--     23505 y skipean el envío en silencio (lib/db/email-notificacion.ts).
--     Trade-off documentado: at-most-once (si Resend falla post-claim, el
--     email no se reintenta — preferimos un email faltante a uno duplicado).
--
--   - suscripcion.morosa_desde · timestamp del inicio del episodio de
--     morosidad vigente. Sirve como discriminador de dedupe (un episodio →
--     un email de suspensión / uno de reactivación) y para calcular la
--     ventana antes de cancelar. NULL = no morosa. El wiring (webhook/cron)
--     llega en un PR posterior; la columna es aditiva y nullable.
--
-- Esta migración no define funciones que referencien tablas futuras, así que
-- no necesita `set check_function_bodies = off` (mismo criterio que M49).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── email_notificacion ─────────────────────────────────────────────────────

CREATE TABLE email_notificacion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organization(id),

  -- Tipo de email (trial_por_vencer, pago_fallido, suscripcion_suspendida,
  -- suscripcion_reactivada, suscripcion_cancelada_morosidad,
  -- suscripcion_activada, ...). text libre: agregar un tipo nuevo no debe
  -- requerir migración.
  tipo             text NOT NULL,

  -- Clave de idempotencia, p.ej. 'pago-fallido:{org}:{mp_payment_id}'.
  -- UNIQUE = la garantía de "este email se manda una sola vez".
  dedupe_key       text NOT NULL UNIQUE,

  -- Email destino (payer_email del OWNER). NO es PII médica, no se cifra
  -- (mismo criterio que suscripcion.payer_email, M19).
  destinatario     text NOT NULL,

  enviado_ts       timestamptz NOT NULL DEFAULT now(),

  -- Contexto no sensible para debug (monto, días restantes, payment id...).
  meta             jsonb,

  CONSTRAINT email_notificacion_tipo_len CHECK (length(tipo) BETWEEN 1 AND 100),
  CONSTRAINT email_notificacion_dedupe_len CHECK (length(dedupe_key) BETWEEN 1 AND 300),
  CONSTRAINT email_notificacion_destinatario_len CHECK (length(destinatario) BETWEEN 3 AND 254)
);

CREATE INDEX email_notificacion_org_tipo_idx
  ON email_notificacion (organization_id, tipo);

COMMENT ON TABLE email_notificacion IS
  'Folio · M65 · registro claim-before-send de emails de lifecycle de suscripción. Se inserta ANTES de enviar; UNIQUE(dedupe_key) garantiza at-most-once frente a crones re-entrantes / webhooks reenviados. Solo service_role opera (RLS deny-by-default).';

-- ─── RLS: service-only (deny-by-default, patrón M42) ────────────────────────
-- Sin CREATE POLICY a propósito: esta tabla NO se expone al cliente. Los
-- writers/readers legítimos (notify* de lib/email/notify.ts vía
-- createSupabaseServiceClient) usan service_role, que es BYPASSRLS. Cualquier
-- acceso directo de anon/authenticated queda bloqueado. Si en el futuro
-- hiciera falta exponer un historial al OWNER, agregar una policy explícita
-- acotada por tenancy — nunca un GRANT abierto.

ALTER TABLE email_notificacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_notificacion FORCE  ROW LEVEL SECURITY;

-- ─── suscripcion.morosa_desde ───────────────────────────────────────────────

ALTER TABLE suscripcion
  ADD COLUMN IF NOT EXISTS morosa_desde timestamptz;

COMMENT ON COLUMN suscripcion.morosa_desde IS
  'M65 · inicio del episodio de morosidad vigente (primer cobro rechazado que llevó a MOROSA). NULL = no morosa. Discriminador de dedupe para los emails de suspensión/reactivación y base de la ventana de cancelación por morosidad. La escritura llega con el wiring (webhook/cron) en un PR posterior.';
