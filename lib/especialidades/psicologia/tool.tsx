"use client";

/**
 * Folio · especialidades · psicología · Tool del slot clínico (Fase D).
 *
 * Tres paneles apilados en la columna del slot (pc-plan-grid, 380px):
 *   1. Escalas — PHQ-9 (9 ítems) y GAD-7 (7 ítems), radios 0–3 por ítem,
 *      puntaje y banda de severidad automáticos al completar la escala, aviso
 *      clínico sobrio si el ítem 9 del PHQ-9 (ideación) es > 0, y curva
 *      longitudinal de ambos puntajes (SVG sparkline con tokens). Tamizaje,
 *      NO diagnóstico.
 *   2. Registro de sesión — estado mental con selects cortos (apariencia,
 *      ánimo, afecto, curso del pensamiento) + riesgo (sin riesgo | ideación
 *      | plan) con nota de manejo si hay riesgo.
 *   3. Objetivos terapéuticos — alta y edición de estado (en curso | logrado
 *      | pausado), con "retomar de la última sesión" para dar continuidad.
 *
 * Controlado por el slot: deriva TODO de `value` (toolData del borrador) y
 * notifica cada edición con `onChange(next)`. Una escala a medio responder
 * vive en el borrador como array con null — el schema estricto exige la
 * escala completa, así que la UI avisa que incompleta no se puede guardar.
 * Borrador sin contenido → null (el writer persiste tool_data NULL).
 * `historial` es solo lectura. PHI: nunca se loguea contenido clínico.
 *
 * Estilos: clases existentes de folio.css (pc-card / fi-eyebrow / fi-wi-field /
 * fi-pill / pc-link / pc-legend-*) + tokens en estilos inline puntuales.
 */

import { useId, useMemo, useState, type CSSProperties } from "react";

import * as I from "@/components/icons";
import type { SpecialtyToolProps } from "@/lib/especialidades/types";
import {
  AFECTO_LABELS,
  AFECTOS,
  ANIMO_LABELS,
  ANIMOS,
  APARIENCIA_LABELS,
  APARIENCIAS,
  CONSIGNA_ESCALAS,
  deriveScoreSeries,
  ESTADO_OBJETIVO_LABELS,
  ESTADOS_OBJETIVO,
  extractObjetivos,
  extractRegistro,
  extractRespuestasEscala,
  GAD7_ITEMS,
  GAD7_LEN,
  OPCIONES_FRECUENCIA,
  PENSAMIENTO_LABELS,
  PENSAMIENTOS,
  PHQ9_ITEM_IDEACION,
  PHQ9_ITEMS,
  PHQ9_LEN,
  RIESGO_LABELS,
  RIESGOS,
  scoreGad7,
  scorePhq9,
  type BandaPhq9,
  type EstadoObjetivo,
  type Objetivo,
  type PsicoSeriesPoint,
  type RegistroSesion,
  type Riesgo,
} from "@/lib/especialidades/psicologia/schema";

// ─── Helpers de presentación (tokens, sin hex off-theme) ────────────────────

const CHIP_BANDA: Record<BandaPhq9, CSSProperties> = {
  minima: { color: "var(--green)", background: "var(--green-soft)", borderColor: "transparent" },
  leve: { color: "var(--slate)", background: "var(--slate-soft)", borderColor: "transparent" },
  moderada: { color: "var(--amber)", background: "var(--amber-soft)", borderColor: "transparent" },
  moderadamente_severa: { color: "var(--red)", background: "var(--red-soft)", borderColor: "transparent" },
  severa: { color: "var(--red)", background: "var(--red-soft)", borderColor: "transparent" },
};

