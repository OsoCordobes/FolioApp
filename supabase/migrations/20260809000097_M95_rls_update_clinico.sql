-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M95 · el UPDATE clínico exige poder VER al paciente 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- Hallazgo (audit 2026-08-09 · HIGH · riesgo clínico directo).
--
-- Las cuatro tablas clínicas hijas quedaron con la ESCRITURA más laxa que la
-- LECTURA. El SELECT de cada una exige, además de la org y el gate clínico, que
-- el paciente sea visible:
--
--     USING (organization_id IN (SELECT user_org_ids())
--            AND can_read_clinical(organization_id)
--            AND EXISTS (SELECT 1 FROM paciente p WHERE p.id = <tabla>.paciente_id))
--
-- …y el UPDATE hermano se quedó sólo con las dos primeras condiciones:
--
--     USING       (organization_id IN (SELECT user_org_ids()) AND can_read_clinical(organization_id))
--     WITH CHECK  (idem)
--
-- Como el EXISTS es lo único que hace jugar la RLS de `paciente` (asignación del
-- profesional M32 + caja fuerte M03/M31), su ausencia convierte al UPDATE en una
-- operación de ORGANIZACIÓN ENTERA. Un
--
--     PATCH /rest/v1/alergia?organization_id=eq.<org>   {"activa": false}
--
-- desactiva a ciegas las alergias de TODOS los pacientes de la clínica —
-- incluidos los de fichas que ese usuario no puede ni abrir. Y la bandera de
-- alergia severa de /hoy deja de dispararse: el riesgo es clínico y directo, sin
-- versionado para restaurar (las cuatro tablas son no_delete, pero el UPDATE sí
-- pisa). Lo mismo aplica a `diagnostico`, `medicacion` y `documento_clinico`.
--
-- NO CONFUNDIR con el ataque amplio "un PROFESIONAL edita pacientes ajenos vía
-- PostgREST", que la verificación adversarial REFUTÓ: Postgres exige la policy
-- SELECT dentro del UPDATE, así que sobre `paciente` no hay acceso cross-paciente.
-- Lo que acá se cierra es distinto: el UPDATE masivo por `organization_id` sobre
-- las tablas HIJAS, donde el filtro por paciente nunca existió.
--
-- ─── Qué hace esta migración ────────────────────────────────────────────────
-- 1. Recrea las 4 policies de UPDATE agregando el EXISTS sobre `paciente` a
--    USING **y** a WITH CHECK. Se usa la forma ESTRICTA (la del INSERT hermano,
--    que además ata la org: `p.organization_id = <tabla>.organization_id`), no la
--    del SELECT: es un superset de lo que el SELECT ya filtra y cierra de paso el
--    re-parenting de una fila a un paciente de otro tenant.
--    Pre-check en producción antes de aplicar: las 4 tablas tienen 0 filas y 0
--    desalineadas, así que nadie pierde acceso a nada existente.
--
-- 2. Cierra el caveat de `paciente_update_clinical` (M03): su WITH CHECK es sólo
--    `org IN user_org_ids() AND can_read_clinical(org)` — no dice nada de
--    `caja_fuerte_profesional`. Un PROFESIONAL con acceso legítimo a una ficha
--    podía UPDATE-earse a sí mismo en esa columna y dejar afuera al OWNER (la
--    caja fuerte, M32, se aplica a TODOS los roles). No se puede expresar en un
--    WITH CHECK, que sólo ve NEW: "no cambiar esta columna" necesita OLD. Va como
--    trigger BEFORE UPDATE, el mismo mecanismo que ya usa
--    `paciente_member_same_org_guard`.
--
-- ─── Compatibilidad ─────────────────────────────────────────────────────────
-- Ningún camino de la app escribe `caja_fuerte_profesional` (verificado por grep
-- sobre lib/, app/ y components/: sólo aparece en database.types.ts y en un
-- comentario), así que el trigger no rompe ningún flujo vigente; sólo cierra la
-- vía directa por PostgREST. El service_role (auth.uid() NULL) queda exento: los
-- crons y las funciones SECURITY DEFINER tienen que poder seguir moviéndola.
--
-- OJO con el NULL: `user_role_in(org)` devuelve NULL para quien no es member, y
-- `NULL NOT IN (…)` evalúa a NULL — la misma trampa que M93 tuvo que arreglar en
-- pseudonimizar_paciente. Por eso acá va coalesce(…, '') y no un NOT IN pelado.
--
-- Prefijo …097, número canónico M95.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · UPDATE de las tablas clínicas hijas: exigir el paciente
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS diagnostico_update_clinical ON public.diagnostico;
CREATE POLICY diagnostico_update_clinical
  ON public.diagnostico FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.paciente p
       WHERE p.id = diagnostico.paciente_id
         AND p.organization_id = diagnostico.organization_id
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.paciente p
       WHERE p.id = diagnostico.paciente_id
         AND p.organization_id = diagnostico.organization_id
    )
  );

