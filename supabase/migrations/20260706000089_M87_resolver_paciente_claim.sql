-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M87 · Resolución de claims de vinculación por el clínico (Fase 3 · P9) 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- El matcher del portal (P3, lib/portal/link-actions.ts) auto-linkea SÓLO alta
-- confianza (dos identificadores independientes en la MISMA ficha); todo lo
-- ambiguo se ENCOLA en `paciente_claim` con estado 'pendiente' (M70). P9 le da al
-- CLÍNICO de la org la decisión explícita: APROBAR (→ setea paciente.cuenta_id,
-- materializando el link) o RECHAZAR. Este es el GATE ANTI-IMPERSONACIÓN: ningún
-- link ambiguo se vuelve real sin la decisión de alguien con acceso clínico a esa
-- org.
--
-- ─── Por qué una función SECURITY DEFINER (y no dos UPDATE RLS-enforced) ──────
-- Aprobar es una operación de DOS escrituras que DEBE ser ATÓMICA y con guardas
-- CAS que la RLS por sí sola no garantiza:
--   1. `paciente_claim.estado` 'pendiente' → 'aprobado'  (CAS: sólo si pendiente)
--   2. `paciente.cuenta_id` NULL → <cuenta del claim>    (CAS: SÓLO SI ES NULL)
-- El guard "cuenta_id SÓLO SI NULL" del paso 2 es la defensa MEDULAR contra
-- impersonación: si la ficha YA está linkeada a OTRA cuenta, aprobar NO la
-- re-asigna (raise → conflicto); si ya está linkeada a la MISMA cuenta del claim,
-- es idempotente (se marca el claim aprobado sin re-escribir). Hacer esto como dos
-- UPDATE sueltos desde JS es (a) NO atómico (ventana de carrera entre ambos) y (b)
-- chocaría con `paciente_update_clinical` (M03), que exige que el actor sea dueño
-- de la caja_fuerte del paciente — pero aprobar un link de IDENTIDAD es una
-- decisión ADMINISTRATIVA de la org, no una edición de contenido clínico: un OWNER
-- debe poder aprobar el claim de una ficha con caja_fuerte de otro profesional sin
-- tocar su PHI. La función DEFINER resuelve ambos: atomicidad + autorización propia
-- (valida can_read_clinical adentro) sin depender del techo de escritura de M03.
--
-- ─── Autorización (adentro de la función, no delegada a la RLS del UPDATE) ────
-- El actor debe ser MEMBER VIVO con acceso clínico a la org DEL CLAIM
-- (public.can_read_clinical = OWNER + PROFESIONAL + DIRECTOR colegiado, M01). Se
-- valida por auth.uid() SIEMPRE (nunca por un arg del caller) → no se puede
-- resolver "como" otra org. service_role (sin auth.uid()) NO pasa el gate: esta
-- función es EXCLUSIVA del clínico logueado; el matcher service_role encola pero no
-- resuelve.
--
-- ─── Qué NO hace ──────────────────────────────────────────────────────────────
--   · No mergea filas paciente (jamás — sólo setea el link cuenta_id).
--   · No toca datos clínicos (SOAP/tool_data): sólo estado del claim + cuenta_id.
--   · No borra claims (append-only: se resuelve por estado; la cola queda auditable).
--   · No resuelve un claim que ya NO esté 'pendiente' (CAS): re-aprobar/re-rechazar
--     un claim ya resuelto raise (idempotencia dura, evita doble-efecto).
--
-- ─── Auditoría ────────────────────────────────────────────────────────────────
-- El UPDATE de `paciente_claim` dispara el trigger genérico `paciente_claim_audit`
-- (M70 · audit_log_trigger, vuelca to_jsonb(NEW) con organization_id). El UPDATE de
-- `paciente` dispara `paciente_audit` (M12). Ambos quedan en audit_log con el actor
-- (auth.uid()) — rastro completo Ley 26.529 art. 18. El data layer (P9) además
-- escribe una entrada explícita 'paciente.claim_resuelto' con el resultado.
--
-- ─── check_function_bodies = off (house style) ────────────────────────────────
-- Convención de la casa (M01/M60/M70/M71/M84/M85/M86). Todos los objetos que
-- referencia la función (paciente_claim/paciente de M70/M03, can_read_clinical +
-- user_member_id_in de M01) PRE-EXISTEN; el flag blinda el replay bajo la preview
-- branch de Supabase.
--
-- ─── Orden de replay (append-only) ────────────────────────────────────────────
-- Depende de M70 (paciente_claim + paciente.cuenta_id) y M01 (helpers RLS). Prefijo
-- …089 (después de M86 …088). Número canónico M87 (siguiente libre ≥ M84: M84=P4,
-- M85=P6, M86=P8). Aditiva, idempotente (CREATE OR REPLACE), replay-safe en
-- postgres:16 vanilla y bajo pgTAP. Sin tablas/columnas/índices nuevos.
-- ════════════════════════════════════════════════════════════════════════════

