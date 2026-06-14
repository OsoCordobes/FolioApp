-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M56 · Nota de reserva del turno (motivo del booking público)
-- ════════════════════════════════════════════════════════════════════════════
-- El "motivo"/aclaraciones que el paciente escribe en /book/[slug] vive hoy SOLO
-- en pedido.motivo_cifrado y NO se copia al turno al promover. La grilla del
-- calendario no podía mostrar ese texto al abrir el detalle de un turno.
--
-- Esta migración agrega turno.nota_reserva_cifrado (AES-256-GCM app-side) que
-- promotePedidoToTurno + reagendarTurno rellenan (re-cifrando el motivo). Es
-- PHI (motivo de consulta) — la app sólo lo desencripta para roles clínicos.
--
-- ⚠️  turno_extendido se redefine para exponer la columna. CREATE OR REPLACE
--     VIEW NO preserva las reloptions: hay que RE-DECLARAR
--     `WITH (security_invoker = true)` o la vista pasa a correr como owner
--     (BYPASSRLS) y se convierte en una fuga cross-tenant. El DO-block final
--     falla la migración si la opción no quedó seteada.
--     (Definición base copiada de M14; columnas existentes intactas y en el
--      mismo orden — sólo se AGREGA nota_reserva_cifrado al final.)
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE turno ADD COLUMN nota_reserva_cifrado bytea;

COMMENT ON COLUMN turno.nota_reserva_cifrado IS
  'Folio M56 · motivo/aclaraciones del booking público, copiado (re-cifrado AES-256-GCM) desde pedido.motivo_cifrado al promover/reagendar. NULL para turnos manuales/walk-in. PHI: la app sólo lo descifra para roles clínicos.';

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

  -- M56: columna nueva, AÑADIDA AL FINAL (no reordena las existentes).
  t.nota_reserva_cifrado

FROM turno t
JOIN paciente p           ON p.id = t.paciente_id
LEFT JOIN paciente_identidad pi ON pi.id = p.identidad_id
JOIN servicio s           ON s.id = t.servicio_id
LEFT JOIN pago pa         ON pa.turno_id = t.id;

COMMENT ON VIEW turno_extendido IS
  'Folio · vista turno + paciente_identidad + servicio + pago + nota_reserva (M56) para grillas. RLS heredada de turno (scope clinic-aware) vía security_invoker.';

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
    RAISE EXCEPTION 'M56: turno_extendido perdió security_invoker=true (fuga RLS) — abortando';
  END IF;
END $$;
