"use client";

/**
 * Folio · /pacientes/[id] · ficha completa con tabs.
 *
 * Port de folio/paciente.jsx (líneas 283-648). El tab por defecto es "plan"
 * (módulo Quiropraxia) para que el baseline pixel-perfect matchee. Cada tab
 * tiene su propio sub-componente.
 *
 * El auto-save indicator del SOAP usa el clock del browser (mockeado en tests
 * con page.clock.install para determinismo).
 */

import Link from "next/link";
import { useRef, useState } from "react";

import * as I from "@/components/icons";
import { SpineMap } from "@/components/paciente/spine-map";
import {
  ESTADO_VERT,
  PACIENTE_DETALLE,
  PLAN,
  TURNO_HOY_HORA,
  fmtFecha,
  iniciales,
  type EstadoVertebra,
} from "@/lib/paciente-detalle-mock";
// ESTADO_VERT solo se referencia desde SpineMap; mantenemos el import por consistencia con el prototipo
void ESTADO_VERT;

type TabId = "informacion" | "plan" | "sesiones" | "documentos";

// ─── Sub: SOAP stacked ─────────────────────────────────────────────────────

const SOAP_SECTIONS = [
  { id: "subjetivo" as const, label: "Subjetivo", hint: "Lo que cuenta el paciente." },
  { id: "objetivo"  as const, label: "Objetivo",  hint: "Lo que observás vos." },
  { id: "analisis"  as const, label: "Análisis",  hint: "Interpretación clínica." },
  { id: "plan"      as const, label: "Plan",      hint: "Próximos pasos." },
];

type SoapState = typeof PLAN.soap;
type SoapKey = keyof SoapState;

