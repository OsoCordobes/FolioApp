"use client";

/**
 * Folio · Auth · Slide 5 (IA · "Tu copiloto clínico" · próximamente)
 *
 * Port fiel de SlideIA en folio/auth.jsx (líneas 747-995).
 *
 * Escena en dos actos con transición:
 *   ACT 1 · AGENDA (t=0–4s)
 *     0.0  Agenda hoy con 4 turnos. Lucía highlighted como próximo.
 *     1.0  Pop-up brass sobre Lucía: "en su última sesión" + CTA
 *   TRANSICIÓN (t=4.0–4.7s) · fade + scale
 *   ACT 2 · FINANZAS + CHAT (t=4.7–13s)
 *     4.7  Finanzas dashboard (KPI $160k, mini chart)
 *     6.0  FAB ✦ aparece + pulse
 *     7.0  FAB click → chat bar sube
 *     8.2  User bubble: "dame un review de mis finanzas"
 *     8.9  Typing
 *    10.0  AI bullets cascada (700ms gap)
 *    13.0+ HOLD
 */

import { useEffect, useState } from "react";

interface Props {
  active: boolean;
}

interface Turno {
  time: string;
  initials: string;
  name: string;
  motivo: string;
  state: "done" | "next" | "idle";
}

const TURNOS: Turno[] = [
  { time: "09:15", initials: "CV", name: "Carlos Vega",     motivo: "consulta · 1ª",    state: "done" },
  { time: "10:30", initials: "MG", name: "María González",  motivo: "control · 12ª",    state: "done" },
  { time: "11:45", initials: "LM", name: "Lucía M.",        motivo: "control · 8ª",     state: "next" },
  { time: "15:00", initials: "AR", name: "Ana Romero",      motivo: "seguimiento · 4ª", state: "idle" },
];

function Sparkle({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.6 4.8L18 8l-4.4 1.2L12 14l-1.6-4.8L6 8l4.4-1.2L12 2z" />
      <path d="M19 14l.8 2.4L22 17l-2.2.6L19 20l-.8-2.4L16 17l2.2-.6L19 14z" opacity="0.65" />
    </svg>
  );
}

