-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M53 · slot_ocupado: parámetro de exclusión de pedido
-- ════════════════════════════════════════════════════════════════════════════
-- FIX del bloqueante del booking público (auditoría 2026-06-11, hallazgo #1):
-- `createPedidoPublico` inserta el pedido PENDIENTE y DESPUÉS llama
-- `promotePedidoToTurno`, cuyo primer paso re-chequea el slot con
-- `slot_ocupado`. Como la función cuenta los pedidos PENDIENTE solapados, el
-- pedido recién insertado SIEMPRE matchea su propio rango → toda reserva
-- pública (y todo "Aceptar" desde la bandeja) devolvía conflict. Producción
-- lo confirma: 0 pedidos y 0 turnos origen BOOKING en toda la historia.
--
-- Fix: `p_exclude_pedido` (default NULL) excluye el pedido que se está
-- promoviendo del chequeo de conflicto. Con NULL la semántica es idéntica a
-- M44 (los llamadores existentes con 3 args siguen funcionando — PostgREST
-- resuelve el default).
--
-- DROP + CREATE (no CREATE OR REPLACE) porque cambia la firma: dejar la
-- versión de 3 args viva crearía un overload ambiguo para PostgREST.

drop function if exists public.slot_ocupado(uuid, timestamptz, timestamptz);

create function public.slot_ocupado(
  p_org            uuid,
  p_inicio         timestamptz,
  p_fin            timestamptz,
  p_exclude_pedido uuid default null
)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    exists (
      select 1
        from turno t
       where t.organization_id = p_org
         and t.deleted_at is null
         and t.estado in ('AGENDADO', 'CONFIRMADO', 'EN_SALA', 'ATENDIENDO')
         and t.inicio < p_fin
         and t.inicio + make_interval(mins => t.duracion_min) > p_inicio
    )
    or exists (
      select 1
        from pedido pe
       where pe.organization_id = p_org
         and pe.estado = 'PENDIENTE'
         and pe.id is distinct from p_exclude_pedido
         and pe.fecha_propuesta is not null
         and pe.fecha_propuesta < p_fin
         and pe.fecha_propuesta + make_interval(mins => pe.duracion_min) > p_inicio
    )
    or exists (
      select 1
        from bloqueo b
       where b.organization_id = p_org
         and b.inicio < p_fin
         and b.inicio + make_interval(mins => b.duracion_min) > p_inicio
    );
$$;

-- anon no la necesita: el flujo público corre server-side con service_role.
revoke all on function public.slot_ocupado(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.slot_ocupado(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;

comment on function public.slot_ocupado(uuid, timestamptz, timestamptz, uuid) is
  'Folio M53 · true si [p_inicio, p_fin) solapa con turno vivo, pedido PENDIENTE (≠ p_exclude_pedido) o bloqueo de la org. p_exclude_pedido permite que promotePedidoToTurno no se auto-conflictúe con el pedido que está promoviendo; el EXCLUDE de M40 sigue siendo el backstop transaccional.';
