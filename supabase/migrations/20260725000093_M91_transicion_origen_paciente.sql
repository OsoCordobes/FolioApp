-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M91 · Origen 'paciente' en el log de transiciones de turno 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Cuando el PACIENTE cancela (o confirma) su turno, la fila que queda en
-- `transicion` dice que lo hizo el consultorio a mano:
--
--   INSERT INTO transicion (…, actor_id, trigger_origin)
--   VALUES (…, public.user_member_id_in(NEW.organization_id),
--           coalesce(current_setting('folio.transition_origin', true), 'manual'));
--                                    ↑ M09, definición vigente en M57:50-53
--
-- Sin sesión de staff `user_member_id_in` da NULL, y como NADIE setea el GUC el
-- origen sale 'manual' — la misma firma que una cancelación de mostrador. En un
-- log append-only de un producto con PHI, eso es un registro que miente.
--
-- Son TRES los caminos afectados:
--   1. Email 1-click · cancelar   → app/(public)/t/[token]/actions.ts (service client)
--   2. Email 1-click · confirmar  → ídem (turno.confirmado_via ya dice 'paciente',
--                                   pero la fila de `transicion` no)
--   3. Portal · cancelación       → lib/db/portal-turnos.ts (RLS client, M84)
--
-- ─── Qué hace esta migración ──────────────────────────────────────────────────
-- (a) Ensancha el CHECK de `transicion.trigger_origin` con 'paciente'. M09 es
--     append-only, así que un CHECK se modifica con DROP + ADD acá, nunca
--     editando M09. Es un ensanchamiento PURO: toda fila existente pasa.
--
-- (b) `turno_transicion_paciente(uuid, text, text[])` — SECURITY DEFINER que
--     setea el GUC y corre el CAS en el MISMO cuerpo. Hace falta porque
--     PostgREST corre cada statement en su propia transacción: un
--     `.rpc('set_config')` aparte no sobrevive hasta el UPDATE. NO agrega
--     privilegio: el llamador ya es el service client (BYPASSRLS), que hoy
--     escribe el turno con un UPDATE directo — la función sólo suma el GUC y
--     encierra el guard de estados.
--
-- (c) Redefine `turno_portal_cancel_guard()` (M84) para que setee el GUC. El
--     guard es BEFORE UPDATE y `turno_transition_log` es AFTER: misma
--     transacción, ese orden. Así el path del portal queda auditado bien SIN
--     ningún cambio en el código de la app. Cuerpo COMPLETO de M84 con el
--     `set_config` agregado — mismo estilo con que M57 redefinió
--     turno_record_transition().
--
-- (d) Redefine `turno_record_transition()` cambiando `coalesce(...)` por
--     `coalesce(nullif(..., ''), 'manual')`. OBLIGATORIO, no cosmético:
--
--       select current_setting('folio.transition_origin', true) is null;  -- t
--       begin; select set_config('folio.transition_origin','paciente',true); commit;
--       select current_setting('folio.transition_origin', true) is null;  -- f  ← ''
--
--     `set_config(..., is_local => true)` revierte el VALOR al terminar la
--     transacción, pero el placeholder GUC queda DEFINIDO en la sesión para
--     siempre, y desde entonces `current_setting(name, true)` devuelve string
--     vacío en vez de NULL. Con el coalesce viejo eso escribe trigger_origin =
--     '' y el CHECK lo rechaza (23514).
--
--     En producción PostgREST/Supavisor poolean conexiones: la PRIMERA
--     transición de paciente "envenena" la conexión, y a partir de ahí TODA
--     transición de staff que caiga en esa misma conexión falla — el
--     consultorio no puede confirmar, cancelar, marcar llegada ni cerrar
--     turnos, de forma intermitente según qué conexión le toque. Leer el GUC
--     era inocuo mientras nadie lo escribía; M91 es el primer escritor.
--
-- ─── check_function_bodies = off (house style) ────────────────────────────────
-- Convención de la casa (M01/M60/M70/M71/M84). Todo lo referenciado acá
-- PRE-EXISTE (estado_turno/turno/transicion de M09, user_member_id_in de M01,
-- paciente_owns de M71, portal_cancel_cutoff de M84); el flag blinda el replay
-- bajo la preview branch de Supabase.
--
-- ─── Orden de replay (append-only) ────────────────────────────────────────────
-- Depende de M84 (…086, guard del portal) y M90 (…092, turno.confirmado_via) →
-- prefijo …093. Número canónico M91 (siguiente libre).
-- ════════════════════════════════════════════════════════════════════════════

set check_function_bodies = off;

