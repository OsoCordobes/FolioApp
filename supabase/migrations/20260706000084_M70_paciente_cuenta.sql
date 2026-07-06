-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M70 · Identidad cross-org del paciente (portal · Fase 3 · P1)
-- ════════════════════════════════════════════════════════════════════════════
-- Keystone del portal del paciente. Hoy un `paciente` es una fila POR ORG (PHI en
-- `paciente`, PII en `paciente_identidad`, M03): el mismo humano atendido en dos
-- consultorios tiene DOS filas `paciente` sin ningún vínculo entre sí. El portal
-- necesita que UN login abanique a los pacientes del humano en varias orgs.
--
-- Decisión de arquitectura (plan Fase 3, decisión bloqueada #3):
--   · Se agrega una tabla NUEVA `paciente_cuenta`, 1:1 con `auth.users`. Es la
--     IDENTIDAD del humano-que-inicia-sesión, cross-org.
--   · `paciente.cuenta_id -> paciente_cuenta.id` es el JOIN que abanica un login
--     a los pacientes de varias orgs. NULL = paciente sin cuenta portal linkeada.
--   · Los pacientes NUNCA reciben una fila `member` → public.user_org_ids() /
--     can_read_clinical() devuelven vacío para ellos → TODAS las policies de
--     clínico son no-ops para un paciente. Las policies del paciente (P2/M71) son
--     ADITIVAS, self-scoped por cuenta_id = auth.uid()-de-la-cuenta, y NO otorgan
--     acceso a `sesion` (el SOAP crudo queda estructuralmente inalcanzable).
--   · NUNCA se mergean filas `paciente`; sólo se LINKEA (se setea cuenta_id). El
--     matcher cross-org (P3) corre en path service_role AUDITADO: auto-link SÓLO
--     alta confianza (DNI, o teléfono+email ambos matcheando en una org); los
--     ambiguos van a la cola `paciente_claim`, aprobada por el clínico (P9).
--
-- Esta migración es DB-only e INOCUA: NO hay readers de código todavía (P2 agrega
-- las policies de lectura; P3 el auth + matcher). Todo aditivo:
--   · paciente_cuenta            (tabla nueva, RLS ENABLE+FORCE, CERRADA acá)
--   · paciente.cuenta_id         (columna nullable + FK ON DELETE SET NULL + índice parcial)
--   · paciente_identidad.email_hash (columna nullable · blind index de email por org,
--                                    backfill DIFERIDO — hoy no existe; lo necesita el
--                                    matcher por email de P3)
--   · paciente_claim             (tabla nueva · cola de matches ambiguos, RLS cerrada acá)
--   · public.paciente_cuenta_actual()  (helper SECURITY DEFINER STABLE, filtra por auth.uid())
--   · pseudonimizar_paciente     (REDEFINE: copia VERBATIM del cuerpo vigente M73 +
--                                 AGREGA el nulleo del link cuenta_id al borrar identidad)
--
-- ─── check_function_bodies = off (house style) ────────────────────────────────
-- Se setea al tope por convención de la casa (mismo patrón que las migraciones
-- que definen funciones SQL/plpgsql que podrían referenciar objetos aún no
-- presentes bajo distintas rutas de replay). Acá todos los objetos referenciados
-- por paciente_cuenta_actual() y por pseudonimizar_paciente PRE-EXISTEN (auth.uid,
-- paciente_cuenta se crea en esta misma migración ANTES del helper, y las tablas
-- del erasure son de M03/M60/M61/M73), pero el flag lo dejamos explícito por
-- consistencia y para blindar el replay bajo la preview branch de Supabase.
--
-- ─── Orden de replay (append-only · pseudonimizar chain) ──────────────────────
-- El cuerpo vigente de pseudonimizar_paciente es el de M73 (cadena
-- M13+M25+M45+M60+M61+M63+M73). Para que este REDEFINE sea el ÚLTIMO en aplicarse
-- y NO lo pise M73, este archivo lleva el prefijo timestamp 20260706000084, que
-- ORDENA DESPUÉS de M73 (…073) y de todos los archivos de Fase 1/2 ya commiteados
-- (el más nuevo es M83 · …083). El NÚMERO CANÓNICO es M70 (P1); el prefijo sólo
-- fija el orden de replay lexicográfico del CI y de push-pending-migrations.
--
-- Portabilidad: replay-safe en postgres:16 vanilla y bajo pgTAP. Idempotente
-- (CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS + CONSTRAINT/POLICY
-- guardados por catálogo, patrón M62/M74/M78/M83). Sin índices ni EXCLUDE con
-- expresiones no-IMMUTABLE.
-- ════════════════════════════════════════════════════════════════════════════

set check_function_bodies = off;

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · paciente_cuenta — identidad del humano que inicia sesión (1:1 auth.users)
-- ════════════════════════════════════════════════════════════════════════════
-- Cross-org. NO es PHI ni PII clínica: es la cuenta de login del portal. El email
-- se guarda en CLARO y lowercased (es el email de la cuenta, no PII de la ficha
-- clínica — ya vive en auth.users; acá lo cacheamos para mostrarlo/matchearlo).
-- telefono_hash es el blind index del teléfono verificado de la cuenta (mismo
-- algoritmo que paciente_identidad.telefono_hash, pero SIN salt per-org: la cuenta
-- es cross-org, así que su hash de teléfono no puede saltearse por org — el matcher
-- de P3 lo recalcula por-org al comparar contra paciente_identidad).

CREATE TABLE IF NOT EXISTS paciente_cuenta (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 1:1 con auth.users. UNIQUE ⇒ una sola cuenta portal por usuario auth.
  -- ON DELETE CASCADE: si se borra el usuario auth (baja de cuenta), la fila
  -- paciente_cuenta se va con él; los `paciente.cuenta_id` que la referencian
  -- quedan NULL por su propio ON DELETE SET NULL (la HC clínica no se toca).
  auth_user_id           uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Email de la cuenta, en CLARO y lowercased (cache de auth.users.email para
  -- display/matching). NO es PII de la ficha (esa va cifrada en paciente_identidad).
  email                  text NOT NULL,
  email_verificado_en    timestamptz,

  -- Blind index del teléfono verificado de la cuenta (HMAC, 64 hex). Cross-org →
  -- computado SIN salt per-org (a diferencia de paciente_identidad.telefono_hash,
  -- que sí saltea por org desde M30/M36). El matcher de P3 compara re-salteando.
  telefono_hash          text,
  telefono_verificado_en timestamptz,

  deleted_at             timestamptz,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT paciente_cuenta_email_lower CHECK (email = lower(email)),
  CONSTRAINT paciente_cuenta_email_len   CHECK (length(email) BETWEEN 3 AND 320),
  CONSTRAINT paciente_cuenta_telefono_hash_hex
    CHECK (telefono_hash IS NULL OR telefono_hash ~ '^[0-9a-f]{64}$')
);

-- Lookup por auth_user_id ya cubierto por el UNIQUE. Índice para el matcher por
-- teléfono (P3) sobre cuentas vivas.
CREATE INDEX IF NOT EXISTS paciente_cuenta_telefono_hash_idx
  ON paciente_cuenta (telefono_hash) WHERE telefono_hash IS NOT NULL AND deleted_at IS NULL;

COMMENT ON TABLE paciente_cuenta IS
  'Folio M70 · identidad cross-org del paciente que inicia sesión en el portal (1:1 con auth.users vía auth_user_id UNIQUE). paciente.cuenta_id la referencia para abanicar un login a los pacientes del humano en varias orgs. NO es member: user_org_ids()/can_read_clinical() son vacío para pacientes. email en claro/lowercased (cache de auth.users); telefono_hash = blind index sin salt per-org (cross-org).';
COMMENT ON COLUMN paciente_cuenta.auth_user_id IS
  'M70 · FK 1:1 a auth.users(id) ON DELETE CASCADE. UNIQUE ⇒ una cuenta portal por usuario auth.';
COMMENT ON COLUMN paciente_cuenta.email IS
  'M70 · email de la cuenta, en claro y lowercased (cache de auth.users.email para display/matching). NO es PII de la ficha clínica.';
COMMENT ON COLUMN paciente_cuenta.telefono_hash IS
  'M70 · blind index del teléfono verificado de la cuenta (HMAC-SHA256, 64 hex). Cross-org → SIN salt per-org. El matcher de P3 re-saltea por org al comparar contra paciente_identidad.telefono_hash.';

DROP TRIGGER IF EXISTS paciente_cuenta_set_updated_at ON paciente_cuenta;
CREATE TRIGGER paciente_cuenta_set_updated_at
  BEFORE UPDATE ON paciente_cuenta
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS paciente_cuenta_audit ON paciente_cuenta;
CREATE TRIGGER paciente_cuenta_audit
  AFTER INSERT OR UPDATE OR DELETE ON paciente_cuenta
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

-- RLS ENABLE+FORCE, CERRADA acá. Las policies de auto-lectura del paciente
-- (self-scoped por cuenta) llegan en P2/M71. Sin policies ⇒ ningún rol non-BYPASS
-- lee/escribe (authenticated queda sin acceso hasta M71); service_role (BYPASSRLS)
-- opera el matcher/auth de P3.
ALTER TABLE paciente_cuenta ENABLE ROW LEVEL SECURITY;
ALTER TABLE paciente_cuenta FORCE  ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · paciente.cuenta_id — el link login→pacientes-de-varias-orgs
-- ════════════════════════════════════════════════════════════════════════════
-- Nullable (backfill = NULL: los pacientes existentes no tienen cuenta portal aún).
-- ON DELETE SET NULL: borrar la cuenta portal NO destruye la ficha clínica (PHI
-- retención Ley 26.529 art. 18); sólo se desvincula.

ALTER TABLE paciente
  ADD COLUMN IF NOT EXISTS cuenta_id uuid REFERENCES paciente_cuenta(id) ON DELETE SET NULL;

-- Índice parcial: el fan-out del portal (P2/P3) filtra por cuenta_id = <mi cuenta>
-- sobre las pocas filas linkeadas; la gran mayoría (cuenta_id NULL) no se indexa.
CREATE INDEX IF NOT EXISTS paciente_cuenta_id_idx
  ON paciente (cuenta_id) WHERE cuenta_id IS NOT NULL;

COMMENT ON COLUMN paciente.cuenta_id IS
  'M70 · FK a paciente_cuenta(id) ON DELETE SET NULL. Link login→pacientes: un mismo paciente_cuenta puede apuntar a N filas paciente (una por org). NULL = sin cuenta portal linkeada. Se setea sólo por auto-link de alta confianza o aprobación de claim (P3/P9); NUNCA se mergean filas paciente. Nulleado en pseudonimizar_paciente al borrar identidad.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · paciente_identidad.email_hash — blind index de email por org (backfill diferido)
-- ════════════════════════════════════════════════════════════════════════════
-- Hoy NO existe: la PII de email vive cifrada en email_cifrado (M03) y no hay
-- blind index. El matcher de P3 (auto-link alta confianza teléfono+email) necesita
-- comparar el email de la cuenta contra el de la ficha SIN descifrar → blind index
-- HMAC salteado por org (blindIndex(email, organization_id), mismo patrón que
-- nombre_hash/dni_hash/telefono_hash · M30/M36). Nullable, backfill DIFERIDO (un
-- script dedicado tipo rehash-blind-indexes lo puebla; hasta entonces el matcher
-- por email simplemente no matchea filas viejas → cae a cola de claim, seguro).

ALTER TABLE paciente_identidad
  ADD COLUMN IF NOT EXISTS email_hash text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'paciente_identidad_email_hash_hex'
  ) THEN
    ALTER TABLE paciente_identidad
      ADD CONSTRAINT paciente_identidad_email_hash_hex
      CHECK (email_hash IS NULL OR email_hash ~ '^[0-9a-f]{64}$');
  END IF;
