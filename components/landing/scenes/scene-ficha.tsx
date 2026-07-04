"use client";

/**
 * Folio · Landing — scene-ficha · la historia clínica por especialidad (interactivo).
 *
 * Muestra "la app por dentro" con la ficha REAL de cada especialidad — y se
 * puede cambiar de ficha clickeando la especialidad (Cardiología · Psicología ·
 * Quiropraxia). Reusa las clases reales de la app (pc-card / fi-pill / fi-wi-field
 * / fm-modal-check / pc-legend-*) para verse idéntico a la ficha de verdad; solo
 * el layout exterior y la columna usan clases .fl-ficha-* propias.
 *
 * PHI: contenido 100 % sintético, hardcodeado — NO sale de ninguna query/RLS/
 * cuenta. Nombres parciales inventados (inicial + apellido común), valores
 * clínicos ilustrativos; sin DNI/teléfono/email/fecha de nacimiento. La parte
 * clínica es aria-hidden (ilustrativa); el control de especialidad es real y la
 * sección tiene un resumen sr-only.
 */

import { useRef, useState } from "react";

import { Activity, Lock, Soap, Vertebra } from "@/components/icons";

type Key = "cardio" | "psico" | "quiro";

interface Patient {
  initials: string;
  name: string;
  age: string;
  session: string;
  last: string;
}

const PATIENTS: Record<Key, Patient> = {
  cardio: { initials: "MR", name: "M. Rivas", age: "54 años", session: "6.ª sesión", last: "2 jun" },
  psico: { initials: "LF", name: "L. Funes", age: "31 años", session: "9.ª sesión", last: "5 jun" },
  quiro: { initials: "DS", name: "D. Sosa", age: "42 años", session: "4.ª sesión", last: "3 jun" },
};

const TABS: { key: Key; label: string }[] = [
  { key: "cardio", label: "Cardiología" },
  { key: "psico", label: "Psicología" },
  { key: "quiro", label: "Quiropraxia" },
];

const AMBER = { color: "var(--amber)", background: "var(--amber-soft)", borderColor: "transparent" };
const GREEN = { color: "var(--green)", background: "var(--green-soft)", borderColor: "transparent" };
const SLATE = { color: "var(--slate)", background: "var(--slate-soft)", borderColor: "transparent" };