set check_function_bodies = off;

-- ════════════════════════════════════════════════════════════════════════════
-- public.resolver_paciente_claim(p_claim_id uuid, p_aprobar boolean) → jsonb
-- ════════════════════════════════════════════════════════════════════════════
-- Resuelve UN claim pendiente. Devuelve un jsonb con el resultado (para el data
-- layer / audit). Raise con mensaje claro ante cada condición inválida (el data
-- layer los mapea a FolioError).
CREATE OR REPLACE FUNCTION public.resolver_paciente_claim(
  p_claim_id uuid,
  p_aprobar  boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id        uuid;
  v_org_id          uuid;
  v_estado          text;
  v_paciente_id     uuid;
  v_cuenta_id       uuid;
  v_actual_cuenta   uuid;
  v_nuevo_estado    text;
  v_link_seteado    boolean := false;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    -- service_role (matcher) NO resuelve: esto es EXCLUSIVO del clínico logueado.
    RAISE EXCEPTION 'resolver_paciente_claim: requiere un usuario autenticado'
      USING ERRCODE = '42501';
  END IF;

  -- Traer el claim y lockearlo (FOR UPDATE) para el CAS atómico: nadie más puede
  -- resolverlo concurrentemente entre el read y el write.
  SELECT c.organization_id, c.estado, c.paciente_id, c.paciente_cuenta_id
    INTO v_org_id, v_estado, v_paciente_id, v_cuenta_id
    FROM paciente_claim c
   WHERE c.id = p_claim_id
   FOR UPDATE;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'resolver_paciente_claim: claim % no existe', p_claim_id
      USING ERRCODE = 'P0002';
  END IF;

  -- ─── Autorización: acceso clínico a la org DEL CLAIM (por auth.uid()) ────────
  -- can_read_clinical resuelve la membership del usuario logueado en esa org (M01).
  -- Un usuario sin membership clínica en la org del claim NO puede resolverlo,
  -- aunque conozca el claim_id (anti-IDOR: la autorización sale de la sesión, no
  -- del arg).
  IF NOT public.can_read_clinical(v_org_id) THEN
    RAISE EXCEPTION 'resolver_paciente_claim: sin acceso clínico a la organización del claim'
      USING ERRCODE = '42501';
  END IF;

  -- ─── CAS de estado: sólo se resuelve lo que está 'pendiente' ────────────────
  IF v_estado <> 'pendiente' THEN
    RAISE EXCEPTION 'resolver_paciente_claim: el claim ya fue resuelto (estado %)', v_estado
      USING ERRCODE = 'P0001';
  END IF;

  IF p_aprobar THEN
    -- ─── APROBAR: materializar el link (CAS: cuenta_id SÓLO SI NULL) ──────────
    -- Guard anti-impersonación MEDULAR. Leemos el cuenta_id actual de la ficha.
    SELECT p.cuenta_id INTO v_actual_cuenta
      FROM paciente p
     WHERE p.id = v_paciente_id
     FOR UPDATE;

    IF v_actual_cuenta IS NULL THEN
      -- La ficha está libre → linkear a la cuenta del claim.
      UPDATE paciente
         SET cuenta_id = v_cuenta_id
       WHERE id = v_paciente_id
         AND cuenta_id IS NULL;  -- CAS redundante (ya lockeada), defensa explícita
      v_link_seteado := true;
    ELSIF v_actual_cuenta = v_cuenta_id THEN
      -- Ya linkeada a ESTA misma cuenta (p. ej. otro claim aprobado antes, o el
      -- auto-link corrió después). Idempotente: no re-escribimos, sólo cerramos el
      -- claim como aprobado. link_seteado = false (no hubo cambio de link).
      v_link_seteado := false;
    ELSE
      -- La ficha YA está linkeada a OTRA cuenta. NO se re-asigna (impersonación):
      -- aprobar acá pisaría la vinculación de otro humano. Abortar en conflicto.
      RAISE EXCEPTION 'resolver_paciente_claim: la ficha ya está vinculada a otra cuenta'
        USING ERRCODE = '23505';
    END IF;

    v_nuevo_estado := 'aprobado';
  ELSE
    -- ─── RECHAZAR: no se toca la ficha, sólo se cierra el claim ───────────────
    v_nuevo_estado := 'rechazado';
  END IF;

  -- Marcar el claim resuelto (dispara paciente_claim_audit → audit_log). resolved_by
  -- es el profile del member (usamos auth.uid() = profile.id; el FK a profile lo
  -- valida). El CAS de estado en el WHERE evita la doble-resolución por carrera.
  UPDATE paciente_claim
     SET estado      = v_nuevo_estado,
         resolved_by = v_actor_id,
         resolved_at = now()
   WHERE id = p_claim_id
     AND estado = 'pendiente';

  RETURN jsonb_build_object(
    'claim_id', p_claim_id,
    'organization_id', v_org_id,
    'paciente_id', v_paciente_id,
    'paciente_cuenta_id', v_cuenta_id,
    'estado', v_nuevo_estado,
    'link_seteado', v_link_seteado
  );
END
$$;

COMMENT ON FUNCTION public.resolver_paciente_claim(uuid, boolean) IS
  'Folio M87 · P9 · resuelve un paciente_claim pendiente (aprobar→setea paciente.cuenta_id SÓLO SI NULL; rechazar→cierra). SECURITY DEFINER: valida can_read_clinical(org-del-claim) por auth.uid() (no impersona) y hace el CAS atómico con FOR UPDATE. Gate anti-impersonación: no re-asigna una ficha ya linkeada a otra cuenta (raise 23505); idempotente si ya está linkeada a la misma. service_role (sin auth.uid()) NO puede resolver.';

-- EXECUTE para authenticated (el clínico logueado la llama por RPC bajo su rol).
-- service_role ya puede por ownership, pero la función lo rechaza por auth.uid() NULL.
GRANT EXECUTE ON FUNCTION public.resolver_paciente_claim(uuid, boolean) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- public.listar_paciente_claims_pendientes(p_org uuid) → SETOF (…)
-- ════════════════════════════════════════════════════════════════════════════
-- Lista los claims PENDIENTES de una org, con los datos NO-SENSIBLES de la CUENTA
-- que reclama (email + flags de verificación), para que el clínico pueda
-- contrastar la identidad antes de aprobar. El data layer (P9) hace el JOIN con
-- paciente_identidad (RLS-enforced, respeta caja_fuerte) para el nombre/DNI de la
-- ficha; ESTA función sólo aporta lo de `paciente_cuenta`, que la RLS del clínico
-- NO le deja leer (M70 dejó paciente_cuenta cerrada).
--
-- Por qué DEFINER: `paciente_cuenta` tiene RLS ENABLE+FORCE sin policy para el
-- clínico (M70) — es la identidad de LOGIN del paciente, cross-org, y no se expone
-- crudamente. Acá se expone SÓLO el email (que el clínico necesita para el match) y
-- los flags de verificación, y SÓLO para claims PENDIENTES de una org donde el
-- caller tiene acceso clínico (gate por auth.uid()). NO se expone telefono_hash ni
-- ningún otro campo. Scope duro: p_org DEBE ser una org del caller (can_read_clinical
-- por auth.uid()); si no, devuelve 0 filas (no raise: el data layer ya gatea por
-- sesión, esto es defensa en profundidad).
--
-- email_masqueado NO acá: el clínico necesita el email completo para decidir el
-- link (es el identificador que reclama la cuenta). Es el mismo dato que ya viaja
-- en el flujo de matching; exponerlo al clínico de la org es coherente con su
-- acceso a la PII de la ficha.
CREATE OR REPLACE FUNCTION public.listar_paciente_claims_pendientes(p_org uuid)
RETURNS TABLE (
  claim_id           uuid,
  paciente_id        uuid,
  paciente_cuenta_id uuid,
  cuenta_email       text,
  cuenta_email_verificado  boolean,
  cuenta_telefono_verificado boolean,
  creado_en          timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.paciente_id,
    c.paciente_cuenta_id,
    pc.email,
    (pc.email_verificado_en IS NOT NULL),
    (pc.telefono_verificado_en IS NOT NULL),
    c.created_at
  FROM paciente_claim c
  JOIN paciente_cuenta pc ON pc.id = c.paciente_cuenta_id
  WHERE c.organization_id = p_org
    AND c.estado = 'pendiente'
    AND pc.deleted_at IS NULL
    AND public.can_read_clinical(p_org)   -- gate por auth.uid(): 0 filas si no.
  ORDER BY c.created_at ASC
$$;

COMMENT ON FUNCTION public.listar_paciente_claims_pendientes(uuid) IS
  'Folio M87 · P9 · claims PENDIENTES de una org con los datos NO-SENSIBLES de la paciente_cuenta que reclama (email + flags de verificación). SECURITY DEFINER porque paciente_cuenta está cerrada para el clínico (M70). Gate: can_read_clinical(p_org) por auth.uid() → 0 filas si el caller no tiene acceso clínico a esa org. NO expone telefono_hash. El nombre/DNI de la ficha lo agrega el data layer vía paciente_identidad (RLS-enforced, respeta caja_fuerte).';

GRANT EXECUTE ON FUNCTION public.listar_paciente_claims_pendientes(uuid) TO authenticated;
