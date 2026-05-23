-- ════════════════════════════════════════════════════════════════════════════
-- Folio · M34 · DIRECTOR puede leer audit_log (alineado con app intent)
-- ════════════════════════════════════════════════════════════════════════════
-- Hallazgo auditoría HIGH-11: lib/db/audit.ts:51-53 y :85-87 chequean
-- `role === "OWNER" || role === "DIRECTOR"` antes de leer audit_log. Pero
-- la RLS de M12 solo permitía OWNER. Resultado: DIRECTOR pasaba el app-level
-- guard, llegaba al query, y la RLS devolvía 0 filas sin error.
-- /admin/audit aparecía vacía para DIRECTOR sin explicación.
--
-- Fix: ampliar audit_log_select policy a OWNER + DIRECTOR. Mantenemos
-- restrictivo a esos dos roles (no clínicos no ven audit).
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS audit_log_select_owner ON audit_log;

CREATE POLICY audit_log_select_admin
  ON audit_log FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
    AND public.user_role_in(organization_id) IN ('OWNER', 'DIRECTOR')
  );

COMMENT ON POLICY audit_log_select_admin ON audit_log IS
  'M34 · OWNER y DIRECTOR pueden leer audit log de su org. PROFESIONAL/COORDINADOR/ASISTENTE no. Alineado con lib/db/audit.ts:51-53.';