-- ─── (a) Ensanchar el CHECK de trigger_origin ────────────────────────────────
-- M09 lo creó con ('manual','auto','webhook','walk_in','system'). Un CHECK no
-- se "altera": se dropea y se re-agrega. El ADD valida la tabla entera, pero al
-- ser un ensanchamiento ninguna fila existente puede fallar.

alter table public.transicion
  drop constraint if exists transicion_trigger_origin_valid;

alter table public.transicion
  add constraint transicion_trigger_origin_valid
  check (trigger_origin in ('manual', 'auto', 'webhook', 'walk_in', 'system', 'paciente'));

comment on column public.transicion.trigger_origin is
  'M09/M91 · quién originó la transición: manual (staff desde la app) | paciente '
  '(1-click del email o self-service del portal) | auto | webhook | walk_in | system. '
  'Filas previas a M91 originadas por el paciente quedaron como manual (no hay backfill posible).';

-- ─── (b) El default del GUC tiene que sobrevivir a la primera escritura ──────
-- Cuerpo COMPLETO de M57 con UN cambio: nullif(..., '') adentro del coalesce.
-- Sin esto, la primera transición de paciente deja el placeholder GUC definido
-- en la sesión y todas las transiciones POSTERIORES de esa conexión escriben
-- '' → violan el CHECK (23514). Ver el encabezado, punto (d).
-- Se preservan SECURITY DEFINER (M47) + search_path y se re-emite el REVOKE
-- (CREATE OR REPLACE re-otorga EXECUTE a PUBLIC).

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
          -- M91 · nullif: el GUC vuelve a '' (no a NULL) una vez que la sesión
          -- lo definió alguna vez. Sin esto el default 'manual' nunca aplica.
          coalesce(nullif(current_setting('folio.transition_origin', true), ''), 'manual'));
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.turno_record_transition() FROM public, anon, authenticated, service_role;

COMMENT ON FUNCTION public.turno_record_transition() IS
  'Folio M09/M47/M57/M91 · registra cada cambio de estado de turno en transicion. SECURITY DEFINER '
  '(transicion es append-only vía trigger). M57 suma AGENDADO → EN_SALA. M91 envuelve el GUC en '
  'nullif(...,'''') porque set_config(is_local) deja el placeholder definido y current_setting pasa a '
  'devolver '''' en vez de NULL — sin eso el default manual no aplica y el CHECK rechaza la fila.';

-- ─── (c) RPC del path service_role (email 1-click) ───────────────────────────
-- Reemplaza el `.from("turno").update(...)` de la action. Devuelve el id
-- afectado o CERO filas si el CAS se perdió (otro click / staff movió el
-- estado), que es exactamente el contrato que la action ya maneja.

create or replace function public.turno_transicion_paciente(
  p_turno_id uuid,
  p_to       text,
  p_from     text[]
)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Función angosta a propósito: el 1-click sólo confirma o cancela. Cualquier
  -- otro destino (EN_SALA, CERRADO, …) es de mostrador y no sale de un email.
  if p_to not in ('CONFIRMADO', 'CANCELADO') then
    raise exception 'turno_transicion_paciente: destino no permitido (%)', p_to
      using errcode = '22023';
  end if;

  -- El ORIGEN también se acota en DB, no sólo app-side vía CONFIRM_CAS_FROM: la
  -- máquina de estados M09 permite EN_SALA→CANCELADO, pero eso es una acción de
  -- mostrador, no de un link de email. Mismo piso que le pone el guard del
  -- portal (M84 (ii)) — sin esto, un caller service_role podría cancelar un
  -- turno en curso y quedaría auditado como si lo hubiera hecho el paciente.
  if not (p_from <@ array['AGENDADO', 'CONFIRMADO']) then
    raise exception 'turno_transicion_paciente: origen no permitido (%)', p_from
      using errcode = '22023';
  end if;

  -- El GUC lo lee turno_record_transition() (AFTER trigger) dentro de esta misma
  -- transacción. is_local => true: muere con la transacción, y en PostgREST cada
  -- request ES una transacción, así que no filtra entre requests.
  perform set_config('folio.transition_origin', 'paciente', true);

  -- CAS guardado por estado, espejo del `.in("estado", CONFIRM_CAS_FROM[...])`
  -- que hacía la action. `deleted_at is null` se re-filtra acá porque el
  -- SECURITY DEFINER bypassea RLS igual que el service client.
  --
  -- `atendiendo_desde` no se toca: CONFIRM_CAS_FROM sólo admite origen
  -- AGENDADO/CONFIRMADO, estados en los que ya es NULL por el CHECK
  -- turno_atendiendo_consistency (M09).
  return query
    with upd as (
      update public.turno t
         set estado = p_to::estado_turno,
             confirmado_via = case
               when p_to = 'CONFIRMADO' then 'paciente'
               else t.confirmado_via          -- una cancelación no borra el M90
             end
       where t.id = p_turno_id
         and t.deleted_at is null
         and t.estado = any (p_from::estado_turno[])
      returning t.id
    )
    select upd.id from upd;
