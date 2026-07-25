/**
 * Folio · decisión PURA de la confirmación 1-click (F7b · M90).
 *
 * Dado un token ya verificado (accion) + el estado real del turno en DB,
 * decide qué hace/muestra la página pública `/t/[token]`:
 *
 *   - "ejecutar":       la transición procede (la página muestra el botón;
 *                        la action corre el CAS).
 *   - "ya_confirmado":  confirmar sobre un turno que ya está confirmado o
 *                        más adelante en el flujo (EN_SALA/ATENDIENDO) —
 *                        replay inocuo, mensaje feliz.
 *   - "ya_cancelado":   cancelar sobre un turno ya cancelado — ídem.
 *   - "turno_pasado":   el inicio ya quedó atrás (el token expira al inicio,
 *                        así que esto cubre la carrera render→click).
 *   - "no_disponible":  el estado no permite la acción online (CERRADO,
 *                        REAGENDADO, NO_ASISTIO, o cancelar con el paciente
 *                        ya en sala) — se deriva al consultorio.
 *
 * Sin DB ni reloj propio (nowMs inyectado) → testeable determinísticamente.
 * La MISMA tabla CONFIRM_CAS_FROM alimenta el `.in("estado", …)` del CAS de
 * la action, así decisión y guard de escritura no pueden divergir.
 */

import type { ConfirmAccion } from "./confirm-token";

/** Estados de `turno.estado` (enum estado_turno, M09). */
export type EstadoTurnoDb =
  | "AGENDADO"
  | "CONFIRMADO"
  | "EN_SALA"
  | "ATENDIENDO"
  | "CERRADO"
  | "NO_ASISTIO"
  | "CANCELADO"
  | "REAGENDADO";

export type ResultadoConfirmacion =
  | "ejecutar"
  | "ya_confirmado"
  | "ya_cancelado"
  | "turno_pasado"
  | "no_disponible";

/**
 * Estados DESDE los que cada acción del 1-click puede transicionar, alineados
 * a la matriz del trigger M09 (y a su subconjunto sensato para un paciente):
 *   - confirmar: solo AGENDADO → CONFIRMADO.
 *   - cancelar:  AGENDADO | CONFIRMADO → CANCELADO. EN_SALA→CANCELADO existe
 *     en la state machine pero es una acción de mostrador, no del email (si
 *     el paciente ya está en la sala de espera, no cancela por link).
 */
export const CONFIRM_CAS_FROM: Record<ConfirmAccion, readonly EstadoTurnoDb[]> = {
  confirmar: ["AGENDADO"],
  cancelar: ["AGENDADO", "CONFIRMADO"],
};

export interface DecisionConfirmacionInput {
  accion: ConfirmAccion;
  /** `turno.estado` leído de DB (uppercase). Valores desconocidos → no_disponible. */
  estado: string;
  /** Inicio del turno en epoch ms. */
  inicioMs: number;
  /** "Ahora" en epoch ms (inyectado, no Date.now() — testeable). */
  nowMs: number;
}

export function decideResultadoConfirmacion(
  input: DecisionConfirmacionInput,
): ResultadoConfirmacion {
  const { accion, estado, inicioMs, nowMs } = input;

  // El turno ya arrancó/pasó: nada que confirmar ni cancelar por link.
  // (El token expira al inicio, pero la carrera render→click y el CAS
  // post-verificación pasan por acá igual.)
  if (nowMs >= inicioMs) return "turno_pasado";

  if ((CONFIRM_CAS_FROM[accion] as readonly string[]).includes(estado)) {
    return "ejecutar";
  }

  if (accion === "confirmar") {
    // Ya confirmado o más adelante en el flujo presencial: replay feliz.
    if (estado === "CONFIRMADO" || estado === "EN_SALA" || estado === "ATENDIENDO") {
      return "ya_confirmado";
    }
    return "no_disponible";
  }

  // accion === "cancelar"
  if (estado === "CANCELADO") return "ya_cancelado";
  return "no_disponible";
}