export function SlideIA({ active }: Props) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) {
      setPhase(0);
      return;
    }
    const timers = [
      setTimeout(() => setPhase(1), 1000),
      setTimeout(() => setPhase(2), 4000),
      setTimeout(() => setPhase(3), 6000),
      setTimeout(() => setPhase(4), 7000),
      setTimeout(() => setPhase(5), 8200),
      setTimeout(() => setPhase(6), 8900),
      setTimeout(() => setPhase(7), 10000),
      setTimeout(() => setPhase(8), 10800),
      setTimeout(() => setPhase(9), 11600),
      setTimeout(() => setPhase(10), 12400),
    ];
    return () => timers.forEach(clearTimeout);
  }, [active]);

  return (
    <>
      <span className="au2-ia3-soon" aria-label="Próximamente">
        <span className="au2-ia3-soon-dot" aria-hidden="true" />
        <span>Próximamente</span>
      </span>

      <article className={"au2-fg au2-ia3 phase-" + phase}>
        <div className="au2-ia3-stage">
          <section className="au2-ia3-scene au2-ia3-scene-agenda" aria-hidden={phase >= 2}>
            <header className="au2-ia3-mock-head">
              <span className="au2-ia3-mock-title">hoy · mié 14 may</span>
              <span className="au2-ia3-mock-meta">4 turnos</span>
            </header>
            <ul className="au2-ia3-turnos">
              {TURNOS.map((t, i) => (
                <li
                  key={i}
                  className={
                    "au2-ia3-tu is-" + t.state +
                    (t.state === "next" && phase >= 1 ? " is-highlighted" : "")
                  }
                >
                  <span className="au2-ia3-tu-time">{t.time}</span>
                  <span className="au2-ia3-tu-avatar">{t.initials}</span>
                  <div className="au2-ia3-tu-body">
                    <span className="au2-ia3-tu-name">{t.name}</span>
                    <span className="au2-ia3-tu-motivo">{t.motivo}</span>
                  </div>
                  <span className="au2-ia3-tu-tag">
                    {t.state === "done" ? "✓" : t.state === "next" ? "próximo" : "agend."}
                  </span>
                </li>
              ))}
            </ul>

            <div className={"au2-ia3-tip" + (phase >= 1 ? " is-on" : "")} aria-hidden={phase < 1}>
              <header className="au2-ia3-tip-head">
                <span className="au2-ia3-tip-spark"><Sparkle size={10} /></span>
                <span>copiloto</span>
                <span className="au2-ia3-tip-time">próximo turno · 11:45</span>
              </header>
              <div className="au2-ia3-tip-block">
                <span className="au2-ia3-tip-lbl">en su última sesión</span>
                <p>&ldquo;Dijo que pasaba muchas horas sentada.&rdquo;</p>
              </div>
              <div className="au2-ia3-tip-block au2-ia3-tip-block-cta">
                <span className="au2-ia3-tip-lbl">recordá preguntarle</span>
                <p>¿Compró la silla ergonómica?</p>
              </div>
            </div>
          </section>

          <section className="au2-ia3-scene au2-ia3-scene-finanzas" aria-hidden={phase < 2}>
            <header className="au2-ia3-mock-head">
              <span className="au2-ia3-mock-title">finanzas · hoy</span>
              <span className="au2-ia3-mock-meta">14 may · 13 de 31 días</span>
            </header>

            <div className="au2-ia3-fin-real">
              <div className="au2-ia3-fin-kpis">
                <div className="au2-ia3-fin-kpi is-primary">
                  <span className="au2-ia3-fin-kpi-lbl">recaudado hoy</span>
                  <span className="au2-ia3-fin-kpi-val"><small>$</small>160k</span>
                  <span className="au2-ia3-fin-kpi-foot">
                    <span className="au2-ia3-fin-kpi-sub">13 de 31 días</span>
                    <span className="au2-ia3-fin-kpi-delta is-pos">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M7 17l10-10M17 17V7H7" />
                      </svg>
                      +18%
                    </span>
                  </span>
                </div>
                <div className="au2-ia3-fin-kpi">
                  <span className="au2-ia3-fin-kpi-lbl">ticket prom.</span>
                  <span className="au2-ia3-fin-kpi-val"><small>$</small>46k</span>
                  <span className="au2-ia3-fin-kpi-foot">
                    <span className="au2-ia3-fin-kpi-sub">por sesión</span>
                    <span className="au2-ia3-fin-kpi-delta is-neg">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M17 7L7 17M7 7v10h10" />
                      </svg>
                      -3%
                    </span>
                  </span>
                </div>
              </div>

              <div className="au2-ia3-fin-chartcard">
                <header className="au2-ia3-fin-chartcard-head">
                  <span className="au2-ia3-fin-chartcard-eyebrow">ingresos diarios · este mes</span>
                  <span className="au2-ia3-fin-chartcard-sub">+18% vs abril</span>
                </header>
                <svg className="au2-ia3-fin-chartcard-svg" viewBox="0 0 360 110" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="au2-ia3-fin-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[0, 1, 2, 3].map((i) => {
                    const y = 12 + i * 22;
                    return (
                      <g key={i}>
                        <line
                          x1="32"
                          y1={y}
                          x2="350"
                          y2={y}
                          stroke="var(--line-soft)"
                          strokeWidth="1"
                          strokeDasharray={i === 3 ? "0" : "2 3"}
                        />
                        <text x="26" y={y + 3} textAnchor="end" fontSize="8" fontFamily="Geist Mono" fill="var(--ink-3)">
                          {i === 0 ? "150k" : i === 1 ? "100k" : i === 2 ? "50k" : "0"}
                        </text>
                      </g>
                    );
                  })}
                  {([
                    [1, 32], [5, 116], [9, 200], [13, 284], [14, 320],
                  ] as [number, number][]).map(([d, x]) => (
                    <text key={d} x={x} y="98" textAnchor="middle" fontSize="8" fontFamily="Geist Mono" fill="var(--ink-3)">
                      {d} may
                    </text>
                  ))}
                  <path
                    d="M 32 71 L 53 56 L 95 38 L 116 31 L 137 47 L 158 39 L 200 23 L 221 26 L 284 47 L 284 78 L 32 78 Z"
                    fill="url(#au2-ia3-fin-area)"
                  />
                  <path
                    d="M 32 71 L 53 56 L 95 38 L 116 31 L 137 47 L 158 39 L 200 23 L 221 26 L 284 47"
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {([
                    [32, 71], [53, 56], [95, 38], [116, 31], [137, 47],
                    [158, 39], [200, 23], [221, 26],
                  ] as [number, number][]).map(([x, y], i) => (
                    <circle key={i} cx={x} cy={y} r="2" fill="var(--surface)" stroke="var(--accent)" strokeWidth="1.6" />
                  ))}
                  <circle cx="284" cy="47" r="3.5" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />
                  <circle cx="284" cy="47" r="1.8" fill="var(--accent)" />
                  <line x1="284" y1="12" x2="284" y2="78" stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
                  <text x="284" y="9" textAnchor="middle" fontSize="7.5" fontFamily="Geist Mono" fill="var(--accent-2)" letterSpacing=".08em">
                    HOY
                  </text>
                </svg>
              </div>
            </div>

            <button
              className={
                "au2-ia3-fab" +
                (phase >= 3 ? " is-on" : "") +
                (phase >= 3 && phase < 4 ? " is-pulse" : "") +
                (phase >= 4 ? " is-active" : "")
              }
              type="button"
              tabIndex={-1}
              aria-label="Abrir copiloto"
            >
              <Sparkle size={13} />
            </button>

            <div className={"au2-ia3-chat" + (phase >= 4 ? " is-on" : "")} aria-hidden={phase < 4}>
              <header className="au2-ia3-chat-head">
                <span className="au2-ia3-chat-head-l">
                  <span className="au2-ia3-chat-spark"><Sparkle size={10} /></span>
                  <span>copiloto</span>
                </span>
                <span className="au2-ia3-chat-head-r">en línea</span>
              </header>

              <div className="au2-ia3-chat-msgs" role="log" aria-live="polite">
                {phase >= 5 ? (
                  <div className="au2-ia3-msg au2-ia3-msg-user">
                    <span>dame un review de mis finanzas</span>
                  </div>
                ) : null}

                {phase >= 6 && phase < 7 ? (
                  <div className="au2-ia3-msg au2-ia3-msg-ai au2-ia3-typing">
                    <span /><span /><span />
                  </div>
                ) : null}

                {phase >= 7 ? (
                  <div className="au2-ia3-msg au2-ia3-msg-ai">
                    <ul className="au2-ia3-bullets">
                      <li className={phase >= 7 ? "is-on" : ""}>
                        <span className="au2-ia3-bullet-dot" />
                        <span>Hoy recaudaste <b>$160k</b>.</span>
                      </li>
                      <li className={phase >= 8 ? "is-on" : ""}>
                        <span className="au2-ia3-bullet-dot" />
                        <span>Tu ticket está un <b>20% debajo</b> del promedio regional.</span>
                      </li>
                      <li className={phase >= 9 ? "is-on" : ""}>
                        <span className="au2-ia3-bullet-dot" />
                        <span>Si aumentás un <b>15%</b> mejorás tu margen financiero.</span>
                      </li>
                    </ul>
                  </div>
                ) : null}
              </div>

              <div className="au2-ia3-chat-input">
                <span className="au2-ia3-chat-input-mic">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
                  </svg>
                </span>
                <span className="au2-ia3-chat-input-ph">preguntá lo que necesites…</span>
                <span className="au2-ia3-chat-input-kbd">↵</span>
              </div>
            </div>
          </section>
        </div>
      </article>
    </>
  );
}
