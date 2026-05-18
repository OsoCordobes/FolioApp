/**
 * Folio · /configuracion
 *
 * Ajustes del consultorio organizados en 6 secciones: Cuenta, Consultorio
 * (default), Horarios, Servicios, Integraciones, Plan. Save bar al header
 * muestra estado dirty/saved.
 *
 * En F4 cada sección persiste vía Server Action con audit log. En F5/F6
 * las integraciones (Google Calendar, WhatsApp) ejecutan flow OAuth real.
 */

import { Configuracion } from "@/components/configuracion/configuracion";

export default function ConfiguracionPage() {
  return <Configuracion />;
}
