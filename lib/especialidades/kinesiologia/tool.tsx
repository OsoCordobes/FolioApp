"use client";

/**
 * Folio · especialidades · kinesiología/fisioterapia · Tool del slot clínico
 * (Fase 2 · N1).
 *
 * Paneles apilados en la columna del slot (pc-plan-grid, 380px):
 *   1. Cuadro y dolor — motivo de consulta (texto libre) + dolor EVA/VAS 0–10
 *      (fila segmentada de un click, <EscalaSegmentada> D3) + curva longitudinal
 *      NORMALIZADA (cada métrica contra su propio rango: EVA 0–10 no se aplasta
 *      contra ODI 0–100) de dolor + scores de outcome.
 *   2. Rango de movilidad (ROM) — alta de mediciones por región (grados) en el
 *      borrador de la sesión + historial de solo lectura.
 *   3. Tests ortopédicos — nombre + resultado categórico (positivo/negativo/
 *      dudoso) en el borrador + historial.
 *   4. Instrumentos de outcome — NDI (cervical), ODI (lumbar) y Borg RPE,
 *      RENDERIZADOS con el <PlanillaRenderer> genérico de la biblioteca (C3),
 *      COLAPSABLES (D3): sin respuestas arrancan plegados con "Cargar {nombre}"
 *      — la sesión típica no administra el cuestionario y no necesita el muro
 *      de fieldsets.
 *   5. Objetivos funcionales — <ObjetivosBlock> genérico de la biblioteca (D3).
 *
 * Controlado por el slot: deriva TODO de `value` (toolData del borrador) y
 * notifica cada edición con `onChange(next)`. Un instrumento a medio responder
 * vive en el borrador como array con null — el schema estricto exige el
 * instrumento completo, así que la UI avisa que incompleto no se puede guardar.
 * Borrador sin contenido → null (el writer persiste tool_data NULL).
 * `historial` es solo lectura. PHI: nunca se loguea contenido clínico.
 *
 * Estilos: clases existentes de folio.css (pc-card / fi-eyebrow / fi-wi-field /
 * fi-pill / pc-link) + tokens en estilos inline puntuales. Sin hex off-theme.
 */

import { useMemo, useState, type CSSProperties } from "react";

import * as I from "@/components/icons";
import { ndi as ndiDef, odi as odiDef, borg as borgDef } from "@/lib/instrumentos";
import { EscalaSegmentada, ObjetivosBlock, PlanillaRenderer } from "@/lib/instrumentos/components";
import {
  SerieEvolucion,
  type MetricaSerie,
  type PuntoSerie,
} from "@/lib/instrumentos/components";
import type { SpecialtyToolProps } from "@/lib/especialidades/types";
import {
  deriveKinesioSeries,
  ESTADO_OBJETIVO_KINE_LABELS,
  ESTADOS_OBJETIVO_KINE,
  EVA_MAX,
  EVA_MIN,
  extractObjetivosKine,
  extractRespuestaBorg,
  extractRespuestasInstrumento,
  extractRom,
  extractTests,
  NDI_LEN,
  ODI_LEN,
  REGION_ROM_LABELS,
  REGIONES_ROM,
  RESULTADO_TEST_LABELS,
  RESULTADOS_TEST,
  ROM_GRADOS_MAX,
  ROM_GRADOS_MIN,
  type KinesioSeriesPoint,
  type KinesiologiaToolData,
  type ObjetivoKine,
  type RegionRom,
  type ResultadoTest,
  type RomMedicion,
  type TestOrtopedico,
} from "@/lib/especialidades/kinesiologia/schema";

// ─── Helpers de presentación (tokens, sin hex off-theme) ────────────────────

