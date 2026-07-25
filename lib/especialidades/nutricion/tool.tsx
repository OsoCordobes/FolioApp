"use client";

/**
 * Folio · especialidades · nutrición · Tool del slot clínico (Fase 2 · N2).
 *
 * Paneles apilados en la columna del slot (pc-plan-grid, 380px):
 *   1. Antropometría — peso (kg) + talla (cm) de la sesión, IMC DERIVADO en vivo
 *      (chip coloreado por banda OMS) + curva longitudinal (peso / IMC / cintura)
 *      con el <SerieEvolucion> genérico de la biblioteca (C3) en modo
 *      NORMALIZADO (D3): peso ~80 kg, IMC ~25 y cintura ~95 cm no comparten
 *      escala — cada métrica se dibuja contra su propio rango observado.
 *   2. Circunferencias — alta de perímetros por sitio (cintura, cadera…) en el
 *      borrador + historial de solo lectura.
 *   3. Pliegues cutáneos — alta de pliegues por sitio (tricipital…) + historial.
 *   4. Plan alimentario — texto libre (plan indicado + observaciones/adherencia).
 *   5. Objetivos nutricionales — alta y estado (en curso/logrado/pausado) con
 *      "retomar de la última sesión" para continuidad.
 *
 * Controlado por el slot: deriva TODO de `value` (toolData del borrador) y
 * notifica cada edición con `onChange(next)`. El IMC NO se persiste — se calcula
 * de peso+talla en vivo (computeImc, pura). Borrador sin contenido → null (el
 * writer persiste tool_data NULL). `historial` es solo lectura. PHI: nunca se
 * loguea contenido clínico.
 *
 * Estilos: clases existentes de folio.css (pc-card / fi-eyebrow / fi-wi-field /
 * fi-pill / pc-link) + tokens en estilos inline puntuales. Sin hex off-theme.
 * A diferencia de kinesiología, nutrición NO usa <PlanillaRenderer> (la
 * antropometría no es una escala de ítems); reusa la biblioteca sólo por
 * <SerieEvolucion>.
 */

import { useMemo, useState, type CSSProperties } from "react";

import * as I from "@/components/icons";
import { ObjetivosBlock } from "@/lib/instrumentos/components";
import {
  SerieEvolucion,
  type MetricaSerie,
  type PuntoSerie,
} from "@/lib/instrumentos/components";
import type { SpecialtyToolProps } from "@/lib/especialidades/types";
import {
  CIRCUNFERENCIA_CM_MAX,
  CIRCUNFERENCIA_CM_MIN,
  computeImc,
  deriveNutriSeries,
  ESTADO_OBJETIVO_NUTRI_LABELS,
  ESTADOS_OBJETIVO_NUTRI,
  extractCircunferencias,
  extractObjetivosNutri,
  extractPliegues,
  PESO_KG_MAX,
  PESO_KG_MIN,
  PLIEGUE_MM_MAX,
  PLIEGUE_MM_MIN,
  SITIO_CIRCUNFERENCIA_LABELS,
  SITIO_PLIEGUE_LABELS,
  SITIOS_CIRCUNFERENCIA,
  SITIOS_PLIEGUE,
  TALLA_CM_MAX,
  TALLA_CM_MIN,
  type Circunferencia,
  type NutriSeriesPoint,
  type NutricionToolData,
  type ObjetivoNutri,
  type Pliegue,
  type SitioCircunferencia,
  type SitioPliegue,
  type TonoImc,
} from "@/lib/especialidades/nutricion/schema";

// ─── Helpers de presentación (tokens, sin hex off-theme) ────────────────────

