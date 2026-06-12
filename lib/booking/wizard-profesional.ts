/**
 * Folio · booking público multi-profesional (CLINICA-4) — decisión pura del
 * flujo del wizard. Sin React/DB: testeada en
 * tests/unit/booking-profesional-publico.test.ts.
 *
 * Regla central: el paso "Elegí profesional" existe SOLO con >1 colegiado.
 * Con 0–1 el wizard es EXACTAMENTE el histórico de 3 pasos (servicio → slot
 * → datos) y el server resuelve el default determinístico — una org Solo no
 * ve ni un píxel distinto.
 *
 * Nota de alcance: el designNotes de la auditoría sugiere gatear también por
 * organization.tipo === 'CLINICA', pero el server (resolveProfesionalPublico)
 * exige elección explícita con >1 colegiado SIN mirar tipo — si el wizard
 * gateara por tipo, una org INDEPENDIENTE con 2 colegiados quedaría con el
 * booking muerto (el server pide elegir y el wizard no ofrece el paso). El
 * gate es ">1 colegiado", consistente en ambas puntas.
 */

/** Profesional reservable expuesto al wizard público (sin PHI, sin email). */
export interface ProfesionalPublico {
  /** member.id — uuid opaco, value del selector. */
  id: string;
  /** "Nombre Apellido" (decrypt server-side; fallback "Profesional"). */
  displayName: string;
}

export type BookingVista = "servicio" | "profesional" | "slot" | "datos" | "ok";

/** ¿El wizard muestra el paso "Elegí profesional"? */
export function esMultiProfesional(profesionales: ProfesionalPublico[]): boolean {
  return profesionales.length > 1;
}

/** Paso que sigue a "Elegí el servicio". */
export function pasoTrasServicio(multiProf: boolean): BookingVista {
  return multiProf ? "profesional" : "slot";
}

/** Destino del "← volver" del paso de horarios. */
export function pasoPrevioASlot(multiProf: boolean): BookingVista {
  return multiProf ? "profesional" : "servicio";
}

/**
 * profesionalId que viaja a fetchSlotsPublico/createPedidoPublico.
 * Solo multi-prof manda el elegido; el flujo Solo NO manda nada y el server
 * resuelve el default (back-compat total: la firma es aditiva).
 */
export function profesionalIdParaActions(
  multiProf: boolean,
  seleccionadoId: string | null,
): string | undefined {
  return multiProf && seleccionadoId ? seleccionadoId : undefined;
}

/** Display name del seleccionado, para "con {nombre}" (null si no aplica). */
export function nombreProfesionalSeleccionado(
  profesionales: ProfesionalPublico[],
  seleccionadoId: string | null,
): string | null {
  if (!seleccionadoId) return null;
  return profesionales.find((p) => p.id === seleccionadoId)?.displayName ?? null;
}