function SoapStacked({ soap, setSoap }: { soap: SoapState; setSoap: (s: SoapState) => void }) {
  const [savingId, setSavingId] = useState<SoapKey | null>(null);
  const [lastSaved, setLastSaved] = useState("11:08");
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const onChange = (id: SoapKey, v: string) => {
    setSoap({ ...soap, [id]: v });
    setSavingId(id);
    if (timers.current[id]) clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => {
      const now = new Date();
      setLastSaved(
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      );
      setSavingId(null);
    }, 800);
  };

  return (
    <div className="pc-soap">
      <header className="pc-soap-head">
        <span className="fi-eyebrow">
          Nota SOAP · sesión 13 may · {TURNO_HOY_HORA}
        </span>
        <span className={"fm-save " + (savingId ? "fm-save--saving" : "fm-save--saved")}>
          {savingId ? (
            <>
              <span className="fm-save-spinner" />
              Guardando…
            </>
          ) : (
            <>
              <I.Check size={11} />
              Guardado · <span className="fm-mono">{lastSaved}</span>
            </>
          )}
        </span>
      </header>
      {SOAP_SECTIONS.map((s) => (
        <div key={s.id} className="pc-soap-section">
          <div className="pc-soap-section-head">
            <b>{s.label}</b>
            <span className="pc-soap-section-hint">{s.hint}</span>
          </div>
          <textarea
            className="pc-soap-textarea"
            value={soap[s.id]}
            onChange={(e) => onChange(s.id, e.target.value)}
            placeholder={`Escribí el ${s.label.toLowerCase()}…`}
            spellCheck={false}
            rows={Math.max(3, Math.ceil((soap[s.id]?.length ?? 0) / 60))}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Sub: Plan de tratamiento ──────────────────────────────────────────────

function PlanTratamiento() {
  const pct = Math.round((PLAN.completadas / PLAN.total) * 100);
  return (
    <section className="pc-card pc-plan">
      <header className="pc-card-head">
        <span className="fi-eyebrow">Plan de tratamiento</span>
        <button type="button" className="pc-link">Editar</button>
      </header>
      <div className="pc-plan-progress">
        <div className="pc-plan-progress-row">
          <span className="pc-plan-num">
            <b>{PLAN.completadas}</b>
            <small>/ {PLAN.total}</small>
          </span>
          <span className="pc-plan-num-lbl">sesiones</span>
          <span className="pc-plan-pct fm-mono">{pct}%</span>
        </div>
        <div className="pc-plan-bar">
          <div className="pc-plan-bar-fill" style={{ width: pct + "%" }} />
          <div className="pc-plan-bar-segs">
            {Array.from({ length: PLAN.total }, (_, i) => (
              <span key={i} className={"pc-plan-seg " + (i < PLAN.completadas ? "is-done" : "")} />
            ))}
          </div>
        </div>
      </div>
      <div className="pc-plan-meta">
        <div>
          <span className="muted">Frecuencia</span>
          <b>{PLAN.frecuencia}</b>
        </div>
        <div>
          <span className="muted">Próximo control</span>
          <b>{fmtFecha(PLAN.proximoControl)}</b>
        </div>
        <div>
          <span className="muted">Diagnóstico</span>
          <b>{PLAN.diagnostico}</b>
        </div>
      </div>
    </section>
  );
}

// ─── Sub: Historial reciente ───────────────────────────────────────────────

function HistorialReciente() {
  const [expanded, setExpanded] = useState(false);
  const visibles = expanded ? PLAN.sesiones : PLAN.sesiones.slice(0, 4);

  return (
    <section className="pc-card pc-historial">
      <header className="pc-card-head">
        <span className="fi-eyebrow">Historial reciente</span>
        <button type="button" className="pc-link" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Mostrar menos" : `Ver todas (${PLAN.sesiones.length})`}
        </button>
      </header>
      <div className="pc-historial-list">
        {visibles.map((s, i) => (
          <div key={s.fecha} className="pc-historial-row">
            <div className="pc-historial-marker">
              <span className="pc-historial-dot" />
              {i < visibles.length - 1 ? <span className="pc-historial-line" /> : null}
            </div>
            <div className="pc-historial-body">
              <div className="pc-historial-head">
                <span className="fm-mono">{fmtFecha(s.fecha)}</span>
                <span className="pc-historial-sep">·</span>
                <span>{s.servicio}</span>
                <span className="pc-historial-dur fm-mono">{s.dur} min</span>
              </div>
              <p className="pc-historial-cambio">{s.cambio}</p>
              {s.vertebras.length ? (
                <div className="pc-historial-vertebras">
                  {s.vertebras.map((v) => (
                    <span key={v} className="pc-historial-vert fm-mono">{v}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Sub: Tab Plan ─────────────────────────────────────────────────────────

function TabPlan() {
  const [vertStates, setVertStates] = useState<Record<string, EstadoVertebra>>(
    PLAN.vertebrasEstado,
  );
  const [soap, setSoap] = useState<SoapState>(PLAN.soap);

  return (
    <div className="pc-plan-tab">
      <div className="pc-module-badge">
        <I.Vertebra size={14} />
        <span>Módulo · Quiropraxia</span>
        <span className="pc-module-hint">esta tab cambia por profesión</span>
      </div>

      <div className="pc-plan-grid">
        <SpineMap states={vertStates} setStates={setVertStates} />
        <SoapStacked soap={soap} setSoap={setSoap} />
      </div>

      <div className="pc-bottom-grid">
        <PlanTratamiento />
        <HistorialReciente />
      </div>
    </div>
  );
}

// ─── Sub: Otras tabs ───────────────────────────────────────────────────────

function TabInformacion() {
  return (
    <div className="pc-info-grid">
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Contacto</span>
          <button type="button" className="pc-link">Editar</button>
        </header>
        <dl className="pc-dl">
          <dt>Teléfono</dt>
          <dd className="fm-mono">{PACIENTE_DETALLE.tel}</dd>
          <dt>Email</dt>
          <dd>{PACIENTE_DETALLE.email}</dd>
          <dt>Cumpleaños</dt>
          <dd>18 may</dd>
          <dt>Obra social</dt>
          <dd>Particular</dd>
        </dl>
      </section>
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Motivo de consulta</span>
        </header>
        <p className="pc-card-text">{PACIENTE_DETALLE.motivo}</p>
        <div className="pc-tags">
          {PACIENTE_DETALLE.tags.map((t) => (
            <span key={t} className="fi-pill fi-pill--mute">{t}</span>
          ))}
        </div>
      </section>
      <section className="pc-card pc-info-notes">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Notas internas</span>
        </header>
        <p className="pc-card-text muted">
          Prefiere turnos a la mañana. Trabaja remoto, jornadas largas en escritorio.
          Compró silla ergonómica en abril; reportó mejoría inmediata en lumbar.
        </p>
      </section>
    </div>
  );
}

function TabSesiones() {
  return (
    <div className="pc-sesiones">
      <div className="pc-sesiones-toolbar">
        <span className="fi-eyebrow">
          {PLAN.sesiones.length} sesiones · desde {fmtFecha(PLAN.inicio)}
        </span>
        <button type="button" className="fi-btn fi-btn-secondary">
          <I.Plus size={12} /> Nueva sesión
        </button>
      </div>
      <div className="pc-sesiones-list">
        {PLAN.sesiones.map((s, i) => (
          <div key={s.fecha} className="pc-sesion-row">
            <div className="pc-sesion-date">
              <b className="fm-mono">{fmtFecha(s.fecha)}</b>
              <span className="muted">2026</span>
            </div>
            <div className="pc-sesion-body">
              <div className="pc-sesion-title">
                <b>Sesión {PLAN.sesiones.length - i}</b>
                <span className="muted">· {s.servicio}</span>
                <span className="fi-pill fi-pill--mute fm-mono">{s.dur} min</span>
              </div>
              <p>{s.cambio}</p>
              {s.vertebras.length ? (
                <div className="pc-sesion-tags">
                  {s.vertebras.map((v) => (
                    <span key={v} className="fi-pill fi-pill--mute fm-mono">{v}</span>
                  ))}
                </div>
              ) : null}
            </div>
            <button type="button" className="pc-link">Ver detalle</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabDocumentos() {
  return (
    <div className="fi-empty" style={{ marginTop: 16 }}>
      <div className="fi-empty-glyph">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="3" width="14" height="18" rx="2.5" />
          <path d="M9 8h6M9 12h6M9 16h4" />
        </svg>
      </div>
      <h2>Sin documentos adjuntos.</h2>
      <p>Subí RMN, estudios o consentimientos para tener todo del paciente en un lugar.</p>
      <div className="fi-empty-actions">
        <button type="button" className="fi-btn fi-btn-secondary">
          <I.Plus size={13} /> Subir documento
        </button>
      </div>
    </div>
  );
}

// ─── Header del paciente ──────────────────────────────────────────────────

function PacienteHeader() {
  return (
    <header className="pc-head">
      <Link href="/pacientes" className="pc-back">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Pacientes
      </Link>
      <div className="pc-id-row">
        <div className="fi-avatar pc-avatar">{iniciales(PACIENTE_DETALLE.nombre)}</div>
        <div className="pc-id-body">
          <h1>{PACIENTE_DETALLE.nombre}</h1>
          <div className="pc-id-meta">
            <span className="fi-pill fi-pill--mute">
              {PACIENTE_DETALLE.tipo === "nuevo"
                ? "1ª visita"
                : `${PACIENTE_DETALLE.sesiones}ª sesión`}
            </span>
            {PACIENTE_DETALLE.tags.includes("VIP") ? (
              <span className="fi-pill fi-pill--vip">VIP</span>
            ) : null}
            <span className="muted">Cumple 18 may</span>
            <span className="muted">·</span>
            <span className="muted">Última visita {fmtFecha("2026-05-06")}</span>
          </div>
        </div>
        <div className="pc-actions">
          <button type="button" className="fi-btn fi-btn-ghost">
            <I.Phone size={13} /> WhatsApp
          </button>
          <button type="button" className="fi-btn fi-btn-secondary">
            <I.Calendar size={13} /> Sacar turno
          </button>
        </div>
      </div>
    </header>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────

export function PacienteDetalle() {
  const [tab, setTab] = useState<TabId>("plan");

  const tabs: [TabId, string, boolean?][] = [
    ["informacion", "Información"],
    ["plan", "Plan", true],
    ["sesiones", `Sesiones (${PLAN.sesiones.length})`],
    ["documentos", "Documentos"],
  ];

  return (
    <div className="fi-content pc-content">
      <PacienteHeader />

      <nav className="pc-tabs">
        {tabs.map(([id, lbl, isModule]) => (
          <button
            key={id}
            type="button"
            className={"pc-tab " + (tab === id ? "is-active" : "")}
            onClick={() => setTab(id)}
          >
            {lbl}
            {isModule && tab !== id ? <span className="pc-tab-dot" /> : null}
          </button>
        ))}
      </nav>

      {tab === "informacion" ? <TabInformacion /> : null}
      {tab === "plan" ? <TabPlan /> : null}
      {tab === "sesiones" ? <TabSesiones /> : null}
      {tab === "documentos" ? <TabDocumentos /> : null}
    </div>
  );
}