/** Campo de solo-lectura con el look exacto de .fi-wi-field. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="fi-wi-field">
      <span>{label}</span>
      <input value={value} readOnly tabIndex={-1} />
    </label>
  );
}

function FichaHeader({ p, icon, modulo }: { p: Patient; icon: React.ReactNode; modulo: string }) {
  return (
    <header className="fl-ficha-head">
      <span className="fl-ficha-avatar">{p.initials}</span>
      <span className="fl-ficha-id">
        <span className="fl-ficha-name">
          {p.name} <span className="fl-ficha-age">· {p.age}</span>
        </span>
        <span className="fl-ficha-submeta">
          <span className="fi-pill">{p.session}</span>
          Última visita {p.last}
        </span>
      </span>
      <span className="fl-ficha-module">
        {icon}
        Módulo · {modulo}
      </span>
    </header>
  );
}

function SubTabs({ items }: { items: [string, boolean][] }) {
  return (
    <nav className="fl-ficha-subtabs">
      {items.map(([label, active]) => (
        <span key={label} className={active ? "is-active" : undefined}>
          {label}
        </span>
      ))}
    </nav>
  );
}

// ─── Cardiología ────────────────────────────────────────────────────────────

const CARDIO_FACTORES: [string, boolean][] = [
  ["Tabaquismo", true],
  ["Hipertensión arterial", true],
  ["Dislipemia", true],
  ["Diabetes", false],
  ["Antecedentes familiares", false],
  ["Sedentarismo", false],
];

function CardioFicha() {
  return (
    <>
      <FichaHeader p={PATIENTS.cardio} icon={<Activity size={13} />} modulo="Cardiología" />
      <SubTabs items={[["Resumen", false], ["Plan", true], ["Sesiones", false], ["Estudios", false]]} />

      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Panel cardiovascular</span>
          <span className="fi-pill" style={AMBER}>Riesgo moderado</span>
        </header>
        <div className="fl-ficha-grid3">
          <Field label="TA sist. (mmHg)" value="138" />
          <Field label="TA diast. (mmHg)" value="86" />
          <Field label="FC (lpm)" value="72" />
        </div>
        <fieldset className="fl-ficha-fieldset">
          <legend className="fi-eyebrow">Factores de riesgo</legend>
          <div className="fl-ficha-grid2">
            {CARDIO_FACTORES.map(([label, on]) => (
              <label key={label} className="fm-modal-check">
                <input type="checkbox" checked={on} readOnly tabIndex={-1} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="fl-ficha-spark-wrap">
          <span className="fi-eyebrow">Evolución TA / FC</span>
          <svg className="fl-ficha-spark" viewBox="0 0 320 96" preserveAspectRatio="none" role="presentation">
            <line x1="6" y1="84" x2="314" y2="84" />
            <polyline className="is-red" points="6,26 83,30 160,22 237,36 314,42" />
            <polyline className="is-amber" points="6,54 83,52 160,58 237,55 314,62" />
            <polyline className="is-slate" points="6,66 83,64 160,68 237,63 314,67" />
            <circle className="is-red" cx="314" cy="42" r="3" />
            <circle className="is-amber" cx="314" cy="62" r="3" />
            <circle className="is-slate" cx="314" cy="67" r="3" />
          </svg>
          <div className="pc-spine-legend fl-ficha-legend">
            <span className="fl-ficha-legend-keys">
              <span className="pc-legend-item"><span className="pc-legend-swatch" style={{ background: "var(--red)" }} />TA sist.</span>
              <span className="pc-legend-item"><span className="pc-legend-swatch" style={{ background: "var(--amber)" }} />TA diast.</span>
              <span className="pc-legend-item"><span className="pc-legend-swatch" style={{ background: "var(--slate)" }} />FC</span>
            </span>
            <span className="fl-ficha-legend-range">5 mar → 2 jun</span>
          </div>
        </div>
      </section>

      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Estudios</span>
        </header>
        <div className="fl-ficha-study">
          <b>Ecocardiograma</b>
          <span className="fl-ficha-dim">28 may</span>
          <span className="fi-pill" style={GREEN}>Normal</span>
        </div>
        <div className="fl-ficha-study">
          <b>Ergometría</b>
          <span className="fl-ficha-dim">12 abr</span>
          <span className="fi-pill" style={AMBER}>Requiere seguimiento</span>
        </div>
      </section>
    </>
  );
}

// ─── Psicología ─────────────────────────────────────────────────────────────

function PsicoFicha() {
  return (
    <>
      <FichaHeader p={PATIENTS.psico} icon={<Soap size={13} />} modulo="Psicología" />
      <SubTabs items={[["Resumen", false], ["Plan", true], ["Sesiones", false], ["Escalas", false]]} />

      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Escalas</span>
        </header>
        <div className="fl-ficha-scales">
          <span className="fl-ficha-scale">
            <b>PHQ-9</b>
            <span className="fi-pill" style={SLATE}>8 · leve</span>
          </span>
          <span className="fl-ficha-scale">
            <b>GAD-7</b>
            <span className="fi-pill" style={SLATE}>6 · leve</span>
          </span>
        </div>
        <div className="fl-ficha-spark-wrap">
          <span className="fi-eyebrow">Evolución de puntajes</span>
          <svg className="fl-ficha-spark" viewBox="0 0 320 96" preserveAspectRatio="none" role="presentation">
            <line x1="6" y1="84" x2="314" y2="84" />
            <polyline className="is-accent" points="6,30 83,40 160,48 237,58 314,66" />
            <polyline className="is-slate" points="6,52 83,56 160,60 237,64 314,70" />
            <circle className="is-accent" cx="314" cy="66" r="3" />
            <circle className="is-slate" cx="314" cy="70" r="3" />
          </svg>
          <div className="pc-spine-legend fl-ficha-legend">
            <span className="fl-ficha-legend-keys">
              <span className="pc-legend-item"><span className="pc-legend-swatch" style={{ background: "var(--accent)" }} />PHQ-9</span>
              <span className="pc-legend-item"><span className="pc-legend-swatch" style={{ background: "var(--slate)" }} />GAD-7</span>
            </span>
            <span className="fl-ficha-legend-range">mejora sostenida</span>
          </div>
        </div>
      </section>

      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Registro de sesión</span>
        </header>
        <div className="fl-ficha-grid2">
          <Field label="Ánimo" value="Ansioso" />
          <Field label="Afecto" value="Congruente" />
          <Field label="Curso del pensamiento" value="Lógico" />
          <Field label="Riesgo" value="Sin riesgo" />
        </div>
      </section>

      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Objetivos terapéuticos</span>
        </header>
        <div className="fl-ficha-goal">
          <span>Reducir evitación social</span>
          <span className="fi-pill" style={SLATE}>En curso</span>
        </div>
        <div className="fl-ficha-goal">
          <span>Higiene del sueño</span>
          <span className="fi-pill" style={GREEN}>Logrado</span>
        </div>
      </section>
    </>
  );
}

// ─── Quiropraxia ────────────────────────────────────────────────────────────

type VertState = "leve" | "moderado" | "ajustada";
const SPINE: { id: string; region: "c" | "d" | "l"; state?: VertState }[] = [
  ...["C1", "C2", "C3", "C4", "C5", "C6", "C7"].map((id) => ({ id, region: "c" as const })),
  ...["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12"].map((id) => ({
    id,
    region: "d" as const,
    state: id === "T6" ? ("leve" as const) : undefined,
  })),
  ...["L1", "L2", "L3", "L4", "L5"].map((id) => ({
    id,
    region: "l" as const,
    state: id === "L4" ? ("moderado" as const) : id === "L5" ? ("ajustada" as const) : undefined,
  })),
];

function QuiroFicha() {
  return (
    <>
      <FichaHeader p={PATIENTS.quiro} icon={<Vertebra size={13} />} modulo="Quiropraxia" />
      <SubTabs items={[["Resumen", false], ["Plan", true], ["Visitas", false], ["Radiografías", false]]} />

      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Columna · vista posterior</span>
          <span className="fi-pill" style={GREEN}>2 ajustes hoy</span>
        </header>
        <div className="fl-ficha-quiro">
          <div className="fl-ficha-spine" aria-hidden="true">
            {SPINE.map((v) => (
              <span
                key={v.id}
                className={`fl-ficha-vert fl-ficha-vert--${v.region}${v.state ? ` is-${v.state}` : ""}`}
              >
                {v.state ? <span className="fl-ficha-vert-tag">{v.id}</span> : null}
              </span>
            ))}
          </div>
          <div className="fl-ficha-quiro-side">
            <Field label="Motivo de consulta" value="Lumbalgia mecánica L4–L5" />
            <Field label="Test de Lasègue" value="Positivo a la izquierda" />
            <div className="fl-ficha-legend-col">
              <span className="pc-legend-item"><span className="pc-legend-swatch" style={{ background: "var(--amber)" }} />Dolor leve</span>
              <span className="pc-legend-item"><span className="pc-legend-swatch" style={{ background: "var(--red)" }} />Dolor moderado</span>
              <span className="pc-legend-item"><span className="pc-legend-swatch" style={{ background: "var(--green)" }} />Ajustada</span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

const FICHAS: Record<Key, () => React.ReactNode> = {
  cardio: CardioFicha,
  psico: PsicoFicha,
  quiro: QuiroFicha,
};

export function SceneFicha() {
  const [active, setActive] = useState<Key>("cardio");
  const btns = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
    setActive(TABS[next].key);
    btns.current[next]?.focus();
  };

  const Body = FICHAS[active];

  return (
    <div className="fl-ficha">
      <div className="fl-ficha-tabbar" role="tablist" aria-label="Ver la ficha por especialidad">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              btns.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            tabIndex={active === t.key ? 0 : -1}
            className={`fl-ficha-tab${active === t.key ? " is-active" : ""}`}
            onClick={() => setActive(t.key)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <article className="fl-ficha-card">
        <div className="fl-ficha-body" key={active} aria-hidden="true">
          <Body />
          <footer className="fl-ficha-foot">
            <Lock size={12} />
            Cifrada de punta a punta
          </footer>
        </div>
      </article>

      <p className="fl-ficha-caption">
        La ficha cambia según tu especialidad. Todo lo clínico, cifrado.
      </p>
    </div>
  );
}
