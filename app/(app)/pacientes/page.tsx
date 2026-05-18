/**
 * Folio · /pacientes (Server Component).
 *
 * Lista todos los pacientes de la org logueada usando la vista
 * `paciente_directorio_lite` (M14). Desencripta PII server-side y construye
 * el shape view-friendly para la tabla del directorio.
 *
 * El filtrado y la búsqueda libre son client-side sobre la lista cargada.
 * Para org con muchos pacientes (>500) habrá que paginar y filtrar en server;
 * por ahora el MVP no lo necesita.
 */

import { PacientesDir } from "@/components/pacientes/pacientes-dir";
import { getPacientesDirectorio } from "@/lib/db/pacientes-dir";

export const dynamic = "force-dynamic";

export default async function PacientesPage() {
  const result = await getPacientesDirectorio();
  if (!result.ok) {
    throw new Error(`No se pudo cargar el directorio: ${result.error.message}`);
  }
  return <PacientesDir pacientes={result.data} />;
}
