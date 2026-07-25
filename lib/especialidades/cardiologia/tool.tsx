"use client";

/**
 * Folio · especialidades · cardiología · Tool del slot clínico (Fase D).
 *
 * Dos paneles apilados en la columna del slot (pc-plan-grid, 380px):
 *   1. Panel cardiovascular — TA sistólica/diastólica (mmHg) y FC (lpm) de la
 *      sesión, checklist de factores de riesgo con chip de riesgo ORIENTATIVO
 *      (scoreRiesgoCV — conteo simplificado OMS/OPS, no diagnóstico) y curva
 *      de evolución TA/FC sobre el historial (SVG sparkline con tokens).
 *   2. Estudios — historial tipado (ECG/Eco/Ergometría/Holter/Laboratorio) en
 *      solo lectura + alta de estudios en el borrador de la sesión en curso.
 *
 * Controlado por el slot: deriva TODO de `value` (toolData del borrador) y
 * notifica cada edición con `onChange(next)`. Borrador sin contenido → null
 * (el writer persiste tool_data NULL — ver lib/especialidades/draft.ts).
 * `historial` es solo lectura. PHI: nunca se loguea contenido clínico.
 *
 * Estilos: clases existentes de folio.css (pc-card / fi-eyebrow / fi-wi-field /
 * fm-modal-check / fi-pill / pc-legend-*) + tokens en estilos inline puntuales.
 */

import { useMemo, useState, type CSSProperties } from "react";

import * as I from "@/components/icons";
import type { SpecialtyToolProps } from "@/lib/especialidades/types";
import { EstudiosAdjuntos } from "@/lib/especialidades/cardiologia/estudios-adjuntos";
import {
  CONCLUSION_LABELS,
  CONCLUSIONES_ESTUDIO,
  deriveCardioSeries,
  ESTADO_MEDICACION_LABELS,
  ESTADOS_MEDICACION,
  FACTOR_LABELS,
  FACTORES_RIESGO,
  RANGOS_PANEL,
  scoreRiesgoCV,
  TIPOS_ESTUDIO,
  URGENCIA_DERIVACION_LABELS,
  URGENCIAS_DERIVACION,
  VITAL_LABELS,
  extractDerivacion,
  extractEstudios,
  extractMedicacion,
  type CampoVital,
  type CardioSeriesPoint,
  type CardiologiaToolDataV3,
  type ConclusionEstudio,
  type DerivacionCardio,
  type EstadoMedicacion,
  type EstudioCardio,
  type FactorRiesgo,
  type MedicamentoCardio,
  type NivelRiesgoCV,
  type TipoEstudio,
  type UrgenciaDerivacion,
} from "@/lib/especialidades/cardiologia/schema";

// ─── Helpers de presentación (tokens, sin hex off-theme) ────────────────────

const CHIP_RIESGO: Record<NivelRiesgoCV, CSSProperties> = {
  bajo: { color: "var(--green)", background: "var(--green-soft)", borderColor: "transparent" },
  moderado: { color: "var(--amber)", background: "var(--amber-soft)", borderColor: "transparent" },
  alto: { color: "var(--red)", background: "var(--red-soft)", borderColor: "transparent" },
};

const CHIP_CONCLUSION: Record<ConclusionEstudio, CSSProperties> = {
  normal: { color: "var(--green)", background: "var(--green-soft)", borderColor: "transparent" },
  anormal: { color: "var(--red)", background: "var(--red-soft)", borderColor: "transparent" },
  requiere_seguimiento: {
    color: "var(--amber)",
    background: "var(--amber-soft)",
    borderColor: "transparent",
  },
};

/** Chip de conteo de medicación activa (v3). */
const CHIP_MED_ACTIVA: CSSProperties = {
  color: "var(--green)",
  background: "var(--green-soft)",
  borderColor: "transparent",
};

/** Chip de estado por fármaco. */
const CHIP_ESTADO_MED: Record<EstadoMedicacion, CSSProperties> = {
  activa: { color: "var(--green)", background: "var(--green-soft)", borderColor: "transparent" },
  suspendida: { color: "var(--slate)", background: "var(--slate-soft)", borderColor: "transparent" },
};

/** Chip de urgencia de la derivación (v3). */
const CHIP_URGENCIA: Record<UrgenciaDerivacion, CSSProperties> = {
  programada: { color: "var(--slate)", background: "var(--slate-soft)", borderColor: "transparent" },
  preferente: { color: "var(--amber)", background: "var(--amber-soft)", borderColor: "transparent" },
  urgente: { color: "var(--red)", background: "var(--red-soft)", borderColor: "transparent" },
};

/** Cantidad de fármacos con estado activo en un esquema. */
function medicacionActivas(meds: MedicamentoCardio[]): number {
  return meds.filter((m) => m.estado === "activa").length;
}

/** Mismo look que los inputs de .fi-wi-field (folio.css no estila selects). */
const SELECT_STYLE: CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-sm)",
  font: "inherit",
  fontSize: 13.5,
  color: "var(--ink)",
  lineHeight: 1.5,
};

