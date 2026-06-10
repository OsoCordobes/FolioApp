/**
 * Folio · Landing · Escena 20:00 — cierre del día ("Un día con Folio" · E2).
 *
 * Mockup CSS puro, decorativo (aria-hidden): card de cierre con 3 stats
 * grandes en Geist Mono (pacientes / registrados / planillas) y mini-barras
 * del día. En el modo sticky las barras crecen scrubeadas por --fl-day
 * (fl-close-bar-up); en base se muestran completas.
 * Server component, cero JS. Clases .fl-close-* en public/folio.css (E2).
 */

interface Stat {
  num: string;
  label: string;
}

const STATS: Stat[] = [
  { num: "6", label: "pacientes" },
  { num: "$96.000", label: "registrados" },
  { num: "0", label: "planillas" },
];

const BARS = 7;

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
            </div>
          ))}
        </div>

        <div className="fl-close-bars">
          {Array.from({ length: BARS }, (_, i) => (
            <span key={i} className="fl-close-bar" />
          ))}
        </div>
      </div>
    </div>
  );
}
