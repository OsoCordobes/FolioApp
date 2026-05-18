/**
 * Folio · turno state machine — single source of truth.
 *
 * Port de folio/turno-states.js del prototipo (intacto en comportamiento).
 * Sin window globals; exports tipados.
 *
 * Flujo clínico (todos los turnos en agenda ya están pagados):
 *   agendado → confirmado → en_sala → atendiendo → cerrado
 *
 * Paralelos terminales: no_asistio, cancelado, reagendado.
 *
 * Post-visita NO es estado, es flag derivado:
 *   postVisitaPendiente = (estado === 'cerrado') && !postVisita?.guardada
 */

import type {
  ActorTurno,
  EstadoTurno,
  EstadoTurnoConfig,
  TriggerTurno,
  Turno,
} from "./types";

export const TURNO_STATES = {
  AGENDADO: "agendado",
  CONFIRMADO: "confirmado",
  EN_SALA: "en_sala",
  ATENDIENDO: "atendiendo",
  CERRADO: "cerrado",
  NO_ASISTIO: "no_asistio",
  CANCELADO: "cancelado",
  REAGENDADO: "reagendado",
} as const satisfies Record<string, EstadoTurno>;

/** Display config — único lugar donde se decide color/label visual de un estado. */
export const TURNO_STATE_CONF: Record<EstadoTurno, EstadoTurnoConfig> = {
  agendado:   { label: "Agendado",   dot: "var(--ink-4)",  tip: "Sin confirmar todavía" },
  confirmado: { label: "Confirmado", dot: "var(--green)",  tip: "Confirmado por WhatsApp" },
  en_sala:    { label: "En sala",    dot: "var(--amber)",  tip: "Llegó al consultorio · esperando" },
  atendiendo: { label: "En curso",   dot: "var(--brass)",  tip: "Sesión en curso", pulse: true },
  cerrado:    { label: "Cerrado",    dot: "var(--green)",  tip: "Sesión finalizada · suma a recaudación" },
  no_asistio: { label: "No asistió", dot: "var(--red)",    tip: "El paciente no se presentó" },
  cancelado:  { label: "Cancelado",  dot: "var(--ink-4)",  tip: "Cancelado antes de empezar" },
  reagendado: { label: "Reagendado", dot: "var(--accent)", tip: "Movido a otra fecha" },
};

const VALID_TRANSITIONS: Record<EstadoTurno, EstadoTurno[]> = {
  agendado:   ["confirmado", "cancelado", "reagendado", "no_asistio"],
  confirmado: ["en_sala", "no_asistio", "cancelado", "reagendado"],
  en_sala:    ["atendiendo", "cancelado"],
  atendiendo: ["cerrado"],
  cerrado:    [],
  no_asistio: ["reagendado"],
  cancelado:  [],
  reagendado: [],
};

export function canTransition(from: EstadoTurno, to: EstadoTurno): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export interface ApplyTransitionOptions {
  actor?: ActorTurno;
  trigger?: TriggerTurno;
  extra?: Partial<Turno>;
}

/** Aplica una transición devolviendo un Turno NUEVO (no muta el original). */
export function applyTransition(
  turno: Turno,
  to: EstadoTurno,
  opts: ApplyTransitionOptions = {},
): Turno {
  const { actor = "lorenzo", trigger = "manual", extra = {} } = opts;
  if (!canTransition(turno.estado, to)) {
    if (typeof console !== "undefined") {
      console.warn(`[turnoStates] Invalid transition: ${turno.estado} → ${to}`);
    }
    return turno;
  }
  return {
    ...turno,
    estado: to,
    transiciones: [
      ...(turno.transiciones ?? []),
      { from: turno.estado, to, ts: new Date().toISOString(), actor, trigger },
    ],
    ...extra,
  };
}

export const postVisitaPendiente = (turno: Turno): boolean =>
  turno.estado === "cerrado" && !turno.postVisita?.guardada;

export const esEstadoTerminal = (estado: EstadoTurno): boolean =>
  ["cerrado", "no_asistio", "cancelado", "reagendado"].includes(estado);

export const esEstadoActivo = (estado: EstadoTurno): boolean =>
  ["en_sala", "atendiendo"].includes(estado);

// ─── Legacy migration (boot) ────────────────────────────────────────────────

const LEGACY_MAP: Record<string, EstadoTurno> = {
  pendiente: "agendado",
  confirmado_wa: "confirmado",
  proximo: "confirmado",
  en_curso: "atendiendo",
  completado: "cerrado",
  facturado: "cerrado",
  completado_facturado: "cerrado",
};

interface LegacyTurnoLike extends Omit<Partial<Turno>, "estado"> {
  estado: string;
  notaCargada?: boolean;
}

export function migrateTurnoLegacy(turno: LegacyTurnoLike): Turno {
  const mapped = (LEGACY_MAP[turno.estado] ?? turno.estado) as EstadoTurno;
  const out: Turno = {
    id: turno.id ?? 0,
    hora: turno.hora ?? "",
    pacienteId: turno.pacienteId ?? 0,
    servicio: turno.servicio ?? "",
    precio: turno.precio ?? 0,
    duracionMin: turno.duracionMin ?? null,
    atendiendoDesde: turno.atendiendoDesde ?? null,
    duracionRealMin: turno.duracionRealMin ?? null,
    estado: mapped,
    postVisita: turno.postVisita ?? { guardada: false },
    gcal: turno.gcal,
    origen: turno.origen,
    transiciones: turno.transiciones ?? [],
    cobro: turno.cobro ?? { estado: "pendiente", ts: null },
  };
  if (turno.notaCargada && !out.postVisita?.guardada) {
    out.postVisita = { guardada: true, ts: "2026-05-13T09:30:00", via: "audio" };
  }
  return out;
}
