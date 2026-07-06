-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M72 · Modalidad del turno (presencial / telemedicina) + campos de sala
-- ════════════════════════════════════════════════════════════════════════════
-- Prepara la TELEMEDICINA (Fase 4 · T1). Hoy todo turno es implícitamente
-- presencial. Esta migración agrega, 100% ADITIVA sobre `turno`:
--
--   turno.modalidad            text NOT NULL DEFAULT 'presencial'
--                              CHECK IN ('presencial','telemedicina')
--   turno.sala_url_cifrado     bytea NULL   · URL de la videollamada, CIFRADA
--                              app-side (AES-256-GCM). La URL es un TOKEN de
--                              acceso a la sala → se trata como secreto, igual
--                              que un ciphertext de PHI: nunca en plaintext en
--                              reposo. El provider (T2) la genera y la app la
--                              descifra sólo para el join server-mediated.
--   turno.sala_provider_room_id text NULL   · id de la sala del lado del
--                              proveedor (Daily/Whereby) — NO es secreto (no da
--                              acceso por sí solo), sirve para idempotencia y
--                              limpieza. Plaintext, nullable.
--   turno.sala_expira_ts       timestamptz NULL · vencimiento de la sala; el
--                              join del paciente (T4) se acota a esta ventana.
--
--   servicio.modalidad_default text NOT NULL DEFAULT 'presencial'
--                              CHECK IN ('presencial','telemedicina') · default
--                              de modalidad al agendar desde ese servicio (T5:
--                              servicio "Videoconsulta"). No fuerza la modalidad
--                              del turno — sólo la sugiere en la UI de agendar.
--
-- Por qué el DEFAULT 'presencial' preserva TODO el comportamiento actual:
--   · El backfill de la columna en filas existentes es 'presencial' (el estado
--     implícito de hoy) → ningún turno cambia de semántica.
--   · Los INSERT actuales de turno (createTurno, walk-in, promoción de pedido)
--     NO setean modalidad → toman el DEFAULT → siguen siendo presenciales.
--   · Los campos de sala quedan NULL para todo turno presencial (CHECK abajo).
--
-- SIN RLS nueva: `turno` ya está protegido por la policy clinic-scoped de M09;
-- estas columnas heredan ese scope. El acceso self-read del paciente a su turno
-- lo habilita P2 (M71) — fuera de este PR.
--
-- ⚠️  turno_extendido se REDEFINE para exponer `modalidad` (badge de calendario
--     "Video"/"Consultorio"). Sólo se AGREGA modalidad al final; las columnas
--     existentes quedan intactas y en el mismo orden (copia verbatim de la
--     definición de M56). CREATE OR REPLACE VIEW NO preserva las reloptions →
--     hay que RE-DECLARAR `WITH (security_invoker = true)` o la vista pasa a
--     correr como owner (BYPASSRLS) = fuga cross-tenant. El DO-block final falla
--     la migración si la opción no quedó seteada (mismo guard que M56).
--     Los campos de SALA (sala_url_cifrado/provider_room_id/expira_ts) NO se
--     exponen en la vista: son server-only (join token), los lee directamente
--     lib/telemedicina (T2/T3), no la grilla del calendario.
--
-- Append-only / portabilidad: sólo columnas nullable (+ modalidad NOT NULL con
-- DEFAULT, que backfilla trivialmente) y CHECKs. No define funciones SQL ni
-- referencia tablas de migraciones posteriores → NO necesita
-- `set check_function_bodies = off` ni IMMUTABLE. Replay-safe en postgres:16
-- vanilla y bajo pgTAP. Idempotente (ADD COLUMN IF NOT EXISTS + CHECK guardado
-- por pg_constraint + CREATE OR REPLACE VIEW), patrón M56/M78.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Columnas en turno ──────────────────────────────────────────────────────

ALTER TABLE turno
  ADD COLUMN IF NOT EXISTS modalidad             text NOT NULL DEFAULT 'presencial',
  ADD COLUMN IF NOT EXISTS sala_url_cifrado      bytea NULL,
  ADD COLUMN IF NOT EXISTS sala_provider_room_id text NULL,
  ADD COLUMN IF NOT EXISTS sala_expira_ts        timestamptz NULL;

-- ─── Columna en servicio ────────────────────────────────────────────────────

ALTER TABLE servicio
  ADD COLUMN IF NOT EXISTS modalidad_default text NOT NULL DEFAULT 'presencial';

-- ─── CHECKs (guardados por pg_constraint para idempotencia) ─────────────────

