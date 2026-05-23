-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M26 · profile.nombre_cifrado / apellido_cifrado → NULLABLE
-- ════════════════════════════════════════════════════════════════════════════
-- M02 declared these as NOT NULL, assuming `completeOnboarding` (the legacy
-- single-shot flow) would write nombre + apellido at signup time. The
-- premium onboarding architecture (introduced with M19+) splits the flow:
-- signUpAndInitOrganization creates `profile` with PII fields NULL at
-- Step 1, and Step 2 of the onboarding wizard fills them via
-- updateOnboardingStep. Without this migration, *every* fresh signup via
-- the premium flow fails with a NOT NULL violation, which masquerades as
-- a generic "Error creando perfil" or — in the Google OAuth path —
-- as the upstream "Invalid login credentials" error (because the upsert
-- silently fails inside `bootstrapOrgForAuthenticatedUser`).
--
-- Application-level guarantee: profile.nombre_cifrado IS NOT NULL by the
-- time onboarding_completed=true. Components/server actions that need
-- the decrypted nombre (sidebar, configuracion, exports) already handle
-- NULL gracefully via `tryDecrypt` / nullable PII fields.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE profile ALTER COLUMN nombre_cifrado   DROP NOT NULL;
ALTER TABLE profile ALTER COLUMN apellido_cifrado DROP NOT NULL;

COMMENT ON COLUMN profile.nombre_cifrado IS
  'AES-256-GCM app-side. NULL durante Step 1 del onboarding premium; se llena en Step 2.';
COMMENT ON COLUMN profile.apellido_cifrado IS
  'AES-256-GCM app-side. NULL durante Step 1 del onboarding premium; se llena en Step 2.';