END$$;

-- Índice parcial para el matcher por email (P3): lookup por (organization_id,
-- email_hash) sobre filas vivas. Espeja paciente_identidad_org_dni_idx (M03).
CREATE INDEX IF NOT EXISTS paciente_identidad_org_email_idx
  ON paciente_identidad (organization_id, email_hash) WHERE deleted_at IS NULL;

COMMENT ON COLUMN paciente_identidad.email_hash IS
  'M70 · blind index del email del paciente (HMAC-SHA256, 64 hex) salteado por org: blindIndex(lower(trim(email)), organization_id). Para el matcher cross-org por email del portal (P3). Nullable, backfill diferido (script dedicado). Se borra físicamente al pseudonimizar (junto con toda la fila paciente_identidad).';

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · paciente_claim — cola de matches AMBIGUOS (aprobados por el clínico · P9)
-- ════════════════════════════════════════════════════════════════════════════
-- El matcher de P3 auto-linkea SÓLO alta confianza. Los ambiguos (p. ej. teléfono
-- matchea pero email no, o hay varias filas candidatas en la org) NO se linkean:
-- se encolan acá con estado 'pendiente' y la dirección clínica de la org aprueba
-- (→ setea paciente.cuenta_id, estado 'aprobado') o rechaza ('rechazado'). Gate
-- anti-impersonación por construcción: ningún link ambiguo se materializa sin la
-- decisión explícita de alguien con acceso clínico a esa org.

