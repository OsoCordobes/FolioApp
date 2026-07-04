-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M66 · organization_tipo_cambio — audit trail de cambios de tier
-- ════════════════════════════════════════════════════════════════════════════
-- Cada upgrade/downgrade de organization.tipo (INDEPENDIENTE ⇄ CLINICA, M49)
-- queda registrado acá, append-only, con el impacto en el monto mensual
-- (monto_antes/despues en centavos, según lib/billing/pricing.ts al momento
-- del cambio). Es evidencia de facturación: quién cambió el plan, cuándo y
-- qué diferencia de precio implicó — nunca se edita ni se borra.
--
--   - Escritura: SOLO service_role (el flujo de cambio de tier corre en una
--     Server Action privilegiada / soporte). Sin policy de INSERT a propósito
--     — mismo criterio que cargo_suscripcion (M19).
--   - Lectura: solo el OWNER de la org (quien paga ve su historial de plan),
--     mismo patrón que suscripcion_select_owner (M19).
--   - Append-only: triggers que bloquean UPDATE/DELETE (patrón exacto de
--     prevent_sesion_enmienda_mutation, M10).
--
-- Portabilidad: la función de trigger es plpgsql y no referencia tablas de
-- migraciones posteriores, así que no necesita `set check_function_bodies =
-- off` (mismo criterio que M49). Replay limpio en postgres:16 vanilla.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE organization_tipo_cambio (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organization(id),

  -- Mismo tipo que organization.tipo (enum organizacion_tipo, M49).
  de_tipo               organizacion_tipo NOT NULL,
  a_tipo                organizacion_tipo NOT NULL,

  -- auth.users.id del actor que ejecutó el cambio (OWNER o soporte). Sin FK a
  -- propósito: el registro debe sobrevivir a la baja de la cuenta del actor
  -- (evidencia de facturación, no relación viva).
  changed_by            uuid NOT NULL,

  -- Monto mensual (centavos ARS) antes/después del cambio, según pricing al
  -- momento. NULL si la org aún no tenía suscripción para comparar.
  monto_antes_cents     int,
  monto_despues_cents   int,

  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT org_tipo_cambio_distinto CHECK (de_tipo <> a_tipo),
  CONSTRAINT org_tipo_cambio_montos_positivos CHECK (
    (monto_antes_cents IS NULL OR monto_antes_cents > 0)
    AND (monto_despues_cents IS NULL OR monto_despues_cents > 0)
  )
);

CREATE INDEX organization_tipo_cambio_org_idx
  ON organization_tipo_cambio (organization_id, created_at DESC);

COMMENT ON TABLE organization_tipo_cambio IS
  'Folio · M66 · historial append-only de cambios de organization.tipo (tier Solo/Clínica) con impacto de precio. INSERT solo via service_role; SELECT solo OWNER de la org; UPDATE/DELETE bloqueados por trigger.';

-- ─── Append-only enforcement (patrón M10 · sesion_enmienda) ─────────────────

CREATE OR REPLACE FUNCTION prevent_organization_tipo_cambio_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'organization_tipo_cambio es append-only (no UPDATE)';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'organization_tipo_cambio es append-only (no DELETE)';
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER organization_tipo_cambio_no_update
  BEFORE UPDATE ON organization_tipo_cambio
  FOR EACH ROW EXECUTE FUNCTION prevent_organization_tipo_cambio_mutation();

CREATE TRIGGER organization_tipo_cambio_no_delete
  BEFORE DELETE ON organization_tipo_cambio
  FOR EACH ROW EXECUTE FUNCTION prevent_organization_tipo_cambio_mutation();

-- ════════════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE organization_tipo_cambio ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_tipo_cambio FORCE  ROW LEVEL SECURITY;

-- ─── SELECT: solo OWNER de la org (patrón suscripcion_select_owner, M19) ────
-- DIRECTOR/PROFESIONAL/ASISTENTE no ven billing.

CREATE POLICY organization_tipo_cambio_select_owner
  ON organization_tipo_cambio FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) = 'OWNER'
  );

-- Sin policy de INSERT/UPDATE/DELETE a propósito: solo service_role
-- (BYPASSRLS) escribe; UPDATE/DELETE además los bloquea el trigger
-- append-only incluso para service_role.