const CHIP_RESULTADO: Record<ResultadoTest, CSSProperties> = {
  positivo: { color: "var(--red)", background: "var(--red-soft)", borderColor: "transparent" },
  negativo: { color: "var(--green)", background: "var(--green-soft)", borderColor: "transparent" },
  dudoso: { color: "var(--amber)", background: "var(--amber-soft)", borderColor: "transparent" },
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MESES[m - 1]} ${String(y).slice(2)}`;
}

// ─── Borrador (controlado desde value) ──────────────────────────────────────

/** Sub-borrador de los instrumentos embebidos: respuestas con null parcial. */
interface KinesioDraft {
  v: 1;
  motivo?: string;
  rom?: RomMedicion[];
  tests?: TestOrtopedico[];
  objetivos?: ObjetivoKine[];
  dolorEva?: number;
  /** NDI / ODI a medio responder viven como Array<number | null>. */
  ndi?: Array<number | null>;
  odi?: Array<number | null>;
  /** Borg (6–20) o null. */
  borg?: number;
}

/**
 * Parse LAXO del borrador a un shape v1: tolera shapes parciales re-hidratados,
 * instrumentos a medio responder y payloads ajenos (→ borrador vacío). La
 * validación estricta (kinesiologiaToolDataSchema) la aplica el writer antes de
 * cifrar; la UI avisa la incompletitud de los instrumentos.
 */
function parseDraft(value: unknown): KinesioDraft {
  const out: KinesioDraft = { v: 1 };
  if (value === null || typeof value !== "object") return out;
  const v = value as Record<string, unknown>;

  if (typeof v.motivo === "string" && v.motivo.trim() !== "") out.motivo = v.motivo;

  const rom = extractRom(value);
  if (rom.length > 0) out.rom = rom;
  const tests = extractTests(value);
  if (tests.length > 0) out.tests = tests;
  const objetivos = extractObjetivosKine(value);
  if (objetivos.length > 0) out.objetivos = objetivos;

  const eva = v.dolorEva;
  if (typeof eva === "number" && Number.isInteger(eva) && eva >= EVA_MIN && eva <= EVA_MAX) {
    out.dolorEva = eva;
  }

  const ndi = extractRespuestasInstrumento(v.ndi, NDI_LEN);
  if (ndi) out.ndi = ndi;
  const odi = extractRespuestasInstrumento(v.odi, ODI_LEN);
  if (odi) out.odi = odi;
  const borg = extractRespuestaBorg(v.borg);
  if (borg !== null) out.borg = borg;

  return out;
}

/** ¿El array de respuestas de un instrumento está completo (sin null)? */
function completo(respuestas: Array<number | null> | undefined): number[] | null {
  if (!respuestas || respuestas.some((r) => r === null)) return null;
  return respuestas as number[];
}

/**
 * Normaliza el borrador antes de emitirlo. Los instrumentos (NDI/ODI) se
 * persisten SOLO completos (mismo criterio que las escalas de psicología); los
 * parciales quedan fuera del payload (el borrador vive en memoria hasta
 * completarse). Todo vacío → null (el writer guarda tool_data NULL, no un
 * `{ v: 1 }` cifrado sin contenido).
 */
function limpiarDraft(next: KinesioDraft): KinesiologiaToolData | null {
  const out: KinesiologiaToolData = { v: 1 };
  const motivo = next.motivo?.trim();
  if (motivo) out.motivo = motivo.slice(0, 2000);
  if (next.rom && next.rom.length > 0) out.rom = next.rom;
  if (next.tests && next.tests.length > 0) out.tests = next.tests;
  if (next.objetivos && next.objetivos.length > 0) out.objetivos = next.objetivos;
  if (typeof next.dolorEva === "number") out.dolorEva = next.dolorEva;
  const ndi = completo(next.ndi);
  if (ndi) out.ndi = ndi;
  const odi = completo(next.odi);
  if (odi) out.odi = odi;
  if (typeof next.borg === "number") out.borg = next.borg;

  return out.motivo ||
    out.rom ||
    out.tests ||
    out.objetivos ||
    out.dolorEva != null ||
    out.ndi ||
    out.odi ||
    out.borg != null
    ? out
    : null;
}

// ─── Serie longitudinal (dolor EVA + NDI + ODI + Borg) ──────────────────────
//
// D3: la serie se dibuja en modo NORMALIZADO — las cuatro métricas tienen rangos
// dispares (EVA 0–10, NDI 0–50, ODI 0–100 %, Borg 6–20) y compartir un solo eje
// aplastaba las chicas hasta hacerlas ilegibles. Cada métrica declara el DOMINIO
// de su instrumento: la posición vertical refleja la severidad dentro de ese
// rango, y el tooltip/último valor muestran siempre el valor real.

const METRICAS_SERIE: MetricaSerie[] = [
  { key: "eva", label: "Dolor EVA", color: "var(--red)", dominio: { min: EVA_MIN, max: EVA_MAX } },
  // NDI crudo 0–50 (10 ítems × 0–5, contrato de deriveKinesioSeries).
  { key: "ndi", label: "NDI", color: "var(--accent)", dominio: { min: 0, max: 50 } },
  { key: "odi", label: "ODI %", color: "var(--amber)", dominio: { min: 0, max: 100 } },
  { key: "borg", label: "Borg", color: "var(--slate)", dominio: { min: 6, max: 20 } },
];

/** Adapta la serie tipada de kinesiología al punto genérico de <SerieEvolucion>. */
function aPuntosSerie(series: KinesioSeriesPoint[]): PuntoSerie[] {
  return series.map((p) => ({
    fecha: p.fecha,
    valores: { eva: p.eva, ndi: p.ndi, odi: p.odi, borg: p.borg },
  }));
}

// ─── Fila de ROM (historial y borrador) ─────────────────────────────────────

function RomRow({
  medicion,
  fechaSesion,
  onQuitar,
}: {
  medicion: RomMedicion;
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
        <b style={{ fontSize: 13, color: "var(--ink)" }}>{REGION_ROM_LABELS[medicion.region]}</b>
        <span className="fi-pill" style={{ color: "var(--slate)", background: "var(--slate-soft)", borderColor: "transparent" }}>
          {medicion.grados}°
        </span>
        {onQuitar ? (
          <button
            type="button"
            className="pc-link"
            onClick={onQuitar}
            style={{ marginLeft: "auto" }}
            aria-label={`Quitar medición de ${REGION_ROM_LABELS[medicion.region]}`}
          >
            Quitar
          </button>
        ) : null}
      </div>
      {medicion.nota ? (
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)" }}>{medicion.nota}</p>
      ) : null}
      {fechaSesion ? (
        <span className="muted" style={{ fontSize: 10.5 }}>
          Registrado en la sesión del {fmtFecha(fechaSesion)}
        </span>
      ) : null}
    </div>
  );
}

// ─── Fila de test ortopédico ─────────────────────────────────────────────────

function TestRow({
  test,
  fechaSesion,
  onQuitar,
}: {
  test: TestOrtopedico;
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
        <b style={{ fontSize: 13, color: "var(--ink)" }}>{test.nombre}</b>
        <span className="fi-pill" style={CHIP_RESULTADO[test.resultado]}>
          {RESULTADO_TEST_LABELS[test.resultado]}
        </span>
        {onQuitar ? (
          <button
            type="button"
            className="pc-link"
            onClick={onQuitar}
            style={{ marginLeft: "auto" }}
            aria-label={`Quitar test ${test.nombre}`}
          >
            Quitar
          </button>
        ) : null}
      </div>
      {test.nota ? (
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)" }}>{test.nota}</p>
      ) : null}
      {fechaSesion ? (
        <span className="muted" style={{ fontSize: 10.5 }}>
          Registrado en la sesión del {fmtFecha(fechaSesion)}
        </span>
      ) : null}
    </div>
  );
}

// ─── Tool ───────────────────────────────────────────────────────────────────

const NUEVO_ROM_INICIAL = { region: "", grados: "", nota: "" };
const NUEVO_TEST_INICIAL = { nombre: "", resultado: "" as ResultadoTest | "", nota: "" };

export function KinesiologiaTool({
  value,
  onChange,
  readOnly,
  historial,
}: SpecialtyToolProps) {
  const draft = useMemo(() => parseDraft(value), [value]);
  const series = useMemo(() => deriveKinesioSeries(historial), [historial]);

  const romHistorial = useMemo(() => {
    const out: Array<{ medicion: RomMedicion; fechaSesion: string }> = [];
    for (const entry of historial) {
      for (const r of extractRom(entry.toolData)) out.push({ medicion: r, fechaSesion: entry.fecha });
    }
    return out;
  }, [historial]);

  const testsHistorial = useMemo(() => {
    const out: Array<{ test: TestOrtopedico; fechaSesion: string }> = [];
    for (const entry of historial) {
      for (const t of extractTests(entry.toolData)) out.push({ test: t, fechaSesion: entry.fecha });
    }
    return out;
  }, [historial]);

  // Últimos objetivos registrados (historial DESC → el primero que tenga).
  const ultimosObjetivos = useMemo(() => {
    for (const entry of historial) {
      const objetivos = extractObjetivosKine(entry.toolData);
      if (objetivos.length > 0) return { fecha: entry.fecha, objetivos };
    }
    return null;
  }, [historial]);

  const [nuevoRom, setNuevoRom] = useState(NUEVO_ROM_INICIAL);
  const [nuevoTest, setNuevoTest] = useState(NUEVO_TEST_INICIAL);
  const [romExpandido, setRomExpandido] = useState(false);
  const [testsExpandido, setTestsExpandido] = useState(false);

  const emit = (next: KinesioDraft) => {
    if (readOnly) return;
    onChange(limpiarDraft(next));
  };

  // ── Motivo ──
  const setMotivo = (raw: string) => emit({ ...draft, motivo: raw });

  // ── Dolor EVA (fila segmentada, un click; null = quitar el registro) ──
  const setDolorEva = (n: number | null) => {
    const next = { ...draft };
    if (n === null) delete next.dolorEva;
    else next.dolorEva = n;
    emit(next);
  };

  // ── Instrumentos embebidos (NDI / ODI / Borg) ──
  const setNdi = (next: number[] | number | null) => {
    const arr = Array.isArray(next) ? (next as Array<number | null>) : null;
    const d = { ...draft };
    if (arr && arr.some((r) => r !== null)) d.ndi = arr;
    else delete d.ndi;
    emit(d);
  };
  const setOdi = (next: number[] | number | null) => {
    const arr = Array.isArray(next) ? (next as Array<number | null>) : null;
    const d = { ...draft };
    if (arr && arr.some((r) => r !== null)) d.odi = arr;
    else delete d.odi;
    emit(d);
  };
  const setBorg = (next: number[] | number | null) => {
    const val = Array.isArray(next) ? next[0] : next;
    const d = { ...draft };
    if (typeof val === "number") d.borg = val;
    else delete d.borg;
    emit(d);
  };

  // ── ROM: borrador ──
  const romDraft = draft.rom ?? [];
  const romValido =
    nuevoRom.region !== "" && nuevoRom.grados !== "" && Number.isFinite(Number(nuevoRom.grados));

  const agregarRom = () => {
    if (!romValido || readOnly) return;
    const grados = Math.round(Number(nuevoRom.grados));
    if (grados < ROM_GRADOS_MIN || grados > ROM_GRADOS_MAX) return;
    const medicion: RomMedicion = {
      region: nuevoRom.region as RegionRom,
      grados,
    };
    const nota = nuevoRom.nota.trim();
    if (nota) medicion.nota = nota.slice(0, 500);
    emit({ ...draft, rom: [...romDraft, medicion] });
    setNuevoRom(NUEVO_ROM_INICIAL);
  };

  const quitarRom = (i: number) => {
    emit({ ...draft, rom: romDraft.filter((_, idx) => idx !== i) });
  };

  // ── Tests: borrador ──
  const testsDraft = draft.tests ?? [];
  const testValido = nuevoTest.nombre.trim() !== "" && nuevoTest.resultado !== "";

  const agregarTest = () => {
    if (!testValido || readOnly) return;
    const test: TestOrtopedico = {
      nombre: nuevoTest.nombre.trim().slice(0, 120),
      resultado: nuevoTest.resultado as ResultadoTest,
    };
    const nota = nuevoTest.nota.trim();
    if (nota) test.nota = nota.slice(0, 500);
    emit({ ...draft, tests: [...testsDraft, test] });
    setNuevoTest(NUEVO_TEST_INICIAL);
  };

  const quitarTest = (i: number) => {
    emit({ ...draft, tests: testsDraft.filter((_, idx) => idx !== i) });
  };

  // ── Objetivos (ObjetivosBlock genérico de la biblioteca, D3) ──
  const objetivos = draft.objetivos ?? [];

  const setObjetivos = (next: ObjetivoKine[]) => {
    emit({ ...draft, objetivos: next });
  };

  const romVisibles = romExpandido ? romHistorial : romHistorial.slice(0, 4);
  const testsVisibles = testsExpandido ? testsHistorial : testsHistorial.slice(0, 4);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, minWidth: 0 }}>
      {/* ── Cuadro y dolor ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Cuadro y dolor</span>
          {typeof draft.dolorEva === "number" ? (
            <span
              className="fi-pill"
              style={{ color: "var(--red)", background: "var(--red-soft)", borderColor: "transparent" }}
              title="Dolor referido en escala visual analógica (EVA/VAS 0–10)."
            >
              EVA {draft.dolorEva}/10
            </span>
          ) : null}
        </header>

        <label className="fi-wi-field">
          <span>Motivo de consulta</span>
          <textarea
            value={draft.motivo ?? ""}
            maxLength={2000}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Cuadro actual, evolución y objetivo del paciente…"
            rows={2}
            spellCheck={false}
            disabled={readOnly}
          />
        </label>

        <div className="fi-wi-field">
          <span>Dolor (EVA / VAS 0–10)</span>
          <EscalaSegmentada
            min={EVA_MIN}
            max={EVA_MAX}
            value={draft.dolorEva ?? null}
            onChange={setDolorEva}
            readOnly={readOnly}
            label="Dolor en escala visual analógica de 0 a 10"
            anclas={{ min: "Sin dolor", max: "Peor dolor" }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="fi-eyebrow">Evolución de dolor y función</span>
          <SerieEvolucion
            serie={aPuntosSerie(series)}
            metricas={METRICAS_SERIE}
            normalizado
            ariaLabel={`Evolución de dolor EVA y outcomes en ${series.length} ${series.length === 1 ? "sesión" : "sesiones"}, cada métrica en su propia escala`}
            vacio="Sin registros de dolor u outcomes en el historial todavía. La curva aparece al guardar sesiones con dolor EVA, NDI, ODI o Borg."
          />
        </div>
      </section>

      {/* ── Rango de movilidad (ROM) ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Rango de movilidad (ROM)</span>
          {romHistorial.length > 4 ? (
            <button type="button" className="pc-link" onClick={() => setRomExpandido((v) => !v)}>
              {romExpandido ? "Mostrar menos" : `Ver todos (${romHistorial.length})`}
            </button>
          ) : null}
        </header>

        {romDraft.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
              En esta sesión
            </span>
            {romDraft.map((m, i) => (
              <RomRow
                key={`${m.region}-${i}`}
                medicion={m}
                onQuitar={readOnly ? undefined : () => quitarRom(i)}
              />
            ))}
          </div>
        ) : null}

        {!readOnly ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 10 }}>
              <label className="fi-wi-field">
                <span>Región</span>
                <select
                  value={nuevoRom.region}
                  onChange={(e) => setNuevoRom({ ...nuevoRom, region: e.target.value })}
                >
                  <option value="">Elegí…</option>
                  {REGIONES_ROM.map((r) => (
                    <option key={r} value={r}>
                      {REGION_ROM_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fi-wi-field">
                <span>Grados</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={ROM_GRADOS_MIN}
                  max={ROM_GRADOS_MAX}
                  step={1}
                  value={nuevoRom.grados}
                  onChange={(e) => setNuevoRom({ ...nuevoRom, grados: e.target.value })}
                  placeholder="°"
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <label className="fi-wi-field" style={{ flex: 1 }}>
                <span>Nota (opcional)</span>
                <input
                  type="text"
                  value={nuevoRom.nota}
                  maxLength={500}
                  onChange={(e) => setNuevoRom({ ...nuevoRom, nota: e.target.value })}
                  placeholder="Movimiento, dolor al final del rango…"
                  spellCheck={false}
                />
              </label>
              <button
                type="button"
                className="fi-btn fi-btn-secondary"
                onClick={agregarRom}
                disabled={!romValido}
                title={
                  romValido
                    ? "Suma la medición al borrador de esta sesión"
                    : "Elegí región e ingresá los grados para agregar"
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
          {romHistorial.length === 0 ? (
            <p className="pc-card-text muted" style={{ fontSize: 12.5 }}>
              Sin mediciones de ROM registradas todavía. Las guardadas en sesiones
              anteriores aparecen acá.
            </p>
          ) : (
            romVisibles.map(({ medicion, fechaSesion }, i) => (
              <RomRow key={`${fechaSesion}-${medicion.region}-${i}`} medicion={medicion} fechaSesion={fechaSesion} />
            ))
          )}
        </div>
      </section>

      {/* ── Tests ortopédicos ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Tests ortopédicos</span>
          {testsHistorial.length > 4 ? (
            <button type="button" className="pc-link" onClick={() => setTestsExpandido((v) => !v)}>
              {testsExpandido ? "Mostrar menos" : `Ver todos (${testsHistorial.length})`}
            </button>
          ) : null}
        </header>

        {testsDraft.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
              En esta sesión
            </span>
            {testsDraft.map((t, i) => (
              <TestRow
                key={`${t.nombre}-${i}`}
                test={t}
                onQuitar={readOnly ? undefined : () => quitarTest(i)}
              />
            ))}
          </div>
        ) : null}

        {!readOnly ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 10 }}>
              <label className="fi-wi-field">
                <span>Test</span>
                <input
                  type="text"
                  value={nuevoTest.nombre}
                  maxLength={120}
                  onChange={(e) => setNuevoTest({ ...nuevoTest, nombre: e.target.value })}
                  placeholder="Ej. Neer, Lachman, Lasègue"
                  spellCheck={false}
                />
              </label>
              <label className="fi-wi-field">
                <span>Resultado</span>
                <select
                  value={nuevoTest.resultado}
                  onChange={(e) =>
                    setNuevoTest({ ...nuevoTest, resultado: e.target.value as ResultadoTest | "" })
                  }
                >
                  <option value="">Elegí…</option>
                  {RESULTADOS_TEST.map((r) => (
                    <option key={r} value={r}>
                      {RESULTADO_TEST_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <label className="fi-wi-field" style={{ flex: 1 }}>
                <span>Nota (opcional)</span>
                <input
                  type="text"
                  value={nuevoTest.nota}
                  maxLength={500}
                  onChange={(e) => setNuevoTest({ ...nuevoTest, nota: e.target.value })}
                  placeholder="Lado, maniobra, hallazgo…"
                  spellCheck={false}
                />
              </label>
              <button
                type="button"
                className="fi-btn fi-btn-secondary"
                onClick={agregarTest}
                disabled={!testValido}
                title={
                  testValido
                    ? "Suma el test al borrador de esta sesión"
                    : "Ingresá el nombre y el resultado para agregar"
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
          {testsHistorial.length === 0 ? (
            <p className="pc-card-text muted" style={{ fontSize: 12.5 }}>
              Sin tests registrados todavía. Los guardados en sesiones anteriores
              aparecen acá.
            </p>
          ) : (
            testsVisibles.map(({ test, fechaSesion }, i) => (
              <TestRow key={`${fechaSesion}-${test.nombre}-${i}`} test={test} fechaSesion={fechaSesion} />
            ))
          )}
        </div>
      </section>

      {/* ── Instrumentos de outcome (biblioteca lib/instrumentos, PlanillaRenderer) ── */}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Instrumentos de outcome</span>
        </header>
        <p className="muted" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5 }}>
          Índices de discapacidad y esfuerzo percibido para el seguimiento
          funcional. Tamizaje orientativo — no reemplazan la evaluación clínica.
        </p>
        <PlanillaRenderer def={ndiDef} respuestas={draft.ndi ?? null} onChange={setNdi} readOnly={readOnly} colapsable />
        <PlanillaRenderer def={odiDef} respuestas={draft.odi ?? null} onChange={setOdi} readOnly={readOnly} colapsable />
        <PlanillaRenderer def={borgDef} respuestas={draft.borg ?? null} onChange={setBorg} readOnly={readOnly} colapsable />
      </section>

      {/* ── Objetivos funcionales (ObjetivosBlock genérico, D3) ── */}
      <ObjetivosBlock
        titulo="Objetivos funcionales"
        placeholder="Ej.: recuperar flexión de rodilla a 120°…"
        estados={ESTADOS_OBJETIVO_KINE}
        estadoLabels={ESTADO_OBJETIVO_KINE_LABELS}
        estadoInicial="en_curso"
        objetivos={objetivos}
        ultimos={ultimosObjetivos}
        onChange={setObjetivos}
        readOnly={readOnly}
      />
    </div>
  );
}
