-- M52 · Índice único para upsert idempotente de bloqueos Google.
--
-- El sync inbound (Google → Folio) refleja eventos del calendar del
-- profesional como filas de `bloqueo` con origen='google'. Para que el
-- webhook pueda upsertear sin carrera entre notificaciones concurrentes
-- del mismo calendario, necesita un conflict target inferible por
-- PostgREST: un índice único NO parcial sobre
-- (organization_id, profesional_id, gcal_event_id).
--
-- Los bloqueos manuales (gcal_event_id IS NULL) no se ven afectados:
-- en Postgres los NULL son distintos entre sí en índices únicos
-- (NULLS DISTINCT, default), así que pueden coexistir N filas manuales.
--
-- Pre-check prod (2026-06-10): tabla bloqueo vacía — sin riesgo de
-- violación al instalar.

CREATE UNIQUE INDEX bloqueo_gcal_event_unique_idx
  ON bloqueo (organization_id, profesional_id, gcal_event_id);

COMMENT ON INDEX bloqueo_gcal_event_unique_idx IS
  'Folio M52 · conflict target del upsert del sync inbound Google→bloqueo. NULLs (bloqueos manuales) no chocan.';
