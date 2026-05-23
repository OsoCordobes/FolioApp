-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M30 · Patient deduplication (telefono_hash + partial UNIQUE indexes)
-- ════════════════════════════════════════════════════════════════════════════
-- Problema (auditoría CRITICAL-4):
--   1. El modal walk-in en /hoy crea paciente_identidad sin DNI. UNIQUE
--      (organization_id, dni_hash) NO bloquea duplicados con DNI NULL
--      (Postgres trata NULLs como distintos). El mismo paciente sin DNI puede
--      cargarse N veces → fichas clínicas fragmentadas → riesgo medico-legal.
--   2. UNIQUE incluye soft-deleted (deleted_at NOT NULL): un paciente borrado
--      bloquea reuso del DNI para siempre, aunque pseudonimizar libera porque
--      borra físicamente la identidad — pero soft-delete sin pseudonimización
--      bloquea para siempre. UX confuso.
--
-- Fix:
--   1. Nueva columna telefono_hash (HMAC-SHA256 de últimos 10 dígitos del
--      teléfono). Blind index para dedupear cuando no hay DNI.
--   2. Reemplazar UNIQUE amplio por DOS partial UNIQUE indexes:
--      - (org, dni_hash) WHERE deleted_at IS NULL AND dni_hash IS NOT NULL
--      - (org, telefono_hash) WHERE deleted_at IS NULL AND telefono_hash IS NOT NULL
--   3. Soft-deletes liberan el slot inmediatamente. Pseudonimización (DELETE
--      físico de la identidad) también lo libera. NULLs siguen permitidos
--      (transición — no se backfillea telefono_hash de datos existentes; los
--      pacientes viejos se dedupean cuando se editan próxima vez).
--
-- Análisis de seguridad:
--   - ADD COLUMN telefono_hash → additive, safe.
--   - DROP CONSTRAINT old + CREATE partial new → strictly MORE permissive
--     para active rows (mismo enforcement) y para soft-deleted (ahora reusable).
--     ZERO chance de violar constraint con data existente.
--   - DROP duplicate index → safe.
--   - CREATE partial UNIQUE on telefono_hash → all values NULL → no conflicts.
--
-- Defensa adicional: DO block al inicio verifica que no hay duplicados activos
-- (no debería haberlos por el old constraint, pero fail-fast con mensaje claro
-- si por algún motivo los hay).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 0. Pre-flight safety check ──────────────────────────────────────────

DO $$
DECLARE
  v_dup_dni int;
BEGIN
  SELECT COUNT(*) INTO v_dup_dni
  FROM (
    SELECT organization_id, dni_hash, COUNT(*) AS c
    FROM paciente_identidad
    WHERE deleted_at IS NULL AND dni_hash IS NOT NULL
    GROUP BY organization_id, dni_hash
    HAVING COUNT(*) > 1
  ) d;
  IF v_dup_dni > 0 THEN
    RAISE EXCEPTION 'M30 ABORT: % grupos de pacientes activos con DNI duplicado en la misma org. El UNIQUE partial fallaría. Resolvé los duplicados manualmente primero (UPDATE deleted_at en el más viejo) y reintentá.', v_dup_dni;
  END IF;
END $$;

-- ─── 1. Nueva columna telefono_hash (additive, idempotent) ───────────────

ALTER TABLE paciente_identidad
  ADD COLUMN IF NOT EXISTS telefono_hash text;

COMMENT ON COLUMN paciente_identidad.telefono_hash IS
  'M30 · HMAC-SHA256 de los últimos 10 dígitos del teléfono (E.164 stripped). Blind index para dedupear cuando no hay DNI (ej. walk-ins). Computado en server action con FOLIO_ENC_HMAC_KEY via blindIndexPhone() en lib/crypto.ts.';

-- ─── 2. Reemplazar UNIQUE amplio por partials ────────────────────────────

-- Antiguo constraint UNIQUE (org, dni_hash) — incluía soft-deleted, bloqueaba
-- reuso. Replaced por partial UNIQUE more permissive.
ALTER TABLE paciente_identidad
  DROP CONSTRAINT IF EXISTS paciente_identidad_unique_dni;

-- Antiguo índice de búsqueda (definido en M03:73 igual) — duplicado con la
-- nueva partial UNIQUE; lo dropeamos para no duplicar storage.
DROP INDEX IF EXISTS paciente_identidad_org_dni_idx;

-- Partial UNIQUE: mismo DNI activo en misma org → bloqueado. Soft-deleted
-- libera el slot. NULL dni_hash → permitido (walk-ins legacy sin DNI).
CREATE UNIQUE INDEX IF NOT EXISTS paciente_identidad_dni_unique_active
  ON paciente_identidad (organization_id, dni_hash)
  WHERE deleted_at IS NULL AND dni_hash IS NOT NULL;

COMMENT ON INDEX paciente_identidad_dni_unique_active IS
  'M30 · UNIQUE parcial · evita duplicados por (org, DNI) entre pacientes activos. Soft-deletes liberan el slot. NULLs permitidos.';

-- Partial UNIQUE: mismo teléfono activo en misma org → bloqueado. Aplica
-- desde el primer INSERT que setea telefono_hash. Pacientes legacy con
-- telefono_hash NULL no se dedupean por teléfono hasta que se editen.
CREATE UNIQUE INDEX IF NOT EXISTS paciente_identidad_telefono_unique_active
  ON paciente_identidad (organization_id, telefono_hash)
  WHERE deleted_at IS NULL AND telefono_hash IS NOT NULL;

COMMENT ON INDEX paciente_identidad_telefono_unique_active IS
  'M30 · UNIQUE parcial · evita duplicados por (org, teléfono) cuando no hay DNI (ej. walk-ins). NULLs permitidos para legacy data pre-M30.';

-- Re-crear el index de búsqueda por (org, dni_hash) que dropeamos arriba,
-- ahora como partial (excluye soft-deleted del index → más chico, más rápido).
-- La nueva partial UNIQUE arriba ya sirve para lookups exactos por dni_hash,
-- pero un index dedicado de búsqueda con WHERE deleted_at IS NULL ayuda al
-- planner cuando el predicate dni_hash IS NOT NULL no se infiere automáticamente.
CREATE INDEX IF NOT EXISTS paciente_identidad_org_dni_search_idx
  ON paciente_identidad (organization_id, dni_hash)
  WHERE deleted_at IS NULL;

-- Nuevo: índice por (org, telefono_hash) para búsqueda directorio rápida cuando
-- el operador busca por teléfono (caso común en recepción).
CREATE INDEX IF NOT EXISTS paciente_identidad_org_telefono_search_idx
  ON paciente_identidad (organization_id, telefono_hash)
  WHERE deleted_at IS NULL;
