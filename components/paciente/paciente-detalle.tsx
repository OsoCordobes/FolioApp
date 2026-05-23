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
import { PacienteFichaProvider, usePacienteFicha } from "@/components/paciente/contexto";
import type { EstadoVertebra, PacienteFichaInfo, PlanData } from "@/lib/db/paciente-ficha";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtFecha(iso: string): string {
  if (!iso || iso === "—") return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

function iniciales(nombre: string): string {
  return nombre.split(" ").map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
}

const TURNO_HOY_HORA = "hoy";

type TabId = "informacion" | "plan" | "sesiones" | "documentos";

// ─── Sub: SOAP stacked ─────────────────────────────────────────────────────

const SOAP_SECTIONS = [
  { id: "subjetivo" as const, label: "Subjetivo", hint: "Lo que cuenta el paciente." },
  { id: "objetivo"  as const, label: "Objetivo",  hint: "Lo que observás vos." },
  { id: "analisis"  as const, label: "Análisis",  hint: "Interpretación clínica." },
  { id: "plan"      as const, label: "Plan",      hint: "Próximos pasos." },
];

type SoapState = PlanData["soap"];
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
  const { plan } = usePacienteFicha();
  const pct = plan.total > 0 ? Math.round((plan.completadas / plan.total) * 100) : 0;
  return (
    <section className="pc-card pc-plan">
      <header className="pc-card-head">
        <span className="fi-eyebrow">Plan de tratamiento</span>
        <button
          type="button"
          className="pc-link"
          disabled
          title="Próximamente — editá desde Configuración o agregá nota en Sesiones"
          aria-disabled="true"
        >
          Editar
        </button>
      </header>
      <div className="pc-plan-progress">
        <div className="pc-plan-progress-row">
          <span className="pc-plan-num">
            <b>{plan.completadas}</b>
            <small>/ {plan.total}</small>
          </span>
          <span className="pc-plan-num-lbl">sesiones</span>
          <span className="pc-plan-pct fm-mono">{pct}%</span>
        </div>
        <div className="pc-plan-bar">
          <div className="pc-plan-bar-fill" style={{ width: pct + "%" }} />
          <div className="pc-plan-bar-segs">
            {Array.from({ length: plan.total }, (_, i) => (
              <span key={i} className={"pc-plan-seg " + (i < plan.completadas ? "is-done" : "")} />
            ))}
          </div>
        </div>
      </div>
      <div className="pc-plan-meta">
        <div>
          <span className="muted">Frecuencia</span>
          <b>{plan.frecuencia}</b>
        </div>
        <div>
          <span className="muted">Próximo control</span>
          <b>{fmtFecha(plan.proximoControl)}</b>
        </div>
        <div>
          <span className="muted">Diagnóstico</span>
          <b>{plan.diagnostico}</b>
        </div>
      </div>
    </section>
  );
}

// ─── Sub: Historial reciente ───────────────────────────────────────────────