CREATE TABLE IF NOT EXISTS paciente_claim (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  -- La cuenta que reclama el link. ON DELETE CASCADE: si se borra la cuenta, sus
  -- claims pendientes desaparecen.
  paciente_cuenta_id uuid NOT NULL REFERENCES paciente_cuenta(id) ON DELETE CASCADE,
  -- El paciente candidato (fila de esa org). ON DELETE CASCADE con paciente.
  paciente_id        uuid NOT NULL REFERENCES paciente(id) ON DELETE CASCADE,

  estado             text NOT NULL DEFAULT 'pendiente',
  -- Auditoría de resolución (quién/cuándo aprobó o rechazó). resolved_by es el
  -- profile del miembro clínico que resolvió (NULL mientras pendiente).
  resolved_by        uuid REFERENCES profile(id) ON DELETE SET NULL,
  resolved_at        timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT paciente_claim_estado_valido
    CHECK (estado IN ('pendiente', 'aprobado', 'rechazado')),
  -- Un solo claim por (cuenta, paciente): no encolar el mismo par dos veces.
  CONSTRAINT paciente_claim_unico UNIQUE (paciente_cuenta_id, paciente_id)
);

CREATE INDEX IF NOT EXISTS paciente_claim_org_estado_idx
  ON paciente_claim (organization_id, estado);