DO $$
BEGIN
  -- Dominio de modalidad del turno.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'turno_modalidad_valida'
  ) THEN
    ALTER TABLE turno
      ADD CONSTRAINT turno_modalidad_valida
      CHECK (modalidad IN ('presencial', 'telemedicina'));
  END IF;

  -- Los campos de sala sólo tienen sentido en telemedicina: un turno presencial
  -- no puede tener URL de sala ni vencimiento. No fuerza que telemedicina los
  -- tenga (se pueblan cuando el proveedor genera la sala, T2, después de crear
  -- el turno) — sólo prohíbe el estado inconsistente presencial-con-sala.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'turno_sala_solo_telemedicina'
  ) THEN
    ALTER TABLE turno
      ADD CONSTRAINT turno_sala_solo_telemedicina
      CHECK (
        modalidad = 'telemedicina'
        OR (sala_url_cifrado IS NULL
            AND sala_provider_room_id IS NULL
            AND sala_expira_ts IS NULL)
      );
  END IF;

  -- Dominio de modalidad_default del servicio.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'servicio_modalidad_default_valida'
  ) THEN
    ALTER TABLE servicio
      ADD CONSTRAINT servicio_modalidad_default_valida
      CHECK (modalidad_default IN ('presencial', 'telemedicina'));
  END IF;
END$$;

-- ─── Comentarios ────────────────────────────────────────────────────────────

COMMENT ON COLUMN turno.modalidad IS
  'M72 · modalidad del turno: presencial (default, comportamiento histórico) o '
  'telemedicina. NOT NULL con DEFAULT presencial → backfill preserva la '
  'semántica actual. La UI de agendar la deriva de servicio.modalidad_default.';
COMMENT ON COLUMN turno.sala_url_cifrado IS
  'M72 · URL de la videollamada (telemedicina), CIFRADA app-side (AES-256-GCM). '
  'Es un token de acceso a la sala → secreto en reposo, nunca plaintext. La '
  'genera el proveedor (T2) y la app la descifra sólo para el join mediado. '
  'NULL para turnos presenciales (CHECK turno_sala_solo_telemedicina).';
COMMENT ON COLUMN turno.sala_provider_room_id IS
  'M72 · id de la sala del lado del proveedor (Daily/Whereby). NO es secreto '
  '(no otorga acceso por sí solo) → plaintext. Usado para idempotencia '
  '(ensureRoomForTurno, T2) y limpieza. NULL para turnos presenciales.';
COMMENT ON COLUMN turno.sala_expira_ts IS
  'M72 · vencimiento de la sala de telemedicina. El join del paciente (T4) se '
  'acota a esta ventana. NULL para turnos presenciales.';
COMMENT ON COLUMN servicio.modalidad_default IS
  'M72 · modalidad sugerida al agendar desde este servicio (T5: servicio '
  '"Videoconsulta"). NOT NULL DEFAULT presencial. Sólo sugiere en la UI; no '
  'fuerza turno.modalidad.';

-- ─── Redefinición de turno_extendido (agrega modalidad al final) ────────────
-- Copia verbatim de la definición de M56; ÚNICO cambio: se AÑADE t.modalidad al
-- final del SELECT (no reordena las columnas existentes). Los campos de sala NO
-- se exponen (server-only). Se RE-DECLARA security_invoker=true (obligatorio).

CREATE OR REPLACE VIEW turno_extendido
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.organization_id,
  t.inicio,
  t.duracion_min,
  t.estado,
  t.origen,
  t.precio_cents,
  t.gcal_event_id,
  t.atendiendo_desde,
  t.duracion_real_min,
  t.created_at,

  t.paciente_id,
  pi.nombre_cifrado     AS paciente_nombre_cifrado,
  pi.apellido_cifrado   AS paciente_apellido_cifrado,
  pi.telefono_cifrado   AS paciente_telefono_cifrado,
  p.tipo                AS paciente_tipo,
  p.tags                AS paciente_tags,
  public.paciente_tiene_alergias_severas(p.id) AS paciente_alerta_alergia,

  t.servicio_id,
  s.nombre              AS servicio_nombre,
  s.tipo_canonico       AS servicio_tipo_canonico,

  t.profesional_id,

  pa.id                 AS pago_id,
  pa.monto_cents        AS pago_monto_cents,
  pa.metodo             AS pago_metodo,
  pa.estado             AS pago_estado,
  pa.pagado_ts          AS pago_pagado_ts,

  t.nota_reserva_cifrado,

  -- M72: columna nueva, AÑADIDA AL FINAL (no reordena las existentes).
  t.modalidad

FROM turno t
JOIN paciente p           ON p.id = t.paciente_id
LEFT JOIN paciente_identidad pi ON pi.id = p.identidad_id
JOIN servicio s           ON s.id = t.servicio_id
LEFT JOIN pago pa         ON pa.turno_id = t.id;

COMMENT ON VIEW turno_extendido IS
  'Folio · vista turno + paciente_identidad + servicio + pago + nota_reserva (M56) + modalidad (M72) para grillas. RLS heredada de turno (scope clinic-aware) vía security_invoker.';

-- Defensa: la migración FALLA si security_invoker no quedó seteado (evita la
-- fuga cross-tenant silenciosa que CREATE OR REPLACE VIEW puede introducir).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'turno_extendido'
      AND relkind = 'v'
      AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION 'M72: turno_extendido perdió security_invoker=true (fuga RLS) — abortando';
  END IF;
END $$;
