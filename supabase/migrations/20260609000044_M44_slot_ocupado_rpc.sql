-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M44 · RPC slot_ocupado — chequeo de solapamiento en SQL
-- ════════════════════════════════════════════════════════════════════════════
-- El booking público (app/(public)/book/[slug]/actions.ts) y el pre-check de
-- turnos (lib/db/turnos.ts checkSlotOcupado) llaman `rpc("slot_ocupado", ...)`
-- desde el deploy inicial, pero la función nunca existió: cada llamada erraba
-- y caía al fallback manual de 3 queries (turno + pedido + bloqueo). Esta
-- migración define la función real: un solo round-trip, evaluada en el server,
-- con la misma semántica que el fallback de la app:
--
--   · turno    — estados vivos (AGENDADO/CONFIRMADO/EN_SALA/ATENDIENDO),
--                no soft-deleted. (El EXCLUDE de M40 sigue siendo el backstop
--                duro por-profesional a nivel constraint.)
--   · pedido   — PENDIENTE con fecha_propuesta (reserva pública sin confirmar).
--   · bloqueo  — cualquier bloqueo de agenda.
--
-- Overlap half-open [inicio, fin): a.inicio < b.fin AND a.fin > b.inicio.
--
-- SECURITY INVOKER a propósito: el booking público la invoca con service_role
-- (BYPASSRLS) y la app interna con el usuario autenticado (RLS limita a su
-- org). No necesita definer rights y así no amplía superficie de ataque.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.slot_ocupado(
  p_org    uuid,
  p_inicio timestamptz,
  p_fin    timestamptz
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
revoke all on function public.slot_ocupado(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.slot_ocupado(uuid, timestamptz, timestamptz) to authenticated, service_role;

comment on function public.slot_ocupado(uuid, timestamptz, timestamptz) is
  'Folio M44 · true si [p_inicio, p_fin) solapa con turno vivo, pedido PENDIENTE o bloqueo de la org. Misma semántica que el fallback manual de lib/db/turnos.ts; el EXCLUDE de M40 sigue siendo el backstop transaccional.';