CREATE INDEX IF NOT EXISTS paciente_claim_cuenta_idx
  ON paciente_claim (paciente_cuenta_id);
CREATE INDEX IF NOT EXISTS paciente_claim_paciente_idx
  ON paciente_claim (paciente_id);

COMMENT ON TABLE paciente_claim IS
  'Folio M70 · cola de matches AMBIGUOS entre una paciente_cuenta (login portal) y un paciente candidato de una org. El matcher de P3 encola acá lo que NO es alta confianza; la dirección clínica aprueba (→ setea paciente.cuenta_id) o rechaza (P9). Gate anti-impersonación: ningún link ambiguo se materializa sin decisión de acceso clínico a esa org. RLS ENABLE+FORCE, policies en P2/M71.';
COMMENT ON COLUMN paciente_claim.estado IS
  'M70 · pendiente | aprobado | rechazado. Sólo el clínico de la org resuelve (P9); aprobar setea paciente.cuenta_id.';

DROP TRIGGER IF EXISTS paciente_claim_set_updated_at ON paciente_claim;
CREATE TRIGGER paciente_claim_set_updated_at
  BEFORE UPDATE ON paciente_claim
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS paciente_claim_audit ON paciente_claim;
CREATE TRIGGER paciente_claim_audit
  AFTER INSERT OR UPDATE OR DELETE ON paciente_claim
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

