/**
 * Folio · Dashboard "Hoy" · helpers compartidos.
 *
 * Port de los utilitarios de folio/dashboard.jsx (líneas 9-43).
 * `NOW_SIM` es la "hora simulada" del prototipo (mitad de la sesión de
 * Diego Peralta — 11:38). Se usa para calcular cuántos minutos faltan
 * para el próximo turno y para etiquetas relativas como "en 22 min".
 *
 * En F4 (data layer real) `NOW_SIM` se reemplaza por `new Date()` real.
 */

import type { EstadoTurno, EstadoTurnoConfig } from "./types";

export const NOW_SIM = new Date("2026-05-13T11:38:00");

export const fmtMoney = (n: number | null | undefined): string =>
  "$" + (n ?? 0).toLocaleString("es-AR");

export function minutesTo(horaStr: string): number {
  const [h, m] = horaStr.split(":").map(Number);
  const t = new Date(NOW_SIM);
  t.setHours(h, m, 0, 0);
  return Math.round((t.getTime() - NOW_SIM.getTime()) / 60000);
}

export function relativeTo(horaStr: string): string {
  const d = minutesTo(horaStr);
  if (d === 0) return "ahora";
  if (d > 0) {
    if (d < 60) return `en ${d} min`;
    const h = Math.floor(d / 60);
    const mm = d % 60;
    return mm ? `en ${h} h ${mm}` : `en ${h} h`;
  }
  const a = Math.abs(d);
  if (a < 60) return `hace ${a} min`;
  return `hace ${Math.floor(a / 60)} h`;
}

/**
 * Configuración visual por estado para la lista del Dashboard. Es una
 * versión simplificada de `TURNO_STATE_CONF` (sólo label + dot color),
 * compatible con la del prototipo. La completa con tooltips/pulse vive
 * en `lib/turno-states.ts`.
 */
export const STATE_CONF: Record<
  Exclude<EstadoTurno, "reagendado">,
  Pick<EstadoTurnoConfig, "label" | "dot">
> = {
  agendado:   { label: "Sin confirmar", dot: "var(--ink-4)"  },
  confirmado: { label: "Confirmado",    dot: "var(--green)"  },
  en_sala:    { label: "En sala",       dot: "var(--amber)"  },
  atendiendo: { label: "En curso",      dot: "var(--brass)"  },
  cerrado:    { label: "Cerrado",       dot: "var(--green)"  },
  no_asistio: { label: "No asistió",    dot: "var(--red)"    },
  cancelado:  { label: "Cancelado",     dot: "var(--ink-4)"  },
};