function HistorialReciente() {
  const { plan } = usePacienteFicha();
  const [expanded, setExpanded] = useState(false);
  const visibles = expanded ? plan.sesiones : plan.sesiones.slice(0, 4);

  return (
    <section className="pc-card pc-historial">
      <header className="pc-card-head">
        <span className="fi-eyebrow">Historial reciente</span>
        <button type="button" className="pc-link" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Mostrar menos" : `Ver todas (${plan.sesiones.length})`}
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
  const { plan } = usePacienteFicha();
  const [vertStates, setVertStates] = useState<Record<string, EstadoVertebra>>(
    plan.vertebrasEstado,
  );
  const [soap, setSoap] = useState<SoapState>(plan.soap);

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
  const { paciente, cumple } = usePacienteFicha();
  return (
    <div className="pc-info-grid">
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Contacto</span>
          <button
          type="button"
          className="pc-link"
          disabled
          title="Próximamente — editá desde Configuración o agregá nota en Sesiones"
          aria-disabled="true"
        >
          Editar
        </button>
        </header>
        <dl className="pc-dl">
          <dt>Teléfono</dt>
          <dd className="fm-mono">{paciente.tel || "—"}</dd>
          <dt>Email</dt>
          <dd>{paciente.email || "—"}</dd>
          <dt>Cumpleaños</dt>
          <dd>{cumple}</dd>
          <dt>Obra social</dt>
          <dd>Particular</dd>
        </dl>
      </section>
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Motivo de consulta</span>
        </header>
        <p className="pc-card-text">{paciente.motivo || "—"}</p>
        <div className="pc-tags">
          {paciente.tags.map((t) => (
            <span key={t} className="fi-pill fi-pill--mute">{t}</span>
          ))}
        </div>
      </section>
      <section className="pc-card pc-info-notes">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Notas internas</span>
        </header>
        <p className="pc-card-text muted">
          {paciente.notasImportantes || "Sin notas registradas todavía."}
        </p>
      </section>
    </div>
  );
}

function TabSesiones() {
  const { plan } = usePacienteFicha();
  return (
    <div className="pc-sesiones">
      <div className="pc-sesiones-toolbar">
        <span className="fi-eyebrow">
          {plan.sesiones.length} sesiones · desde {fmtFecha(plan.inicio)}
        </span>
        <button
          type="button"
          className="fi-btn fi-btn-secondary"
          disabled
          title="Próximamente — las sesiones se generan al cerrar un turno desde /hoy"
          aria-disabled="true"
        >
          <I.Plus size={12} /> Nueva sesión
        </button>
      </div>
      <div className="pc-sesiones-list">
        {plan.sesiones.map((s, i) => (
          <div key={s.fecha} className="pc-sesion-row">
            <div className="pc-sesion-date">
              <b className="fm-mono">{fmtFecha(s.fecha)}</b>
              <span className="muted">2026</span>
            </div>
            <div className="pc-sesion-body">
              <div className="pc-sesion-title">
                <b>Sesión {plan.sesiones.length - i}</b>
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
            <button
              type="button"
              className="pc-link"
              disabled
              title="Próximamente — vista detallada de cada sesión"
              aria-disabled="true"
            >
              Ver detalle
            </button>
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
        <button
          type="button"
          className="fi-btn fi-btn-secondary"
          disabled
          title="Próximamente — Supabase Storage cifrado con audit log automático"
          aria-disabled="true"
        >
          <I.Plus size={13} /> Subir documento
        </button>
      </div>
    </div>
  );
}

// ─── Header del paciente ──────────────────────────────────────────────────

function PacienteWhatsAppButton({ telefono, nombre }: { telefono: string; nombre: string }) {
  const num = telefono.replace(/[^0-9]/g, "");
  if (!num) {
    return (
      <button
        type="button"
        className="fi-btn fi-btn-ghost"
        disabled
        title="Este paciente no tiene teléfono cargado"
        style={{ opacity: 0.5 }}
      >
        <I.Phone size={13} /> WhatsApp
      </button>
    );
  }
  return (
    <a
      href={`https://wa.me/${num}`}
      target="_blank"
      rel="noopener noreferrer"
      className="fi-btn fi-btn-ghost"
      title={`Abrir WhatsApp con ${nombre}`}
    >
      <I.Phone size={13} /> WhatsApp
    </a>
  );
}

function PacienteHeader() {
  const { paciente, plan, cumple } = usePacienteFicha();
  const ultimaVisita = plan.sesiones[0]?.fecha ?? null;
  return (
    <header className="pc-head">
      <Link href="/pacientes" className="pc-back">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Pacientes
      </Link>
      <div className="pc-id-row">
        <div className="fi-avatar pc-avatar">{iniciales(paciente.nombre)}</div>
        <div className="pc-id-body">
          <h1>{paciente.nombre}</h1>
          <div className="pc-id-meta">
            <span className="fi-pill fi-pill--mute">
              {paciente.tipo === "nuevo"
                ? "1ª visita"
                : `${paciente.sesiones}ª sesión`}
            </span>
            {paciente.tags.includes("VIP") ? (
              <span className="fi-pill fi-pill--vip">VIP</span>
            ) : null}
            <span className="muted">Cumple {cumple}</span>
            {ultimaVisita ? (
              <>
                <span className="muted">·</span>
                <span className="muted">Última visita {fmtFecha(ultimaVisita)}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="pc-actions">
          <PacienteWhatsAppButton telefono={paciente.tel} nombre={paciente.nombre} />
          <a
            href={`/calendario?paciente=${encodeURIComponent(paciente.id)}`}
            className="fi-btn fi-btn-secondary"
            title="Agendar un nuevo turno para este paciente"
          >
            <I.Calendar size={13} /> Sacar turno
          </a>
        </div>
      </div>
    </header>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────

interface PacienteDetalleProps {
  paciente: PacienteFichaInfo;
  plan: PlanData;
  cumple: string;
}

export function PacienteDetalle({ paciente, plan, cumple }: PacienteDetalleProps) {
  return (
    <PacienteFichaProvider value={{ paciente, plan, cumple }}>
      <PacienteDetalleInner />
    </PacienteFichaProvider>
  );
}

function PacienteDetalleInner() {
  const { plan } = usePacienteFicha();
  const [tab, setTab] = useState<TabId>("plan");

  const tabs: [TabId, string, boolean?][] = [
    ["informacion", "Información"],
    ["plan", "Plan", true],
    ["sesiones", `Sesiones (${plan.sesiones.length})`],
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
