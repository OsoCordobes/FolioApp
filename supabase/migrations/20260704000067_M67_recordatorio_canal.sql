-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M67 · recordatorio_job.canal — canal efectivo del recordatorio
-- ════════════════════════════════════════════════════════════════════════════
--
-- El dispatcher (/api/cron/dispatch-recordatorios) era WhatsApp-only: si el
-- teléfono del paciente no normalizaba a E.164 o el envío fallaba, el job
-- consumía sus 5 intentos y el paciente caía en silencio. Con el fallback a
-- email necesitamos registrar POR QUÉ canal salió (o no salió) cada job:
--
--   - 'whatsapp' · default — canal primario; también el valor histórico
--                  implícito de todas las filas existentes (todo lo enviado
--                  hasta hoy salió por WhatsApp).
--   - 'email'    · fallback — el teléfono no servía o WhatsApp falló, y el
--                  paciente tenía email en paciente_identidad.
--   - 'ninguno'  · sin canal de contacto — ni teléfono normalizable ni email.
--                  El job igual consume presupuesto de intentos (error_msg
--                  'sin canal de contacto').
--
-- Aditiva pura (columna con DEFAULT, sin backfill ni validación de datos
-- previos): segura de aplicar antes del deploy del código que la usa.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE recordatorio_job
  ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT 'whatsapp'
    CONSTRAINT recordatorio_canal_valido CHECK (canal IN ('whatsapp', 'email', 'ninguno'));

COMMENT ON COLUMN recordatorio_job.canal IS
  'Folio · canal efectivo del recordatorio: whatsapp (primario), email (fallback cuando el teléfono no sirve o WhatsApp falla) o ninguno (sin canal de contacto). Default whatsapp = valor histórico de filas pre-M67.';