/** Vitales primarios (TA/FC) — fila superior del panel. */
const VITALES_TA_FC: Array<{ campo: CampoVital; label: string }> = [
  { campo: "taSistolica", label: VITAL_LABELS.taSistolica },
  { campo: "taDiastolica", label: VITAL_LABELS.taDiastolica },
  { campo: "fc", label: VITAL_LABELS.fc },
];

/** Vitales extra (v2, C5): antropometría/oximetría/glucemia — segunda fila. */
const VITALES_EXTRA: Array<{ campo: CampoVital; label: string }> = [
  { campo: "peso", label: VITAL_LABELS.peso },
  { campo: "talla", label: VITAL_LABELS.talla },
  { campo: "satO2", label: VITAL_LABELS.satO2 },
  { campo: "glucemia", label: VITAL_LABELS.glucemia },
];

/** Todos los vitales del panel v2 (para el chequeo de rango). */
const VITALES: Array<{ campo: CampoVital; label: string }> = [
  ...VITALES_TA_FC,
  ...VITALES_EXTRA,
];

function hoyISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MESES[m - 1]} ${String(y).slice(2)}`;
}

// ─── Borrador (controlado desde value) ──────────────────────────────────────

/**
 * Parse LAXO del borrador a un shape v3 (C6): tolera vitales fuera de rango
 * (valores intermedios mientras se tipea — el schema estricto los rechazaría y
 * resetearía el borrador en cada render), shapes parciales re-hidratados y
 * sesiones LEGACY v1/v2 (que se leen igual: sus campos son un subset de v3, así
 * que el borrador arranca en v3 sin migración de datos). Medicación y derivación
 * (v3) se leen con los extractores del schema (validan item a item / bloque).
 * La validación estricta (cardiologiaToolDataV3Schema) la aplica el writer antes
 * de cifrar; la UI avisa con el hint de "fuera de rango".
 */
function parseDraft(value: unknown): CardiologiaToolDataV3 {
  const out: CardiologiaToolDataV3 = { v: 3 };
  if (value === null || typeof value !== "object") return out;

  const rawPanel = (value as { panel?: unknown }).panel;
  if (rawPanel !== null && typeof rawPanel === "object") {
    const p = rawPanel as Record<string, unknown>;
    const panel: NonNullable<CardiologiaToolDataV3["panel"]> = {};
    for (const campo of Object.keys(RANGOS_PANEL) as CampoVital[]) {
      const n = p[campo];
      if (typeof n === "number" && Number.isFinite(n)) panel[campo] = Math.round(n);
    }
    const rawFactores = p.factores;
    if (rawFactores !== null && typeof rawFactores === "object") {
      const f: NonNullable<NonNullable<CardiologiaToolDataV3["panel"]>["factores"]> = {};
      for (const k of FACTORES_RIESGO) {
        if ((rawFactores as Record<string, unknown>)[k] === true) f[k] = true;
      }
      if (FACTORES_RIESGO.some((k) => f[k] === true)) panel.factores = f;
    }
    if (Object.keys(panel).length > 0) out.panel = panel;
  }

  const estudios = extractEstudios(value);
  if (estudios.length > 0) out.estudios = estudios;

  // v3 · medicación (validada item a item) + derivación (validada como bloque).
  const medicacion = extractMedicacion(value);
  if (medicacion.length > 0) out.medicacion = medicacion;
  const derivacion = extractDerivacion(value);
  if (derivacion) out.derivacion = derivacion;

  return out;
}

/**
 * Normaliza el borrador antes de emitirlo: factores sin ninguno marcado →
 * fuera; panel sin claves → fuera; estudios/medicación vacíos → fuera;
 * derivación sin motivo → fuera; todo vacío → null (el writer guarda tool_data
 * NULL, no un `{ v: 3 }` cifrado sin contenido).
 */
function limpiarDraft(next: CardiologiaToolDataV3): CardiologiaToolDataV3 | null {
  const panel = next.panel ? { ...next.panel } : undefined;
  if (panel) {
    if (panel.factores && !FACTORES_RIESGO.some((f) => panel.factores?.[f] === true)) {
      delete panel.factores;
    }
    for (const k of Object.keys(panel) as Array<keyof typeof panel>) {
      if (panel[k] === undefined) delete panel[k];
    }
  }
  const out: CardiologiaToolDataV3 = { v: 3 };
  if (panel && Object.keys(panel).length > 0) out.panel = panel;
  if (next.estudios && next.estudios.length > 0) out.estudios = next.estudios;
  if (next.medicacion && next.medicacion.length > 0) out.medicacion = next.medicacion;
  // Derivación sólo se conserva si tiene motivo (lo único requerido del bloque).
  if (next.derivacion && next.derivacion.motivo.trim() !== "") out.derivacion = next.derivacion;
  return out.panel || out.estudios || out.medicacion || out.derivacion ? out : null;
}

// ─── Sparkline de evolución TA/FC ───────────────────────────────────────────

const METRICAS_SERIE = [
  { key: "taS" as const, label: "TA sist.", color: "var(--red)" },
  { key: "taD" as const, label: "TA diast.", color: "var(--amber)" },
  { key: "fc" as const, label: "FC", color: "var(--slate)" },
];

function CardioSparkline({ series }: { series: CardioSeriesPoint[] }) {
  const W = 320;
  const H = 110;
  const PX = 8;
  const PY = 12;

  const valores = series
    .flatMap((p) => [p.taS, p.taD, p.fc])
    .filter((n): n is number => n !== null);

  if (series.length === 0 || valores.length === 0) {
    return (
      <p className="pc-card-text muted" style={{ fontSize: 12.5 }}>
        Sin registros de TA/FC en el historial todavía. La curva aparece al
        guardar sesiones con el panel cargado.
      </p>
    );
  }

  let min = Math.min(...valores);
  let max = Math.max(...valores);
  if (max - min < 10) {
    min -= 5;
    max += 5;
  }
  const x = (i: number) =>
    series.length === 1 ? W / 2 : PX + (i * (W - 2 * PX)) / (series.length - 1);
  const y = (v: number) => H - PY - ((v - min) * (H - 2 * PY)) / (max - min);

  const metricas = METRICAS_SERIE.map((m) => ({
    ...m,
    puntos: series
      .map((p, i) => ({ i, v: p[m.key] }))
      .filter((p): p is { i: number; v: number } => p.v !== null),
  })).filter((m) => m.puntos.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Evolución de tensión arterial y frecuencia cardíaca en ${series.length} ${series.length === 1 ? "sesión" : "sesiones"}`}
        style={{ width: "100%", display: "block" }}
      >
        <line
          x1={PX} y1={H - PY} x2={W - PX} y2={H - PY}
          stroke="var(--line-soft)" strokeWidth="1"
        />
        {metricas.map((m) => (
          <g key={m.key}>
            {m.puntos.length > 1 ? (
              <polyline
                points={m.puntos.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")}
                fill="none"
                stroke={m.color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {m.puntos.map((p, idx) => (
              <circle
                key={p.i}
                cx={x(p.i)}
                cy={y(p.v)}
                r={idx === m.puntos.length - 1 ? 3 : 2}
                fill={m.color}
              />
            ))}
          </g>
        ))}
      </svg>
      <div className="pc-spine-legend" style={{ marginTop: 0, justifyContent: "space-between" }}>
        <span style={{ display: "inline-flex", gap: 12 }}>
          {metricas.map((m) => (
            <span key={m.key} className="pc-legend-item">
              <span className="pc-legend-swatch" style={{ background: m.color }} />
              <span>{m.label}</span>
            </span>
          ))}
        </span>
        <span className="fm-mono muted" style={{ fontSize: 10 }}>
          {fmtFecha(series[0].fecha)}
          {series.length > 1 ? ` → ${fmtFecha(series[series.length - 1].fecha)}` : ""}
        </span>
      </div>
    </div>
  );
}

// ─── Fila de estudio (historial y borrador) ─────────────────────────────────

function EstudioRow({
  estudio,
  fechaSesion,
  onQuitar,
}: {
  estudio: EstudioCardio;
  /** Fecha de la sesión que lo registró (solo historial). */
  fechaSesion?: string;
  onQuitar?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        padding: "8px 0",
        borderBottom: "1px solid var(--line-soft)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: 13, color: "var(--ink)" }}>{estudio.tipo}</b>
        <span className="fm-mono muted" style={{ fontSize: 10.5 }}>
          {fmtFecha(estudio.fecha)}
        </span>
        <span className="fi-pill" style={CHIP_CONCLUSION[estudio.conclusion]}>
          {CONCLUSION_LABELS[estudio.conclusion]}
        </span>
        {onQuitar ? (
          <button
            type="button"
            className="pc-link"
            onClick={onQuitar}
            style={{ marginLeft: "auto" }}
            aria-label={`Quitar estudio ${estudio.tipo} del ${fmtFecha(estudio.fecha)}`}
          >
            Quitar
          </button>
        ) : null}
      </div>
      {estudio.hallazgos ? (
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)" }}>
          {estudio.hallazgos}
        </p>
      ) : null}
      {fechaSesion && fechaSesion !== estudio.fecha ? (
        <span className="muted" style={{ fontSize: 10.5 }}>
          Registrado en la sesión del {fmtFecha(fechaSesion)}
        </span>
      ) : null}
    </div>
  );
}

// ─── Fila de medicación (v3) ────────────────────────────────────────────────

function MedRow({
  med,
  onQuitar,
  onToggleEstado,
}: {
  med: MedicamentoCardio;
  onQuitar?: () => void;
  onToggleEstado?: () => void;
}) {
  const detalles = [med.dosis, med.frecuencia].filter((x): x is string => !!x && x.trim() !== "");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        padding: "8px 0",
        borderBottom: "1px solid var(--line-soft)",
        opacity: med.estado === "suspendida" ? 0.68 : 1,
      }}
    >
      <b style={{ fontSize: 13, color: "var(--ink)" }}>{med.droga}</b>
      {detalles.length > 0 ? (
        <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{detalles.join(" · ")}</span>
      ) : null}
      {onToggleEstado ? (
        <button
          type="button"
          className="fi-pill"
          style={{ ...CHIP_ESTADO_MED[med.estado], cursor: "pointer" }}
          onClick={onToggleEstado}
          title="Cambiar estado (activa / suspendida)"
        >
          {ESTADO_MEDICACION_LABELS[med.estado]}
        </button>
      ) : (
        <span className="fi-pill" style={CHIP_ESTADO_MED[med.estado]}>
          {ESTADO_MEDICACION_LABELS[med.estado]}
        </span>
      )}
      {onQuitar ? (
        <button
          type="button"
          className="pc-link"
          onClick={onQuitar}
          style={{ marginLeft: "auto" }}
          aria-label={`Quitar ${med.droga} del esquema`}
        >
          Quitar
        </button>
      ) : null}
    </div>
  );
}

