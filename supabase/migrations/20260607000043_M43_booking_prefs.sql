-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M43 · Booking preferences (auto-confirmar + margen de slot)
-- ════════════════════════════════════════════════════════════════════════════
-- Habilita el flujo de booking público "auto-confirmar configurable":
--
--   - organization.auto_confirmar_reservas: si true (default), una reserva
--     pública (canal WEB) se promueve automáticamente a turno CONFIRMADO sin
--     que el profesional tenga que aceptarla en la bandeja. Si false, se
--     mantiene el flujo actual (pedido PENDIENTE → aceptar manual).
--
--   - organization.slot_margen_min: minutos de separación entre slots ofrecidos
--     en el booking público. SOLO afecta qué horarios se ofrecen al paciente;
--     NO afecta el constraint M40 (turno_no_overlap_excl) ni los chequeos de
--     conflicto de la app — un turno manual puede caer en el "gap".
--
--   - pedido.profesional_id: profesional destino del pedido (resuelto en el
--     booking público vía el member es_colegiado). Necesario para:
--       (a) auto-confirmar contra el profesional correcto (M40 keyea por
--           profesional_id),
--       (b) PR B: push a Google Calendar del profesional dueño del turno.
--
-- Aditiva con DEFAULT → segura para replay CI (postgres:16) y para aplicar a
-- prod ANTES de mergear el código (disciplina de deploy de CLAUDE.md). No hay
-- constraint enforcing sobre datos existentes.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.organization
  add column if not exists auto_confirmar_reservas boolean not null default true;

alter table public.organization
  add column if not exists slot_margen_min smallint not null default 0;

alter table public.pedido
  add column if not exists profesional_id uuid references public.member(id) on delete set null;

create index if not exists pedido_profesional_idx
  on public.pedido (profesional_id)
  where profesional_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organization_slot_margen_valid'
  ) then
    alter table public.organization
      add constraint organization_slot_margen_valid
      check (slot_margen_min between 0 and 120);
  end if;
end
$$;

comment on column public.organization.auto_confirmar_reservas is
  'Folio M43 · si true (default), las reservas públicas (canal WEB) se confirman automáticamente como turno sin aprobación manual del profesional.';
comment on column public.organization.slot_margen_min is
  'Folio M43 · minutos de separación entre slots ofrecidos en el booking público. NO afecta el constraint M40 ni los chequeos de conflicto.';
comment on column public.pedido.profesional_id is
  'Folio M43 · profesional destino del pedido (resuelto en el booking público); habilita auto-confirmación y el push a Google Calendar del profesional correcto.';
