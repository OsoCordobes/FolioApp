-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M47 · turno_record_transition debe ser SECURITY DEFINER
-- ════════════════════════════════════════════════════════════════════════════
-- Bug encontrado en el smoke test E2E pre-demo (2026-06-09): crear un turno
-- como usuario autenticado falla con
--
--   "new row violates row-level security policy for table transicion"
--
-- Causa: M09/M22 dejaron `transicion` con FORCE RLS y una única policy de
-- INSERT `transicion_no_direct_insert` WITH CHECK (false) — la intención es
-- que las transiciones SOLO las escriba el trigger `turno_transition_log`.
-- Pero la trigger function `turno_record_transition()` quedó SECURITY
-- INVOKER: corre con el rol del usuario y la policy la bloquea igual que a
-- un INSERT directo. Resultado: TODA creación/cambio de estado de turno por
-- un usuario autenticado abortaba (el booking público no lo sufría porque
-- corre con service_role/BYPASSRLS — por eso pasó inadvertido).
--
-- Fix: SECURITY DEFINER (owner postgres, BYPASSRLS en Supabase) — el mismo
-- patrón que ya usa audit_log_trigger para escribir en audit_log, que tiene
-- una policy idéntica de no-direct-insert. auth.uid() no se ve afectado por
-- el cambio de rol (lee el claim del JWT), así que el actor_id del log de
-- transición sigue siendo el usuario real.
-- ════════════════════════════════════════════════════════════════════════════

alter function public.turno_record_transition()
  security definer
  set search_path = public;

-- Hygiene M45-consistente: las trigger functions no se invocan por RPC.
revoke all on function public.turno_record_transition() from public, anon, authenticated, service_role;

comment on function public.turno_record_transition() is
  'Folio M09/M47 · registra cada cambio de estado de turno en transicion. SECURITY DEFINER: transicion es append-only vía trigger (policy no_direct_insert) y el rol del usuario no puede insertar directo.';
