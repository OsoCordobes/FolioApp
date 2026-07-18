-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M88 · Provisioning de primera sesión del portal (Fase 3 · fix audit) 🔒
-- ════════════════════════════════════════════════════════════════════════════
-- BUG que cierra (audit adversarial · bloqueante del portal): NADA creaba filas
-- de `paciente_cuenta` (M70). El callback de auth (app/api/auth/callback) hacía
-- rpc('paciente_cuenta_actual') y, al ser SIEMPRE NULL para un usuario nuevo,
-- redirigía a /portal/login?error=sin_cuenta ⇒ NINGÚN paciente podía entrar
-- jamás al portal. Faltaba el paso de provisioning: crear la IDENTIDAD
-- (paciente_cuenta) en la primera sesión del magic-link.
--
-- ─── Qué hace public.paciente_cuenta_ensure() ─────────────────────────────────
--   · auth.uid() NULL → NULL (sin sesión no hay nada que crear).
--   · Cuenta VIVA existente para auth.uid() → devuelve su id (idempotente).
--   · Cuenta SOFT-DELETED existente → NULL, NO la resucita: la baja del portal es
--     una decisión explícita (M70: deleted_at) y un magic-link nuevo no debe
--     revertirla silenciosamente (el flujo de re-alta, si algún día existe, será
--     explícito y auditado).
--   · Si no existe: INSERT con auth_user_id = auth.uid() y email = lower(email)
--     leído de auth.users DEL PROPIO uid — VERDAD DEL SERVER, jamás input del
--     cliente (la función no acepta argumentos → no se puede provisionar "como"
--     otro usuario ni con otro email). email_verificado_en se copia de
--     auth.users.email_confirmed_at (GoTrue lo setea al consumir el magic-link).
--   · ON CONFLICT (auth_user_id) DO NOTHING + reselect → race-safe: dos requests
--     concurrentes del mismo login (doble click en el link, prefetch) convergen
--     a la MISMA fila sin error.
--
-- ─── Qué NO hace ──────────────────────────────────────────────────────────────
--   · NO linkea fichas `paciente` (jamás toca paciente.cuenta_id). El linkage es
--     EXCLUSIVO del matcher auditado (P3 · lib/portal/link-actions.ts) con sus
--     guards anti-impersonación (dos identificadores para auto-link, cola de
--     claims para lo ambiguo, P9). Esta función sólo crea la IDENTIDAD de login.
--   · NO actualiza el email de una cuenta viva (la autogestión de contacto es
--     M86; el refresh de email post-cambio en auth es un flujo aparte).
--
-- ─── Por qué SECURITY DEFINER ─────────────────────────────────────────────────
-- `paciente_cuenta` tiene RLS ENABLE+FORCE cerrada para escritura (M70/M71: el
-- paciente sólo tiene SELECT self-scoped). El INSERT debe pasar por un path
-- controlado: DEFINER con search_path fijado (house style M70/M84/M85/M86/M87),
-- filtrando SIEMPRE por auth.uid() → no impersona. EXECUTE sólo para
-- authenticated (anon/PUBLIC revocados: un visitante sin sesión no tiene por qué
-- poder invocarla; con auth.uid() NULL igual sería no-op, defensa en capas).
--
-- ─── check_function_bodies = off (house style) ────────────────────────────────
-- Convención de la casa (M01/M60/M70/M71/M84/M85/M86/M87). Todos los objetos
-- referenciados (paciente_cuenta de M70, auth.users, auth.uid()) PRE-EXISTEN
-- (este archivo ordena último en la cadena); el flag blinda el replay bajo la
-- preview branch de Supabase.
--
-- ─── Orden de replay (append-only) ────────────────────────────────────────────
-- Depende de M70 (paciente_cuenta). Prefijo …090 (después de M87 …089). Número
-- canónico M88. Aditiva, idempotente (CREATE OR REPLACE), replay-safe en
-- postgres:16 vanilla DEFAULT y bajo pgTAP (el stub CI de auth.users tiene
-- email + email_confirmed_at). Sin tablas/columnas/índices nuevos.
-- ════════════════════════════════════════════════════════════════════════════

set check_function_bodies = off;

-- ════════════════════════════════════════════════════════════════════════════
-- public.paciente_cuenta_ensure() → uuid
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.paciente_cuenta_ensure()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid;
  v_id        uuid;
  v_email     text;
  v_confirmed timestamptz;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  -- Fast path: cuenta VIVA existente → idempotente.
  SELECT pc.id INTO v_id
    FROM paciente_cuenta pc
   WHERE pc.auth_user_id = v_uid
     AND pc.deleted_at IS NULL;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- Cuenta SOFT-DELETED: NO resucitar (la baja fue explícita; un magic-link
  -- nuevo no la revierte). El caller trata NULL como "sin cuenta de portal".
  IF EXISTS (SELECT 1 FROM paciente_cuenta pc WHERE pc.auth_user_id = v_uid) THEN
    RETURN NULL;
  END IF;

  -- Email = VERDAD DEL SERVER: auth.users del PROPIO uid (nunca un arg del
  -- cliente). lower() para cumplir el CHECK paciente_cuenta_email_lower (M70).
  SELECT lower(u.email), u.email_confirmed_at
    INTO v_email, v_confirmed
    FROM auth.users u
   WHERE u.id = v_uid;

  -- Sin email usable no hay cuenta portal (el portal es email-first: el login
  -- es un magic-link por email). Bounds del CHECK paciente_cuenta_email_len.
  IF v_email IS NULL OR length(v_email) < 3 OR length(v_email) > 320 THEN
    RETURN NULL;
  END IF;

  -- Race-safe: dos requests concurrentes (doble click en el magic-link) chocan
  -- en el UNIQUE (auth_user_id) → DO NOTHING + reselect convergen al mismo id.
  INSERT INTO paciente_cuenta (auth_user_id, email, email_verificado_en)
  VALUES (v_uid, v_email, v_confirmed)
  ON CONFLICT (auth_user_id) DO NOTHING;

  SELECT pc.id INTO v_id
    FROM paciente_cuenta pc
   WHERE pc.auth_user_id = v_uid
     AND pc.deleted_at IS NULL;
  RETURN v_id;
END
$$;

COMMENT ON FUNCTION public.paciente_cuenta_ensure() IS
  'Folio M88 · provisioning de primera sesión del portal: devuelve el id de la paciente_cuenta VIVA de auth.uid(), creándola si no existe (email = lower(auth.users.email) del PROPIO uid — verdad del server, sin args → no impersona; email_verificado_en = auth.users.email_confirmed_at). NO resucita cuentas soft-deleted (baja explícita → NULL). NO linkea fichas (eso es del matcher auditado P3 con sus guards anti-impersonación). Race-safe vía ON CONFLICT (auth_user_id) DO NOTHING + reselect. SECURITY DEFINER; EXECUTE sólo authenticated.';

-- EXECUTE sólo para authenticated (el callback la llama por RPC bajo la sesión
-- recién creada del magic-link). anon/PUBLIC revocados: sin sesión sería no-op
-- (auth.uid() NULL), pero no hay razón para exponerla — defensa en capas.
-- (En Supabase las funciones de public reciben EXECUTE para anon/authenticated
-- por default privileges; en vanilla, PUBLIC. Se revocan ambos explícitamente.)
REVOKE ALL ON FUNCTION public.paciente_cuenta_ensure() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paciente_cuenta_ensure() FROM anon;
GRANT EXECUTE ON FUNCTION public.paciente_cuenta_ensure() TO authenticated;