end
$$;

-- Sólo el service client la invoca (la action del email corre sin sesión y ya
-- verificó el token HMAC app-side). anon/authenticated NO deben poder llamarla:
-- bypassea RLS por definición.
revoke all on function public.turno_transicion_paciente(uuid, text, text[])
  from public, anon, authenticated;
grant execute on function public.turno_transicion_paciente(uuid, text, text[])
  to service_role;

comment on function public.turno_transicion_paciente(uuid, text, text[]) is
  'Folio M91 · transición de turno originada por el PACIENTE (1-click del email). '
  'Setea folio.transition_origin = paciente y corre el CAS por estado en la misma '
  'transacción, para que turno_record_transition() audite el origen real. '
  'SECURITY DEFINER sin privilegio nuevo (el llamador ya es service_role/BYPASSRLS). '
  'Sólo CONFIRMADO|CANCELADO. Cero filas = CAS perdido (carrera), no error.';

-- ─── (d) El guard del portal setea el GUC ────────────────────────────────────
-- Cuerpo COMPLETO de M84 (append-only: se redefine acá, no se edita allá) con
-- UNA línea nueva antes del RETURN NEW final. Se preserva LANGUAGE plpgsql +
-- SET search_path y la AUSENCIA de SECURITY DEFINER (setear un GUC no requiere
-- privilegio, y el guard debe seguir corriendo como el invocador para que
-- user_member_id_in/paciente_owns evalúen la sesión REAL).

create or replace function public.turno_portal_cancel_guard()
returns trigger
language plpgsql
set search_path = public
as $$
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
  IF NOT public.paciente_owns(OLD.paciente_id) THEN
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

  -- (iii) Anti-tampering: NINGUNA otra columna puede cambiar — comparación de la
  --       FILA COMPLETA menos `estado` (allowlist, no denylist). Un denylist de
  --       columnas enumeradas dejaba pasar deleted_at (soft-delete: el paciente
  --       escondía su cancelación tardía de las vistas del consultorio),
  --       nota_reserva_cifrado (PHI, M56), gcal_event_id y sala_* (telemedicina,
  --       M72) — y cualquier columna futura. La forma cerrada cubre todo.
  --       Orden de triggers (alfabético): este guard (…portal_cancel…) corre
  --       ANTES de turno_same_org_guard y turno_set_updated_at, así que NEW
  --       llega acá sin mutar por otros triggers (updated_at aún es el de OLD
  --       salvo que el cliente lo haya tocado — y eso también se bloquea).
  --       M91: por esto mismo la atribución del portal NO puede ser una columna
  --       espejo (turno.cancelado_via) — este diff la rechazaría. Va por GUC.
  IF (to_jsonb(NEW) - 'estado') IS DISTINCT FROM (to_jsonb(OLD) - 'estado') THEN
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

  -- (v) M91 · Llegar acá significa: NO es staff, ES el dueño paciente de la fila,
  --     y la cancelación pasó las cuatro invariantes. Marcamos el origen para que
  --     turno_record_transition() (AFTER, misma transacción) audite 'paciente' en
  --     vez de 'manual'. Se setea DESPUÉS de validar, así una cancelación
  --     rechazada nunca deja el GUC seteado.
  PERFORM set_config('folio.transition_origin', 'paciente', true);

  RETURN NEW;
END
$$;

comment on function public.turno_portal_cancel_guard() is
  'Folio M84/M91 · guard BEFORE UPDATE de turno para el path del PACIENTE de portal (P4). '
  'Si el actor NO es member y ES dueño (paciente_owns) de la fila, exige: estado→CANCELADO, '
  'origen AGENDADO|CONFIRMADO, NINGUNA otra columna cambiada (fila completa via to_jsonb menos '
  'estado — cubre deleted_at/nota_reserva_cifrado/gcal_event_id/sala_* y columnas futuras), y '
  'fuera de la ventana de corte (organization.portal_cancel_cutoff_horas). Staff (member de la '
  'org) no entra al guard. M91: al pasar todas las validaciones setea folio.transition_origin = '
  'paciente para que el log de transiciones registre el origen real. Cinturón sobre la policy '
  'turno_cancel_portal + la máquina de estados M09 + el EXCLUDE M40.';
