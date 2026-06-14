-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M57 · Permitir AGENDADO → EN_SALA (sacar el paso "Confirmar")
-- ════════════════════════════════════════════════════════════════════════════
-- Feedback de demo: el botón "Confirmar" antes de la hora del turno es
-- innecesario — los turnos del booking ya están de hecho confirmados. La UI
-- (turno-row.tsx) pasa a mostrar "Marcar llegada" directo sobre un turno
-- AGENDADO, lo que exige permitir la transición AGENDADO → EN_SALA (la matriz
-- M09 sólo permitía AGENDADO → CONFIRMADO).
--
-- Esta migración REDEFINE turno_record_transition() con el CUERPO COMPLETO de
-- M09 (matriz + INSERT INTO transicion + ramas TG_OP/no-op), cambiando SÓLO la
-- línea de AGENDADO para sumar 'EN_SALA'. Mantiene SECURITY DEFINER +
-- search_path (M47) y re-emite el revoke (CREATE OR REPLACE re-otorga EXECUTE a
-- PUBLIC). NO se toca el trigger turno_transition_log.
--
-- Seguridad: la nueva arista es compatible con el CHECK
-- turno_atendiendo_consistency (EN_SALA no requiere atendiendo_desde) y no
-- afecta M40 (overlap), checkSlotOcupado ni KPIs (AGENDADO y EN_SALA ya se
-- tratan ambos como "vivos"). Todos los objetos referenciados pre-existen →
-- no se requiere `set check_function_bodies = off`.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.turno_record_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prev_estado estado_turno;
BEGIN
  IF TG_OP = 'INSERT' THEN
    prev_estado := NULL;
  ELSE
    prev_estado := OLD.estado;
    IF prev_estado = NEW.estado THEN
      RETURN NEW;                                    -- sin cambio, no transición
    END IF;
    -- Validar transición permitida
    IF NOT (
      (prev_estado = 'AGENDADO'   AND NEW.estado IN ('CONFIRMADO', 'EN_SALA', 'CANCELADO', 'REAGENDADO', 'NO_ASISTIO'))
      OR (prev_estado = 'CONFIRMADO' AND NEW.estado IN ('EN_SALA', 'NO_ASISTIO', 'CANCELADO', 'REAGENDADO'))
      OR (prev_estado = 'EN_SALA'    AND NEW.estado IN ('ATENDIENDO', 'CANCELADO'))
      OR (prev_estado = 'ATENDIENDO' AND NEW.estado = 'CERRADO')
      OR (prev_estado = 'NO_ASISTIO' AND NEW.estado = 'REAGENDADO')
    ) THEN
      RAISE EXCEPTION 'Invalid turno transition: % → %', prev_estado, NEW.estado;
    END IF;
  END IF;
  INSERT INTO transicion (turno_id, from_estado, to_estado, ts, actor_id, trigger_origin)
  VALUES (NEW.id, prev_estado, NEW.estado, now(),
          public.user_member_id_in(NEW.organization_id),
          coalesce(current_setting('folio.transition_origin', true), 'manual'));
  RETURN NEW;
END
$$;

-- M47-consistente: las trigger functions no se invocan por RPC.
REVOKE ALL ON FUNCTION public.turno_record_transition() FROM public, anon, authenticated, service_role;

COMMENT ON FUNCTION public.turno_record_transition() IS
  'Folio M09/M47/M57 · registra cada cambio de estado de turno en transicion. SECURITY DEFINER (transicion es append-only vía trigger). M57 suma AGENDADO → EN_SALA (la UI saca el paso Confirmar).';
