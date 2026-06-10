-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M50 · Especialidades — organization.especialidad + sesion tool slot
-- ════════════════════════════════════════════════════════════════════════════
-- Fase B del plan multi-especialidad (docs/PLAN.md). El "slot" clínico de la
-- ficha del paciente deja de ser el SpineMap hardcodeado: cada org declara su
-- especialidad y el registry de la app (lib/especialidades/) decide qué
-- herramienta renderizar y con qué schema validar los datos por sesión.
--
-- Modelo de datos:
--
--   1. organization.especialidad — slug de especialidad por tenant. Backfill
--      implícito a 'quiropraxia' vía DEFAULT (todas las orgs existentes son
--      quiroprácticas hoy). El CHECK valida al instalar — seguro porque cada
--      fila recibe el default antes de evaluarse.
--
--   2. sesion.tool_id — identificador versionado de la herramienta clínica que
--      produjo los datos de esa sesión ('quiropraxia.spine.v1', etc.). Sin
--      CHECK de lista acá: la lista viva la valida el registry en la app (el
--      catálogo de tools crece sin migración).
--
--   3. sesion.tool_data_cifrado — payload JSON de la herramienta, cifrado
--      app-side AES-256-GCM (lib/crypto.ts encryptColumn/decryptColumn), igual
--      que el SOAP. Los datos de cardiología/psicología son PHI sensible y van
--      cifrados desde el día cero; vertebras_json (M10) queda como columna
--      legacy de lectura + espejo de quiropraxia (compat con la vista M14 y el
--      índice gin) hasta su retiro en Fase F.
--
-- Append-only / aditiva: solo ADD COLUMN nullable o con DEFAULT + CREATE OR
-- REPLACE del guard de lock para cubrir las columnas nuevas. RLS: heredada de
-- organization y sesion — sin policies nuevas.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. organization.especialidad ───────────────────────────────────────────

ALTER TABLE organization
  ADD COLUMN especialidad text NOT NULL DEFAULT 'quiropraxia'
  CONSTRAINT organization_especialidad_valida
    CHECK (especialidad IN ('quiropraxia', 'cardiologia', 'psicologia'));

COMMENT ON COLUMN organization.especialidad IS
  'M50 · slug de especialidad del tenant (quiropraxia | cardiologia | '
  'psicologia). Decide qué herramienta clínica renderiza el slot de la ficha '
  'del paciente (registry en lib/especialidades/). Orgs previas backfill a '
  'quiropraxia vía DEFAULT. Ampliar el CHECK al sumar especialidades nuevas.';

-- ─── 2. sesion.tool_id + sesion.tool_data_cifrado ───────────────────────────

ALTER TABLE sesion
  ADD COLUMN tool_id text,
  ADD COLUMN tool_data_cifrado bytea;

COMMENT ON COLUMN sesion.tool_id IS
  'M50 · id versionado de la herramienta clínica que produjo tool_data_cifrado '
  '(''quiropraxia.spine.v1'', ''cardiologia.placeholder'', ...). NULL en filas '
  'legacy pre-M50 (el reader cae a vertebras_json). Sin CHECK de lista: el '
  'registry de la app valida contra su catálogo vivo.';

COMMENT ON COLUMN sesion.tool_data_cifrado IS
  'M50 · payload JSON de la herramienta clínica, cifrado app-side AES-256-GCM '
  '(mismo esquema que el SOAP: iv||tag||ciphertext vía lib/crypto.ts). El '
  'schema del JSON lo define el registry por tool_id (zod, versionado con '
  '{ v: n }). PHI — nunca se persiste en claro.';

COMMENT ON COLUMN sesion.vertebras_json IS
  'M10 · legacy de lectura + espejo quiropraxia. Desde M50 la fuente de verdad '
  'es tool_data_cifrado; el writer espeja acá el toolData de quiropraxia para '
  'compat con la vista sesion_con_enmiendas (M14) y el índice gin. Se retira '
  'en Fase F.';

-- ─── 3. Extender el guard de lock (Ley 26.529 art. 15) ──────────────────────
-- Copia del cuerpo de M10:93-116 + tool_id / tool_data_cifrado en la lista de
-- campos protegidos. Una sesión bloqueada tampoco puede cambiar de herramienta
-- ni de payload clínico.

CREATE OR REPLACE FUNCTION prevent_locked_sesion_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    -- Permitir el setear locked_at de NULL → not NULL (eso ES el lock).
    -- Si ya estaba locked, ningún cambio permitido salvo NO-OP.
    IF NEW.soap_s_cifrado    IS DISTINCT FROM OLD.soap_s_cifrado
       OR NEW.soap_o_cifrado IS DISTINCT FROM OLD.soap_o_cifrado
       OR NEW.soap_a_cifrado IS DISTINCT FROM OLD.soap_a_cifrado
       OR NEW.soap_p_cifrado IS DISTINCT FROM OLD.soap_p_cifrado
       OR NEW.vertebras_json IS DISTINCT FROM OLD.vertebras_json
       OR NEW.eva_antes      IS DISTINCT FROM OLD.eva_antes
       OR NEW.eva_despues    IS DISTINCT FROM OLD.eva_despues
       OR NEW.notas_cifrado  IS DISTINCT FROM OLD.notas_cifrado
       OR NEW.locked_at      IS DISTINCT FROM OLD.locked_at
       OR NEW.turno_id       IS DISTINCT FROM OLD.turno_id
       OR NEW.paciente_id    IS DISTINCT FROM OLD.paciente_id
       OR NEW.tool_id        IS DISTINCT FROM OLD.tool_id
       OR NEW.tool_data_cifrado IS DISTINCT FROM OLD.tool_data_cifrado
    THEN
      RAISE EXCEPTION 'Sesión bloqueada (locked_at=%). Usá sesion_enmienda para correcciones (Ley 26.529 art. 15).', OLD.locked_at;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION prevent_locked_sesion_update() IS
  'Folio · M10+M50 · guard append-only de sesión bloqueada (Ley 26.529 art. '
  '15). M50 suma tool_id y tool_data_cifrado a la lista de campos protegidos.';
