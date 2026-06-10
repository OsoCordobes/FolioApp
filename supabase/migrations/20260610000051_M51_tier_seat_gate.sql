-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M51 · Tier seat gate — solo orgs CLINICA pueden invitar equipo
-- ════════════════════════════════════════════════════════════════════════════
-- Fase C (tiers Solo/Clinic, docs/PLAN.md): el plan Solo (organization.tipo =
-- 'INDEPENDIENTE', ARS 30.000/mes) cubre UN solo member activo — el OWNER.
-- Invitar staff (médicos, secretaría, dirección) es una capacidad del plan
-- Clínica ('CLINICA', ARS 100.000/mes base + 25.000 por seat adicional).
--
-- Este gate de negocio se aplica EN LA POLICY de INSERT de member_invitation
-- (no solo app-side): la RLS es el gate real e infranqueable — la app puede
-- ocultar el form, pero sin esta policy un OWNER de una org INDEPENDIENTE
-- podría crear invitaciones por API directa y sumar seats sin pagar el tier.
--
-- Cambio: DROP + re-CREATE de member_invitation_insert_admin (M49:117-123)
-- conservando el WITH CHECK original (member de la org + rol OWNER/DIRECTOR +
-- invited_by coherente) y AGREGANDO la condición de tipo CLINICA.
--
-- Notas:
--   - El subselect a organization corre bajo la RLS del usuario que inserta:
--     org_select_own (M02) garantiza que un member siempre puede leer su
--     propia org, así que la condición es evaluable para cualquier
--     OWNER/DIRECTOR legítimo.
--   - Aditiva/segura para prod: cambiar una policy no valida datos existentes
--     (a diferencia de un CHECK/EXCLUDE). Las invitaciones ya creadas no se
--     tocan; aceptar una invitación va por la RPC SECURITY DEFINER de M49 y
--     no pasa por esta policy.
--   - Append-only: NO editar M49; este archivo es la versión canónica nueva.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY member_invitation_insert_admin ON member_invitation;

CREATE POLICY member_invitation_insert_admin
  ON member_invitation FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
    AND invited_by_member_id = public.user_member_id_in(organization_id)
    AND (SELECT o.tipo FROM organization o WHERE o.id = organization_id) = 'CLINICA'
  );

COMMENT ON POLICY member_invitation_insert_admin ON member_invitation IS
  'M49+M51 · Solo OWNER/DIRECTOR de la org crean invitaciones, y SOLO si la '
  'org es tipo CLINICA (gate de negocio Fase C: el plan Solo/INDEPENDIENTE '
  'cubre un único member; el equipo es del plan Clínica — base ARS 100.000 + '
  '25.000 por seat adicional, ver docs/PLAN.md). El upgrade de tipo se hace '
  'vía onboarding o soporte; el cobro variable por seats llega en Fase E.';
