-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M90 · Confirmación de turno por el paciente, 1-click (Grado A · F7b)
-- ════════════════════════════════════════════════════════════════════════════
-- El email de recordatorio 24h suma botones Confirmo / Necesito reprogramar /
-- Cancelar como links GET firmados (HMAC app-side con FOLIO_ENC_HMAC_KEY:
-- turno_id + acción + expiración — SIN tabla de tokens: la transición es
-- idempotente vía la state machine de M09, así un replay del link es inocuo,
-- y el token expira solo). El mejor reductor de ausentismo mientras WhatsApp
-- está "Próximamente".
--
-- Lo ÚNICO que necesita schema es el ORIGEN de la transición, para el chip
-- "confirmó el paciente" en la agenda y para métricas de ausentismo:
--
--   · turno.confirmado_via text NULL — quién confirmó:
--       'manual'   → el profesional/secretaría desde la app (default histórico
--                    implícito; las filas viejas quedan NULL = desconocido).
--       'paciente' → 1-click desde el email (o futuro portal/WhatsApp).
--     Solo se escribe al transicionar a CONFIRMADO; una cancelación posterior
--     no lo borra (queda como registro de que el paciente había confirmado).
--
-- Aditiva pura: 1 columna NULL + CHECK que solo valida filas nuevas (los NULL
-- pasan). Sin RLS nueva (viaja con las policies de turno). Replay-safe en
-- vanilla postgres:16 default.

alter table public.turno
  add column if not exists confirmado_via text null
    constraint turno_confirmado_via_valido
    check (confirmado_via is null or confirmado_via in ('manual', 'paciente'));

comment on column public.turno.confirmado_via is
  'M90 · Origen de la transición a CONFIRMADO: manual (staff) | paciente '
  '(1-click desde el email de recordatorio). NULL = fila previa a M90.';