-- same-org guard: el paciente candidato debe pertenecer a la org del claim (evita
-- encolar un paciente de otro tenant bajo la org equivocada).
CREATE OR REPLACE FUNCTION paciente_claim_validate_same_org()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM paciente p
    WHERE p.id = NEW.paciente_id
      AND p.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'paciente_claim.paciente_id debe coincidir en org con el paciente';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS paciente_claim_same_org_guard ON paciente_claim;
CREATE TRIGGER paciente_claim_same_org_guard
  BEFORE INSERT OR UPDATE OF paciente_id, organization_id ON paciente_claim
  FOR EACH ROW EXECUTE FUNCTION paciente_claim_validate_same_org();

-- RLS ENABLE+FORCE, CERRADA acá (policies del clínico para resolver claims van en
-- P2/M71). service_role (matcher de P3) escribe con BYPASSRLS.
ALTER TABLE paciente_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE paciente_claim FORCE  ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · public.paciente_cuenta_actual() — helper de la cuenta del usuario logueado
-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER + STABLE. Devuelve el id de la paciente_cuenta VIVA cuyo
-- auth_user_id = auth.uid() (la cuenta portal del usuario logueado), o NULL. Es el
-- espejo, del lado paciente, de public.user_member_id_in()/user_org_ids() del lado
-- staff. Las policies de auto-lectura del paciente (P2/M71) lo usarán:
--   paciente.cuenta_id = public.paciente_cuenta_actual()
-- Filtra por auth.uid() (nunca por un arg del caller) → no puede impersonar otra
-- cuenta. DEFINER para poder leer paciente_cuenta a pesar de la RLS cerrada de acá.
CREATE OR REPLACE FUNCTION public.paciente_cuenta_actual()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pc.id
    FROM paciente_cuenta pc
   WHERE pc.auth_user_id = auth.uid()
     AND pc.deleted_at IS NULL
   LIMIT 1
$$;

COMMENT ON FUNCTION public.paciente_cuenta_actual() IS
  'Folio M70 · id de la paciente_cuenta viva del usuario logueado (auth_user_id = auth.uid()), o NULL. SECURITY DEFINER + STABLE, filtra SIEMPRE por auth.uid() (no acepta arg → no impersona). Base de las policies de auto-lectura del paciente (P2/M71): paciente.cuenta_id = public.paciente_cuenta_actual().';

-- authenticated necesita EXECUTE (lo llaman las policies del paciente en P2/M71
-- bajo el rol del usuario logueado). service_role ya puede por BYPASS/ownership.
GRANT EXECUTE ON FUNCTION public.paciente_cuenta_actual() TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6 · Erasure: extender pseudonimizar_paciente (cuerpo vigente = M73) para
--     NULLEAR el link cuenta_id al borrar la identidad del paciente.
-- ════════════════════════════════════════════════════════════════════════════
-- Cuerpo copiado VERBATIM del vigente (M73, cadena M13+M25+M45+M60+M61+M63+M73) +
-- se AGREGA el nulleo de paciente.cuenta_id (junto al identidad_id := NULL) y un
-- contador en el jsonb. (Regla append-only: NO se edita M73; se REDEFINE con
-- CREATE OR REPLACE, que este archivo aplica DESPUÉS de M73 por su prefijo …084.)
--
-- Por qué hace falta: la pseudonimización suprime la PII del paciente (Ley 25.326
-- art. 16). El link con la cuenta portal (paciente.cuenta_id) ES un identificador
-- que ata la ficha a un humano reconocible → debe romperse en la supresión. El FK
-- tiene ON DELETE SET NULL, pero eso sólo dispara si se borra la paciente_cuenta;
-- al pseudonimizar NO borramos la cuenta (es cross-org, puede tener otras fichas),
-- así que hay que nullear el link explícitamente en esta fila.

