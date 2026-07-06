-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M86 · Portal · auto-gestión de contacto por el paciente (Fase 3 · P8) 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- M71 (P2) dejó al paciente SÓLO LEER su PII (paciente_identidad_select_portal).
-- P8 le suma UNA acción acotada: EDITAR SUS DATOS DE CONTACTO Y DOMICILIO sobre una
-- fila `paciente_identidad` que cuelga de una ficha `paciente` SUYA. La escritura es
-- self-scoped (anti-IDOR) y con una ALLOW-LIST DURA de columnas:
--
--   EDITABLE por el paciente (contacto + domicilio):
--     · email_cifrado + email_hash          (contacto)
--     · telefono_cifrado + telefono_hash    (contacto)
--     · domicilio_calle_cifrado
--     · domicilio_numero_cifrado
--     · domicilio_ciudad / domicilio_provincia / domicilio_cp
--
--   INMUTABLE para el paciente (INTEGRIDAD DE IDENTIDAD — cambiarlos sería un pedido
--   que el clínico revisa, no un auto-servicio):
--     · nombre_cifrado / apellido_cifrado / nombre_hash
--     · tipo_doc / numero_doc_cifrado / dni_hash
--     · organization_id / deleted_at / created_at
--
-- La allow-list PRIMARIA vive en el data layer (lib/db/portal-perfil.ts): construye
-- el UPDATE con SÓLO las columnas editables y recomputa los hashes con el salt de la
-- org. Esta migración es el CINTURÓN (defensa en profundidad a nivel DB): aunque un
-- path futuro arme un UPDATE crudo, el trigger-guard RECHAZA cualquier cambio a una
-- columna de identidad cuando el actor es un paciente de portal (no-member + dueño).
--
-- Principio (plan Fase 3 · seguridad): toda decisión scopea desde la sesión del
-- paciente (paciente_cuenta_actual() → auth.uid()), NUNCA desde input del cliente.
-- El paciente NO recibe acceso a `sesion` (M71 lo deja estructuralmente fuera); esto
-- sólo agrega UPDATE de columnas de contacto sobre `paciente_identidad` (que él ya
-- podía leer).
--
-- Aditiva: helper + policy UPDATE + trigger-guard. Idempotente y replay-safe en
-- postgres:16 vanilla y bajo pgTAP.
--
-- ─── check_function_bodies = off (house style) ────────────────────────────────
-- Convención de la casa (M01/M60/M70/M71/M84/M85). Todos los objetos referenciados
-- por el helper y el trigger-guard (paciente_cuenta_actual de M70, user_member_id_in
-- de M01, paciente/paciente_identidad de M03) PRE-EXISTEN; el flag blinda el replay
-- bajo la preview branch de Supabase.
--
-- ─── Orden de replay (append-only) ────────────────────────────────────────────
-- Depende de M71 (paciente_identidad_select_portal, paciente_cuenta_actual) →
-- prefijo …088 (después de M85 …087). Número canónico M86 (siguiente libre ≥ M84
-- pedido por el plan; M84=P4, M85=P6).
-- ════════════════════════════════════════════════════════════════════════════

set check_function_bodies = off;

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · public.paciente_owns_identidad(uuid) — ¿esta identidad es del login?
-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER + STABLE. true sii existe una fila `paciente` viva cuyo
-- identidad_id = <id> y cuyo cuenta_id = la paciente_cuenta del usuario logueado
-- (paciente_cuenta_actual, M70). Espeja paciente_owns (M71) pero indexado por la
-- identidad (la PII cuelga de `paciente` vía paciente.identidad_id). DEFINER para
-- consultar `paciente` sin atravesar su RLS FORCE desde el USING/guard. NUNCA acepta
-- la cuenta como arg — la resuelve por auth.uid() adentro ⇒ no impersona. Devuelve
-- false (no NULL) para staff/anon (paciente_cuenta_actual() NULL) ⇒ seguro por default.
CREATE OR REPLACE FUNCTION public.paciente_owns_identidad(p_identidad_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM paciente p
     WHERE p.identidad_id = p_identidad_id
       AND p.pseudonimizado_en IS NULL
       AND p.cuenta_id IS NOT NULL
       AND p.cuenta_id = public.paciente_cuenta_actual()
  )
$$;

COMMENT ON FUNCTION public.paciente_owns_identidad(uuid) IS
  'Folio M86 · true si la fila paciente_identidad <id> cuelga (vía paciente.identidad_id) de una ficha paciente viva de la paciente_cuenta del usuario logueado (M70/M71). SECURITY DEFINER + STABLE, resuelve la cuenta por auth.uid() (no acepta arg de cuenta ⇒ no impersona). Base del USING de la policy de auto-edición de contacto del paciente (P8). false para staff/anon.';

