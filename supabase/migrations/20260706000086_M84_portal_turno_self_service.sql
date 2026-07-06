-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M84 · Portal · self-service de turnos del paciente (Fase 3 · P4) 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- M71 (P2) dejó al paciente SÓLO leer sus turnos (turno_select_portal). P4 le
-- suma DOS acciones acotadas, ambas self-scoped (anti-IDOR) y con la máquina de
-- estados (M09) + el EXCLUDE (M40) como backstop transaccional:
--
--   1. CANCELAR un turno propio — UPDATE estado → 'CANCELADO', pero SÓLO:
--        · sobre una fila que cuelga de su cuenta (paciente_owns),
--        · desde AGENDADO o CONFIRMADO (nunca EN_SALA/ATENDIENDO/CERRADO),
--        · fuera de la VENTANA DE CORTE (inicio > now() + cutoff horas),
--        · sin tocar NINGUNA otra columna (no puede mover el horario, cambiar
--          precio, profesional ni escalar el estado a EN_SALA/ATENDIENDO).
--      Se implementa como policy self-scoped + trigger-guard que fija esas
--      invariantes de columna/estado/ventana. El trigger es el cinturón; la
--      policy, los tiradores.
--
--   2. RESERVAR / REAGENDAR — NO muta `turno`: cae como `pedido` PENDIENTE para
--      confirmación del clínico (promotePedidoToTurno lo promueve, respetando
--      auto_confirmar_reservas). Self-scoped INSERT sobre `pedido`: sólo a una
--      fila `paciente` propia y en la MISMA org de esa ficha, estado PENDIENTE.
--
-- Principio (plan Fase 3 · seguridad): toda decisión scopea desde la sesión del
-- paciente (paciente_cuenta_actual() → auth.uid()), NUNCA desde input del cliente.
-- El paciente NO recibe acceso a `sesion` (M71 lo deja estructuralmente fuera).
--
-- Aditiva: columna de config con DEFAULT + ADD VALUE de enum + policies + trigger
-- + helper. Idempotente y replay-safe en postgres:16 vanilla y bajo pgTAP.
--
-- ─── check_function_bodies = off (house style) ────────────────────────────────
-- Convención de la casa (M01/M60/M70/M71). Todos los objetos referenciados por el
-- trigger-guard y el helper (paciente_owns de M71, user_member_id_in de M01,
-- organization de M02, turno de M09) PRE-EXISTEN; el flag blinda el replay bajo la
-- preview branch de Supabase.
--
-- ─── Orden de replay (append-only) ────────────────────────────────────────────
-- Depende de M71 (paciente_owns, turno_select_portal) → prefijo …086 (después de
-- M71 …085). Número canónico M84 (siguiente libre ≥ M84 pedido por el plan).
-- ════════════════════════════════════════════════════════════════════════════

set check_function_bodies = off;

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · organization.portal_cancel_cutoff_horas — ventana de corte de cancelación
-- ════════════════════════════════════════════════════════════════════════════
-- Cuántas horas ANTES del turno el paciente todavía puede cancelar por sí mismo.
-- Default 24h (regla habitual de consultorio). Fuera de la ventana (turno más
-- cerca que el cutoff), el paciente ya no cancela solo — debe llamar al
-- consultorio (el clínico igual puede cancelar desde el staff). Aditiva con
-- DEFAULT → segura para replay y para aplicar a prod antes del código.

ALTER TABLE public.organization
  ADD COLUMN IF NOT EXISTS portal_cancel_cutoff_horas smallint NOT NULL DEFAULT 24;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organization_portal_cancel_cutoff_valid'
  ) THEN
    ALTER TABLE public.organization
      ADD CONSTRAINT organization_portal_cancel_cutoff_valid
      CHECK (portal_cancel_cutoff_horas BETWEEN 0 AND 168);  -- 0h..7 días
  END IF;
END
$$;

COMMENT ON COLUMN public.organization.portal_cancel_cutoff_horas IS
  'Folio M84 · horas antes del turno hasta las que el PACIENTE puede cancelar por el portal (P4). Default 24. Más cerca que el cutoff, el auto-servicio de cancelación se deshabilita (el clínico igual puede). 0 = sin ventana (siempre puede).';

-- ─── Helper DEFINER para leer el cutoff sin RLS de organization ───────────────
-- CRÍTICO: el paciente NO es member ⇒ org_select_own (M02) NO le deja leer la fila
-- `organization`. Por eso ni la policy de cancelación ni el trigger-guard pueden
-- leer organization.portal_cancel_cutoff_horas con el rol del paciente (devolvería
-- NULL y bloquearía TODA cancelación). Este helper SECURITY DEFINER lee la columna
-- sin atravesar la RLS de organization, devolviendo el cutoff (o el default 24 si
-- la fila no existe / valor NULL). STABLE. Se usa desde la policy USING, el
-- trigger-guard y (vía RPC) el pre-check de la app — una sola fuente de verdad.
CREATE OR REPLACE FUNCTION public.portal_cancel_cutoff(p_org uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT o.portal_cancel_cutoff_horas FROM organization o WHERE o.id = p_org),
    24
  )::int
