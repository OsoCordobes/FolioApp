-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M20 · Campos públicos + tracking del onboarding
-- ════════════════════════════════════════════════════════════════════════════
-- Datos NO médicos, NO PII sensible — son datos del negocio del profesional
-- que se muestran en su página pública de reservas. Sin encriptación.
--
-- Tracking del onboarding: permite que el user abandone y vuelva exactamente
-- donde estaba (D8: persistencia agresiva del plan premium onboarding).
--
-- Cambio de arquitectura del onboarding asociado:
--   ANTES: signup → step 9 click → completeOnboarding crea org + redirect.
--   AHORA: signup → org creada con onboarding_completed=false → steps 2-8
--          persisten deltas → step 9 marca completed=true.
--
-- Orgs zombies: si un user nunca termina el onboarding, queda una fila
-- huérfana con onboarding_completed=false. Un cron mensual eliminará las
-- que tengan más de 30 días (lo agregamos en un sprint posterior).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE organization
  ADD COLUMN IF NOT EXISTS telefono_publico       text,
  ADD COLUMN IF NOT EXISTS direccion_completa     text,
  ADD COLUMN IF NOT EXISTS instagram_handle       text,
  ADD COLUMN IF NOT EXISTS bio                    text,
  ADD COLUMN IF NOT EXISTS onboarding_completed   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_step_max    smallint NOT NULL DEFAULT 1;

-- Constraints idempotentes (PG no acepta IF NOT EXISTS en CHECK directamente).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_telefono_publico_len') THEN
    ALTER TABLE organization ADD CONSTRAINT organization_telefono_publico_len
      CHECK (telefono_publico IS NULL OR length(telefono_publico) BETWEEN 6 AND 30);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_direccion_len') THEN
    ALTER TABLE organization ADD CONSTRAINT organization_direccion_len
      CHECK (direccion_completa IS NULL OR length(direccion_completa) BETWEEN 5 AND 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_instagram_len') THEN
    ALTER TABLE organization ADD CONSTRAINT organization_instagram_len
      CHECK (instagram_handle IS NULL OR length(instagram_handle) BETWEEN 1 AND 40);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_bio_len') THEN
    ALTER TABLE organization ADD CONSTRAINT organization_bio_len
      CHECK (bio IS NULL OR length(bio) BETWEEN 1 AND 280);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_onboarding_step_range') THEN
    ALTER TABLE organization ADD CONSTRAINT organization_onboarding_step_range
      CHECK (onboarding_step_max BETWEEN 1 AND 9);
  END IF;
END$$;

-- Index para queries "orgs con onboarding incompleto" (analítica + remarketing
-- + cron de cleanup de zombies).
CREATE INDEX IF NOT EXISTS organization_onboarding_incomplete_idx
  ON organization (onboarding_step_max)
  WHERE onboarding_completed = false AND deleted_at IS NULL;

-- Backfill: las orgs existentes (pre-M20) ya completaron onboarding por
-- definición (existen porque pasaron el flow viejo). Marcarlas como completed.
UPDATE organization
   SET onboarding_completed = true,
       onboarding_step_max = 9
 WHERE onboarding_completed = false
   AND created_at < now();

COMMENT ON COLUMN organization.telefono_publico IS
  'Folio · teléfono mostrado en /book público. Distinto del tel personal del profesional (que vive en profile, cifrado). NO PII médica.';
COMMENT ON COLUMN organization.direccion_completa IS
  'Folio · dirección física del consultorio mostrada en /book. Distinta de ciudad+provincia (más fina).';
COMMENT ON COLUMN organization.instagram_handle IS
  'Folio · handle de Instagram (sin @) mostrado como link en /book.';
COMMENT ON COLUMN organization.bio IS
  'Folio · descripción corta del consultorio (max 280 chars) para card pública.';
COMMENT ON COLUMN organization.onboarding_completed IS
  'Folio · true cuando el user terminó el onboarding (paso 9). Hasta entonces, /login redirige a /onboarding para resumir.';
COMMENT ON COLUMN organization.onboarding_step_max IS
  'Folio · último step alcanzado por el user (1-9). Permite resumir el onboarding si abandonó. Solo crece, nunca decrece.';
