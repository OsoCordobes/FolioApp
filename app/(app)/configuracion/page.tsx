/**
 * Folio · /configuracion (Server Component).
 *
 * Lee organization + profile + servicios y los pasa al Client Component.
 * MVP scope:
 *   - Save real para sección Consultorio (organization + profile).
 *   - Servicios, Horarios, Integraciones, Plan: read-only o stub.
 *
 * Role gating del save: el server action `saveConsultorioAction` ya rechaza
 * si el rol no es OWNER/DIRECTOR. El UI usa `canEdit` para deshabilitar el
 * botón Guardar y mostrar tooltip explicativo.
 */

import { Configuracion } from "@/components/configuracion/configuracion";
import { getActiveContext } from "@/lib/db/active-context";
import { getConfiguracionData } from "@/lib/db/configuracion";

export const dynamic = "force-dynamic";

export default async function ConfiguracionPage() {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    throw new Error(`No se pudo cargar /configuracion: ${ctx.error.message}`);
  }

  const data = await getConfiguracionData();
  if (!data.ok) {
    throw new Error(`Error cargando configuración: ${data.error.message}`);
  }

  const canEdit = ctx.data.session.role === "OWNER" || ctx.data.session.role === "DIRECTOR";

  return (
    <Configuracion
      initialConsultorio={data.data.consultorio}
      initialServicios={data.data.servicios}
      initialDias={data.data.dias}
      initialSlotMin={data.data.slotMin}
      initialAutoConfirmar={data.data.autoConfirmarReservas}
      initialSlotMargenMin={data.data.slotMargenMin}
      googleCalendar={data.data.googleCalendar}
      canEdit={canEdit}
    />
  );
}
