/**
 * Folio · Landing · Escena 20:00 — cierre del día ("Un día con Folio" · E2/R2).
 *
 * Mockup CSS puro, decorativo (aria-hidden): dashboard de cierre — header
 * (día + badge verde "Día cerrado"), 3 stats grandes en Geist Mono con
 * sub-labels, las barras de la semana con la de hoy destacada en --accent y
 * una fila de detalle con los últimos cobros en mono. En el modo sticky las
 * barras crecen scrubeadas por --fl-day (fl-close-bar-up, range contain
 * 70%–86% INTACTO) y los cobros fade-up dentro de esa misma ventana
 * (fl-sc-fade-up); en base todo se muestra completo.
 * Server component, cero JS. Clases .fl-close-* en public/folio.css
 * (fragmento E2 + refinamiento R2).
 */

import { Check } from "@/components/icons";

interface Stat {
  num: string;
  label: string;
  sub: string;
}

const STATS: Stat[] = [
  { num: "6", label: "pacientes", sub: "0 ausencias" },
  { num: "$96.000", label: "registrados", sub: "6 cobros · al día" },
  { num: "0", label: "planillas", sub: "todo quedó en Folio" },
];

interface WeekDay {
  day: string;
  today?: boolean;
}

/* Las alturas de cada barra viven en el CSS (nth-child) — acá solo el orden */
const WEEK: WeekDay[] = [
  { day: "mié" },
  { day: "jue" },
  { day: "vie" },
  { day: "sáb" },
  { day: "dom" },
  { day: "lun" },
  { day: "hoy", today: true },
];

interface Pay {
  time: string;
  name: string;
  amount: string;
  /** [completo, abreviado] — el corto se muestra solo en pantallas angostas */
  method: [string, string];
}

const PAYS: Pay[] = [
  { time: "18:20", name: "Julián P.", amount: "$16.000", method: ["transferencia", "transf."] },
  { time: "17:05", name: "Carlos V.", amount: "$18.000", method: ["efectivo", "efectivo"] },
];

export function SceneCierre() {
  return (
    <div className="fl-scene-visual" aria-hidden="true">
      <div className="fl-close">
        <header className="fl-close-head">
          <span className="fl-close-day">Hoy · mar 10 jun</span>
          <span className="fl-close-badge">
            <span className="fl-close-dot" />
            Día cerrado · 20:00
          </span>
        </header>

        <div className="fl-close-stats">
          {STATS.map((stat) => (
            <div key={stat.label} className="fl-close-stat">
              <span className="fl-close-num">{stat.num}</span>
              <span className="fl-close-label">{stat.label}</span>
              <span className="fl-close-sub">{stat.sub}</span>
            </div>
          ))}
        </div>

        <div className="fl-close-week">
          <span className="fl-close-week-label">turnos · últimos 7 días</span>
          <div className="fl-close-bars">
            {WEEK.map((d) => (
              <span key={d.day} className="fl-close-col">
                <span className={"fl-close-bar" + (d.today ? " is-today" : "")} />
                <span className={"fl-close-bar-day" + (d.today ? " is-today" : "")}>
                  {d.day}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div className="fl-close-pays">
          <span className="fl-close-pays-label">últimos cobros</span>
          {PAYS.map((pay) => (
            <div key={pay.time} className="fl-close-pay">
              <span className="fl-close-pay-time">{pay.time}</span>
              <span className="fl-close-pay-name">{pay.name}</span>
              <span className="fl-close-pay-amt">{pay.amount}</span>
              <span className="fl-close-pay-ok">
                <Check size={11} />
                <span className="fl-sc-long">{pay.method[0]}</span>
                <span className="fl-sc-short">{pay.method[1]}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
