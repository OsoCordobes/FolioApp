/**
 * Folio · /pacientes
 *
 * Directorio de pacientes: tabla densa con filtros, búsqueda, bulk actions
 * y widget de pacientes para reactivar (>60 días sin contacto).
 *
 * En F4 la data viene de Supabase (Paciente + PacienteIdentidad + join con
 * Turno) y las acciones (mensaje, archivar, etiquetar) se conectan a Server
 * Actions reales con audit logging.
 */

import { PacientesDir } from "@/components/pacientes/pacientes-dir";

export default function PacientesPage() {
  return <PacientesDir />;
}
