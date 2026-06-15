"use client";

/**
 * Folio · /pacientes/[id] · ficha completa con tabs.
 *
 * Port de folio/paciente.jsx (líneas 283-648). El tab por defecto es "plan"
 * (el slot clínico renderiza la herramienta de la especialidad de la org vía
 * lib/especialidades/registry — Fase B) para que el baseline pixel-perfect
 * matchee. Cada tab tiene su propio sub-componente.
 *
 * El auto-save indicator del SOAP usa el clock del browser (mockeado en tests
 * con page.clock.install para determinismo).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import * as I from "@/components/icons";
import { saveSesionFichaAction, saveSesionYCerrarAction } from "@/app/(app)/pacientes/actions";
import { TurnoCreateModal } from "@/components/hoy/turno-create-modal";
import { PacienteFichaProvider, usePacienteFicha } from "@/components/paciente/contexto";
import { IntakeAvanzadoModal } from "@/components/paciente/intake-avanzado-modal";
import { PlanTratamientoModal } from "@/components/paciente/plan-tratamiento-modal";
import {
  filtrarToolHistorial,
  getEspecialidad,
  getIntakeAvanzadoConfig,
  type EspecialidadSlug,
} from "@/lib/especialidades/registry";
import { toWhatsappE164 } from "@/lib/format/phone";
import type { IntakeAvanzadoFicha, PacienteFichaInfo, PlanData } from "@/lib/db/paciente-ficha";

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

function SoapStacked({
  soap,
  setSoap,
  saveBadge,
}: {
  soap: SoapState;
  setSoap: (s: SoapState) => void;
  /** Indicador de guardado (lo pasa TabPlan cuando hay turno en curso). */
  saveBadge?: ReactNode;
}) {
  // El borrador se persiste con "Guardar sesión" (TabPlan) cuando el paciente
  // tiene un turno en curso. Sin turno en curso no hay sesión contra la cual
  // guardar (sesion.turno_id UNIQUE) — etiqueta honesta "Borrador local".
  return (
    <div className="pc-soap">
      <header className="pc-soap-head">
        <span className="fi-eyebrow">Nota SOAP · sesión de {TURNO_HOY_HORA}</span>
        {saveBadge ?? (
          <span
            className="fm-save"
            title="No hay un turno en curso para este paciente — editás localmente. Iniciá la atención desde /hoy para poder guardar la sesión."
          >
            Borrador local
          </span>
        )}
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
            onChange={(e) => setSoap({ ...soap, [s.id]: e.target.value })}
            placeholder={`Escribí el ${s.label.toLowerCase()}…`}
            aria-label={`${s.label} — nota SOAP. ${s.hint}`}
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
  const { paciente, plan } = usePacienteFicha();
  const [editOpen, setEditOpen] = useState(false);
  const pct = plan.total > 0 ? Math.round((plan.completadas / plan.total) * 100) : 0;
  return (
    <section className="pc-card pc-plan">
      <header className="pc-card-head">
        <span className="fi-eyebrow">Plan de tratamiento</span>
        <button
          type="button"
          className="pc-link"
          onClick={() => setEditOpen(true)}
          title="Editar objetivos, frecuencia y diagnóstico del plan"
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

      {editOpen ? (
        <PlanTratamientoModal
          pacienteId={paciente.id}
          prefill={plan.planEditable}
          onClose={() => setEditOpen(false)}
        />
      ) : null}
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
  const { paciente, plan, especialidad } = usePacienteFicha();
  const def = getEspecialidad(especialidad);
  const router = useRouter();
  const turnoActivo = plan.turnoActivo;

  // Workstream 6 · la ficha quiropraxia v2 reemplaza el SOAP: la Tool ocupa todo
  // el ancho (sin la grilla 380px) y NO se rinde <SoapStacked>. Cardio/psico
  // siguen con la grilla + SOAP, exactamente igual que antes.
  const hideSoap = especialidad === "quiropraxia";

  // Props OPCIONALES nuevas (Workstream 6) — inofensivas para cardio/psico, que
  // las ignoran. La Tool quiro las usa para radiografías + carry-forward.
  const toolExtras = {
    pacienteId: paciente.id,
    turno: turnoActivo ? { id: turnoActivo.id, tieneSesionGuardada: turnoActivo.tieneSesionGuardada } : null,
    radiografias: plan.radiografias,
    // Cardiología la usa en el score de riesgo CV (≥60 suma); quiro/psico la ignoran.
    edad: paciente.edad > 0 ? paciente.edad : undefined,
  };

  // Borrador local del toolData de la herramienta. Si el turno en curso ya
  // tiene sesión guardada, re-hidrata desde ahí: el writer sobreescribe las
  // columnas tool en cada guardado re-hidratable, así que "guardar solo SOAP"
  // después no debe pisar la herramienta con null. Si toolDraft vino null por
  // un tool_id de OTRA especialidad, el writer preserva esas columnas en los
  // guardados solo-SOAP (debePreservarToolData, lib/db/sesiones.ts).
  const [toolValue, setToolValue] = useState<unknown>(turnoActivo?.toolDraft ?? null);
  const [soap, setSoap] = useState<SoapState>(plan.soap);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleGuardar = async () => {
    if (!turnoActivo || saving) return;
    setSaving(true);
    setSaveError(null);
    const result = await saveSesionFichaAction({
      turnoId: turnoActivo.id,
      pacienteId: paciente.id,
      toolValue,
      soap,
    });
    setSaving(false);
    if (result.ok) {
      const d = new Date();
      setSavedAt(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
      // La vuelta: refresca el Server Component → plan.toolHistorial trae la
      // sesión recién guardada (el borrador local no se resetea: useState).
      router.refresh();
    } else {
      setSaveError(`No se pudo guardar: ${result.error.message}`);
    }
  };

  // "Guardar y cerrar": persiste la sesión Y cierra el turno (ATENDIENDO →
  // CERRADO) en un solo paso. La action devuelve ok({ cerrado }) — un err
  // significa que el guardado falló; ok({ cerrado: false }) que se guardó pero
  // el cierre no, sin perder el trabajo.
  const handleGuardarYCerrar = async () => {
    if (!turnoActivo || saving) return;
    setSaving(true);
    setSaveError(null);
    const result = await saveSesionYCerrarAction({
      turnoId: turnoActivo.id,
      pacienteId: paciente.id,
      toolValue,
      soap,
    });
    if (result.ok && result.data.cerrado) {
      // Turno cerrado: el lugar natural es la agenda del día (el turno ya no
      // está en curso). No reseteamos `saving` — navegamos fuera de la ficha.
      router.push("/hoy");
      return;
    }
    setSaving(false);
    if (result.ok) {
      // Sesión guardada pero el cierre falló — copy explícito, el trabajo no se
      // pierde y el turno sigue en curso (se puede reintentar cerrar).
      setSaveError(`Sesión guardada, pero no se pudo cerrar el turno: ${result.data.cierreError ?? "intentá de nuevo."}`);
    } else {
      // El guardado mismo falló: nunca se intentó cerrar.
      setSaveError(`No se pudo guardar: ${result.error.message}`);
    }
  };

  const saveBadge: ReactNode = turnoActivo ? (
    saving ? (
      <span className="fm-save fm-save--saving">
        <span className="fm-save-spinner" />
        Guardando…
      </span>
    ) : savedAt ? (
      <span className="fm-save fm-save--saved">Guardado · {savedAt}</span>
    ) : (
      <span
        className="fm-save"
        title="El borrador se persiste con «Guardar sesión» mientras el turno está en curso."
      >
        Borrador sin guardar
      </span>
    )
  ) : undefined;

  return (
    <div className="pc-plan-tab">
      <div className="pc-module-badge">
        <def.Icon size={14} />
        <span>{def.badgeLabel}</span>
      </div>

      {/* Sin turno en curso no hay sesión contra la cual guardar (sesion.turno_id
          UNIQUE): la herramienta se rinde en modo lectura y un aviso honesto
          explica el porqué + cómo habilitar el guardado. Genérico para todas las
          especialidades (la Tool respeta `readOnly` vía SpecialtyToolProps). */}
      {!turnoActivo ? (
        <div className="pc-sin-turno" role="note">
          <I.Lock size={14} aria-hidden />
          <p>
            No hay un turno en curso para este paciente. Iniciá la atención desde{" "}
            <Link href="/hoy" className="pc-link">/hoy</Link>{" "}
            (o sacá un turno) para registrar y guardar la sesión.
          </p>
        </div>
      ) : null}

      {/* M55 · la Tool recibe SOLO el historial de SU tool_id (legacy NULL
          cuenta como quiropraxia): en fichas mixtas (cardio + psico) cada
          herramienta ve sus propias sesiones. El resumen por sesión de
          HistorialReciente/TabSesiones sigue siendo por tool_id persistido.
          readOnly cuando no hay turno activo: editar un borrador que no se
          puede guardar sería engañoso.
          Workstream 6 · quiropraxia (hideSoap) rinde la Tool a ancho completo y
          omite el SOAP; el resto conserva la grilla 380px + SOAP. */}
      {hideSoap ? (
        <def.Tool
          value={toolValue}
          onChange={setToolValue}
          readOnly={!turnoActivo}
          historial={filtrarToolHistorial(plan.toolHistorial, especialidad)}
          {...toolExtras}
        />
      ) : (
        <div className="pc-plan-grid">
          <def.Tool
            value={toolValue}
            onChange={setToolValue}
            readOnly={!turnoActivo}
            historial={filtrarToolHistorial(plan.toolHistorial, especialidad)}
            {...toolExtras}
          />
          <SoapStacked soap={soap} setSoap={setSoap} saveBadge={saveBadge} />
        </div>
      )}

      {/* Sin SoapStacked (quiro) el badge de guardado se muestra acá, alineado
          al bloque de acciones de guardado de abajo. */}
      {hideSoap && saveBadge ? (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>{saveBadge}</div>
      ) : null}

      {turnoActivo ? (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
          {saveError ? (
            <span role="alert" style={{ color: "var(--red)", fontSize: 12.5 }}>
              {saveError}
            </span>
          ) : null}
          <button
            type="button"
            className="fi-btn fi-btn-secondary"
            onClick={() => {
              void handleGuardar();
            }}
            disabled={saving}
            aria-busy={saving}
            title="Guarda la herramienta y el SOAP como la sesión de este turno (editable hasta el cierre)"
          >
            {saving ? "Guardando…" : "Guardar sesión"}
          </button>
          {/* "Guardar y cerrar": solo con el turno ya EN ATENCIÓN (ATENDIENDO →
              CERRADO). En EN_SALA todavía no arrancó la atención, así que solo
              se ofrece "Guardar sesión" (el cierre lo hace "Abrir ficha" → ...
              → "Cerrar turno" / esta acción una vez en curso). */}
          {turnoActivo.estado === "ATENDIENDO" ? (
            <button
              type="button"
              className="fi-btn fi-btn-primary"
              onClick={() => {
                void handleGuardarYCerrar();
              }}
              disabled={saving}
              aria-busy={saving}
              title="Guarda la sesión y cierra el turno (suma a la recaudación del día)"
            >
              {saving ? "Guardando…" : "Guardar y cerrar"}
            </button>
          ) : null}
        </div>
      ) : null}

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
          <dt>Ocupación</dt>
          <dd>{paciente.ocupacion || "—"}</dd>
          <dt>Recomendado por</dt>
          <dd>{paciente.recomendadoPor || "—"}</dd>
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
      <InfoAvanzada />
    </div>
  );
}

// ─── Sub: Información avanzada por especialidad (read-only + editar) ──────────

function InfoAvanzada() {
  const { paciente, especialidad, intakeAvanzado } = usePacienteFicha();
  const [editOpen, setEditOpen] = useState(false);

  // Los campos/labels salen del config de la especialidad ACTIVA. Mostramos
  // todos los campos del config con su valor (o "—" si no está) para que la
  // ficha refleje la anamnesis completa de esa especialidad.
  const campos = getIntakeAvanzadoConfig(especialidad).campos;
  const datos = intakeAvanzado?.datos ?? {};

  return (
    <section className="pc-card">
      <header className="pc-card-head">
        <span className="fi-eyebrow">Información avanzada</span>
        <button
          type="button"
          className="pc-link"
          onClick={() => setEditOpen(true)}
          title="Editar los antecedentes de esta especialidad"
        >
          Editar
        </button>
      </header>
      {campos.length === 0 ? (
        <p className="pc-card-text muted">No hay campos avanzados para esta especialidad.</p>
      ) : (
        <dl className="pc-dl">
          {campos.map((campo) => (
            <FragmentCampo key={campo.key} label={campo.label} valor={fmtIntakeValor(datos[campo.key])} />
          ))}
        </dl>
      )}

      {editOpen ? (
        <IntakeAvanzadoModal
          pacienteId={paciente.id}
          especialidad={especialidad}
          datos={intakeAvanzado?.datos ?? null}
          onClose={() => setEditOpen(false)}
        />
      ) : null}
    </section>
  );
}

/** Una fila dt/dd del intake avanzado (label + valor formateado). */
function FragmentCampo({ label, valor }: { label: string; valor: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{valor}</dd>
    </>
  );
}

/** Formatea un valor del intake para la vista read-only (es-AR). */
function fmtIntakeValor(value: unknown): string {
  if (value === true) return "Sí";
  if (value === false || value == null) return "—";
  if (typeof value === "string") return value.trim().length > 0 ? value : "—";
  return String(value);
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
  // Normaliza a E.164 AR (54 + 9 móvil + NSN, sin 0/15) para que el deep-link
  // sirva con teléfonos en formato local (auditoría L4).
  const num = toWhatsappE164(telefono);
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
  const [agendarOpen, setAgendarOpen] = useState(false);
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
          <button
            type="button"
            className="fi-btn fi-btn-secondary"
            title="Agendar un nuevo turno para este paciente"
            onClick={() => setAgendarOpen(true)}
          >
            <I.Calendar size={13} /> Sacar turno
          </button>
        </div>
      </div>

      {agendarOpen ? (
        <TurnoCreateModal
          origen="MANUAL"
          preselectPacienteId={paciente.id}
          onClose={() => setAgendarOpen(false)}
          onCreated={() => {
            setAgendarOpen(false);
            // El nuevo turno aparece en /hoy si es hoy, sino en /calendario.
            // Acá no necesitamos refrescar la ficha — el plan/sesiones se
            // actualizan cuando el turno se cierra (cron + transición).
          }}
        />
      ) : null}
    </header>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────

interface PacienteDetalleProps {
  paciente: PacienteFichaInfo;
  plan: PlanData;
  cumple: string;
  /** Especialidad de la org (M50) — el server component la saca del contexto activo. */
  especialidad: EspecialidadSlug;
  /** Workstream 5 · intake avanzado de la especialidad activa (M60) o null. */
  intakeAvanzado: IntakeAvanzadoFicha | null;
}

export function PacienteDetalle({
  paciente,
  plan,
  cumple,
  especialidad,
  intakeAvanzado,
}: PacienteDetalleProps) {
  return (
    <PacienteFichaProvider value={{ paciente, plan, cumple, especialidad, intakeAvanzado }}>
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

  // Patrón WAI-ARIA Tabs: flechas mueven el foco entre tabs con activación
  // automática (roving tabindex — solo la tab activa es tab-reachable).
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, id: TabId) => {
    const ids = tabs.map(([tid]) => tid);
    const idx = ids.indexOf(id);
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % ids.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + ids.length) % ids.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = ids.length - 1;
    if (nextIdx == null) return;
    e.preventDefault();
    const nextId = ids[nextIdx];
    setTab(nextId);
    document.getElementById(`pc-tab-${nextId}`)?.focus();
  };

  const panelProps = (id: TabId) => ({
    role: "tabpanel" as const,
    id: `pc-panel-${id}`,
    "aria-labelledby": `pc-tab-${id}`,
    tabIndex: 0,
  });

  return (
    <div className="fi-content pc-content">
      <PacienteHeader />

      <nav className="pc-tabs" role="tablist" aria-label="Secciones de la ficha">
        {tabs.map(([id, lbl, isModule]) => (
          <button
            key={id}
            id={`pc-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`pc-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={"pc-tab " + (tab === id ? "is-active" : "")}
            onClick={() => setTab(id)}
            onKeyDown={(e) => onTabKeyDown(e, id)}
          >
            {lbl}
            {isModule && tab !== id ? <span className="pc-tab-dot" aria-hidden /> : null}
          </button>
        ))}
      </nav>

      {tab === "informacion" ? (
        <div {...panelProps("informacion")}>
          <TabInformacion />
        </div>
      ) : null}
      {tab === "plan" ? (
        <div {...panelProps("plan")}>
          <TabPlan />
        </div>
      ) : null}
      {tab === "sesiones" ? (
        <div {...panelProps("sesiones")}>
          <TabSesiones />
        </div>
      ) : null}
      {tab === "documentos" ? (
        <div {...panelProps("documentos")}>
          <TabDocumentos />
        </div>
      ) : null}
    </div>
  );
}