-- Lo llama la policy del paciente bajo el rol `authenticated` del usuario.
GRANT EXECUTE ON FUNCTION public.paciente_owns_identidad(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · paciente_identidad · self-UPDATE del paciente (contacto/domicilio)
-- ════════════════════════════════════════════════════════════════════════════
-- ADITIVA sobre paciente_identidad_update_admin (staff, M03 · PERMISSIVE ⇒ OR). El
-- paciente sólo puede actualizar una identidad SUYA (paciente_owns_identidad), viva.
-- La policy filtra QUÉ filas; el bloqueo de QUÉ columnas (allow-list de contacto vs.
-- inmutabilidad de identidad) lo hace el trigger-guard de la sección 3 (que sí ve
-- OLD vs NEW — una policy no puede comparar imágenes).
DROP POLICY IF EXISTS paciente_identidad_update_portal ON public.paciente_identidad;
CREATE POLICY paciente_identidad_update_portal
  ON public.paciente_identidad FOR UPDATE
  USING (
    deleted_at IS NULL
    AND public.paciente_owns_identidad(id)
  )
  WITH CHECK (
    deleted_at IS NULL
    AND public.paciente_owns_identidad(id)
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · paciente_identidad · guard de allow-list (defensa en profundidad)
-- ════════════════════════════════════════════════════════════════════════════
-- Cuando quien actualiza es un PACIENTE de portal (NO member de la org de la fila Y
-- dueño de la identidad vía paciente_owns_identidad), forzar que NINGUNA columna de
-- IDENTIDAD cambie. El paciente sólo puede tocar contacto/domicilio; nombre, apellido,
-- documento (tipo/número) y sus blind indexes de identidad quedan intactos.
--
--   Staff (user_member_id_in del org NOT NULL) NO entra al guard: su UPDATE sigue
--   exactamente como antes (M03). El guard SÓLO endurece el path del paciente.
--
-- Espeja el patrón de turno_portal_cancel_guard (M84): early-return si es member o si
-- no es el dueño paciente; sólo entonces aplica el anti-tampering de columnas.
CREATE OR REPLACE FUNCTION public.paciente_identidad_portal_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_is_member boolean;
BEGIN
  -- ¿El actor es member de la org de la identidad? Si lo es, es staff → no aplica el
  -- guard (su camino es el de M03, sin cambios). En replay/superuser (auth.uid()
  -- NULL) user_member_id_in devuelve NULL → v_is_member=false, pero como no hay
  -- sesión de paciente tampoco pasa el gate de paciente_owns_identidad más abajo.
  v_is_member := public.user_member_id_in(NEW.organization_id) IS NOT NULL;
  IF v_is_member THEN
    RETURN NEW;
  END IF;

  -- No es member. Sólo endurecemos si es el DUEÑO paciente de la identidad (portal).
  -- Si no es dueño, la RLS ya lo habría bloqueado; devolvemos NEW y dejamos que el
  -- resto de las capas actúen (no es nuestro rol acá).
  IF NOT public.paciente_owns_identidad(OLD.id) THEN
    RETURN NEW;
  END IF;

  -- ─── A partir de acá: es un paciente de portal editando su propia identidad ────
  -- ALLOW-LIST DURA: ninguna columna de IDENTIDAD puede cambiar. El paciente sólo
  -- puede tocar contacto (email/telefono) y domicilio. Cambiar nombre/documento es un
  -- pedido que el clínico revisa (integridad de identidad), NO un auto-servicio.
  IF NEW.nombre_cifrado     IS DISTINCT FROM OLD.nombre_cifrado
     OR NEW.apellido_cifrado   IS DISTINCT FROM OLD.apellido_cifrado
     OR NEW.tipo_doc           IS DISTINCT FROM OLD.tipo_doc
     OR NEW.numero_doc_cifrado IS DISTINCT FROM OLD.numero_doc_cifrado
     OR NEW.nombre_hash        IS DISTINCT FROM OLD.nombre_hash
     OR NEW.dni_hash           IS DISTINCT FROM OLD.dni_hash
     OR NEW.fecha_nacimiento   IS DISTINCT FROM OLD.fecha_nacimiento
     OR NEW.sexo_biologico     IS DISTINCT FROM OLD.sexo_biologico
     OR NEW.organization_id    IS DISTINCT FROM OLD.organization_id
     OR NEW.deleted_at         IS DISTINCT FROM OLD.deleted_at
  THEN
    RAISE EXCEPTION 'portal: el paciente sólo puede editar sus datos de contacto y domicilio, no su identidad (nombre/documento)'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.paciente_identidad_portal_update_guard() IS
  'Folio M86 · guard BEFORE UPDATE de paciente_identidad para el path del PACIENTE de portal (P8). Si el actor NO es member y ES dueño (paciente_owns_identidad) de la fila, exige que NINGUNA columna de identidad cambie (nombre/apellido/tipo_doc/numero_doc/nombre_hash/dni_hash/fecha_nacimiento/sexo/organization_id/deleted_at). Sólo contacto (email/telefono + hashes) y domicilio son editables. Staff (member de la org) no entra al guard. Cinturón sobre la policy paciente_identidad_update_portal + la allow-list del data layer.';

-- BEFORE UPDATE, por-fila. Corre para TODO update de paciente_identidad pero es
-- no-op salvo para el path del paciente (early-return si es member o si no es dueño).
DROP TRIGGER IF EXISTS paciente_identidad_portal_update_guard_trg ON public.paciente_identidad;
CREATE TRIGGER paciente_identidad_portal_update_guard_trg
  BEFORE UPDATE ON public.paciente_identidad
  FOR EACH ROW EXECUTE FUNCTION public.paciente_identidad_portal_update_guard();