CREATE OR REPLACE FUNCTION public.pseudonimizar_paciente(
  p_paciente_id   uuid,
  p_motivo        text,
  p_dry_run       boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id             uuid;
  v_actor_id           uuid;
  v_actor_member_id    uuid;
  v_identidad_id       uuid;
  v_actor_role         text;
  v_is_service         boolean;
  v_nombre_hash        text;
  v_dni_hash           text;
  v_intake_borrados    int;
  v_contactos_borrados int;
  v_tutores_borrados   int;
  v_instrumentos_borrados int;
  v_tenia_cuenta       boolean;
BEGIN
  v_actor_id := auth.uid();
  -- M45/M63: el cron /api/cron/account-purge invoca con service_role (sin JWT de
  -- usuario → auth.uid() = NULL). Antes esto abortaba con "requiere auth.uid()"
  -- y la purga post-grace de 30 días (Ley 25.326 art. 16) nunca corría.
  v_is_service := v_actor_id IS NULL AND coalesce(auth.role(), '') = 'service_role';
  IF v_actor_id IS NULL AND NOT v_is_service THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: requiere auth.uid()';
  END IF;
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: motivo requerido (>= 3 caracteres)';
  END IF;

  SELECT p.organization_id, p.identidad_id
    INTO v_org_id, v_identidad_id
    FROM paciente p
   WHERE p.id = p_paciente_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'pseudonimizar_paciente: paciente % no existe', p_paciente_id;
  END IF;

  IF v_is_service THEN
    v_actor_role := 'service_role';
  ELSE
    SELECT role, id INTO v_actor_role, v_actor_member_id
      FROM member
     WHERE profile_id = v_actor_id
       AND organization_id = v_org_id
       AND deleted_at IS NULL;
    IF v_actor_role NOT IN ('OWNER', 'DIRECTOR') THEN
      RAISE EXCEPTION 'pseudonimizar_paciente: rol % no autorizado. Solo OWNER/DIRECTOR.', v_actor_role;
    END IF;
  END IF;

  -- Capture the blind-index hashes BEFORE deletion (M25 audit trail).
  IF v_identidad_id IS NOT NULL THEN
    SELECT nombre_hash, dni_hash
      INTO v_nombre_hash, v_dni_hash
      FROM paciente_identidad
     WHERE id = v_identidad_id;
  END IF;

  -- M70: ¿el paciente tenía una cuenta portal linkeada? (para el resumen).
  SELECT (cuenta_id IS NOT NULL) INTO v_tenia_cuenta
    FROM paciente WHERE id = p_paciente_id;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'paciente_id', p_paciente_id,
      'organization_id', v_org_id,
      'actor_role', v_actor_role,
      'motivo', p_motivo,
      'dry_run', true,
      'identidad_id', v_identidad_id,
      'intake_avanzado_a_borrar', (SELECT count(*) FROM paciente_intake_avanzado WHERE paciente_id = p_paciente_id),
      'contactos_emergencia_a_borrar', (SELECT count(*) FROM contacto_emergencia WHERE paciente_id = p_paciente_id),
      'tutores_legales_a_borrar', (SELECT count(*) FROM tutor_legal WHERE paciente_id = p_paciente_id),
      'instrumento_respuesta_a_borrar', (SELECT count(*) FROM instrumento_respuesta WHERE paciente_id = p_paciente_id),
      'cuenta_link_a_desvincular', coalesce(v_tenia_cuenta, false),
      'would_record_event', v_dni_hash IS NOT NULL AND v_nombre_hash IS NOT NULL
    );
  END IF;

  IF v_dni_hash IS NOT NULL AND v_nombre_hash IS NOT NULL THEN
    INSERT INTO pseudonimizacion_event
      (organization_id, paciente_id, dni_sha256, nombre_sha256, performed_by, motivo)
    VALUES
      (v_org_id, p_paciente_id, v_dni_hash, v_nombre_hash, v_actor_id, p_motivo);
  END IF;

  IF v_identidad_id IS NOT NULL THEN
    DELETE FROM paciente_identidad WHERE id = v_identidad_id;
  END IF;

  -- M60: borrar físicamente el intake avanzado (PHI/PII directa + de terceros).
  DELETE FROM paciente_intake_avanzado WHERE paciente_id = p_paciente_id;
  GET DIAGNOSTICS v_intake_borrados = ROW_COUNT;

  -- M61: re-borrar la PII de terceros (contactos de emergencia + tutores
  -- legales) que M13 borraba y M25 había perdido al reescribir el cuerpo.
  DELETE FROM contacto_emergencia WHERE paciente_id = p_paciente_id;
  GET DIAGNOSTICS v_contactos_borrados = ROW_COUNT;
  DELETE FROM tutor_legal WHERE paciente_id = p_paciente_id;
  GET DIAGNOSTICS v_tutores_borrados = ROW_COUNT;

  -- M73: borrar físicamente las respuestas de instrumentos clínicos (PHI). Las
  -- filas pueden estar lockeadas (append-only): la supresión legal (Ley 25.326
  -- art. 16) prevalece sobre el lock → el DELETE corre en SECURITY DEFINER y el
  -- lock guard sólo bloquea UPDATE, no DELETE (además instrumento_respuesta_no_delete
  -- es RLS, y esta función es DEFINER/BYPASSRLS).
  DELETE FROM instrumento_respuesta WHERE paciente_id = p_paciente_id;
  GET DIAGNOSTICS v_instrumentos_borrados = ROW_COUNT;

  UPDATE paciente
     SET identidad_id    = NULL,
         -- M70: romper el link con la cuenta portal (identificador que ata la
         -- ficha a un humano reconocible). No se borra la paciente_cuenta (es
         -- cross-org); sólo se desvincula ESTA ficha.
         cuenta_id       = NULL,
         pseudonimizado_en = now()
   WHERE id = p_paciente_id;

  RETURN jsonb_build_object(
    'paciente_id', p_paciente_id,
    'organization_id', v_org_id,
    'actor_role', v_actor_role,
    'motivo', p_motivo,
    'dry_run', false,
    'identidad_id_borrada', v_identidad_id,
    'intake_avanzado_borrados', v_intake_borrados,
    'contactos_emergencia_borrados', v_contactos_borrados,
    'tutores_legales_borrados', v_tutores_borrados,
    'instrumento_respuesta_borrados', v_instrumentos_borrados,
    'cuenta_link_desvinculado', coalesce(v_tenia_cuenta, false),
    'pseudonimizacion_event_recorded', v_dni_hash IS NOT NULL
  );
END
$$;

COMMENT ON FUNCTION public.pseudonimizar_paciente(uuid, text, boolean) IS
  'Folio · M13 + M25 + M45 + M60 + M61 + M63 + M73 + M70 · pseudonimización de paciente. Borra paciente_identidad + paciente_intake_avanzado + contacto_emergencia + tutor_legal + instrumento_respuesta, DESVINCULA el link cuenta_id de la cuenta portal (M70), marca paciente.pseudonimizado_en, y graba pseudonimizacion_event con SHA-256 del DNI + nombre. SECURITY DEFINER. Callers: UI (OWNER/DIRECTOR, valida membership) y cron account-purge (service_role, auth.uid() NULL → performed_by NULL).';
