/**
 * Folio · /pacientes/[id]
 *
 * Ficha completa del paciente con tabs: Información, Plan (módulo
 * Quiropraxia con spine map + SOAP), Sesiones, Documentos. El baseline
 * captura el tab "Plan" para la paciente demo (María Sánchez, id=2).
 *
 * En F4 el `[id]` route param se usa para fetchear el paciente real
 * desde Supabase (Paciente + PacienteIdentidad + Sesion[] join, con RLS
 * que filtra por organizationId y profesionalPrincipalId).
 */

import { PacienteDetalle } from "@/components/paciente/paciente-detalle";

export default function PacientePage() {
  return <PacienteDetalle />;
}
