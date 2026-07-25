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

import { useRouter } from "next/navigation";

import * as I from "@/components/icons";
import { registrarCssrsAction } from "@/app/(app)/pacientes/actions";
import { cssrs as cssrsDef } from "@/lib/instrumentos";
import { ObjetivosBlock, PlanillaRenderer, ResultadoBadge } from "@/lib/instrumentos/components";
import { SerieEvolucion, type MetricaSerie, type PuntoSerie } from "@/lib/instrumentos/components";
import type { SpecialtyToolProps } from "@/lib/especialidades/types";
import { OutcomesDashboard } from "@/lib/especialidades/psicologia/dashboard";
import {
  AFECTO_LABELS,
  AFECTOS,
  ANIMO_LABELS,
  ANIMOS,
  APARIENCIA_LABELS,
  APARIENCIAS,
  ATENCION_LABELS,
  ATENCIONES,
  CONSIGNA_ESCALAS,
  CONTENIDO_PENSAMIENTO_LABELS,
  CONTENIDOS_PENSAMIENTO,
  CSSRS_ITEMS_LEN,
  cssrsBandaLabel,
  deriveScoreSeries,
  deteccionRiesgo,
  ESTADO_OBJETIVO_LABELS,
  ESTADOS_OBJETIVO,
  extractCrisisPlan,
  extractObjetivos,
  extractProcesoNota,
  extractRegistro,
  extractRespuestasEscala,
  GAD7_ITEMS,
  GAD7_LEN,
  INSIGHT_LABELS,
  INSIGHTS,
  JUICIO_LABELS,
  JUICIOS,
  LENGUAJE_LABELS,
  LENGUAJES,
  MEMORIA_LABELS,
  MEMORIAS,
  NOTA_FORMATO_LABELS,
  NOTA_FORMATO_SECCIONES,
  NOTA_FORMATOS,
  OPCIONES_FRECUENCIA,
  ORIENTACION_LABELS,
  ORIENTACIONES,
  PENSAMIENTO_LABELS,
  PENSAMIENTOS,
  PHQ9_ITEM_IDEACION,
  PHQ9_ITEMS,
  PHQ9_LEN,
  PSICOMOTRICIDAD_LABELS,
  PSICOMOTRICIDADES,
  RIESGO_LABELS,
  RIESGOS,
  scoreCssrsCrisis,
  scoreGad7,
  scorePhq9,
  SENSOPERCEPCION_LABELS,
  SENSOPERCEPCIONES,
  type BandaPhq9,
  type NotaFormato,
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

const AVISO_STYLE: CSSProperties = {
  margin: 0,
  padding: "10px 12px",
  background: "var(--red-soft)",
  color: "var(--red)",
  borderRadius: "var(--r-sm)",
  fontSize: 12.5,
  lineHeight: 1.5,
};

// ─── Borrador (controlado desde value) ──────────────────────────────────────

/**
 * Borrador en memoria (v2, C7): las escalas admiten null (ítem sin responder) —
 * el schema estricto (psicologiaToolDataV2Schema) exige la escala completa y lo
 * aplica el writer antes de cifrar; la UI avisa la incompletitud. El screener
 * C-SSRS del plan de crisis admite igual respuestas parciales en memoria.
 */
interface CrisisPlanDraft {
  /** Respuestas del C-SSRS (0/1), con null en lo no respondido. */
  cssrs?: Array<number | null>;
  accesoMedios?: string;
  factoresProtectores?: string;
  planTexto?: string;
}

/** Sub-borrador de la nota de proceso (C8): formato + textos por sección. */
interface ProcesoNotaDraft {
  formato?: NotaFormato;
  campos?: Record<string, string>;
}

interface PsicologiaDraft {
  v: 3;
  phq9?: Array<number | null>;
  gad7?: Array<number | null>;
  registro?: RegistroSesion;
  objetivos?: Objetivo[];
  crisisPlan?: CrisisPlanDraft;
  procesoNota?: ProcesoNotaDraft;
}

/** Parse LAXO del borrador: tolera shapes parciales/ajenos re-hidratados (v1/v2/v3). */
function parseDraft(value: unknown): PsicologiaDraft {
  const out: PsicologiaDraft = { v: 3 };
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

  // C7 · plan de crisis (v2). Se re-hidrata laxo: el screener a Array<number|null>
  // y los textos tal cual. En una sesión v1 (sin crisisPlan) queda undefined.
  const crisis = extractCrisisPlan(value);
  if (crisis) {
    const draft: CrisisPlanDraft = {};
    const cssrs = extractRespuestasCssrs(v.crisisPlan);
    if (cssrs) draft.cssrs = cssrs;
    if (crisis.accesoMedios) draft.accesoMedios = crisis.accesoMedios;
    if (crisis.factoresProtectores) draft.factoresProtectores = crisis.factoresProtectores;
    if (crisis.planTexto) draft.planTexto = crisis.planTexto;
    if (Object.keys(draft).length > 0) out.crisisPlan = draft;
  }

  // C8 · nota de proceso (v3). Re-hidrata formato + textos por sección tal cual.
  // En una sesión v1/v2 (sin procesoNota) queda undefined.
  const nota = extractProcesoNota(value);
  if (nota) {
    const draft: ProcesoNotaDraft = {};
    if (nota.formato) draft.formato = nota.formato;
    if (nota.campos) {
      // El record del schema es Partial<Record<…>> (valores string | undefined);
      // el borrador guarda solo las claves con texto real (Record<string, string>).
      const campos: Record<string, string> = {};
      for (const [k, v2] of Object.entries(nota.campos)) {
        if (typeof v2 === "string") campos[k] = v2;
      }
      if (Object.keys(campos).length > 0) draft.campos = campos;
    }
    if (Object.keys(draft).length > 0) out.procesoNota = draft;
  }
  return out;
}

/**
 * Respuestas laxas del screener C-SSRS (0/1) para el borrador: array de longitud
 * fija con null en lo no respondido. Devuelve null si no hay ninguna respuesta
 * válida. Espejo de extractRespuestasEscala pero con rango 0–1.
 */
function extractRespuestasCssrs(crisisPlan: unknown): Array<number | null> | null {
  if (crisisPlan === null || typeof crisisPlan !== "object") return null;
  const raw = (crisisPlan as Record<string, unknown>).cssrs;
  if (!Array.isArray(raw)) return null;
  const out: Array<number | null> = [];
  for (let i = 0; i < CSSRS_ITEMS_LEN; i++) {
    const v = raw[i];
    out.push(v === 0 || v === 1 ? v : v === true ? 1 : v === false ? 0 : null);
  }
  return out.some((v) => v !== null) ? out : null;
}

/** Limpia el sub-borrador del plan de crisis; null si no aporta nada. */
function limpiarCrisisPlan(next: CrisisPlanDraft | undefined): CrisisPlanDraft | null {
  if (!next) return null;
  const out: CrisisPlanDraft = {};
  // El screener persiste SOLO completo (mismo criterio que PHQ-9/GAD-7).
  if (next.cssrs && next.cssrs.every((r) => r === 0 || r === 1)) out.cssrs = next.cssrs;
  const texto = (s: string | undefined) => (s && s.trim() !== "" ? s.trim() : undefined);
  const acceso = texto(next.accesoMedios);
  if (acceso) out.accesoMedios = acceso;
  const factores = texto(next.factoresProtectores);
  if (factores) out.factoresProtectores = factores;
  const plan = texto(next.planTexto);
  if (plan) out.planTexto = plan;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Limpia el sub-borrador de la nota de proceso (C8); null si no aporta nada. El
 * formato solo persiste si hay al menos un texto (elegir formato sin escribir no
 * ensucia el toolData). Las secciones vacías se descartan; solo se guardan las
 * del formato elegido.
 */
function limpiarProcesoNota(next: ProcesoNotaDraft | undefined): ProcesoNotaDraft | null {
  if (!next || !next.formato) return null;
  const secciones = NOTA_FORMATO_SECCIONES[next.formato];
  const campos: Record<string, string> = {};
  for (const s of secciones) {
    const raw = next.campos?.[s.key];
    const t = typeof raw === "string" ? raw.trim() : "";
    if (t !== "") campos[s.key] = t.slice(0, 5000);
  }
  if (Object.keys(campos).length === 0) return null;
  return { formato: next.formato, campos };
}

/**
 * Normaliza el borrador antes de emitirlo: escala sin ninguna respuesta →
 * fuera; registro sin campos → fuera; objetivos vacíos → fuera; plan de crisis
 * sin contenido → fuera; nota de proceso sin texto → fuera; todo vacío → null
 * (el writer guarda tool_data NULL, no un `{ v: 3 }` cifrado sin contenido).
 */
function limpiarDraft(next: PsicologiaDraft): PsicologiaDraft | null {
  const out: PsicologiaDraft = { v: 3 };
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
  const crisis = limpiarCrisisPlan(next.crisisPlan);
  if (crisis) out.crisisPlan = crisis;
  const nota = limpiarProcesoNota(next.procesoNota);
  if (nota) out.procesoNota = nota;
  return out.phq9 || out.gad7 || out.registro || out.objetivos || out.crisisPlan || out.procesoNota
    ? out
    : null;
}

// ─── Serie longitudinal PHQ-9 / GAD-7 ───────────────────────────────────────
//
// C4: el sparkline propio (PsicoSparkline) se reemplaza por <SerieEvolucion> de
// la biblioteca (C3), que unifica los sparklines duplicados de cardio/psico.
// Solo hay que aportar las métricas (colores/labels) y adaptar la serie de
// psico ({ fecha, phq9, gad7 }) al punto genérico ({ fecha, valores: {…} }).

const METRICAS_SERIE: MetricaSerie[] = [
  { key: "phq9", label: "PHQ-9", color: "var(--accent)" },
  { key: "gad7", label: "GAD-7", color: "var(--slate)" },
];

/** Adapta la serie tipada de psico al punto genérico de <SerieEvolucion>. */
function aPuntosSerie(series: PsicoSeriesPoint[]): PuntoSerie[] {
  return series.map((p) => ({
    fecha: p.fecha,
    valores: { phq9: p.phq9, gad7: p.gad7 },
  }));
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

interface CampoMSE {
  campo: keyof RegistroSesion;
  label: string;
  opciones: readonly string[];
  labels: Record<string, string>;
}

/** Dominios básicos del MSE — siempre visibles (los 4 originales, v1). */
const CAMPOS_ESTADO_MENTAL_BASE: readonly CampoMSE[] = [
  { campo: "apariencia", label: "Apariencia", opciones: APARIENCIAS, labels: APARIENCIA_LABELS as Record<string, string> },
  { campo: "animo", label: "Ánimo", opciones: ANIMOS, labels: ANIMO_LABELS as Record<string, string> },
  { campo: "afecto", label: "Afecto", opciones: AFECTOS, labels: AFECTO_LABELS as Record<string, string> },
  { campo: "pensamiento", label: "Curso del pensamiento", opciones: PENSAMIENTOS, labels: PENSAMIENTO_LABELS as Record<string, string> },
];

/**
 * Dominios ampliados del MSE (C8) — se muestran al expandir "MSE completo". Todos
 * opcionales; completá solo los que aporten valor a la sesión.
 */
const CAMPOS_ESTADO_MENTAL_EXT: readonly CampoMSE[] = [
  { campo: "psicomotricidad", label: "Psicomotricidad", opciones: PSICOMOTRICIDADES, labels: PSICOMOTRICIDAD_LABELS as Record<string, string> },
  { campo: "lenguaje", label: "Lenguaje", opciones: LENGUAJES, labels: LENGUAJE_LABELS as Record<string, string> },
  { campo: "orientacion", label: "Orientación", opciones: ORIENTACIONES, labels: ORIENTACION_LABELS as Record<string, string> },
  { campo: "atencion", label: "Atención", opciones: ATENCIONES, labels: ATENCION_LABELS as Record<string, string> },
  { campo: "memoria", label: "Memoria", opciones: MEMORIAS, labels: MEMORIA_LABELS as Record<string, string> },
  { campo: "sensopercepcion", label: "Sensopercepción", opciones: SENSOPERCEPCIONES, labels: SENSOPERCEPCION_LABELS as Record<string, string> },
  { campo: "contenidoPensamiento", label: "Contenido del pensamiento", opciones: CONTENIDOS_PENSAMIENTO, labels: CONTENIDO_PENSAMIENTO_LABELS as Record<string, string> },
  { campo: "juicio", label: "Juicio", opciones: JUICIOS, labels: JUICIO_LABELS as Record<string, string> },
  { campo: "insight", label: "Insight", opciones: INSIGHTS, labels: INSIGHT_LABELS as Record<string, string> },
];

// ─── Workflow de riesgo suicida: C-SSRS + plan de seguridad (C7) ─────────────
//
// Reemplaza los banners role=alert históricos por un protocolo ESTRUCTURADO:
//   1. C-SSRS (screener de 6 ítems sí/no de lib/instrumentos, renderizado con el
//      PlanillaRenderer genérico en modo binario) → banda de riesgo automática.
//   2. Plan de seguridad documentado: acceso a medios, factores protectores,
//      texto del plan.
// Todo se persiste en el toolData (crisisPlan, v2, cifrado) al guardar la sesión.
// Además, el screener completo se registra en instrumento_respuesta (C2) para el
// tracking longitudinal del riesgo, vía registrarCssrsAction — botón explícito.

/** Copy del motivo del disparo (uno o ambos), para el encabezado del protocolo. */
function motivoCopy(motivos: readonly ("phq9_item9" | "registro_riesgo")[]): string {
  const partes: string[] = [];
  if (motivos.includes("phq9_item9")) partes.push("ítem 9 del PHQ-9 (ideación) > 0");
  if (motivos.includes("registro_riesgo")) partes.push("riesgo registrado (ideación o plan)");
  return partes.join(" y ");
}

function CrisisWorkflow({
  crisisPlan,
  motivos,
  onChange,
  readOnly,
  pacienteId,
  turno,
}: {
  crisisPlan: CrisisPlanDraft | undefined;
  motivos: readonly ("phq9_item9" | "registro_riesgo")[];
  onChange(next: CrisisPlanDraft | undefined): void;
  readOnly?: boolean;
  pacienteId?: string;
  turno?: { id: string; tieneSesionGuardada: boolean } | null;
}) {
  const router = useRouter();
  const [registrando, setRegistrando] = useState(false);
  const [registrado, setRegistrado] = useState(false);
  const [errorRegistro, setErrorRegistro] = useState<string | null>(null);

  const plan = crisisPlan ?? {};
  const cssrs = plan.cssrs ?? null;
  // El score en vivo con la def de la biblioteca (contrato laxo: null si incompleto).
  const score = scoreCssrsCrisis(cssrs);
  const respondidasCssrs = cssrs ? cssrs.filter((r) => r !== null).length : 0;
  const cssrsCompleto = respondidasCssrs === CSSRS_ITEMS_LEN;

  const setCampo = <K extends keyof CrisisPlanDraft>(campo: K, valor: CrisisPlanDraft[K]) => {
    if (readOnly) return;
    onChange({ ...plan, [campo]: valor });
  };

  // El PlanillaRenderer emite Array<number | null> (modo binario, 0/1).
  const setCssrs = (next: number[] | number | null) => {
    if (readOnly) return;
    const arr = Array.isArray(next) ? (next as Array<number | null>) : null;
    onChange({ ...plan, cssrs: arr ?? undefined });
    // Cambió el screener → invalida el "registrado" previo (hay que re-registrar).
    setRegistrado(false);
    setErrorRegistro(null);
  };

  // Registra el screener completo en instrumento_respuesta (tracking longitudinal).
  const registrarEnHistorial = async () => {
    if (readOnly || registrando || !cssrsCompleto || !pacienteId) return;
    const respuestas = (cssrs ?? []).map((r) => (r === 1 ? 1 : 0));
    setRegistrando(true);
    setErrorRegistro(null);
    const result = await registrarCssrsAction({
      pacienteId,
      turnoId: turno?.id ?? null,
      cssrs: respuestas,
    });
    setRegistrando(false);
    if (result.ok) {
      setRegistrado(true);
      router.refresh();
    } else {
      setErrorRegistro(result.error.message);
    }
  };

  return (
    <section
      className="pc-card"
      style={{ borderColor: "var(--red)", boxShadow: "0 0 0 1px var(--red-soft)" }}
    >
      <header className="pc-card-head" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <I.Alert size={15} aria-hidden style={{ color: "var(--red)" }} />
        <span className="fi-eyebrow" style={{ color: "var(--red)" }}>
          Protocolo de riesgo
        </span>
        {score ? (
          <ResultadoBadge
            banda={score.banda}
            def={cssrsDef}
            title="C-SSRS (screener)"
          />
        ) : null}
      </header>

      <p role="alert" style={{ ...AVISO_STYLE }}>
        Se activó por {motivoCopy(motivos)}. Completá el screener C-SSRS y
        documentá el plan de seguridad. Es tamizaje: no reemplaza la evaluación
        clínica presencial ni el juicio profesional.
      </p>

      {/* ── C-SSRS (screener binario, renderer genérico de la biblioteca) ── */}
      <PlanillaRenderer
        def={cssrsDef}
        respuestas={cssrs}
        onChange={setCssrs}
        readOnly={readOnly}
      />

      {/* ── Plan de seguridad ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="fi-eyebrow">Plan de seguridad</span>
        <label className="fi-wi-field">
          <span>Acceso a medios letales y su restricción</span>
          <textarea
            value={plan.accesoMedios ?? ""}
            maxLength={2000}
            onChange={(e) => setCampo("accesoMedios", e.target.value)}
            placeholder="Medios disponibles y medidas acordadas para restringir el acceso…"
            rows={2}
            spellCheck={false}
            disabled={readOnly}
          />
        </label>
        <label className="fi-wi-field">
          <span>Factores protectores</span>
          <textarea
            value={plan.factoresProtectores ?? ""}
            maxLength={2000}
            onChange={(e) => setCampo("factoresProtectores", e.target.value)}
            placeholder="Red de apoyo, razones para vivir, recursos personales…"
            rows={2}
            spellCheck={false}
            disabled={readOnly}
          />
        </label>
        <label className="fi-wi-field">
          <span>Plan de seguridad acordado</span>
          <textarea
            value={plan.planTexto ?? ""}
            maxLength={4000}
            onChange={(e) => setCampo("planTexto", e.target.value)}
            placeholder="Señales de alarma, estrategias de afrontamiento, contactos de emergencia y pasos a seguir…"
            rows={4}
            spellCheck={false}
            disabled={readOnly}
          />
        </label>
      </div>

      {/* ── Registro longitudinal del screener (instrumento_respuesta, C2) ── */}
      {!readOnly ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              className="fi-btn fi-btn-secondary"
              onClick={registrarEnHistorial}
              disabled={!cssrsCompleto || registrando || !pacienteId}
              title={
                !pacienteId
                  ? "Disponible en la ficha del paciente."
                  : !cssrsCompleto
                    ? "Completá las 6 respuestas del C-SSRS para registrar."
                    : "Registra el screener en el historial de riesgo del paciente (seguimiento longitudinal)."
              }
            >
              {registrado ? <I.Check size={12} /> : <I.History size={12} />}
              {registrado ? "Registrado en el historial" : "Registrar C-SSRS en el historial de riesgo"}
            </button>
            {!cssrsCompleto && respondidasCssrs > 0 ? (
              <span className="fm-mono muted" style={{ fontSize: 10.5 }}>
                {respondidasCssrs}/{CSSRS_ITEMS_LEN}
              </span>
            ) : null}
          </div>
          {errorRegistro ? (
            <p role="alert" style={{ margin: 0, fontSize: 11.5, color: "var(--red)" }}>
              No se pudo registrar: {errorRegistro}
            </p>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
              El plan de crisis se guarda con la sesión. «Registrar» además suma
              el screener a la serie de riesgo del paciente (seguimiento
              longitudinal), independiente del SOAP.
            </p>
          )}
        </div>
      ) : score ? (
        <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
          C-SSRS: riesgo {cssrsBandaLabel(score.banda)} (registro de solo lectura).
        </p>
      ) : null}
    </section>
  );
}

// ─── Nota de proceso guiada: SOAP / DAP / BIRP (C8) ──────────────────────────
//
// Nota de proceso ESTRUCTURADA de la sesión, apoyada en el SOAP guiado de Fase 0:
// el profesional elige el formato (SOAP/DAP/BIRP) y redacta cada sección con un
// prompt orientador. Persiste en el toolData (procesoNota, v3, cifrado). El SOAP
// de texto libre de la ficha NO cambia — esto es una nota clínica adicional.

function NotaProcesoBlock({
  nota,
  onChange,
  readOnly,
}: {
  nota: ProcesoNotaDraft | undefined;
  onChange(next: ProcesoNotaDraft | undefined): void;
  readOnly?: boolean;
}) {
  const formato = nota?.formato;
  const campos = nota?.campos ?? {};

  const setFormato = (f: NotaFormato | "") => {
    if (readOnly) return;
    if (f === "") {
      onChange(undefined);
      return;
    }
    onChange({ formato: f, campos: nota?.campos });
  };

  const setCampo = (key: string, valor: string) => {
    if (readOnly || !formato) return;
    onChange({ formato, campos: { ...campos, [key]: valor } });
  };

  return (
    <section className="pc-card">
      <header className="pc-card-head" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="fi-eyebrow">Nota de proceso</span>
        {formato ? (
          <span className="fi-pill" style={{ color: "var(--slate)", background: "var(--slate-soft)", borderColor: "transparent" }}>
            {NOTA_FORMATO_LABELS[formato]}
          </span>
        ) : null}
      </header>

      <label className="fi-wi-field">
        <span>Formato de nota</span>
        <select
          value={formato ?? ""}
          onChange={(e) => setFormato(e.target.value as NotaFormato | "")}
          disabled={readOnly}
          aria-label="Formato de la nota de proceso"
        >
          <option value="">— Sin nota de proceso</option>
          {NOTA_FORMATOS.map((f) => (
            <option key={f} value={f}>
              {NOTA_FORMATO_LABELS[f]}
            </option>
          ))}
        </select>
      </label>

      {formato ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {NOTA_FORMATO_SECCIONES[formato].map((s) => (
            <label key={s.key} className="fi-wi-field">
              <span>{s.label}</span>
              <p className="muted" style={{ margin: "0 0 4px", fontSize: 11, lineHeight: 1.5 }}>
                {s.guia}
              </p>
              <textarea
                value={campos[s.key] ?? ""}
                maxLength={5000}
                onChange={(e) => setCampo(s.key, e.target.value)}
                placeholder={`Escribí ${s.label.toLowerCase()}…`}
                rows={3}
                spellCheck={false}
                disabled={readOnly}
              />
            </label>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5 }}>
          Elegí un formato para redactar la nota de proceso de la sesión (SOAP,
          DAP o BIRP). Es una nota clínica adicional al SOAP de la ficha.
        </p>
      )}
    </section>
  );
}

export function PsicologiaTool({
  value,
  onChange,
  readOnly,
  historial,
  pacienteId,
  turno,
}: SpecialtyToolProps) {
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

  // MSE completo (C8): los dominios ampliados arrancan abiertos si la sesión ya
  // cargó alguno; el profesional puede expandirlos siempre.
  const tieneMseExt = CAMPOS_ESTADO_MENTAL_EXT.some((c) => draft.registro?.[c.campo] != null);
  const [mseExpandido, setMseExpandido] = useState(tieneMseExt);
  const mseAbierto = mseExpandido || tieneMseExt;

  const emit = (next: PsicologiaDraft) => {
    if (readOnly) return;
    onChange(limpiarDraft(next));
  };

  // ── Escalas ──
  const phq9Score = scorePhq9(draft.phq9);
  const gad7Score = scoreGad7(draft.gad7);
  const ideacionPhq9 = (draft.phq9?.[PHQ9_ITEM_IDEACION] ?? 0) > 0;

  // ── Detección de riesgo (C7) ──
  // El trigger PURO (deteccionRiesgo) decide si abrir el workflow estructurado:
  // PHQ-9 ítem 9 > 0 O registro.riesgo in {ideacion, plan}. Reemplaza los dos
  // banners role=alert históricos por el C-SSRS + plan de seguridad.
  const deteccion = deteccionRiesgo(draft);

  const setCrisisPlan = (next: CrisisPlanDraft | undefined) => {
    emit({ ...draft, crisisPlan: next });
  };

  // ── Nota de proceso (C8) ──
  const setProcesoNota = (next: ProcesoNotaDraft | undefined) => {
    emit({ ...draft, procesoNota: next });
  };

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

  // ── Objetivos terapéuticos (ObjetivosBlock genérico de la biblioteca, D3) ──
  const objetivos = draft.objetivos ?? [];

  const setObjetivos = (next: Objetivo[]) => {
    emit({ ...draft, objetivos: next });
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
          <p style={AVISO_STYLE}>
            <b>Ítem 9 mayor a 0:</b> el paciente reportó pensamientos de muerte
            o autolesión. Abajo se abrió el <b>protocolo de riesgo</b> (C-SSRS +
            plan de seguridad) para estructurar la evaluación.
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
          <SerieEvolucion
            serie={aPuntosSerie(series)}
            metricas={METRICAS_SERIE}
            pisoCero
            ariaLabel={`Evolución de puntajes PHQ-9 y GAD-7 en ${series.length} ${series.length === 1 ? "sesión" : "sesiones"}`}
            vacio="Sin escalas completas en el historial todavía. La curva aparece al guardar sesiones con PHQ-9 o GAD-7 completos."
          />
        </div>
      </section>

      {/* ── Registro de sesión: examen del estado mental (MSE completo · C8) ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Examen del estado mental</span>
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
          {CAMPOS_ESTADO_MENTAL_BASE.map(({ campo, label, opciones, labels }) => (
            <label key={campo} className="fi-wi-field">
              <span>{label}</span>
              <select
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

        {/* Dominios ampliados del MSE (C8) — opcionales, detrás de un toggle. */}
        {mseAbierto ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {CAMPOS_ESTADO_MENTAL_EXT.map(({ campo, label, opciones, labels }) => (
              <label key={campo} className="fi-wi-field">
                <span>{label}</span>
                <select
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
        ) : !readOnly ? (
          <button
            type="button"
            className="pc-link"
            onClick={() => setMseExpandido(true)}
            style={{ alignSelf: "flex-start" }}
            title="Agrega orientación, atención, memoria, sensopercepción, contenido del pensamiento, juicio, insight, lenguaje y psicomotricidad"
          >
            + MSE completo (dominios adicionales)
          </button>
        ) : null}

        <label className="fi-wi-field">
          <span>Riesgo</span>
          <select
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
          <p style={AVISO_STYLE}>
            Registraste riesgo con {riesgo === "plan" ? "plan" : "ideación"}. Abajo
            se abrió el <b>protocolo de riesgo</b> (C-SSRS + plan de seguridad)
            para estructurar la evaluación y documentar el plan.
          </p>
        ) : null}
      </section>

      {/* ── Nota de proceso guiada: SOAP / DAP / BIRP (C8) ── */}
      <NotaProcesoBlock
        nota={draft.procesoNota}
        onChange={setProcesoNota}
        readOnly={readOnly}
      />

      {/* ── Dashboard de outcomes (C8) ── */}
      <OutcomesDashboard historial={historial} pacienteId={pacienteId} />

      {/* ── Protocolo de riesgo suicida (C7) ── */}
      {deteccion.activo ? (
        <CrisisWorkflow
          crisisPlan={draft.crisisPlan}
          motivos={deteccion.motivos}
          onChange={setCrisisPlan}
          readOnly={readOnly}
          pacienteId={pacienteId}
          turno={turno}
        />
      ) : null}

      {/* ── Objetivos terapéuticos (ObjetivosBlock genérico, D3) ── */}
      <ObjetivosBlock
        titulo="Objetivos terapéuticos"
        placeholder="Ej.: reducir evitación social…"
        estados={ESTADOS_OBJETIVO}
        estadoLabels={ESTADO_OBJETIVO_LABELS}
        estadoInicial="en_curso"
        objetivos={objetivos}
        ultimos={ultimosObjetivos}
        onChange={setObjetivos}
        readOnly={readOnly}
      />
    </div>
  );
}
