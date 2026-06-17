/**
 * Folio · Landing — scene-ficha · mock de la historia clínica por especialidad.
 *
 * Muestra "la app por dentro": la ficha clínica de Cardiología (uno de los
 * fuertes del producto), con un peek de pestañas de especialidad que insinúa
 * "tu ficha cambia según tu profesión". Server component, aria-hidden, cero JS.
 *
 * PHI: contenido 100 % sintético, hardcodeado — NO sale de ninguna query, RLS
 * ni cuenta. Nombre parcial inventado (inicial + apellido común, nunca un
 * paciente real), valores clínicos ilustrativos; sin DNI/teléfono/email/fecha
 * de nacimiento. Mismo criterio que scene-cifrado.tsx. Clases auto-contenidas
 * `.fl-ficha-*` (no depende de las clases de la app).
 */

import { Activity, Check, Lock } from "@/components/icons";

const VITALS = [
  { v: "138", l: "TA sist. mmHg" },
  { v: "86", l: "TA diast. mmHg" },
  { v: "72", l: "FC lpm" },
] as const;

const FACTORES = [
  { label: "Hipertensión", on: true },
  { label: "Tabaquismo", on: true },
  { label: "Diabetes", on: false },
  { label: "Sedentarismo", on: false },
] as const;

const ESTUDIOS = [
  { name: "Ecocardiograma", date: "28 may", tag: "Normal", tone: "green" },
  { name: "Ergometría", date: "12 abr", tag: "Seguimiento", tone: "amber" },
] as const;

export function SceneFicha() {
  return (
    <div className="fl-ficha" aria-hidden="true">
      <div className="fl-ficha-specs">
        <span className="fl-ficha-spec is-active">Cardiología</span>
        <span className="fl-ficha-spec">Psicología</span>
        <span className="fl-ficha-spec">Quiropraxia</span>
      </div>

      <article className="fl-ficha-card">
        <header className="fl-ficha-head">
          <span className="fl-ficha-avatar">MR</span>
          <span className="fl-ficha-id">
            <span className="fl-ficha-name">
              M. Rivas <span className="fl-ficha-age">· 54 años</span>
            </span>
            <span className="fl-ficha-meta">
              <span className="fl-ficha-tag">6ª sesión</span>
              Última visita 2 jun
            </span>
          </span>
          <span className="fl-ficha-module">
            <Activity size={13} />
            Módulo · Cardiología
          </span>
        </header>

        <nav className="fl-ficha-tabs">
          <span>Información</span>
          <span className="is-active">Plan</span>
          <span>Sesiones</span>
          <span>Estudios</span>
        </nav>

        <div className="fl-ficha-panel">
          <div className="fl-ficha-panel-head">
            <span className="fl-ficha-panel-title">Panel cardiovascular</span>
            <span className="fl-ficha-risk">Riesgo moderado</span>
          </div>

          <div className="fl-ficha-vitals">
            {VITALS.map((m) => (
              <span key={m.l} className="fl-ficha-vital">
                <b>{m.v}</b>
                <i>{m.l}</i>
              </span>
            ))}
          </div>

          <svg
            className="fl-ficha-spark"
            viewBox="0 0 220 44"
            preserveAspectRatio="none"
            role="presentation"
          >
            <polyline points="0,12 44,18 88,15 132,24 176,22 220,31" />
            <circle cx="220" cy="31" r="3" />
          </svg>

          <ul className="fl-ficha-factors">
            {FACTORES.map((f) => (
              <li key={f.label} className={f.on ? "is-on" : undefined}>
                {f.on ? <Check size={11} /> : null}
                {f.label}
              </li>
            ))}
          </ul>
        </div>

        <ul className="fl-ficha-studies">
          {ESTUDIOS.map((e) => (
            <li key={e.name}>
              <span className="fl-ficha-study-name">{e.name}</span>
              <span className="fl-ficha-meta">{e.date}</span>
              <span className={`fl-ficha-tag fl-ficha-tag--${e.tone}`}>{e.tag}</span>
            </li>
          ))}
        </ul>

        <footer className="fl-ficha-foot">
          <Lock size={12} />
          Cifrada de punta a punta
        </footer>
      </article>

      <p className="fl-ficha-caption">
        La ficha cambia según tu especialidad. Todo lo clínico, cifrado.
      </p>
    </div>
  );
}
