-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M71 · RLS de auto-lectura del paciente (portal · Fase 3 · P2) 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Frontera de seguridad del portal del paciente. M70 (P1) instaló la identidad
-- cross-org (`paciente_cuenta`, `paciente.cuenta_id`, helper
-- `paciente_cuenta_actual()`) DEJANDO CERRADAS las tablas nuevas y SIN otorgar al
-- paciente lectura de NADA de su ficha. Esta migración agrega las policies de
-- AUTO-LECTURA — y SÓLO auto-lectura, self-scoped por la cuenta del login.
--
-- Principio de arquitectura (plan Fase 3 · decisión bloqueada #3):
--   · Los pacientes NUNCA reciben una fila `member` ⇒ public.user_org_ids() y
--     public.can_read_clinical() son SIEMPRE vacío/false para ellos ⇒ TODAS las
--     policies de clínico (M03/M07/M09/M10/M60…) son no-ops para un paciente.
--   · Las policies de acá son ADITIVAS (Postgres combina PERMISSIVE con OR): no
--     tocan ni una policy de staff. Sobre un paciente sólo aplica lo que agregamos
--     acá; sobre un miembro de staff siguen aplicando SÓLO las policies de staff
--     (paciente_cuenta_actual() es NULL para él ⇒ estas policies son no-op).
--   · Self-scope: cada policy exige que la fila cuelgue de la `paciente_cuenta`
--     del usuario logueado, vía `paciente.cuenta_id = paciente_cuenta_actual()`.
--     paciente_cuenta_actual() (M70) filtra SIEMPRE por auth.uid() y NO acepta
--     arg ⇒ un paciente no puede pedir la cuenta de otro. Si es NULL (staff/anon),
--     `cuenta_id = NULL` nunca es verdadero ⇒ estas policies no otorgan nada.
--
-- DELIBERADAMENTE NO SE OTORGA NINGÚN ACCESO A `sesion` (ni a `sesion_enmienda`,
-- ni a `tool_data`): el SOAP crudo queda ESTRUCTURALMENTE inalcanzable para el
-- paciente. No hay policy aditiva sobre `sesion` ⇒ la única RLS que le aplica es
-- la clínica de M10, que es no-op para un no-member ⇒ 0 filas, siempre. El
-- "resumen clínico curado" (P5) será un WHITELIST explícito de campos servido por
-- código `service_role`, NUNCA un filtro sobre la tabla cruda. Tampoco se otorga
-- INSERT/UPDATE/DELETE de ninguna tabla clínica: el paciente es READ-ONLY sobre su
-- ficha (su auto-gestión de contacto y booking llegan en P4/P8 con paths acotados).
--
-- Alcance EXACTO de lo que el paciente puede leer con M71:
--   · paciente            — SU(S) fila(s) PHI (una por org linkeada). SELECT.
--   · paciente_identidad  — SU PII (la identidad colgada de una fila paciente suya).
--   · turno               — SUS turnos. SELECT.
--   · consentimiento      — SUS consentimientos firmados. SELECT.
--   · paciente_claim      — self-select + self-insert de SU cola de claims (P3
--                           encola en service_role; esto habilita que el paciente
--                           vea/registre su propio pedido de link). El clínico
--                           resuelve claims con su policy clínica (P9/M71 abajo).
--
-- Helper nuevo:
--   · public.paciente_owns(uuid) boolean — SECURITY DEFINER + STABLE. true si esa
--     fila `paciente` cuelga de la cuenta del usuario logueado. DEFINER ⇒ lee
--     `paciente` sin recursión de RLS (las policies de turno/consentimiento lo
--     llaman en su USING sin re-evaluar la RLS de paciente). Filtra por auth.uid()
--     vía paciente_cuenta_actual() ⇒ no impersona.
--
-- ─── check_function_bodies = off (house style) ────────────────────────────────
-- Por convención de la casa (M01/M60/M70). Acá todos los objetos referenciados por
-- paciente_owns() (paciente, paciente_cuenta_actual de M70) PRE-EXISTEN; el flag es
-- defensa de replay bajo la preview branch de Supabase.
--
-- ─── Orden de replay (append-only) ────────────────────────────────────────────
-- Depende de M70 (helper + columna cuenta_id + tabla paciente_claim). M70 lleva el
-- prefijo …084; este archivo lleva …085 para ORDENAR DESPUÉS. Número canónico M71.
--
-- Portabilidad: replay-safe en postgres:16 vanilla y bajo pgTAP. Idempotente
-- (CREATE OR REPLACE FUNCTION + DROP POLICY IF EXISTS antes de cada CREATE POLICY).
-- Sin índices ni EXCLUDE nuevos. Las tablas ya tienen RLS ENABLE+FORCE (M03/M07/
-- M09/M70): acá SÓLO agregamos policies.
-- ════════════════════════════════════════════════════════════════════════════

set check_function_bodies = off;

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · public.paciente_owns(uuid) — ¿esta fila paciente es del usuario logueado?
-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER + STABLE. true sii existe una fila `paciente` con ese id cuyo
-- cuenta_id = la paciente_cuenta viva del usuario logueado (paciente_cuenta_actual,
-- M70). DEFINER para poder consultar `paciente` a pesar de su RLS FORCE sin que el
-- USING de las policies de turno/consentimiento tenga que atravesarla (evita
-- cualquier sutileza de recursión de policy y es más barato). NUNCA acepta la
-- cuenta como argumento — la resuelve por auth.uid() adentro ⇒ no impersona.
-- Devuelve false (no NULL) cuando no hay match o cuando paciente_cuenta_actual()
-- es NULL (staff/anon) ⇒ seguro por default.
CREATE OR REPLACE FUNCTION public.paciente_owns(p_paciente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM paciente p
     WHERE p.id = p_paciente_id
       AND p.cuenta_id IS NOT NULL
       AND p.cuenta_id = public.paciente_cuenta_actual()
  )
$$;

COMMENT ON FUNCTION public.paciente_owns(uuid) IS
  'Folio M71 · true si la fila paciente <id> cuelga de la paciente_cuenta del usuario logueado (cuenta_id = paciente_cuenta_actual(), M70). SECURITY DEFINER + STABLE, resuelve la cuenta por auth.uid() (no acepta arg de cuenta ⇒ no impersona). Base del USING de las policies de auto-lectura del paciente sobre turno/consentimiento (M71). false para staff/anon (paciente_cuenta_actual() NULL).';

-- Lo llaman las policies del paciente bajo el rol `authenticated` del usuario.
GRANT EXECUTE ON FUNCTION public.paciente_owns(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · paciente — auto-lectura de la(s) PHI propia(s)
-- ════════════════════════════════════════════════════════════════════════════
-- ADITIVA sobre las policies clínicas de M03 (PERMISSIVE ⇒ OR). El paciente ve
-- SÓLO las filas paciente cuyo cuenta_id es su cuenta (una por org linkeada). No
-- ve `sesion` (no hay policy aditiva sobre sesion). Sólo SELECT: el paciente no
-- crea ni edita su PHI (eso nace del lado clínico).
DROP POLICY IF EXISTS paciente_select_portal ON paciente;
CREATE POLICY paciente_select_portal
  ON paciente FOR SELECT
  USING (
    cuenta_id IS NOT NULL
    AND cuenta_id = public.paciente_cuenta_actual()
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · paciente_identidad — auto-lectura de la PII propia
-- ════════════════════════════════════════════════════════════════════════════
-- La PII (nombre, doc, contacto) cuelga de `paciente` vía paciente.identidad_id.
-- El paciente puede leer la identidad ligada a una fila paciente suya. EXISTS sobre
-- paciente: como la policy #2 le otorga sus filas paciente, el EXISTS (evaluado
-- bajo su rol) las encuentra. deleted_at IS NULL: no exponer identidades
-- pseudonimizadas (borradas físicamente de todos modos, pero explícito). SELECT
-- únicamente — la auto-edición de contacto (allow-list server-side) llega en P8.
DROP POLICY IF EXISTS paciente_identidad_select_portal ON paciente_identidad;
CREATE POLICY paciente_identidad_select_portal
  ON paciente_identidad FOR SELECT
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
        FROM paciente p
       WHERE p.identidad_id = paciente_identidad.id
         AND p.cuenta_id IS NOT NULL
         AND p.cuenta_id = public.paciente_cuenta_actual()
    )
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · turno — auto-lectura de los turnos propios
-- ════════════════════════════════════════════════════════════════════════════
-- ADITIVA sobre la policy clinic-scoped de M09. El paciente ve SÓLO sus turnos
-- (turno.paciente_id cuelga de una fila paciente suya). Sólo SELECT: reservar/
-- reagendar/cancelar desde el portal llega en P4 con transiciones acotadas.
DROP POLICY IF EXISTS turno_select_portal ON turno;
CREATE POLICY turno_select_portal
  ON turno FOR SELECT
  USING (
    public.paciente_owns(turno.paciente_id)
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · consentimiento — auto-lectura de los consentimientos firmados propios
-- ════════════════════════════════════════════════════════════════════════════
-- ADITIVA sobre la policy clínica de M07. El paciente ve SÓLO sus consentimientos.
-- Sólo SELECT: ver/firmar desde el portal (canvas→PNG→Storage + inmutabilidad)
-- llega en P6 con su propio path.
DROP POLICY IF EXISTS consentimiento_select_portal ON consentimiento;
CREATE POLICY consentimiento_select_portal
  ON consentimiento FOR SELECT
  USING (
    public.paciente_owns(consentimiento.paciente_id)
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 6 · paciente_claim — self-select + self-insert de la cola de link del paciente
-- ════════════════════════════════════════════════════════════════════════════
-- El matcher de P3 (service_role) encola los claims ambiguos; estas policies dejan
-- que el PACIENTE dueño de la cuenta vea SUS claims y registre uno propio (p. ej.
-- "soy paciente de esta org, vincúlenme"). NO puede resolverlos (aprobar/rechazar
-- = UPDATE): eso es exclusivo del clínico (policies de abajo, P9). Self-scope por
-- paciente_cuenta_id = su cuenta.
--
-- self-INSERT: el paciente sólo puede encolar un claim A SU PROPIA cuenta y en
-- estado 'pendiente' (no puede auto-aprobarse). El same-org guard de M70 valida que
-- paciente_id ∈ organization_id. NO le damos manera de setear un paciente_id que no
-- sea suyo a un estado aprobado: el estado arranca 'pendiente' y sólo el clínico lo
-- mueve. (Que el paciente_id apunte a una ficha que aún NO es suya es EL PUNTO de un
-- claim: pide que se lo vinculen; el gate anti-impersonación es la aprobación del
-- clínico, no el INSERT.)
DROP POLICY IF EXISTS paciente_claim_select_portal ON paciente_claim;
CREATE POLICY paciente_claim_select_portal
  ON paciente_claim FOR SELECT
  USING (
    paciente_cuenta_id = public.paciente_cuenta_actual()
  );

DROP POLICY IF EXISTS paciente_claim_insert_portal ON paciente_claim;
CREATE POLICY paciente_claim_insert_portal
  ON paciente_claim FOR INSERT
  WITH CHECK (
    paciente_cuenta_id = public.paciente_cuenta_actual()
    AND estado = 'pendiente'
  );

-- ─── paciente_claim · lado clínico (resolución · P9) ─────────────────────────
-- El clínico con acceso a la org ve y resuelve (aprobar→setea paciente.cuenta_id
-- fuera de acá, rechazar) los claims de SU org. Self-scoped por user_org_ids() +
-- can_read_clinical (mismo techo que la PHI: sólo quien puede leer clínico decide
-- un link de identidad, gate anti-impersonación). Sin DELETE (append-only de la
-- cola: se resuelve por estado, no se borra).
DROP POLICY IF EXISTS paciente_claim_select_clinical ON paciente_claim;
CREATE POLICY paciente_claim_select_clinical
  ON paciente_claim FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  );

DROP POLICY IF EXISTS paciente_claim_update_clinical ON paciente_claim;
CREATE POLICY paciente_claim_update_clinical
  ON paciente_claim FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
  );

-- NOTA (frontera 🔒): NO se crea policy alguna sobre `sesion`, `sesion_enmienda`,
-- ni ninguna tabla de SOAP/tool_data. Es DELIBERADO: sin policy aditiva, la única
-- RLS que le aplica a un paciente sobre `sesion` es la clínica de M10 (no-op para
-- un no-member) ⇒ 0 filas SIEMPRE. El SOAP crudo es estructuralmente inalcanzable.
