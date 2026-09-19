-- M123: M92's staff membership check also admitted coordinators to payment
-- details. A restrictive SELECT boundary composes with both SELECT and ALL
-- permissive policies, preserving existing turno scope and the M101 MFA gate.
CREATE POLICY pago_select_financial_role
 ON public.pago AS RESTRICTIVE FOR SELECT TO authenticated
 USING (
  EXISTS (
   SELECT 1 FROM public.turno t
   WHERE t.id=pago.turno_id AND public.can_read_admin(t.organization_id)
  )
 );
COMMENT ON POLICY pago_select_financial_role ON public.pago IS
 'Folio M123: payment reads require a current financial role (OWNER, DIRECTOR, PROFESIONAL, ASISTENTE), existing visible-turno scope and MFA. COORDINADOR receives no payment rows. Existing write policies and service-role behavior are unchanged.';
