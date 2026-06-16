-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M64 · Directorio público: opt-IN listar_en_directorio (Fase 3)
-- ════════════════════════════════════════════════════════════════════════════
-- El directorio /profesionales hace a un consultorio BUSCABLE e INDEXABLE por
-- terceros — un nivel de exposición SUPERIOR al link de reserva
-- (opt_out_public_listing, default false / opt-OUT: "tengo un link compartible").
-- Listar en un buscador indexable exige consentimiento AFIRMATIVO, específico e
-- informado (Ley 25.326): por eso es **opt-IN**, default false, con su propio
-- toggle y su propio timestamp de consentimiento.
--
-- listar_en_directorio_at: cuándo se prestó el consentimiento (auditable).
--
-- 100% aditiva: columnas nullable / default false + índice parcial. No define
-- funciones SQL ni usa funciones en el predicado del índice que no sean
-- IMMUTABLE (solo columnas + booleanos) → NO necesita check_function_bodies off
-- ni wrappers IMMUTABLE. Replay-safe en postgres:16 vanilla y pgTAP.
--
-- Backfill: orgs existentes → listar_en_directorio=false (nadie aparece hasta
-- que opta explícitamente). Sin exposición.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE organization
  ADD COLUMN IF NOT EXISTS listar_en_directorio    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS listar_en_directorio_at timestamptz NULL;

COMMENT ON COLUMN organization.listar_en_directorio IS
  'M64 · OPT-IN al directorio público /profesionales (default false). Consentimiento Ley 25.326 distinto y superior al link de reserva (opt_out_public_listing): listar = ser BUSCABLE/indexable por terceros. Las internas (is_internal_account) nunca se listan.';
COMMENT ON COLUMN organization.listar_en_directorio_at IS
  'M64 · timestamp del consentimiento a listarse en el directorio (cuándo se activó listar_en_directorio). Auditoría Ley 25.326.';

-- Índice parcial para las queries del directorio (facetas especialidad/provincia/
-- ciudad). Solo indexa las filas elegibles → chico y selectivo. Predicado con
-- columnas/booleanos puros (IMMUTABLE), sin funciones.
CREATE INDEX IF NOT EXISTS organization_directorio_idx
  ON organization (especialidad, provincia, ciudad)
  WHERE listar_en_directorio
    AND deleted_at IS NULL
    AND is_internal_account = false;
