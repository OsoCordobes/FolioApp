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
import {
  CONCLUSION_LABELS,
  CONCLUSIONES_ESTUDIO,
  deriveCardioSeries,
  FACTOR_LABELS,
  FACTORES_RIESGO,
  RANGOS_PANEL,
  scoreRiesgoCV,
  TIPOS_ESTUDIO,
  extractEstudios,
  type CampoVital,
  type CardioSeriesPoint,
  type CardiologiaToolData,
  type ConclusionEstudio,
  type EstudioCardio,
  type FactorRiesgo,
  type NivelRiesgoCV,
  type TipoEstudio,
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

const VITALES: Array<{ campo: CampoVital; label: string }> = [
  { campo: "taSistolica", label: "TA sist. (mmHg)" },
  { campo: "taDiastolica", label: "TA diast. (mmHg)" },
  { campo: "fc", label: "FC (lpm)" },
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
 * Parse LAXO del borrador: tolera vitales fuera de rango (valores intermedios
 * mientras se tipea — el schema estricto los rechazaría y resetearía el
 * borrador en cada render) y shapes parciales re-hidratados. La validación
 * estricta (cardiologiaToolDataSchema) la aplica el writer antes de cifrar;
 * la UI avisa con el hint de "fuera de rango".
 */
function parseDraft(value: unknown): CardiologiaToolData {
  const out: CardiologiaToolData = { v: 1 };
  if (value === null || typeof value !== "object") return out;

  const rawPanel = (value as { panel?: unknown }).panel;
  if (rawPanel !== null && typeof rawPanel === "object") {
    const p = rawPanel as Record<string, unknown>;
    const panel: NonNullable<CardiologiaToolData["panel"]> = {};
    for (const campo of Object.keys(RANGOS_PANEL) as CampoVital[]) {
      const n = p[campo];
      if (typeof n === "number" && Number.isFinite(n)) panel[campo] = Math.round(n);
    }
    const rawFactores = p.factores;
    if (rawFactores !== null && typeof rawFactores === "object") {
      const f: NonNullable<NonNullable<CardiologiaToolData["panel"]>["factores"]> = {};
      for (const k of FACTORES_RIESGO) {
        if ((rawFactores as Record<string, unknown>)[k] === true) f[k] = true;
      }
      if (FACTORES_RIESGO.some((k) => f[k] === true)) panel.factores = f;
    }
    if (Object.keys(panel).length > 0) out.panel = panel;
  }

  const estudios = extractEstudios(value);
  if (estudios.length > 0) out.estudios = estudios;
  return out;
}

/**
 * Normaliza el borrador antes de emitirlo: factores sin ninguno marcado →
 * fuera; panel sin claves → fuera; estudios vacíos → fuera; todo vacío → null
 * (el writer guarda tool_data NULL, no un `{ v: 1 }` cifrado sin contenido).
 */
function limpiarDraft(next: CardiologiaToolData): CardiologiaToolData | null {
  const panel = next.panel ? { ...next.panel } : undefined;
  if (panel) {
    if (panel.factores && !FACTORES_RIESGO.some((f) => panel.factores?.[f] === true)) {
      delete panel.factores;
    }
    for (const k of Object.keys(panel) as Array<keyof typeof panel>) {
      if (panel[k] === undefined) delete panel[k];
    }
  }
  const out: CardiologiaToolData = { v: 1 };
  if (panel && Object.keys(panel).length > 0) out.panel = panel;
  if (next.estudios && next.estudios.length > 0) out.estudios = next.estudios;
  return out.panel || out.estudios ? out : null;
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

// ─── Tool ───────────────────────────────────────────────────────────────────

const NUEVO_ESTUDIO_INICIAL = { tipo: "", fecha: "", hallazgos: "", conclusion: "" };

export function CardiologiaTool({ value, onChange, readOnly, historial, edad }: SpecialtyToolProps) {
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

  // Form local de alta de estudio (el resto del borrador vive en `value`).
  const [nuevo, setNuevo] = useState(NUEVO_ESTUDIO_INICIAL);
  const [estudiosExpandidos, setEstudiosExpandidos] = useState(false);

  const emit = (next: CardiologiaToolData) => {
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
          {VITALES.map(({ campo, label }) => (
            <label key={campo} className="fi-wi-field">
              <span>{label}</span>
              <input
                type="number"
                inputMode="numeric"
                min={RANGOS_PANEL[campo].min}
                max={RANGOS_PANEL[campo].max}
                step={1}
                value={draft.panel?.[campo] ?? ""}
                onChange={(e) => setVital(campo, e.target.value)}
                placeholder="—"
                disabled={readOnly}
              />
            </label>
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
      </section>
    </div>
  );
}