// ─── Derivación read-only (snapshot) ─────────────────────────────────────────

function DerivacionReadonly({ derivacion }: { derivacion: DerivacionCardio }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "var(--ink-2)" }}>
      {derivacion.destinatario ? (
        <span>
          <b style={{ color: "var(--ink)" }}>Para:</b> {derivacion.destinatario}
          {derivacion.especialidad ? ` · ${derivacion.especialidad}` : ""}
        </span>
      ) : derivacion.especialidad ? (
        <span>
          <b style={{ color: "var(--ink)" }}>Especialidad:</b> {derivacion.especialidad}
        </span>
      ) : null}
      <span style={{ whiteSpace: "pre-wrap" }}>{derivacion.motivo}</span>
    </div>
  );
}

// ─── Impresión de la derivación (ventana efímera, sin PHI de otros pacientes) ─

/** Escapa texto para inyectarlo seguro en el HTML de la ventana de impresión. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Membrete del imprimible (D2): identidad del documento clínico. Espejo del
 * FichaPrintHeader de la ficha (consultorio · paciente · fecha) — sin esto la
 * derivación era un papel anónimo, inservible para el receptor.
 */
interface MembreteDerivacion {
  pacienteNombre?: string;
  organizacionNombre?: string;
}

/**
 * Abre la derivación en una ventana nueva (vía Blob URL, sin document.write) y
 * dispara la impresión del navegador. Documento HTML mínimo y autocontenido —
 * sólo el contenido de ESTA derivación, nunca PHI de otros pacientes ni el resto
 * de la ficha. Todo el texto pasa por escapeHtml (defensa XSS). No persiste
 * nada; la derivación estructurada vive en el toolData de la sesión. C6.
 *
 * D2 · membrete: consultorio (header con la línea brass) + paciente + fecha,
 * mismo patrón que FichaPrintHeader. Los colores son los valores canónicos de
 * los tokens de folio.css (#1B1812 --ink, #8A6722 --accent, #DDD5C0 --line;
 * mismos hex fijados en lib/pdf/theme.ts) — la ventana es un documento
 * standalone y no puede resolver var(--*) de la app.
 */
