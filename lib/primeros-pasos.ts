/**
 * Folio · "Primeros pasos" — checklist de activación post-onboarding (pura).
 *
 * La activación del día 1 es el gap #1 vs Jane/SimplePractice (auditoría
 * 2026-07, dimensiones onboarding/benchmark): /hoy recibía al usuario nuevo
 * con un empty state de texto. Esta lib decide, a partir de un snapshot de
 * datos REALES de la org (nada de localStorage), qué tareas están completas
 * y si la card se muestra.
 *
 * Reglas:
 *   - La card es visible solo mientras la org es "joven": onboarding
 *     completado, menos de PRIMEROS_PASOS_MAX_DIAS desde la creación de la
 *     org (proxy de la fecha de fin del onboarding — no persistimos un
 *     completed_at) y menos de PRIMEROS_PASOS_MAX_TURNOS turnos creados.
 *   - Desaparece sola cuando todas las tareas están hechas.
 *   - "Compartí tu link" se considera hecho cuando existe al menos una
 *     reserva con origen BOOKING — evidencia real de que el link circuló.
 *   - "Invitá a tu equipo" solo existe para orgs CLINICA.
 *
 * El fetch de los contadores vive en lib/db/primeros-pasos.ts; acá solo hay
 * lógica pura, testeable con node:test (tests/unit/primeros-pasos.test.ts).
 */

export const PRIMEROS_PASOS_MAX_TURNOS = 5;
export const PRIMEROS_PASOS_MAX_DIAS = 30;

const DIA_MS = 24 * 60 * 60 * 1000;

export type OrgTipo = "INDEPENDIENTE" | "CLINICA";

export type PrimerPasoId =
  | "compartir_link"
  | "primer_paciente"
  | "primer_turno"
  | "google_calendar"
  | "cobros_mp"
  | "invitar_equipo";

/** Snapshot de datos reales de la org — lo arma lib/db/primeros-pasos.ts. */
export interface PrimerosPasosSnapshot {
  tipo: OrgTipo;
  onboardingCompleted: boolean;
  /** organization.created_at (ISO) — proxy de la fecha de fin del onboarding. */
  orgCreatedAt: string;
  /** Turnos creados por la org (cualquier origen/estado, no borrados). */
  turnosTotal: number;
  /** Turnos con origen BOOKING — alguien reservó por el link público. */
  reservasOnline: number;
  /** Pacientes activos (paciente_identidad no borradas). */
  pacientesTotal: number;
  /** Existe una integración GOOGLE_CALENDAR en la org. */
  gcalConectado: boolean;
  /** Hay suscripción a Folio (cualquier estado) o integración MERCADOPAGO. */
  cobrosMpListos: boolean;
  /** CLINICA: hay más de un member activo o una invitación pendiente. */
  equipoInvitado: boolean;
}

export interface PrimerPaso {
  id: PrimerPasoId;
  done: boolean;
}

export interface PrimerosPasosEstado {
  /** false ⇒ la card no se renderiza (org madura o checklist completo). */
  visible: boolean;
  /** Siempre en orden de render; incluye invitar_equipo solo en CLINICA. */
  pasos: PrimerPaso[];
  completados: number;
  total: number;
}

/**
 * TRUE si la org tiene menos de PRIMEROS_PASOS_MAX_DIAS de vida (ventana
 * semiabierta: el día 30 exacto ya no es joven). Fecha inválida ⇒ false
 * (fail-safe: ante datos rotos no molestamos). Una fecha futura (clock skew
 * de una org recién creada) cuenta como joven.
 */
export function esOrgJoven(orgCreatedAt: string, nowMs: number): boolean {
  const createdMs = Date.parse(orgCreatedAt);
  if (Number.isNaN(createdMs)) return false;
  return nowMs - createdMs < PRIMEROS_PASOS_MAX_DIAS * DIA_MS;
}

/** Deriva el estado completo del checklist a partir del snapshot. */
export function computePrimerosPasos(
  s: PrimerosPasosSnapshot,
  nowMs: number = Date.now(),
): PrimerosPasosEstado {
  const pasos: PrimerPaso[] = [
    { id: "compartir_link", done: s.reservasOnline > 0 },
    { id: "primer_paciente", done: s.pacientesTotal > 0 },
    { id: "primer_turno", done: s.turnosTotal > 0 },
    { id: "google_calendar", done: s.gcalConectado },
    { id: "cobros_mp", done: s.cobrosMpListos },
  ];
  if (s.tipo === "CLINICA") {
    pasos.push({ id: "invitar_equipo", done: s.equipoInvitado });
  }

  const completados = pasos.filter((p) => p.done).length;
  const visible =
    s.onboardingCompleted &&
    esOrgJoven(s.orgCreatedAt, nowMs) &&
    s.turnosTotal < PRIMEROS_PASOS_MAX_TURNOS &&
    completados < pasos.length;

  return { visible, pasos, completados, total: pasos.length };
}
