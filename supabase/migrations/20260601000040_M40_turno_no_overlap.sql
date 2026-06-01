-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M40 · Turno no-overlap EXCLUSION constraint (double-booking backstop)
-- ════════════════════════════════════════════════════════════════════════════
-- Hallazgo de integridad de agenda (CR-5/CR-6/CR-7): las paths internas
-- (aceptar pedido, crear turno manual) podían insertar dos turnos solapados
-- del mismo profesional. El fix de aplicación (CAS + chequeo slot_ocupado en
-- lib/db/*) cierra la ventana en el camino feliz, pero NO es una garantía dura:
-- dos transacciones concurrentes que pasen el chequeo de lectura igual podrían
-- insertar (TOCTOU). Este constraint es el backstop a nivel DB.
--
-- Definición: un mismo `profesional_id` no puede tener dos turnos cuyos rangos
-- [inicio, inicio + duracion_min) se solapen, considerando SÓLO los estados
-- "vivos" (excluimos los terminales que liberan el slot: CANCELADO, NO_ASISTIO,
-- REAGENDADO) y excluyendo los soft-deleted (deleted_at IS NOT NULL).
--
-- Schema confirmado en M09 (20260518000009_M09_servicios_turnos.sql):
--   turno.inicio          timestamptz NOT NULL
--   turno.duracion_min    smallint     NOT NULL          (no hay columna fin/end:
--                                                          se computa de la duración)
--   turno.estado          estado_turno NOT NULL           (enum MAYÚSCULAS:
--                                                          AGENDADO/CONFIRMADO/
--                                                          EN_SALA/ATENDIENDO/
--                                                          CERRADO/NO_ASISTIO/
--                                                          CANCELADO/REAGENDADO)
--   turno.profesional_id  uuid NOT NULL
--   turno.deleted_at      timestamptz                     (soft-delete)
--
-- El EXCLUDE USING gist sobre `=` + `&&` (range overlap) requiere btree_gist
-- (para el operador `=` sobre uuid dentro de un índice GiST).
--
-- Idempotente: `create extension if not exists` + guarda en pg_constraint.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists btree_gist;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'turno_no_overlap_excl'
  ) then
    alter table public.turno
      add constraint turno_no_overlap_excl
      exclude using gist (
        profesional_id with =,
        tstzrange(inicio, inicio + (duracion_min * interval '1 minute')) with &&
      )
      where (estado not in ('CANCELADO', 'NO_ASISTIO', 'REAGENDADO')
             and deleted_at is null);
  end if;
end
$$;

comment on constraint turno_no_overlap_excl on public.turno is
  'Folio M40 · backstop de doble-reserva: impide turnos solapados del mismo profesional en estados vivos (excluye CANCELADO/NO_ASISTIO/REAGENDADO y soft-deleted). Complementa el chequeo de aplicación en lib/db/turnos.ts + lib/db/pedidos.ts.';
