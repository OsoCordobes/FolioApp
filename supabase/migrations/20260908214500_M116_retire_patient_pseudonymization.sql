-- M116: retire the legacy patient-erasure RPC. A request for account closure
-- never authorizes deletion of patient identity or clinical records.
-- Preserve the original signature/default for old clients and dependencies,
-- but discard the destructive body. Owners/superusers also hit this rejection;
-- restoring EXECUTE alone cannot reactivate the retired implementation.
BEGIN;

CREATE OR REPLACE FUNCTION public.pseudonimizar_paciente(
  p_paciente_id uuid,
  p_motivo text,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501',
    MESSAGE = 'patient_pseudonymization_retired',
    HINT = 'La solicitud requiere revisión humana de conservación y entrega autorizada. Esta función no elimina ni modifica datos.';
END;
$$;

REVOKE ALL ON FUNCTION public.pseudonimizar_paciente(uuid, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.pseudonimizar_paciente(uuid, text, boolean) IS
  'Folio M116; policy=retired.v1; legacy patient pseudonymization is retired. Every invocation rejects with 42501, including dry-run and privileged callers. No identity, clinical, account or Auth mutations; no replacement erasure workflow is enabled.';

COMMIT;
