-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M54 · slot_ocupado per-profesional + exclusión de turno
-- ════════════════════════════════════════════════════════════════════════════
-- Dos problemas de la auditoría clínica (2026-06-12):
--
-- 1. SOBRE-BLOQUEO ORG-WIDE: la firma M53 chequea turno/pedido/bloqueo solo
--    por organization_id — en una clínica, el turno del cardiólogo bloquea a
--    la psicóloga a la misma hora. La app quedaba MÁS restrictiva que su
--    propio backstop transaccional (el EXCLUDE de M40 keyea por
--    profesional_id). `p_profesional` alinea el chequeo con el dominio.
--
-- 2. DIVERGENCIA PRE-CHECK vs CREATE en REAGENDAR (review PR #44, B1): el
--    pre-check del reagendado excluía el propio turno solo en el fallback
--    manual de la app (per-profesional), pero el create posterior usaba el
--    RPC org-wide → en clínicas el pre-check podía pasar y el create fallar
--    DESPUÉS de la transición irreversible a REAGENDADO (huérfano
--    determinístico). `p_exclude_turno` permite que ambos chequeos usen el
--    MISMO RPC con la misma semántica.
--
-- Semántica por tabla con p_profesional NOT NULL:
--   · turno   — solo los del profesional (M40 garantiza per-prof; el slot de
--               otro médico no es conflicto).
--   · bloqueo — solo los del profesional (bloqueo.profesional_id es NOT NULL
--               desde M09: es agenda personal — la ausencia del cardiólogo no
--               bloquea a la psicóloga).
--   · pedido  — los del profesional MÁS los pedidos sin profesional asignado
--               (legacy/WhatsApp): bloquean conservadoramente hasta asignarse.
--
-- Con p_profesional NULL la semántica es IDÉNTICA a M53 (org-wide): los
-- callers viejos siguen funcionando sin cambios (PostgREST resuelve los
-- defaults) — rollout escalonado seguro: migración primero, código después.
--
-- DROP + CREATE (no OR REPLACE): cambia la firma; un overload vivo de 4 args
-- ambiguaría la resolución de PostgREST.

drop function if exists public.slot_ocupado(uuid, timestamptz, timestamptz, uuid);

create function public.slot_ocupado(
  p_org            uuid,
  p_inicio         timestamptz,
  p_fin            timestamptz,
  p_exclude_pedido uuid default null,
  p_profesional    uuid default null,
  p_exclude_turno  uuid default null
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
         and (p_profesional is null or t.profesional_id = p_profesional)
         and t.id is distinct from p_exclude_turno
         and t.inicio < p_fin
         and t.inicio + make_interval(mins => t.duracion_min) > p_inicio
    )
    or exists (
      select 1
        from pedido pe
       where pe.organization_id = p_org
         and pe.estado = 'PENDIENTE'
         and pe.id is distinct from p_exclude_pedido
         and (p_profesional is null
              or pe.profesional_id = p_profesional
              or pe.profesional_id is null)
         and pe.fecha_propuesta is not null
         and pe.fecha_propuesta < p_fin
         and pe.fecha_propuesta + make_interval(mins => pe.duracion_min) > p_inicio
    )
    or exists (
      select 1
        from bloqueo b
       where b.organization_id = p_org
         and (p_profesional is null or b.profesional_id = p_profesional)
         and b.inicio < p_fin
         and b.inicio + make_interval(mins => b.duracion_min) > p_inicio
    );
$$;

-- anon no la necesita: el flujo público corre server-side con service_role.
revoke all on function public.slot_ocupado(uuid, timestamptz, timestamptz, uuid, uuid, uuid) from public, anon;
grant execute on function public.slot_ocupado(uuid, timestamptz, timestamptz, uuid, uuid, uuid) to authenticated, service_role;

comment on function public.slot_ocupado(uuid, timestamptz, timestamptz, uuid, uuid, uuid) is
  'Folio M54 · true si [p_inicio, p_fin) solapa turno vivo / pedido PENDIENTE / bloqueo. p_profesional acota el chequeo a la agenda de UN profesional (NULL = org-wide, semántica M53); p_exclude_pedido/p_exclude_turno excluyen la fila propia en promociones/reagendas. El EXCLUDE de M40 (per-profesional) sigue siendo el backstop transaccional.';