function imprimirDerivacion(
  derivacion: DerivacionCardio | null,
  membrete: MembreteDerivacion = {},
): void {
  if (!derivacion || derivacion.motivo.trim() === "") return;
  if (typeof window === "undefined") return;

  const hoy = new Date().toLocaleDateString("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const fechaLinea = derivacion.fecha ? escapeHtml(derivacion.fecha) : hoy;
  const filas: string[] = [];
  if (membrete.pacienteNombre) {
    filas.push(`<p><strong>Paciente:</strong> ${escapeHtml(membrete.pacienteNombre)}</p>`);
  }
  if (derivacion.destinatario) {
    filas.push(`<p><strong>Para:</strong> ${escapeHtml(derivacion.destinatario)}</p>`);
  }
  if (derivacion.especialidad) {
    filas.push(`<p><strong>Especialidad / servicio:</strong> ${escapeHtml(derivacion.especialidad)}</p>`);
  }
  filas.push(
    `<p><strong>Prioridad:</strong> ${escapeHtml(URGENCIA_DERIVACION_LABELS[derivacion.urgencia])}</p>`,
  );

  const org = membrete.organizacionNombre?.trim() || "Folio";
  const docTitulo = membrete.pacienteNombre
    ? `Derivación / Interconsulta — ${escapeHtml(membrete.pacienteNombre)}`
    : "Derivación / Interconsulta";

  const doc = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Derivación</title>
<style>
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; color: #1B1812; margin: 48px; line-height: 1.6; }
  .membrete { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; border-bottom: 2px solid #8A6722; padding-bottom: 10px; margin-bottom: 20px; }
  .membrete b { font-size: 16px; letter-spacing: -.01em; }
  .membrete span { font-size: 11px; color: #6B6455; }
  h1 { font-size: 19px; letter-spacing: .03em; text-transform: uppercase; margin: 0 0 20px; }
  .body p { margin: 0 0 8px; font-size: 14px; }
  .motivo { margin-top: 20px; white-space: pre-wrap; font-size: 14px; border-top: 1px solid #DDD5C0; padding-top: 14px; }
  .foot { margin-top: 64px; font-size: 12px; color: #6B6455; }
  @media print { body { margin: 24mm; } }
</style></head>
<body onload="setTimeout(function(){window.print()},250)">
  <div class="membrete"><b>${escapeHtml(org)}</b><span>Fecha: ${fechaLinea}</span></div>
  <h1>${docTitulo}</h1>
  <div class="body">${filas.join("")}</div>
  <div class="motivo"><strong>Motivo:</strong><br>${escapeHtml(derivacion.motivo)}</div>
  <div class="foot">Documento generado con Folio. Firma y sello del profesional: _______________________</div>
</body></html>`;

  // Blob URL en vez de document.write: la ventana carga un documento propio,
  // aislado, sin tocar el DOM de la app. Se revoca al rato (la ventana ya cargó).
  const blob = new Blob([doc], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "width=720,height=900");
  if (!win) {
    URL.revokeObjectURL(url);
    return;
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ─── Input de un vital (TA/FC y extra v2) ────────────────────────────────────

/** Un campo numérico de vital, con su rango plausible como min/max del input. */
function VitalInput({
  campo,
  label,
  value,
  onChangeVital,
  readOnly,
}: {
  campo: CampoVital;
  label: string;
  value: number | undefined;
  onChangeVital: (campo: CampoVital, raw: string) => void;
  readOnly?: boolean;
}) {
  return (
    <label className="fi-wi-field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={RANGOS_PANEL[campo].min}
        max={RANGOS_PANEL[campo].max}
        step={1}
        value={value ?? ""}
        onChange={(e) => onChangeVital(campo, e.target.value)}
        placeholder="—"
        disabled={readOnly}
      />
    </label>
  );
}

// ─── Tool ───────────────────────────────────────────────────────────────────

const NUEVO_ESTUDIO_INICIAL = { tipo: "", fecha: "", hallazgos: "", conclusion: "" };
const NUEVO_MED_INICIAL = { droga: "", dosis: "", frecuencia: "", estado: "activa" as EstadoMedicacion };

export function CardiologiaTool({
  value,
  onChange,
  readOnly,
  historial,
  edad,
  pacienteId,
  turno,
  estudiosAdjuntos,
  pacienteNombre,
  organizacionNombre,
}: SpecialtyToolProps) {
  const draft = useMemo(() => parseDraft(value), [value]);
  const series = useMemo(() => deriveCardioSeries(historial), [historial]);
  const estudiosHistorial = useMemo(() => {
    const out: Array<{ estudio: EstudioCardio; fechaSesion: string }> = [];
    for (const entry of historial) {
      for (const e of extractEstudios(entry.toolData)) {
        out.push({ estudio: e, fechaSesion: entry.fecha });
      }
    }
    out.sort((a, b) => b.estudio.fecha.localeCompare(a.estudio.fecha));
    return out;
  }, [historial]);

  // Medicación del historial (la más reciente ANTES de esta sesión): sirve de
  // referencia read-only ("plan vigente al iniciar"). Se toma de la primera
  // sesión del historial (DESC) que tenga medicación.
  const medicacionPrevia = useMemo<MedicamentoCardio[]>(() => {
    for (const entry of historial) {
      const meds = extractMedicacion(entry.toolData);
      if (meds.length > 0) return meds;
    }
    return [];
  }, [historial]);

  // Form local de alta de estudio + de medicación (el resto vive en `value`).
  const [nuevo, setNuevo] = useState(NUEVO_ESTUDIO_INICIAL);
  const [estudiosExpandidos, setEstudiosExpandidos] = useState(false);
  const [nuevoMed, setNuevoMed] = useState(NUEVO_MED_INICIAL);

  const emit = (next: CardiologiaToolDataV3) => {
    if (readOnly) return;
    onChange(limpiarDraft(next));
  };

  // ── Panel CV: vitales ──
  const setVital = (campo: CampoVital, raw: string) => {
    const panel = { ...(draft.panel ?? {}) };
    const num = raw.trim() === "" ? undefined : Number(raw);
    if (num === undefined || !Number.isFinite(num)) {
      delete panel[campo];
    } else {
      panel[campo] = Math.round(num);
    }
    emit({ ...draft, panel });
  };

  const fueraDeRango = VITALES.filter(({ campo }) => {
    const v = draft.panel?.[campo];
    return v != null && (v < RANGOS_PANEL[campo].min || v > RANGOS_PANEL[campo].max);
  });

  // ── Panel CV: factores ──
  const factores = draft.panel?.factores ?? {};
  const nFactores = FACTORES_RIESGO.filter((f) => factores[f] === true).length;
  const riesgo = scoreRiesgoCV(factores, edad);

  const toggleFactor = (f: FactorRiesgo) => {
    const next = { ...factores };
    if (next[f]) delete next[f];
    else next[f] = true;
    emit({ ...draft, panel: { ...(draft.panel ?? {}), factores: next } });
  };

  // ── Estudios: borrador ──
  const estudiosDraft = draft.estudios ?? [];
  const nuevoValido =
    nuevo.tipo !== "" && nuevo.conclusion !== "" && /^\d{4}-\d{2}-\d{2}$/.test(nuevo.fecha);

  const agregarEstudio = () => {
    if (!nuevoValido || readOnly) return;
    const estudio: EstudioCardio = {
      tipo: nuevo.tipo as TipoEstudio,
      fecha: nuevo.fecha,
      hallazgos: nuevo.hallazgos.trim().slice(0, 2000),
      conclusion: nuevo.conclusion as ConclusionEstudio,
    };
    emit({ ...draft, estudios: [...estudiosDraft, estudio] });
    setNuevo(NUEVO_ESTUDIO_INICIAL);
  };

  const quitarEstudio = (i: number) => {
    emit({ ...draft, estudios: estudiosDraft.filter((_, idx) => idx !== i) });
  };

  // ── Medicación (v3): borrador ──
  const medicacionDraft = draft.medicacion ?? [];
  const nuevoMedValido = nuevoMed.droga.trim() !== "";

  const agregarMed = () => {
    if (!nuevoMedValido || readOnly) return;
    const med: MedicamentoCardio = {
      droga: nuevoMed.droga.trim().slice(0, 120),
      estado: nuevoMed.estado,
    };
    const dosis = nuevoMed.dosis.trim();
    const frecuencia = nuevoMed.frecuencia.trim();
    if (dosis) med.dosis = dosis.slice(0, 80);
    if (frecuencia) med.frecuencia = frecuencia.slice(0, 80);
    emit({ ...draft, medicacion: [...medicacionDraft, med] });
    setNuevoMed(NUEVO_MED_INICIAL);
  };

  const quitarMed = (i: number) => {
    emit({ ...draft, medicacion: medicacionDraft.filter((_, idx) => idx !== i) });
  };

  const toggleEstadoMed = (i: number) => {
    const meds = medicacionDraft.map((m, idx) =>
      idx === i
        ? { ...m, estado: (m.estado === "activa" ? "suspendida" : "activa") as EstadoMedicacion }
        : m,
    );
    emit({ ...draft, medicacion: meds });
  };

  // ── Derivación (v3): borrador ──
  const derivacion = draft.derivacion ?? null;

  const setDerivacionCampo = (patch: Partial<DerivacionCardio>) => {
    if (readOnly) return;
    const base: DerivacionCardio = derivacion ?? { motivo: "", urgencia: "programada" };
    emit({ ...draft, derivacion: { ...base, ...patch } });
  };

  const limpiarDerivacion = () => {
    if (readOnly) return;
    const { derivacion: _drop, ...rest } = draft;
    void _drop;
    emit(rest);
  };

  const historialVisibles = estudiosExpandidos ? estudiosHistorial : estudiosHistorial.slice(0, 4);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
      {/* ── Panel cardiovascular ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Panel cardiovascular</span>
          {nFactores > 0 ? (
            <span
              className="fi-pill"
              style={CHIP_RIESGO[riesgo.nivel]}
              title={`Clasificación orientativa por conteo de factores (${nFactores} de ${FACTORES_RIESGO.length}). No es diagnóstico ni reemplaza el criterio clínico.`}
            >
              {riesgo.etiqueta}
            </span>
          ) : null}
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {VITALES_TA_FC.map(({ campo, label }) => (
            <VitalInput
              key={campo}
              campo={campo}
              label={label}
              value={draft.panel?.[campo]}
              onChangeVital={setVital}
              readOnly={readOnly}
            />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 10px" }}>
          {VITALES_EXTRA.map(({ campo, label }) => (
            <VitalInput
              key={campo}
              campo={campo}
              label={label}
              value={draft.panel?.[campo]}
              onChangeVital={setVital}
              readOnly={readOnly}
            />
          ))}
        </div>
        {fueraDeRango.length > 0 ? (
          <p role="alert" style={{ margin: 0, fontSize: 11.5, color: "var(--red)" }}>
            Revisá{" "}
            {fueraDeRango
              .map(
                ({ campo, label }) =>
                  `${label.split(" (")[0]} (${RANGOS_PANEL[campo].min}–${RANGOS_PANEL[campo].max} ${RANGOS_PANEL[campo].unidad})`,
              )
              .join(", ")}{" "}
            — fuera del rango aceptado, no se va a poder guardar.
          </p>
        ) : null}

        <fieldset
          style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}
        >
          <legend className="fi-eyebrow" style={{ padding: 0, marginBottom: 8 }}>
            Factores de riesgo
          </legend>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
            {FACTORES_RIESGO.map((f) => (
              <label key={f} className="fm-modal-check">
                <input
                  type="checkbox"
                  checked={factores[f] === true}
                  onChange={() => toggleFactor(f)}
                  disabled={readOnly}
                />
                <span>{FACTOR_LABELS[f]}</span>
              </label>
            ))}
          </div>
          {nFactores === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
              Marcá los factores presentes para estimar el riesgo (orientativo).
            </p>
          ) : null}
        </fieldset>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="fi-eyebrow">Evolución TA / FC</span>
          <CardioSparkline series={series} />
        </div>
      </section>

      {/* ── Estudios ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Estudios</span>
          {estudiosHistorial.length > 4 ? (
            <button
              type="button"
              className="pc-link"
              onClick={() => setEstudiosExpandidos((v) => !v)}
            >
              {estudiosExpandidos ? "Mostrar menos" : `Ver todos (${estudiosHistorial.length})`}
            </button>
          ) : null}
        </header>

        {estudiosDraft.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
              En esta sesión
            </span>
            {estudiosDraft.map((e, i) => (
              <EstudioRow
                key={`${e.tipo}-${e.fecha}-${i}`}
                estudio={e}
                onQuitar={readOnly ? undefined : () => quitarEstudio(i)}
              />
            ))}
          </div>
        ) : null}

        {!readOnly ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label className="fi-wi-field">
                <span>Tipo de estudio</span>
                <select
                  style={SELECT_STYLE}
                  value={nuevo.tipo}
                  onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value })}
                >
                  <option value="">Elegí…</option>
                  {TIPOS_ESTUDIO.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="fi-wi-field">
                <span>Fecha</span>
                <input
                  type="date"
                  value={nuevo.fecha}
                  max={hoyISO()}
                  onChange={(e) => setNuevo({ ...nuevo, fecha: e.target.value })}
                />
              </label>
            </div>
            <label className="fi-wi-field">
              <span>Hallazgos</span>
              <textarea
                value={nuevo.hallazgos}
                maxLength={2000}
                onChange={(e) => setNuevo({ ...nuevo, hallazgos: e.target.value })}
                placeholder="Hallazgos del estudio…"
                rows={2}
                spellCheck={false}
              />
            </label>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <label className="fi-wi-field" style={{ flex: 1 }}>
                <span>Conclusión</span>
                <select
                  style={SELECT_STYLE}
                  value={nuevo.conclusion}
                  onChange={(e) => setNuevo({ ...nuevo, conclusion: e.target.value })}
                >
                  <option value="">Elegí…</option>
                  {CONCLUSIONES_ESTUDIO.map((c) => (
                    <option key={c} value={c}>{CONCLUSION_LABELS[c]}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="fi-btn fi-btn-secondary"
                onClick={agregarEstudio}
                disabled={!nuevoValido}
                title={
                  nuevoValido
                    ? "Suma el estudio al borrador de esta sesión"
                    : "Completá tipo, fecha y conclusión para agregar"
                }
              >
                <I.Plus size={12} /> Agregar
              </button>
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
            Historial
          </span>
          {estudiosHistorial.length === 0 ? (
            <p className="pc-card-text muted" style={{ fontSize: 12.5 }}>
              Sin estudios registrados todavía. Los estudios guardados en
              sesiones anteriores aparecen acá.
            </p>
          ) : (
            historialVisibles.map(({ estudio, fechaSesion }, i) => (
              <EstudioRow
                key={`${fechaSesion}-${estudio.tipo}-${estudio.fecha}-${i}`}
                estudio={estudio}
                fechaSesion={fechaSesion}
              />
            ))
          )}
        </div>

        {/* C6 · adjuntos de estudios (ECG/Holter/ergometría escaneados o PDF).
            El archivo se ABRE por signed URL — Folio NO renderiza la señal. */}
        <EstudiosAdjuntos
          pacienteId={pacienteId}
          turno={turno}
          estudiosAdjuntos={estudiosAdjuntos}
          readOnly={readOnly}
        />
      </section>

      {/* ── Medicación (v3) ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Medicación</span>
          {medicacionActivas(medicacionDraft) > 0 ? (
            <span className="fi-pill" style={CHIP_MED_ACTIVA}>
              {medicacionActivas(medicacionDraft)} activa
              {medicacionActivas(medicacionDraft) === 1 ? "" : "s"}
            </span>
          ) : null}
        </header>

        {medicacionDraft.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
              En esta sesión
            </span>
            {medicacionDraft.map((m, i) => (
              <MedRow
                key={`${m.droga}-${i}`}
                med={m}
                onQuitar={readOnly ? undefined : () => quitarMed(i)}
                onToggleEstado={readOnly ? undefined : () => toggleEstadoMed(i)}
              />
            ))}
          </div>
        ) : null}

        {!readOnly ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label className="fi-wi-field">
                <span>Droga</span>
                <input
                  type="text"
                  value={nuevoMed.droga}
                  maxLength={120}
                  onChange={(e) => setNuevoMed({ ...nuevoMed, droga: e.target.value })}
                  placeholder="Ej. Enalapril"
                />
              </label>
              <label className="fi-wi-field">
                <span>Dosis</span>
                <input
                  type="text"
                  value={nuevoMed.dosis}
                  maxLength={80}
                  onChange={(e) => setNuevoMed({ ...nuevoMed, dosis: e.target.value })}
                  placeholder="Ej. 10 mg"
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <label className="fi-wi-field" style={{ flex: 1 }}>
                <span>Frecuencia</span>
                <input
                  type="text"
                  value={nuevoMed.frecuencia}
                  maxLength={80}
                  onChange={(e) => setNuevoMed({ ...nuevoMed, frecuencia: e.target.value })}
                  placeholder="Ej. 1 comp/día"
                />
              </label>
              <label className="fi-wi-field" style={{ width: 130 }}>
                <span>Estado</span>
                <select
                  style={SELECT_STYLE}
                  value={nuevoMed.estado}
                  onChange={(e) =>
                    setNuevoMed({ ...nuevoMed, estado: e.target.value as EstadoMedicacion })
                  }
                >
                  {ESTADOS_MEDICACION.map((s) => (
                    <option key={s} value={s}>{ESTADO_MEDICACION_LABELS[s]}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="fi-btn fi-btn-secondary"
                onClick={agregarMed}
                disabled={!nuevoMedValido}
                title={
                  nuevoMedValido
                    ? "Suma el fármaco al esquema de esta sesión"
                    : "Ingresá al menos la droga para agregar"
                }
              >
                <I.Plus size={12} /> Agregar
              </button>
            </div>
          </div>
        ) : null}

        {medicacionPrevia.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
              Esquema de la última sesión (referencia)
            </span>
            {medicacionPrevia.map((m, i) => (
              <MedRow key={`prev-${m.droga}-${i}`} med={m} />
            ))}
          </div>
        ) : null}
      </section>

      {/* ── Derivación (v3, imprimible) ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Derivación</span>
          {derivacion && derivacion.motivo.trim() !== "" ? (
            <span className="fi-pill" style={CHIP_URGENCIA[derivacion.urgencia]}>
              {URGENCIA_DERIVACION_LABELS[derivacion.urgencia]}
            </span>
          ) : null}
        </header>

        {readOnly && (!derivacion || derivacion.motivo.trim() === "") ? (
          <p className="pc-card-text muted" style={{ fontSize: 12.5 }}>
            Sin derivación en esta sesión.
          </p>
        ) : null}

        {!readOnly ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label className="fi-wi-field">
                <span>Destinatario (opcional)</span>
                <input
                  type="text"
                  value={derivacion?.destinatario ?? ""}
                  maxLength={160}
                  onChange={(e) => setDerivacionCampo({ destinatario: e.target.value })}
                  placeholder="Dr./Dra. o servicio"
                />
              </label>
              <label className="fi-wi-field">
                <span>Especialidad (opcional)</span>
                <input
                  type="text"
                  value={derivacion?.especialidad ?? ""}
                  maxLength={120}
                  onChange={(e) => setDerivacionCampo({ especialidad: e.target.value })}
                  placeholder="Ej. Electrofisiología"
                />
              </label>
            </div>
            <label className="fi-wi-field">
              <span>Motivo de la derivación</span>
              <textarea
                value={derivacion?.motivo ?? ""}
                maxLength={2000}
                onChange={(e) => setDerivacionCampo({ motivo: e.target.value })}
                placeholder="Motivo e información clínica relevante para el receptor…"
                rows={3}
                spellCheck={false}
              />
            </label>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label className="fi-wi-field" style={{ width: 160 }}>
                <span>Urgencia</span>
                <select
                  style={SELECT_STYLE}
                  value={derivacion?.urgencia ?? "programada"}
                  onChange={(e) =>
                    setDerivacionCampo({ urgencia: e.target.value as UrgenciaDerivacion })
                  }
                >
                  {URGENCIAS_DERIVACION.map((u) => (
                    <option key={u} value={u}>{URGENCIA_DERIVACION_LABELS[u]}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="fi-btn fi-btn-secondary"
                onClick={() => imprimirDerivacion(derivacion, { pacienteNombre, organizacionNombre })}
                disabled={!derivacion || derivacion.motivo.trim() === ""}
                title={
                  derivacion && derivacion.motivo.trim() !== ""
                    ? "Abre la derivación en una ventana lista para imprimir"
                    : "Completá el motivo para imprimir la derivación"
                }
              >
                <I.Printer size={12} /> Imprimir
              </button>
              {derivacion && derivacion.motivo.trim() !== "" ? (
                <button
                  type="button"
                  className="pc-link"
                  onClick={limpiarDerivacion}
                  style={{ marginLeft: "auto" }}
                >
                  Quitar derivación
                </button>
              ) : null}
            </div>
          </div>
        ) : derivacion && derivacion.motivo.trim() !== "" ? (
          // Snapshot read-only: mostrar la derivación + botón de impresión.
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <DerivacionReadonly derivacion={derivacion} />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="fi-btn fi-btn-secondary"
                onClick={() => imprimirDerivacion(derivacion, { pacienteNombre, organizacionNombre })}
              >
                <I.Printer size={12} /> Imprimir
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