const CHIP_ESTADO_OBJETIVO: Record<EstadoObjetivo, CSSProperties> = {
  en_curso: { color: "var(--slate)", background: "var(--slate-soft)", borderColor: "transparent" },
  logrado: { color: "var(--green)", background: "var(--green-soft)", borderColor: "transparent" },
  pausado: { color: "var(--amber)", background: "var(--amber-soft)", borderColor: "transparent" },
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

const AVISO_STYLE: CSSProperties = {
  margin: 0,
  padding: "10px 12px",
  background: "var(--red-soft)",
  color: "var(--red)",
  borderRadius: "var(--r-sm)",
  fontSize: 12.5,
  lineHeight: 1.5,
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MESES[m - 1]} ${String(y).slice(2)}`;
}

// ─── Borrador (controlado desde value) ──────────────────────────────────────

/**
 * Borrador en memoria: las escalas admiten null (ítem sin responder) — el
 * schema estricto (psicologiaToolDataSchema) exige la escala completa y lo
 * aplica el writer antes de cifrar; la UI avisa la incompletitud.
 */
interface PsicologiaDraft {
  v: 1;
  phq9?: Array<number | null>;
  gad7?: Array<number | null>;
  registro?: RegistroSesion;
  objetivos?: Objetivo[];
}

/** Parse LAXO del borrador: tolera shapes parciales/ajenos re-hidratados. */
function parseDraft(value: unknown): PsicologiaDraft {
  const out: PsicologiaDraft = { v: 1 };
  if (value === null || typeof value !== "object") return out;
  const v = value as Record<string, unknown>;

  const phq9 = extractRespuestasEscala(v.phq9, PHQ9_LEN);
  if (phq9) out.phq9 = phq9;
  const gad7 = extractRespuestasEscala(v.gad7, GAD7_LEN);
  if (gad7) out.gad7 = gad7;
  const registro = extractRegistro(v.registro);
  if (registro) out.registro = registro;
  const objetivos = extractObjetivos(value);
  if (objetivos.length > 0) out.objetivos = objetivos;
  return out;
}

/**
 * Normaliza el borrador antes de emitirlo: escala sin ninguna respuesta →
 * fuera; registro sin campos → fuera; objetivos vacíos → fuera; todo vacío →
 * null (el writer guarda tool_data NULL, no un `{ v: 1 }` cifrado sin
 * contenido).
 */
function limpiarDraft(next: PsicologiaDraft): PsicologiaDraft | null {
  const out: PsicologiaDraft = { v: 1 };
  if (next.phq9 && next.phq9.some((r) => r !== null)) out.phq9 = next.phq9;
  if (next.gad7 && next.gad7.some((r) => r !== null)) out.gad7 = next.gad7;
  if (next.registro) {
    const r = { ...next.registro };
    for (const k of Object.keys(r) as Array<keyof RegistroSesion>) {
      if (r[k] === undefined) delete r[k];
    }
    if (Object.keys(r).length > 0) out.registro = r;
  }
  if (next.objetivos && next.objetivos.length > 0) out.objetivos = next.objetivos;
  return out.phq9 || out.gad7 || out.registro || out.objetivos ? out : null;
}

// ─── Sparkline longitudinal PHQ-9 / GAD-7 ───────────────────────────────────

const METRICAS_SERIE = [
  { key: "phq9" as const, label: "PHQ-9", color: "var(--accent)" },
  { key: "gad7" as const, label: "GAD-7", color: "var(--slate)" },
];

function PsicoSparkline({ series }: { series: PsicoSeriesPoint[] }) {
  const W = 320;
  const H = 110;
  const PX = 8;
  const PY = 12;

  const valores = series
    .flatMap((p) => [p.phq9, p.gad7])
    .filter((n): n is number => n !== null);

  if (series.length === 0 || valores.length === 0) {
    return (
      <p className="pc-card-text muted" style={{ fontSize: 12.5 }}>
        Sin escalas completas en el historial todavía. La curva aparece al
        guardar sesiones con PHQ-9 o GAD-7 completos.
      </p>
    );
  }

  // Piso 0 (los puntajes arrancan ahí); techo con margen para que no pegue.
  const min = 0;
  const max = Math.max(...valores, 10) + 2;
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
        aria-label={`Evolución de puntajes PHQ-9 y GAD-7 en ${series.length} ${series.length === 1 ? "sesión" : "sesiones"}`}
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

// ─── Bloque de escala (PHQ-9 / GAD-7) ───────────────────────────────────────

function EscalaBlock({
  titulo,
  maxTotal,
  items,
  respuestas,
  score,
  onSet,
  onQuitar,
  readOnly,
}: {
  titulo: string;
  maxTotal: number;
  items: readonly string[];
  /** null = escala sin cargar en esta sesión. */
  respuestas: Array<number | null> | null;
  score: { total: number; banda: BandaPhq9; etiqueta: string } | null;
  onSet(idx: number, valor: number): void;
  onQuitar(): void;
  readOnly?: boolean;
}) {
  const uid = useId();
  // Abierta si ya hay respuestas; el profesional puede abrirla vacía.
  const [abiertaLocal, setAbiertaLocal] = useState(false);
  const abierta = abiertaLocal || respuestas !== null;
  const respondidas = respuestas ? respuestas.filter((r) => r !== null).length : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: 13, color: "var(--ink)" }}>{titulo}</b>
        {score ? (
          <span
            className="fi-pill"
            style={CHIP_BANDA[score.banda]}
            title={`Puntaje ${score.total} de ${maxTotal} — severidad ${score.etiqueta}. Tamizaje orientativo, no diagnóstico.`}
          >
            {score.total} · {score.etiqueta}
          </span>
        ) : abierta && respondidas > 0 ? (
          <span className="fm-mono muted" style={{ fontSize: 10.5 }}>
            {respondidas}/{items.length}
          </span>
        ) : null}
        {abierta && !readOnly ? (
          <button
            type="button"
            className="pc-link"
            onClick={() => {
              setAbiertaLocal(false);
              onQuitar();
            }}
            style={{ marginLeft: "auto" }}
            aria-label={`Quitar la escala ${titulo} de esta sesión`}
          >
            Quitar
          </button>
        ) : null}
      </div>

      {!abierta ? (
        readOnly ? (
          <p className="pc-card-text muted" style={{ fontSize: 12.5 }}>
            Sin cargar en esta sesión.
          </p>
        ) : (
          <button
            type="button"
            className="fi-btn fi-btn-secondary"
            onClick={() => setAbiertaLocal(true)}
            style={{ alignSelf: "flex-start" }}
          >
            <I.Plus size={12} /> Cargar {titulo}
          </button>
        )
      ) : (
        <>
          <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
            {OPCIONES_FRECUENCIA.map((o, i) => `${i} = ${o}`).join(" · ")}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((texto, i) => (
              <fieldset
                key={i}
                style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}
              >
                <legend
                  style={{ padding: 0, fontSize: 12, lineHeight: 1.45, color: "var(--ink-2)" }}
                >
                  {i + 1}. {texto}
                </legend>
                <div style={{ display: "flex", gap: 12 }}>
                  {OPCIONES_FRECUENCIA.map((opcion, valor) => (
                    <label
                      key={valor}
                      title={opcion}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        color: "var(--ink-2)",
                        cursor: readOnly ? "default" : "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name={`${uid}-item-${i}`}
                        checked={respuestas?.[i] === valor}
                        onChange={() => onSet(i, valor)}
                        disabled={readOnly}
                        aria-label={`${opcion} (${valor})`}
                        style={{ accentColor: "var(--accent)", margin: 0 }}
                      />
                      <span aria-hidden="true">{valor}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          {respondidas > 0 && !score ? (
            <p role="alert" style={{ margin: 0, fontSize: 11.5, color: "var(--red)" }}>
              {titulo} incompleto ({respondidas}/{items.length}) — respondé los{" "}
              {items.length - respondidas} ítems restantes o quitá la escala; incompleta
              no se va a poder guardar.
            </p>
          ) : null}
          {respondidas === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
              El puntaje y la banda se calculan automáticamente al completar
              los {items.length} ítems.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

// ─── Tool ───────────────────────────────────────────────────────────────────

const CAMPOS_ESTADO_MENTAL = [
  { campo: "apariencia" as const, label: "Apariencia", opciones: APARIENCIAS, labels: APARIENCIA_LABELS as Record<string, string> },
  { campo: "animo" as const, label: "Ánimo", opciones: ANIMOS, labels: ANIMO_LABELS as Record<string, string> },
  { campo: "afecto" as const, label: "Afecto", opciones: AFECTOS, labels: AFECTO_LABELS as Record<string, string> },
  { campo: "pensamiento" as const, label: "Curso del pensamiento", opciones: PENSAMIENTOS, labels: PENSAMIENTO_LABELS as Record<string, string> },
];

export function PsicologiaTool({ value, onChange, readOnly, historial }: SpecialtyToolProps) {
  const draft = useMemo(() => parseDraft(value), [value]);
  const series = useMemo(() => deriveScoreSeries(historial), [historial]);
  // Últimos objetivos registrados (historial DESC → el primero que tenga).
  const ultimosObjetivos = useMemo(() => {
    for (const entry of historial) {
      const objetivos = extractObjetivos(entry.toolData);
      if (objetivos.length > 0) return { fecha: entry.fecha, objetivos };
    }
    return null;
  }, [historial]);

  // Form local de alta de objetivo (el resto del borrador vive en `value`).
  const [nuevoObjetivo, setNuevoObjetivo] = useState("");

  const emit = (next: PsicologiaDraft) => {
    if (readOnly) return;
    onChange(limpiarDraft(next));
  };

  // ── Escalas ──
  const phq9Score = scorePhq9(draft.phq9);
  const gad7Score = scoreGad7(draft.gad7);
  const ideacionPhq9 = (draft.phq9?.[PHQ9_ITEM_IDEACION] ?? 0) > 0;

  const setItemEscala = (escala: "phq9" | "gad7", len: number) => (idx: number, valor: number) => {
    const base = draft[escala] ?? Array.from({ length: len }, () => null);
    const next = base.map((r, i) => (i === idx ? valor : r));
    emit({ ...draft, [escala]: next });
  };

  const quitarEscala = (escala: "phq9" | "gad7") => {
    const next = { ...draft };
    delete next[escala];
    emit(next);
  };

  // ── Registro de sesión ──
  const registro = draft.registro ?? {};
  const riesgo = registro.riesgo;

  const setCampoRegistro = (campo: keyof RegistroSesion, raw: string) => {
    const next: RegistroSesion = { ...registro };
    if (raw === "") delete next[campo];
    else (next as Record<string, string>)[campo] = raw;
    emit({ ...draft, registro: next });
  };

  // ── Objetivos terapéuticos ──
  const objetivos = draft.objetivos ?? [];
  const textoNuevo = nuevoObjetivo.trim();

  const agregarObjetivo = () => {
    if (textoNuevo === "" || readOnly) return;
    const objetivo: Objetivo = { texto: textoNuevo.slice(0, 500), estado: "en_curso" };
    emit({ ...draft, objetivos: [...objetivos, objetivo] });
    setNuevoObjetivo("");
  };

  const setEstadoObjetivo = (i: number, estado: EstadoObjetivo) => {
    emit({ ...draft, objetivos: objetivos.map((o, idx) => (idx === i ? { ...o, estado } : o)) });
  };

  const quitarObjetivo = (i: number) => {
    emit({ ...draft, objetivos: objetivos.filter((_, idx) => idx !== i) });
  };

  const retomarObjetivos = () => {
    if (!ultimosObjetivos || readOnly) return;
    emit({ ...draft, objetivos: ultimosObjetivos.objetivos });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
      {/* ── Escalas PHQ-9 / GAD-7 ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Escalas</span>
        </header>
        <p className="muted" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5 }}>
          {CONSIGNA_ESCALAS} Tamizaje orientativo — no reemplaza la evaluación
          clínica.
        </p>

        <EscalaBlock
          titulo="PHQ-9"
          maxTotal={27}
          items={PHQ9_ITEMS}
          respuestas={draft.phq9 ?? null}
          score={phq9Score}
          onSet={setItemEscala("phq9", PHQ9_LEN)}
          onQuitar={() => quitarEscala("phq9")}
          readOnly={readOnly}
        />

        {ideacionPhq9 ? (
          <p role="alert" style={AVISO_STYLE}>
            <b>Ítem 9 mayor a 0:</b> el paciente reportó pensamientos de muerte
            o autolesión. Evaluá riesgo suicida según tu protocolo y registrá
            la conducta a seguir.
          </p>
        ) : null}

        <EscalaBlock
          titulo="GAD-7"
          maxTotal={21}
          items={GAD7_ITEMS}
          respuestas={draft.gad7 ?? null}
          score={gad7Score}
          onSet={setItemEscala("gad7", GAD7_LEN)}
          onQuitar={() => quitarEscala("gad7")}
          readOnly={readOnly}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="fi-eyebrow">Evolución de puntajes</span>
          <PsicoSparkline series={series} />
        </div>
      </section>

      {/* ── Registro de sesión (estado mental) ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Registro de sesión</span>
          {riesgo && riesgo !== "sin_riesgo" ? (
            <span
              className="fi-pill"
              style={{ color: "var(--red)", background: "var(--red-soft)", borderColor: "transparent" }}
            >
              Riesgo: {RIESGO_LABELS[riesgo].toLowerCase()}
            </span>
          ) : null}
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {CAMPOS_ESTADO_MENTAL.map(({ campo, label, opciones, labels }) => (
            <label key={campo} className="fi-wi-field">
              <span>{label}</span>
              <select
                style={SELECT_STYLE}
                value={registro[campo] ?? ""}
                onChange={(e) => setCampoRegistro(campo, e.target.value)}
                disabled={readOnly}
              >
                <option value="">—</option>
                {opciones.map((o) => (
                  <option key={o} value={o}>{labels[o]}</option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <label className="fi-wi-field">
          <span>Riesgo</span>
          <select
            style={SELECT_STYLE}
            value={riesgo ?? ""}
            onChange={(e) => setCampoRegistro("riesgo", e.target.value as Riesgo | "")}
            disabled={readOnly}
          >
            <option value="">—</option>
            {RIESGOS.map((r) => (
              <option key={r} value={r}>{RIESGO_LABELS[r]}</option>
            ))}
          </select>
        </label>

        {riesgo === "ideacion" || riesgo === "plan" ? (
          <p role="alert" style={AVISO_STYLE}>
            Registraste riesgo con {riesgo === "plan" ? "plan" : "ideación"}.
            Documentá la evaluación y el plan de seguridad según tu protocolo.
          </p>
        ) : null}
      </section>

      {/* ── Objetivos terapéuticos ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Objetivos terapéuticos</span>
        </header>

        {objetivos.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
              En esta sesión
            </span>
            {objetivos.map((o, i) => (
              <div
                key={`${o.texto}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 0",
                  borderBottom: "1px solid var(--line-soft)",
                }}
              >
                <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.45, color: "var(--ink)" }}>
                  {o.texto}
                </span>
                <select
                  style={{ ...SELECT_STYLE, width: "auto", padding: "4px 6px", fontSize: 12 }}
                  value={o.estado}
                  onChange={(e) => setEstadoObjetivo(i, e.target.value as EstadoObjetivo)}
                  disabled={readOnly}
                  aria-label={`Estado del objetivo: ${o.texto}`}
                >
                  {ESTADOS_OBJETIVO.map((estado) => (
                    <option key={estado} value={estado}>{ESTADO_OBJETIVO_LABELS[estado]}</option>
                  ))}
                </select>
                {!readOnly ? (
                  <button
                    type="button"
                    className="pc-link"
                    onClick={() => quitarObjetivo(i)}
                    aria-label={`Quitar objetivo: ${o.texto}`}
                  >
                    Quitar
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {!readOnly ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {objetivos.length === 0 && ultimosObjetivos ? (
              <button
                type="button"
                className="fi-btn fi-btn-secondary"
                onClick={retomarObjetivos}
                style={{ alignSelf: "flex-start" }}
                title={`Copia los ${ultimosObjetivos.objetivos.length} objetivos de la sesión del ${fmtFecha(ultimosObjetivos.fecha)} para actualizar su estado`}
              >
                <I.History size={12} /> Retomar de la última sesión ({ultimosObjetivos.objetivos.length})
              </button>
            ) : null}
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <label className="fi-wi-field" style={{ flex: 1 }}>
                <span>Nuevo objetivo</span>
                <input
                  type="text"
                  value={nuevoObjetivo}
                  maxLength={500}
                  onChange={(e) => setNuevoObjetivo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      agregarObjetivo();
                    }
                  }}
                  placeholder="Ej.: reducir evitación social…"
                  spellCheck={false}
                />
              </label>
              <button
                type="button"
                className="fi-btn fi-btn-secondary"
                onClick={agregarObjetivo}
                disabled={textoNuevo === ""}
                title={
                  textoNuevo !== ""
                    ? "Suma el objetivo al borrador de esta sesión (estado: en curso)"
                    : "Escribí el objetivo para agregarlo"
                }
              >
                <I.Plus size={12} /> Agregar
              </button>
            </div>
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
            Última sesión registrada
          </span>
          {!ultimosObjetivos ? (
            <p className="pc-card-text muted" style={{ fontSize: 12.5 }}>
              Sin objetivos registrados todavía. Los objetivos guardados en
              sesiones anteriores aparecen acá.
            </p>
          ) : (
            <>
              {ultimosObjetivos.objetivos.map((o, i) => (
                <div
                  key={`${ultimosObjetivos.fecha}-${i}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 0",
                    borderBottom: "1px solid var(--line-soft)",
                  }}
                >
                  <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.45, color: "var(--ink-2)" }}>
                    {o.texto}
                  </span>
                  <span className="fi-pill" style={CHIP_ESTADO_OBJETIVO[o.estado]}>
                    {ESTADO_OBJETIVO_LABELS[o.estado]}
                  </span>
                </div>
              ))}
              <span className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>
                Registrados en la sesión del {fmtFecha(ultimosObjetivos.fecha)}
              </span>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
