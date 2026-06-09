/**
 * Folio · Dashboard "Hoy" · helpers compartidos.
 *
 * `minutesTo` y `relativeTo` operan contra un "now" inyectable para evitar
 * hydration mismatches (SSR captura el reloj en el fetch, el cliente lo
 * refresca via `useNow` hook). Los componentes pasan el `now` explícitamente
 * o aceptan el default `new Date()` (sólo válido en client-side render).
 */

import type { EstadoTurno, EstadoTurnoConfig } from "./types";

export const fmtMoney = (n: number | null | undefined): string =>
  "$" + (n ?? 0).toLocaleString("es-AR");

/**
 * Minutos hasta `horaStr` (hh:mm en hora de pared de la org). El cálculo es
 * wall-clock vs wall-clock: `now` se proyecta al timezone de la org con Intl
 * en vez de interpretarse en el TZ del runtime. Sin esto, server (TZ org) y
 * browser (TZ del visitante) disienten sobre si un turno es "próximo" y la
 * hidratación del header de /hoy falla para usuarios fuera del TZ del server.
 */
export function minutesTo(horaStr: string, now: Date = new Date(), timeZone?: string): number {
  const [h, m] = horaStr.split(":").map(Number);
  let nowH: number;
  let nowM: number;
  try {
    [nowH, nowM] = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    })
      .format(now)
      .split(":")
      .map(Number);
  } catch {
    nowH = now.getHours();
    nowM = now.getMinutes();
  }
  return h * 60 + m - (nowH * 60 + nowM);
}

export function relativeTo(horaStr: string, now: Date = new Date(), timeZone?: string): string {
  const d = minutesTo(horaStr, now, timeZone);
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