$$;

COMMENT ON FUNCTION public.portal_cancel_cutoff(uuid) IS
  'Folio M84 · horas de ventana de corte de cancelación del portal para una org (organization.portal_cancel_cutoff_horas, default 24). SECURITY DEFINER: el paciente NO es member y no puede leer organization (org_select_own, M02); este helper le da el cutoff sin exponer la fila. Usado por la policy turno_cancel_portal, el trigger-guard y el pre-check de la app (RPC).';

-- El paciente (rol authenticated) lo llama desde la policy y por RPC en el pre-check.
GRANT EXECUTE ON FUNCTION public.portal_cancel_cutoff(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · canal_pedido += 'PORTAL' — origen de los pedidos creados desde el portal
-- ════════════════════════════════════════════════════════════════════════════
-- Los pedidos de reserva/reagenda del portal NO son booking anónimo WEB: el
-- paciente ya está autenticado (identidad conocida). Un canal propio 'PORTAL':
--   · los distingue en la bandeja del clínico,
--   · los saca del constraint pedido_web_requires_consent (M39, sólo canal WEB):
--     el consentimiento anónimo del booking público no aplica a una cuenta ya
--     autenticada y linkeada.
--
-- IMPORTANTE (restricción Postgres): un valor de enum recién agregado con
-- ADD VALUE no se puede USAR (comparar/insertar) en la MISMA transacción que lo
-- agrega. Por eso esta migración NO referencia 'PORTAL' en ningún DDL (la policy
-- de abajo NO filtra por canal). El literal 'PORTAL' sólo se usa en runtime desde
-- lib/db/portal-turnos.ts (transacción separada) — seguro.
ALTER TYPE public.canal_pedido ADD VALUE IF NOT EXISTS 'PORTAL';

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · pedido · self-INSERT del paciente (reserva/reagenda como pedido PENDIENTE)
-- ════════════════════════════════════════════════════════════════════════════
-- ADITIVA sobre las policies clínicas de M09 (PERMISSIVE ⇒ OR). El paciente sólo
-- puede encolar un pedido:
--   · atado a una fila `paciente` SUYA (paciente_owns(paciente_id)) — anti-IDOR:
--     no puede reservar "a nombre de" otro paciente,
--   · en la MISMA org de esa ficha (organization_id = org del paciente) — el guard
--     de coherencia lo re-valida a nivel fila,
--   · en estado PENDIENTE (nunca auto-CONFIRMADO: el turno lo materializa el
--     clínico o el auto-confirm, no el paciente por RLS).
-- NO se filtra por canal acá (ver nota de ADD VALUE arriba). El código setea
-- canal='PORTAL'; la coherencia paciente↔org la fija el helper de abajo.
--
-- Sin policy de SELECT propia para el paciente sobre `pedido`: no la necesita (el
-- resultado de la reserva se refleja en su turno cuando el clínico confirma; el
-- pedido crudo es metadata de bandeja del clínico). El INSERT basta para P4.
DROP POLICY IF EXISTS pedido_insert_portal ON public.pedido;
CREATE POLICY pedido_insert_portal
  ON public.pedido FOR INSERT
  WITH CHECK (
    estado = 'PENDIENTE'
    AND paciente_id IS NOT NULL
    AND public.paciente_owns(paciente_id)
    AND EXISTS (
      SELECT 1 FROM public.paciente p
      WHERE p.id = pedido.paciente_id
        AND p.organization_id = pedido.organization_id
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · turno · self-cancel del paciente — policy + trigger-guard
-- ════════════════════════════════════════════════════════════════════════════
-- 4a · Policy UPDATE self-scoped. ADITIVA sobre turno_update_scoped (staff, M09).
--   USING: la fila cuelga de la cuenta del paciente (paciente_owns) Y el turno
--          está fuera de la ventana de corte (inicio > now() + cutoff de la org).
--          El WITH CHECK exige que el estado resultante sea CANCELADO.
--   Nota: una policy no puede comparar NEW vs OLD (sólo ve una imagen por rama).
--         El bloqueo de "sólo estado cambió, sólo desde AGENDADO/CONFIRMADO" lo
--         hace el trigger-guard de 4b (que sí ve OLD y NEW). La policy filtra QUÉ
--         filas y el estado destino; el trigger fija el resto de invariantes.
DROP POLICY IF EXISTS turno_cancel_portal ON public.turno;
CREATE POLICY turno_cancel_portal
  ON public.turno FOR UPDATE
  USING (
    public.paciente_owns(turno.paciente_id)
    AND turno.inicio > now()
      + make_interval(hours => public.portal_cancel_cutoff(turno.organization_id))
  )
  WITH CHECK (
    public.paciente_owns(turno.paciente_id)
    AND turno.estado = 'CANCELADO'
  );

-- 4b · Trigger-guard: cuando quien actualiza es un PACIENTE de portal (dueño de la
--   fila vía paciente_owns Y NO member de la org), forzar que:
--     · el ÚNICO cambio sea estado (todas las demás columnas relevantes iguales),
--     · el estado pase de AGENDADO|CONFIRMADO a CANCELADO,
--     · el turno esté fuera de la ventana de corte (defensa en profundidad con la
--       policy — el trigger corre aunque un futuro path service_role saltee RLS).
--   Staff (user_member_id_in del org NOT NULL) NO entra al guard: su UPDATE sigue
--   exactamente como antes (M09/transición). El guard SÓLO endurece el path del
--   paciente. La transición AGENDADO/CONFIRMADO→CANCELADO ya la valida el trigger
--   M09; acá agregamos el anti-tampering de columnas + la ventana + el piso de
--   estados de origen (M09 permite EN_SALA→CANCELADO para staff; el paciente NO).
CREATE OR REPLACE FUNCTION public.turno_portal_cancel_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_is_member  boolean;
  v_cutoff     int;
BEGIN
  -- ¿El actor es member de la org del turno? Si lo es, es staff → no aplica el
  -- guard (su camino es el de M09, sin cambios). En replay/superuser (auth.uid()
  -- NULL) user_member_id_in devuelve NULL → v_is_member=false, pero como no hay
  -- sesión de paciente tampoco pasa el gate de paciente_owns más abajo.
  v_is_member := public.user_member_id_in(NEW.organization_id) IS NOT NULL;
  IF v_is_member THEN
    RETURN NEW;
  END IF;

  -- No es member. Sólo endurecemos si es el DUEÑO paciente de la fila (portal).
  -- Si no es dueño, la RLS ya lo habría bloqueado; devolvemos NEW y dejamos que
  -- el resto de las capas actúen (no es nuestro rol acá).
  IF NOT public.paciente_owns(OLD.id) THEN
    RETURN NEW;
  END IF;

  -- ─── A partir de acá: es un paciente de portal editando su propio turno ─────

  -- (i) Sólo se permite CANCELAR: estado destino CANCELADO.
  IF NEW.estado <> 'CANCELADO' THEN
    RAISE EXCEPTION 'portal: el paciente sólo puede cancelar su turno (estado destino inválido: %)', NEW.estado
      USING ERRCODE = '42501';
  END IF;

  -- (ii) Sólo desde AGENDADO o CONFIRMADO (nunca EN_SALA/ATENDIENDO/CERRADO/…).
  IF OLD.estado NOT IN ('AGENDADO', 'CONFIRMADO') THEN
    RAISE EXCEPTION 'portal: no se puede cancelar un turno en estado %', OLD.estado
      USING ERRCODE = '42501';
  END IF;

  -- (iii) Anti-tampering: NINGUNA otra columna material puede cambiar. El paciente
  --       no mueve el horario, ni el precio, ni el profesional, ni la modalidad,
  --       ni reasigna el turno a otro paciente/servicio/org.
  IF NEW.paciente_id      IS DISTINCT FROM OLD.paciente_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.servicio_id     IS DISTINCT FROM OLD.servicio_id
     OR NEW.profesional_id  IS DISTINCT FROM OLD.profesional_id
     OR NEW.inicio          IS DISTINCT FROM OLD.inicio
     OR NEW.duracion_min    IS DISTINCT FROM OLD.duracion_min
     OR NEW.precio_cents    IS DISTINCT FROM OLD.precio_cents
     OR NEW.modalidad       IS DISTINCT FROM OLD.modalidad
  THEN
    RAISE EXCEPTION 'portal: sólo se puede cambiar el estado a CANCELADO, no otros campos del turno'
      USING ERRCODE = '42501';
  END IF;

  -- (iv) Ventana de corte: el turno debe estar más lejos que el cutoff de la org.
  --      Vía el helper DEFINER (el trigger corre como el paciente, que NO puede
  --      leer organization por RLS — un SELECT directo devolvería NULL).
  v_cutoff := public.portal_cancel_cutoff(OLD.organization_id);
  IF OLD.inicio <= now() + make_interval(hours => v_cutoff) THEN
    RAISE EXCEPTION 'portal: fuera de la ventana de cancelación (faltan menos de % h para el turno)', v_cutoff
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.turno_portal_cancel_guard() IS
  'Folio M84 · guard BEFORE UPDATE de turno para el path del PACIENTE de portal (P4). Si el actor NO es member y ES dueño (paciente_owns) de la fila, exige: estado→CANCELADO, origen AGENDADO|CONFIRMADO, ninguna otra columna cambiada, y fuera de la ventana de corte (organization.portal_cancel_cutoff_horas). Staff (member de la org) no entra al guard. Cinturón sobre la policy turno_cancel_portal + la máquina de estados M09 + el EXCLUDE M40.';

-- BEFORE UPDATE, por-fila. Corre para TODO update de turno pero es no-op salvo
-- para el path del paciente (early-return si es member o si no es dueño).
DROP TRIGGER IF EXISTS turno_portal_cancel_guard_trg ON public.turno;
CREATE TRIGGER turno_portal_cancel_guard_trg
  BEFORE UPDATE ON public.turno
  FOR EACH ROW EXECUTE FUNCTION public.turno_portal_cancel_guard();
