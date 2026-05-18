-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M18 · WhatsApp inbound (org lookup) + outbound (status tracking)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Agrega columnas que permiten:
--   1. Resolver `organization` desde el `phone_number_id` que Meta envía
--      en cada webhook. Sin esto, no podemos atribuir mensajes inbound
--      a la org correcta.
--   2. Trackear el `wamid` (WhatsApp message id) que devuelve Meta al
--      enviar un template. Sin esto, el `statuses[]` webhook no puede
--      cerrar el loop con `recordatorio_job`.
--
-- Sprint S3 T-3.2 + T-3.3.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. organization.whatsapp_phone_number_id — id de Meta del business number.
ALTER TABLE organization
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id text;

CREATE INDEX IF NOT EXISTS organization_wa_phone_idx
  ON organization (whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL;

COMMENT ON COLUMN organization.whatsapp_phone_number_id IS
  'Folio · ID del business phone number de Meta WhatsApp (no el número en sí, sino el ID que devuelve la Graph API). Usado para resolver org en webhooks inbound.';

-- 2. recordatorio_job.meta_message_id — wamid devuelto por Meta al enviar.
ALTER TABLE recordatorio_job
  ADD COLUMN IF NOT EXISTS meta_message_id text;

CREATE INDEX IF NOT EXISTS recordatorio_meta_message_idx
  ON recordatorio_job (meta_message_id)
  WHERE meta_message_id IS NOT NULL;

COMMENT ON COLUMN recordatorio_job.meta_message_id IS
  'Folio · wamid retornado por Meta WhatsApp al enviar el template. Lookup desde webhook statuses para cerrar loop delivered/read/failed.';

-- 3. recordatorio_job.estado_delivery — último estado reportado por Meta.
--    Más explícito que solo enviado_ts (que indica "salió de nuestro lado").
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_delivery_wa') THEN
    CREATE TYPE estado_delivery_wa AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');
  END IF;
END$$;

ALTER TABLE recordatorio_job
  ADD COLUMN IF NOT EXISTS estado_delivery estado_delivery_wa;

ALTER TABLE recordatorio_job
  ADD COLUMN IF NOT EXISTS delivery_updated_ts timestamptz;

COMMENT ON COLUMN recordatorio_job.estado_delivery IS
  'Folio · último estado de delivery reportado por Meta WhatsApp via webhook statuses. NULL = todavía no recibimos status.';
