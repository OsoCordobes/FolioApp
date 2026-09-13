import type { Role } from "./capabilities";

/** M46 grants these roles all sessions of patients they may read. Keep patient/vault RLS. */
export function canExportCompleteClinicalHistory(role: Role, esColegiado: boolean): boolean {
  return role === "OWNER" || (role === "DIRECTOR" && esColegiado);
}

export const COMPLETE_HISTORY_PERMISSION_MESSAGE = "Para recibir la historia clínica completa, solicitá la entrega al responsable del consultorio o a la dirección clínica. Podés exportar por separado las sesiones a las que tenés acceso.";
