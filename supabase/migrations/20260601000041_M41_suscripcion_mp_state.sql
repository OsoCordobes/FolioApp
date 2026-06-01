-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M41 · suscripcion.mp_last_modified (orden monotónico de webhooks MP)
-- ════════════════════════════════════════════════════════════════════════════
-- Problema (audit billing CR-3):
--   MP NO garantiza el orden de entrega de los webhooks subscription_preapproval.
--   Un evento viejo/reenviado con status=authorized podía resucitar una
--   suscripción ya CANCELADA, porque applyMpPreapprovalUpdate escribía el estado
--   mapeado sin ninguna guarda de orden.
--
-- Solución:
--   Persistir `preapproval.last_modified` (timestamp que MP emite por cada
--   cambio de estado del preapproval) y aplicar el update SOLO cuando el
--   last_modified entrante es más nuevo que el guardado (o el guardado es null).
--   Así un evento stale se descarta y no regresa un estado terminal.
--
-- Aditivo y seguro de aplicar en una base viva: solo agrega una columna nullable.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE suscripcion
  ADD COLUMN IF NOT EXISTS mp_last_modified timestamptz;

COMMENT ON COLUMN suscripcion.mp_last_modified IS
  'Folio · último preapproval.last_modified aplicado desde un webhook MP. Guarda monotonicidad: applyMpPreapprovalUpdate descarta eventos cuyo last_modified no es más nuevo que éste, evitando que un evento stale/reenviado resucite un estado terminal (CR-3).';