DROP POLICY IF EXISTS alergia_update_clinical ON public.alergia;
CREATE POLICY alergia_update_clinical
  ON public.alergia FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.paciente p
       WHERE p.id = alergia.paciente_id
         AND p.organization_id = alergia.organization_id
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.paciente p
       WHERE p.id = alergia.paciente_id
         AND p.organization_id = alergia.organization_id
    )
  );

DROP POLICY IF EXISTS medicacion_update_clinical ON public.medicacion;
CREATE POLICY medicacion_update_clinical
  ON public.medicacion FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.paciente p
       WHERE p.id = medicacion.paciente_id
         AND p.organization_id = medicacion.organization_id
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.paciente p
       WHERE p.id = medicacion.paciente_id
         AND p.organization_id = medicacion.organization_id
    )
  );

-- La policy de documento_clinico se llama `documento_update_clinical` (sin el
-- sufijo _clinico de la tabla) — nombre heredado de M08.
DROP POLICY IF EXISTS documento_update_clinical ON public.documento_clinico;
CREATE POLICY documento_update_clinical
  ON public.documento_clinico FOR UPDATE
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.paciente p
       WHERE p.id = documento_clinico.paciente_id
         AND p.organization_id = documento_clinico.organization_id
    )
  )
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.can_read_clinical(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.paciente p
       WHERE p.id = documento_clinico.paciente_id
         AND p.organization_id = documento_clinico.organization_id
    )
  );

-- Nota: NO se agrega `deleted_at IS NULL` (que sí tiene el SELECT de
-- documento_clinico) — en USING se evalúa sobre la fila VIEJA, así que el
-- borrado lógico seguiría funcionando, pero bloquearía des-borrar y editar un
-- documento ya archivado. Eso es un cambio de comportamiento ajeno a este fix.

COMMENT ON POLICY diagnostico_update_clinical ON public.diagnostico IS
  'M05 + M95 · org + gate clínico + el paciente tiene que ser visible bajo la RLS de paciente (hereda asignación M32 y caja fuerte M03/M31). Sin el EXISTS, un PATCH por organization_id editaba las filas de TODOS los pacientes de la clínica.';
COMMENT ON POLICY alergia_update_clinical ON public.alergia IS
  'M05 + M95 · idem diagnostico. Era la peor de las cuatro: desactivar alergias a ciegas apaga la bandera de alergia severa de /hoy.';
COMMENT ON POLICY medicacion_update_clinical ON public.medicacion IS
  'M05 + M95 · idem diagnostico.';
COMMENT ON POLICY documento_update_clinical ON public.documento_clinico IS
  'M08 + M95 · idem diagnostico.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · caja_fuerte_profesional sólo la mueve un admin de la org
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.paciente_caja_fuerte_solo_admin()
RETURNS trigger
LANGUAGE plpgsql
-- DEFINER como todos los helpers de RLS del esquema (user_role_in,
-- can_read_clinical, paciente_owns): el cuerpo llama a auth.uid(), y bajo
-- INVOKER eso exige USAGE sobre el schema `auth` al rol que dispara el UPDATE.
-- No decide nada por sí mismo — sólo consulta quién es el actor y delega en
-- user_role_in, que ya es DEFINER.
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Sin cambio en la columna: nada que controlar.
  IF NEW.caja_fuerte_profesional IS NOT DISTINCT FROM OLD.caja_fuerte_profesional THEN
    RETURN NEW;
  END IF;

  -- service_role / SECURITY DEFINER sin JWT de usuario (crons, RPCs internas):
  -- exentos, igual que en el resto del esquema.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- coalesce obligatorio: user_role_in() devuelve NULL para quien no es member y
  -- `NULL NOT IN (…)` evalúa a NULL, con lo que el IF no entraría (es la misma
  -- trampa que M93 tuvo que cerrar en pseudonimizar_paciente).
  IF coalesce(public.user_role_in(NEW.organization_id), '') NOT IN ('OWNER', 'DIRECTOR') THEN
    RAISE EXCEPTION 'paciente: solo OWNER/DIRECTOR pueden cambiar la caja fuerte del paciente'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.paciente_caja_fuerte_solo_admin() IS
  'Folio M95 · impide que un PROFESIONAL se auto-asigne paciente.caja_fuerte_profesional y deje al OWNER sin acceso a la ficha. Necesita OLD, así que no puede vivir en el WITH CHECK de paciente_update_clinical. Exime a service_role (auth.uid() NULL).';

DROP TRIGGER IF EXISTS paciente_caja_fuerte_guard ON public.paciente;
CREATE TRIGGER paciente_caja_fuerte_guard
  BEFORE UPDATE OF caja_fuerte_profesional ON public.paciente
  FOR EACH ROW
  EXECUTE FUNCTION public.paciente_caja_fuerte_solo_admin();
