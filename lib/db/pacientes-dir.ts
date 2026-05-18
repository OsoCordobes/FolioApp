/**
 * Folio · /pacientes data fetcher (Sprint S1 T-1.6).
 *
 * Wrapea `listPacientesDirectorio` (lib/db/pacientes.ts) y le da al cliente
 * el shape "directorio" compatible con la tabla del prototipo:
 *   { id, nombre, tel, email, tipo, sesiones, ultima, proximo, tags, estado, motivoCorto }
 *
 * Las decisiones de derivación:
 *   - `estado`: "activo" si proximoTurno != null, "inactivo" si último >60d
 *      sin próximo, "alta" si tags incluye "ALTA", "pausa" si tags incluye
 *      "PAUSA". Para MVP (sin tabla de estado propio).
 *   - `tipo`: mapeado desde tipo_paciente DB ('NUEVO' → "nuevo", 'ACTIVO' / 'EN_ESPERA' → "recurrente").
 *   - `motivoCorto`: por ahora vacío. La vista `paciente_directorio_lite`
 *     no incluye motivo_consulta_cifrado (PHI). Para mostrarlo necesitamos
 *     join con `paciente` que ya está aliased en la vista pero por ahora
 *     dejamos "—" — se puede expandir en T-1.7 (ficha).
 */

import { listPacientesDirectorio } from "./pacientes";
import { ok, type Result } from "./errors";

export interface PacienteDirRow {
  id: string;
  nombre: string;
  tel: string;
  email: string;
  tipo: "nuevo" | "recurrente";
  sesiones: number;
  ultima: string | null;
  proximo: string | null;
  tags: string[];
  estado: "activo" | "inactivo" | "pausa" | "alta";
  motivoCorto: string;
}

export async function getPacientesDirectorio(): Promise<Result<PacienteDirRow[]>> {
  const res = await listPacientesDirectorio();
  if (!res.ok) return res;

  const now = Date.now();
  const rows: PacienteDirRow[] = res.data.map((p) => {
    const diasUltima = p.ultimaVisita
      ? Math.floor((now - new Date(p.ultimaVisita).getTime()) / 86_400_000)
      : null;

    let estado: PacienteDirRow["estado"] = "activo";
    const tagsUpper = (p.tags ?? []).map((t) => t.toUpperCase());
    if (tagsUpper.includes("ALTA")) estado = "alta";
    else if (tagsUpper.includes("PAUSA")) estado = "pausa";
    else if (!p.proximoTurno && diasUltima != null && diasUltima > 60) estado = "inactivo";
    else estado = "activo";

    return {
      id: p.id,
      nombre: [p.nombre, p.apellido].filter(Boolean).join(" ").trim() || "Sin nombre",
      tel: p.telefono ?? "",
      email: p.email ?? "",
      tipo: p.tipo === "RECURRENTE" ? "recurrente" : "nuevo",
      sesiones: p.sesionesCompletadas,
      ultima: p.ultimaVisita ? p.ultimaVisita.slice(0, 10) : null,
      proximo: p.proximoTurno ? p.proximoTurno.slice(0, 10) : null,
      tags: p.tags ?? [],
      estado,
      motivoCorto: "—",
    };
  });

  return ok(rows);
}