const CHIP_TONO_IMC: Record<TonoImc, CSSProperties> = {
  green: { color: "var(--green)", background: "var(--green-soft)", borderColor: "transparent" },
  amber: { color: "var(--amber)", background: "var(--amber-soft)", borderColor: "transparent" },
  red: { color: "var(--red)", background: "var(--red-soft)", borderColor: "transparent" },
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MESES[m - 1]} ${String(y).slice(2)}`;
}

// ─── Borrador (controlado desde value) ──────────────────────────────────────

interface NutriDraft {
  v: 1;
  peso?: number;
  talla?: number;
  circunferencias?: Circunferencia[];
  pliegues?: Pliegue[];
  planAlimentario?: string;
  observaciones?: string;
  objetivos?: ObjetivoNutri[];
}

/**
 * Parse LAXO del borrador a un shape v1: tolera shapes parciales re-hidratados y
 * payloads ajenos (→ borrador vacío). La validación estricta
 * (nutricionToolDataSchema) la aplica el writer antes de cifrar.
 */
function parseDraft(value: unknown): NutriDraft {
  const out: NutriDraft = { v: 1 };
  if (value === null || typeof value !== "object") return out;
  const v = value as Record<string, unknown>;

  // Parse LAXO [audit-fixes · ALTO-4]: NO se clampea el rango acá. El input está
  // controlado desde `value` (cada tecla hace emit→onChange→value→parseDraft); si
  // parseDraft descartara valores fuera de rango, tipear "175" pasaría por "1" y
  // "17" (< mínimo), que se descartarían y RESETEARÍAN el input en cada render →
  // el campo sería imposible de tipear dígito a dígito. Se tolera cualquier número
  // finito mientras se escribe; la validación estricta de rango la aplica el writer
  // (nutricionToolDataSchema) antes de cifrar. Mismo patrón que cardiología.
  if (typeof v.peso === "number" && Number.isFinite(v.peso)) {
    out.peso = v.peso;
  }
  if (typeof v.talla === "number" && Number.isFinite(v.talla)) {
    out.talla = v.talla;
  }

  const circ = extractCircunferencias(value);
  if (circ.length > 0) out.circunferencias = circ;
  const pliegues = extractPliegues(value);
  if (pliegues.length > 0) out.pliegues = pliegues;

  if (typeof v.planAlimentario === "string" && v.planAlimentario.trim() !== "") {
    out.planAlimentario = v.planAlimentario;
  }
  if (typeof v.observaciones === "string" && v.observaciones.trim() !== "") {
    out.observaciones = v.observaciones;
  }

  const objetivos = extractObjetivosNutri(value);
  if (objetivos.length > 0) out.objetivos = objetivos;

  return out;
}

/**
 * Normaliza el borrador antes de emitirlo. Todo vacío → null (el writer guarda
 * tool_data NULL, no un `{ v: 1 }` cifrado sin contenido).
 */
function limpiarDraft(next: NutriDraft): NutricionToolData | null {
  const out: NutricionToolData = { v: 1 };
  if (typeof next.peso === "number") out.peso = next.peso;
  if (typeof next.talla === "number") out.talla = next.talla;
  if (next.circunferencias && next.circunferencias.length > 0) out.circunferencias = next.circunferencias;
  if (next.pliegues && next.pliegues.length > 0) out.pliegues = next.pliegues;
  const plan = next.planAlimentario?.trim();
  if (plan) out.planAlimentario = plan.slice(0, 4000);
  const obs = next.observaciones?.trim();
  if (obs) out.observaciones = obs.slice(0, 2000);
  if (next.objetivos && next.objetivos.length > 0) out.objetivos = next.objetivos;

  return out.peso != null ||
    out.talla != null ||
    out.circunferencias ||
    out.pliegues ||
    out.planAlimentario ||
    out.observaciones ||
    out.objetivos
    ? out
    : null;
}

// ─── Serie longitudinal (peso + IMC + cintura) ──────────────────────────────

const METRICAS_SERIE: MetricaSerie[] = [
  { key: "peso", label: "Peso (kg)", color: "var(--accent)" },
  { key: "imc", label: "IMC", color: "var(--amber)" },
  { key: "cintura", label: "Cintura (cm)", color: "var(--slate)" },
];

/** Adapta la serie tipada de nutrición al punto genérico de <SerieEvolucion>. */
function aPuntosSerie(series: NutriSeriesPoint[]): PuntoSerie[] {
  return series.map((p) => ({
    fecha: p.fecha,
    valores: { peso: p.peso, imc: p.imc, cintura: p.cintura },
  }));
}

// ─── Fila de circunferencia (historial y borrador) ──────────────────────────

function CircunferenciaRow({
  medicion,
  fechaSesion,
  onQuitar,
}: {
  medicion: Circunferencia;
  fechaSesion?: string;
  onQuitar?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        padding: "8px 0",
        borderBottom: "1px solid var(--line-soft)",
      }}
    >
      <b style={{ fontSize: 13, color: "var(--ink)" }}>{SITIO_CIRCUNFERENCIA_LABELS[medicion.sitio]}</b>
      <span
        className="fi-pill"
        style={{ color: "var(--slate)", background: "var(--slate-soft)", borderColor: "transparent" }}
      >
        {medicion.cm} cm
      </span>
      {fechaSesion ? (
        <span className="muted" style={{ fontSize: 10.5, marginLeft: "auto" }}>
          {fmtFecha(fechaSesion)}
        </span>
      ) : null}
      {onQuitar ? (
        <button
          type="button"
          className="pc-link"
          onClick={onQuitar}
          style={{ marginLeft: fechaSesion ? 0 : "auto" }}
          aria-label={`Quitar circunferencia de ${SITIO_CIRCUNFERENCIA_LABELS[medicion.sitio]}`}
        >
          Quitar
        </button>
      ) : null}
    </div>
  );
}

// ─── Fila de pliegue (historial y borrador) ─────────────────────────────────

function PliegueRow({
  medicion,
  fechaSesion,
  onQuitar,
}: {
  medicion: Pliegue;
  fechaSesion?: string;
  onQuitar?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        padding: "8px 0",
        borderBottom: "1px solid var(--line-soft)",
      }}
    >
      <b style={{ fontSize: 13, color: "var(--ink)" }}>{SITIO_PLIEGUE_LABELS[medicion.sitio]}</b>
      <span
        className="fi-pill"
        style={{ color: "var(--slate)", background: "var(--slate-soft)", borderColor: "transparent" }}
      >
        {medicion.mm} mm
      </span>
      {fechaSesion ? (
        <span className="muted" style={{ fontSize: 10.5, marginLeft: "auto" }}>
          {fmtFecha(fechaSesion)}
        </span>
      ) : null}
      {onQuitar ? (
        <button
          type="button"
          className="pc-link"
          onClick={onQuitar}
          style={{ marginLeft: fechaSesion ? 0 : "auto" }}
          aria-label={`Quitar pliegue ${SITIO_PLIEGUE_LABELS[medicion.sitio]}`}
        >
          Quitar
        </button>
      ) : null}
    </div>
  );
}

// ─── Tool ───────────────────────────────────────────────────────────────────

const NUEVA_CIRC_INICIAL = { sitio: "" as SitioCircunferencia | "", cm: "" };
const NUEVO_PLIEGUE_INICIAL = { sitio: "" as SitioPliegue | "", mm: "" };

export function NutricionTool({
  value,
  onChange,
  readOnly,
  historial,
}: SpecialtyToolProps) {
  const draft = useMemo(() => parseDraft(value), [value]);
  const series = useMemo(() => deriveNutriSeries(historial), [historial]);
  const imc = useMemo(() => computeImc(draft.peso, draft.talla), [draft.peso, draft.talla]);

  const circHistorial = useMemo(() => {
    const out: Array<{ medicion: Circunferencia; fechaSesion: string }> = [];
    for (const entry of historial) {
      for (const c of extractCircunferencias(entry.toolData)) {
        out.push({ medicion: c, fechaSesion: entry.fecha });
      }
    }
    return out;
  }, [historial]);

  const plieguesHistorial = useMemo(() => {
    const out: Array<{ medicion: Pliegue; fechaSesion: string }> = [];
    for (const entry of historial) {
      for (const p of extractPliegues(entry.toolData)) out.push({ medicion: p, fechaSesion: entry.fecha });
    }
    return out;
  }, [historial]);

  // Últimos objetivos registrados (historial DESC → el primero que tenga).
  const ultimosObjetivos = useMemo(() => {
    for (const entry of historial) {
      const objetivos = extractObjetivosNutri(entry.toolData);
      if (objetivos.length > 0) return { fecha: entry.fecha, objetivos };
    }
    return null;
  }, [historial]);

  const [nuevaCirc, setNuevaCirc] = useState(NUEVA_CIRC_INICIAL);
  const [nuevoPliegue, setNuevoPliegue] = useState(NUEVO_PLIEGUE_INICIAL);
  const [circExpandido, setCircExpandido] = useState(false);
  const [plieguesExpandido, setPlieguesExpandido] = useState(false);

  const emit = (next: NutriDraft) => {
    if (readOnly) return;
    onChange(limpiarDraft(next));
  };

  // ── Peso / talla ──
  const setPeso = (raw: string) => {
    const next = { ...draft };
    if (raw === "") delete next.peso;
    else {
      const n = Number(raw);
      if (Number.isFinite(n)) next.peso = n;
    }
    emit(next);
  };
  const setTalla = (raw: string) => {
    const next = { ...draft };
    if (raw === "") delete next.talla;
    else {
      const n = Number(raw);
      if (Number.isFinite(n)) next.talla = n;
    }
    emit(next);
  };

  // ── Plan alimentario / observaciones ──
  const setPlan = (raw: string) => emit({ ...draft, planAlimentario: raw });
  const setObservaciones = (raw: string) => emit({ ...draft, observaciones: raw });

  // ── Circunferencias: borrador ──
  const circDraft = draft.circunferencias ?? [];
  const circValida =
    nuevaCirc.sitio !== "" && nuevaCirc.cm !== "" && Number.isFinite(Number(nuevaCirc.cm));

  const agregarCirc = () => {
    if (!circValida || readOnly) return;
    const cm = Number(nuevaCirc.cm);
    if (cm < CIRCUNFERENCIA_CM_MIN || cm > CIRCUNFERENCIA_CM_MAX) return;
    const medicion: Circunferencia = { sitio: nuevaCirc.sitio as SitioCircunferencia, cm };
    // Reemplaza una medición del mismo sitio en el borrador (una por sitio/sesión).
    const sinDuplicado = circDraft.filter((c) => c.sitio !== medicion.sitio);
    emit({ ...draft, circunferencias: [...sinDuplicado, medicion] });
    setNuevaCirc(NUEVA_CIRC_INICIAL);
  };

  const quitarCirc = (i: number) => {
    emit({ ...draft, circunferencias: circDraft.filter((_, idx) => idx !== i) });
  };

  // ── Pliegues: borrador ──
  const plieguesDraft = draft.pliegues ?? [];
  const pliegueValido =
    nuevoPliegue.sitio !== "" && nuevoPliegue.mm !== "" && Number.isFinite(Number(nuevoPliegue.mm));

  const agregarPliegue = () => {
    if (!pliegueValido || readOnly) return;
    const mm = Number(nuevoPliegue.mm);
    if (mm < PLIEGUE_MM_MIN || mm > PLIEGUE_MM_MAX) return;
    const medicion: Pliegue = { sitio: nuevoPliegue.sitio as SitioPliegue, mm };
    const sinDuplicado = plieguesDraft.filter((p) => p.sitio !== medicion.sitio);
    emit({ ...draft, pliegues: [...sinDuplicado, medicion] });
    setNuevoPliegue(NUEVO_PLIEGUE_INICIAL);
  };

  const quitarPliegue = (i: number) => {
    emit({ ...draft, pliegues: plieguesDraft.filter((_, idx) => idx !== i) });
  };

  // ── Objetivos (ObjetivosBlock genérico de la biblioteca, D3) ──
  const objetivos = draft.objetivos ?? [];

  const setObjetivos = (next: ObjetivoNutri[]) => {
    emit({ ...draft, objetivos: next });
  };

  const circVisibles = circExpandido ? circHistorial : circHistorial.slice(0, 4);
  const plieguesVisibles = plieguesExpandido ? plieguesHistorial : plieguesHistorial.slice(0, 4);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
      {/* ── Antropometría ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Antropometría</span>
          {imc ? (
            <span
              className="fi-pill"
              style={CHIP_TONO_IMC[imc.tono]}
              title="Índice de masa corporal derivado de peso y talla (orientativo, no diagnóstico)."
            >
              IMC {imc.valor} · {imc.banda}
            </span>
          ) : null}
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label className="fi-wi-field">
            <span>Peso (kg)</span>
            <input
              type="number"
              inputMode="decimal"
              min={PESO_KG_MIN}
              max={PESO_KG_MAX}
              step={0.1}
              value={draft.peso ?? ""}
              onChange={(e) => setPeso(e.target.value)}
              placeholder="kg"
              disabled={readOnly}
            />
          </label>
          <label className="fi-wi-field">
            <span>Talla (cm)</span>
            <input
              type="number"
              inputMode="decimal"
              min={TALLA_CM_MIN}
              max={TALLA_CM_MAX}
              step={0.1}
              value={draft.talla ?? ""}
              onChange={(e) => setTalla(e.target.value)}
              placeholder="cm"
              disabled={readOnly}
            />
          </label>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="fi-eyebrow">Evolución antropométrica</span>
          <SerieEvolucion
            serie={aPuntosSerie(series)}
            metricas={METRICAS_SERIE}
            normalizado
            ariaLabel={`Evolución de peso, IMC y cintura en ${series.length} ${series.length === 1 ? "sesión" : "sesiones"}, cada métrica en su propia escala`}
            vacio="Sin registros antropométricos en el historial todavía. La curva aparece al guardar sesiones con peso, talla o circunferencia de cintura."
          />
        </div>
      </section>

      {/* ── Circunferencias ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Circunferencias</span>
          {circHistorial.length > 4 ? (
            <button type="button" className="pc-link" onClick={() => setCircExpandido((v) => !v)}>
              {circExpandido ? "Mostrar menos" : `Ver todas (${circHistorial.length})`}
            </button>
          ) : null}
        </header>

        {circDraft.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
              En esta sesión
            </span>
            {circDraft.map((m, i) => (
              <CircunferenciaRow
                key={`${m.sitio}-${i}`}
                medicion={m}
                onQuitar={readOnly ? undefined : () => quitarCirc(i)}
              />
            ))}
          </div>
        ) : null}

        {!readOnly ? (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <label className="fi-wi-field" style={{ flex: 1 }}>
              <span>Sitio</span>
              <select
                value={nuevaCirc.sitio}
                onChange={(e) => setNuevaCirc({ ...nuevaCirc, sitio: e.target.value as SitioCircunferencia | "" })}
              >
                <option value="">Elegí…</option>
                {SITIOS_CIRCUNFERENCIA.map((s) => (
                  <option key={s} value={s}>
                    {SITIO_CIRCUNFERENCIA_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="fi-wi-field" style={{ width: 100 }}>
              <span>cm</span>
              <input
                type="number"
                inputMode="decimal"
                min={CIRCUNFERENCIA_CM_MIN}
                max={CIRCUNFERENCIA_CM_MAX}
                step={0.1}
                value={nuevaCirc.cm}
                onChange={(e) => setNuevaCirc({ ...nuevaCirc, cm: e.target.value })}
                placeholder="cm"
              />
            </label>
            <button
              type="button"
              className="fi-btn fi-btn-secondary"
              onClick={agregarCirc}
              disabled={!circValida}
              title={
                circValida
                  ? "Suma la circunferencia al borrador de esta sesión"
                  : "Elegí sitio e ingresá los cm para agregar"
              }
            >
              <I.Plus size={12} /> Agregar
            </button>
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
            Historial
          </span>
          {circHistorial.length === 0 ? (
            <p className="pc-card-text muted" style={{ fontSize: 12.5 }}>
              Sin circunferencias registradas todavía. Las guardadas en sesiones
              anteriores aparecen acá.
            </p>
          ) : (
            circVisibles.map(({ medicion, fechaSesion }, i) => (
              <CircunferenciaRow key={`${fechaSesion}-${medicion.sitio}-${i}`} medicion={medicion} fechaSesion={fechaSesion} />
            ))
          )}
        </div>
      </section>

      {/* ── Pliegues cutáneos ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Pliegues cutáneos</span>
          {plieguesHistorial.length > 4 ? (
            <button type="button" className="pc-link" onClick={() => setPlieguesExpandido((v) => !v)}>
              {plieguesExpandido ? "Mostrar menos" : `Ver todos (${plieguesHistorial.length})`}
            </button>
          ) : null}
        </header>

        {plieguesDraft.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
              En esta sesión
            </span>
            {plieguesDraft.map((m, i) => (
              <PliegueRow
                key={`${m.sitio}-${i}`}
                medicion={m}
                onQuitar={readOnly ? undefined : () => quitarPliegue(i)}
              />
            ))}
          </div>
        ) : null}

        {!readOnly ? (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
            <label className="fi-wi-field" style={{ flex: 1 }}>
              <span>Sitio</span>
              <select
                value={nuevoPliegue.sitio}
                onChange={(e) => setNuevoPliegue({ ...nuevoPliegue, sitio: e.target.value as SitioPliegue | "" })}
              >
                <option value="">Elegí…</option>
                {SITIOS_PLIEGUE.map((s) => (
                  <option key={s} value={s}>
                    {SITIO_PLIEGUE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="fi-wi-field" style={{ width: 100 }}>
              <span>mm</span>
              <input
                type="number"
                inputMode="decimal"
                min={PLIEGUE_MM_MIN}
                max={PLIEGUE_MM_MAX}
                step={0.1}
                value={nuevoPliegue.mm}
                onChange={(e) => setNuevoPliegue({ ...nuevoPliegue, mm: e.target.value })}
                placeholder="mm"
              />
            </label>
            <button
              type="button"
              className="fi-btn fi-btn-secondary"
              onClick={agregarPliegue}
              disabled={!pliegueValido}
              title={
                pliegueValido
                  ? "Suma el pliegue al borrador de esta sesión"
                  : "Elegí sitio e ingresá los mm para agregar"
              }
            >
              <I.Plus size={12} /> Agregar
            </button>
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
            Historial
          </span>
          {plieguesHistorial.length === 0 ? (
            <p className="pc-card-text muted" style={{ fontSize: 12.5 }}>
              Sin pliegues registrados todavía. Los guardados en sesiones
              anteriores aparecen acá.
            </p>
          ) : (
            plieguesVisibles.map(({ medicion, fechaSesion }, i) => (
              <PliegueRow key={`${fechaSesion}-${medicion.sitio}-${i}`} medicion={medicion} fechaSesion={fechaSesion} />
            ))
          )}
        </div>
      </section>

      {/* ── Plan alimentario ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Plan alimentario</span>
        </header>

        <label className="fi-wi-field">
          <span>Plan indicado</span>
          <textarea
            value={draft.planAlimentario ?? ""}
            maxLength={4000}
            onChange={(e) => setPlan(e.target.value)}
            placeholder="Distribución de comidas, calorías, macronutrientes, indicaciones…"
            rows={4}
            spellCheck={false}
            disabled={readOnly}
          />
        </label>

        <label className="fi-wi-field">
          <span>Observaciones / adherencia</span>
          <textarea
            value={draft.observaciones ?? ""}
            maxLength={2000}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Evolución, adherencia al plan, dificultades…"
            rows={2}
            spellCheck={false}
            disabled={readOnly}
          />
        </label>
      </section>

      {/* ── Objetivos nutricionales (ObjetivosBlock genérico, D3) ── */}
      <ObjetivosBlock
        titulo="Objetivos nutricionales"
        placeholder="Ej.: bajar 4 kg en 3 meses…"
        estados={ESTADOS_OBJETIVO_NUTRI}
        estadoLabels={ESTADO_OBJETIVO_NUTRI_LABELS}
        estadoInicial="en_curso"
        objetivos={objetivos}
        ultimos={ultimosObjetivos}
        onChange={setObjetivos}
        readOnly={readOnly}
      />
    </div>
  );
}
