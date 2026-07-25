-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M92 · El log interno del turno vuelve a ser sólo del staff 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Cierra una fuga de lectura hacia las cuentas de PORTAL que nadie introdujo a
-- propósito: es el producto de dos decisiones correctas por separado.
--
-- ─── Cómo se abrió ───────────────────────────────────────────────────────────
-- M09 le dio a las dos tablas satélite de `turno` una policy de SELECT SIN
-- predicado propio de organización, delegando entera la decisión en la RLS de
-- `turno`:
--
--   -- M09:465                            -- M09:476
--   CREATE POLICY transicion_select_scoped  CREATE POLICY pago_select_admin
--     ON transicion FOR SELECT                ON pago FOR SELECT
--     USING (EXISTS (                         USING (EXISTS (
--       SELECT 1 FROM turno t                   SELECT 1 FROM turno t
--       WHERE t.id = transicion.turno_id));     WHERE t.id = pago.turno_id));
--                                               -- "la policy de turno ya filtra por scope"
--
-- El comentario de M09 era cierto EN M09: `turno` sólo tenía policies de staff
-- (turno_select_clinic_scoped), así que ese EXISTS significaba exactamente "el
-- staff ve los satélites de los turnos que ya puede ver".
--
-- M71 (…085) sumó la auto-lectura del paciente:
--
--   CREATE POLICY turno_select_portal ON turno FOR SELECT
--     USING (public.paciente_owns(turno.paciente_id));
--
-- Las policies PERMISSIVE se OR-ean. Desde ese momento el EXISTS de los
-- satélites también da true para una cuenta de portal sobre SUS turnos — sin
-- que ninguna migración de M71 en adelante tocara `transicion` ni `pago`. Es el
-- costo de delegar el scope en la RLS de otra tabla: el predicado propio de la
-- tabla satélite ya no dice nada, y cualquier policy nueva sobre `turno` se
-- propaga sola.
--
-- ─── Qué se filtraba ─────────────────────────────────────────────────────────
-- Ninguna UI lo pide: NINGÚN código TS lee esas tablas desde el portal
-- (`grep from("transicion")` da cero; los reads de `pago` son de /finanzas y
-- lib/afip, todos con sesión de staff). Era lectura no intencional, alcanzable
-- igual porque PostgREST expone toda la tabla al rol `authenticated`:
--
--   · transicion → `actor_id` (QUÉ member del staff tocó cada estado y cuándo)
--     y `trigger_origin`. Con M91 el log además distingue 'paciente' vs
--     'manual', o sea que se volvió MÁS informativo justo ahora.
--   · pago → `comision_clinica_cents` y `liquidado_profesional_cents` (el split
--     clínica↔profesional, dato comercial entre la clínica y su profesional),
--     `notas` (texto libre de mostrador) y `factura_afip_numero`.
--
-- En un producto con PHI, que el paciente pueda reconstruir la operación
-- interna del consultorio no es aceptable ni siquiera si "sólo son sus datos".
--
-- ─── Qué hace esta migración ─────────────────────────────────────────────────
-- Le agrega a cada policy un PISO propio de pertenencia a la org del turno:
-- `t.organization_id IN (SELECT public.user_org_ids())`. Los pacientes NUNCA
-- reciben fila en `member` (invariante que M71 documenta en su encabezado), así
-- que `user_org_ids()` es siempre vacío para ellos → EXISTS false.
--
-- Es un ANGOSTAMIENTO PURO, cero cambio para el staff: para pasar el EXISTS ya
-- había que pasar `turno_select_clinic_scoped`, que EMPIEZA por ese mismo
-- `organization_id IN (SELECT public.user_org_ids())`. El predicado nuevo es
-- redundante para todo actor que hoy lee legítimamente, y decisivo para el
-- portal. Se conserva la delegación en la RLS de `turno` porque ahí vive el
-- scope FINO del staff (PROFESIONAL ve los suyos, COORDINADOR/ASISTENTE por
-- `alcance`); lo que se suma es el piso que faltaba, no un reemplazo.
--
-- `transicion` no tiene `organization_id` propio (es un log append-only colgado
-- de `turno`), así que el piso se evalúa sobre `t`, adentro del EXISTS. `pago`
-- tampoco.
--
-- No se toca `post_visita_select_clinical`: ese EXISTS ya exige
-- `can_read_clinical(t.organization_id)`, que es false para quien no es member.
-- Tampoco `pago_write_admin` (ya exige `user_role_in(...)`). Se revisó el resto
-- de la cadena: son las dos únicas policies que delegaban sin piso.
--
-- ─── Alcance deliberado: sólo SELECT ─────────────────────────────────────────
-- Las policies de escritura de ambas tablas quedan como están:
-- `transicion_no_direct_insert/no_update/no_delete` (M09/M22 — el log lo escribe
-- sólo el trigger SECURITY DEFINER de M47) y `pago_write_admin` + `pago_no_delete`.
--
-- ─── check_function_bodies ───────────────────────────────────────────────────
-- No aplica: esta migración no define ninguna función. Sólo DROP + CREATE de dos
-- policies, que no se parsean bajo ese flag.
--
-- ─── Orden de replay (append-only) ───────────────────────────────────────────
-- No edita M09 ni M71 (append-only). Depende de M09 (…009, las policies) y de
-- M01 (…001, user_org_ids). Prefijo …094, después de M91 (…093). Número
-- canónico M92 (siguiente libre).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── transicion · el log de estados es del consultorio ──────────────────────

DROP POLICY IF EXISTS transicion_select_scoped ON public.transicion;

CREATE POLICY transicion_select_scoped
  ON public.transicion FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.turno t
      WHERE t.id = transicion.turno_id
        -- M92 · piso propio: hay que ser member de la org del turno. Sin esto,
        -- turno_select_portal (M71) alcanza para pasar el EXISTS.
        AND t.organization_id IN (SELECT public.user_org_ids())
    )
  );

COMMENT ON POLICY transicion_select_scoped ON public.transicion IS
  'Folio M09/M92 · el log de transiciones lo lee SÓLO el staff: member de la org del turno '
  '(user_org_ids) Y con el turno visible por la RLS de turno (scope fino por rol/alcance). '
  'M92 sumó el piso de org: sin él, turno_select_portal (M71) hacía que el paciente de portal '
  'leyera actor_id y trigger_origin de sus propios turnos.';

-- ─── pago · el split clínica↔profesional tampoco es del paciente ────────────

DROP POLICY IF EXISTS pago_select_admin ON public.pago;

CREATE POLICY pago_select_admin
  ON public.pago FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.turno t
      WHERE t.id = pago.turno_id
        -- M92 · idéntico caso que transicion. El scope fino del staff lo sigue
        -- poniendo la RLS de turno; acá va sólo el piso de pertenencia.
        AND t.organization_id IN (SELECT public.user_org_ids())
    )
  );

COMMENT ON POLICY pago_select_admin ON public.pago IS
  'Folio M09/M92 · el pago lo lee SÓLO el staff: member de la org del turno (user_org_ids) Y con '
  'el turno visible por la RLS de turno. M92 sumó el piso de org: sin él, turno_select_portal '
  '(M71) exponía comision_clinica_cents, liquidado_profesional_cents, notas y factura_afip_numero '
  'a la cuenta de portal del paciente. La escritura sigue en pago_write_admin (rol) + pago_no_delete.';
