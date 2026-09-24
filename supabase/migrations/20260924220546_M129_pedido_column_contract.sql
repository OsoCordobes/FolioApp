-- M129 / B05a contract. Apply only after the code using M128's clinical-reason
-- RPC is deployed and verified. This removes broad authenticated table SELECT
-- grants, which otherwise override any column-level restriction.
-- The administrative inbox still reads contact and booking details. It cannot
-- read or update the encrypted clinical booking reason through the Data API.

REVOKE SELECT ON public.pedido FROM PUBLIC, anon, authenticated;
REVOKE INSERT ON public.pedido FROM PUBLIC, anon;
REVOKE SELECT (motivo_cifrado) ON public.pedido
  FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id, organization_id, canal, estado, nombre_cifrado, telefono_cifrado,
  email_cifrado, paciente_id, fecha_propuesta, duracion_min, servicio_id,
  precio_cents, recibido_ts, confirmado_ts, rechazado_motivo,
  contra_propuesta, profesional_id
) ON public.pedido TO authenticated;
GRANT INSERT ON public.pedido TO authenticated;
