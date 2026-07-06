/**
 * Folio · biblioteca de instrumentos · núcleo puro del renderer (C3).
 *
 * Lógica SIN React ni DOM que sostiene los tres componentes de C3
 * (PlanillaRenderer, ResultadoBadge, SerieEvolucion). Se separa del `.tsx` para
 * poder fijarla con tests unitarios (`node:test` no renderiza React):
 *
 *   - `modoDeInstrumento(def)` — deduce el modo de entrada de un InstrumentoDef
 *     (likert de radios / binario sí-no / numérico de select / estructurado) a
 *     partir de su SHAPE (no de su id), para que un instrumento nuevo herede el
 *     renderer sin tocar código.
 *   - `toneDeBanda(bandaId, def?)` — mapea un id de banda a un tono visual
 *     (good / neutral / warn / bad) por palabras-clave del catálogo, con la
 *     posición dentro de `def.bandas` como desempate. Alimenta el color del chip.
 *   - `escalaSerie(...)` / `puntosMetrica(...)` — normalizan una serie de puntos
 *     a coordenadas del sparkline genérico (mismo cálculo que los sparklines
 *     duplicados de cardio/psico, unificado acá).
 *
 * Nada de esto loguea contenido clínico ni toca la DB. Contrato LAXO como el
 * resto de la biblioteca: entradas raras degradan a un default seguro, nunca
 * lanzan.
 */

import type { InstrumentoDef, OpcionRespuesta } from "../types";

// ─── Modo de entrada de un instrumento ───────────────────────────────────────

/**
 * Cómo se responde un instrumento en el renderer genérico:
 *   - "likert"       → un set de opciones compartido, N ítems, radios por ítem
 *                      (PHQ-9, GAD-7, DASS-21, PCL-5, NDI, ODI). respuestas =
 *                      number[] (valor por ítem, en orden).
 *   - "binario"      → dos opciones (típicamente No/Sí), N ítems, radios sí-no
 *                      por ítem (C-SSRS). respuestas = boolean[] | (0|1)[].
 *   - "numerico"     → un solo ítem, opciones con valores no contiguos, select
 *                      (Borg 6–20). respuestas = number (o [number]).
 *   - "estructurado" → no encaja en los anteriores (SMART: texto libre +
 *                      booleanos). El renderer genérico NO lo dibuja; el
 *                      consumidor usa un form dedicado.
 */
export type ModoInstrumento = "likert" | "binario" | "numerico" | "estructurado";

/**
 * Deduce el modo de entrada de un instrumento a partir de su shape. Reglas, en
 * orden:
 *   1. sin `opciones` compartidas → estructurado (SMART: cada criterio es un
 *      boolean/texto propio, no un set de opciones común).
 *   2. un solo ítem → numerico (Borg: select de una escala de un ancla).
 *   3. exactamente 2 opciones → binario (C-SSRS sí/no).
 *   4. resto → likert (radios 0..N por ítem).
 *
 * Pura y total (nunca lanza): un def malformado cae a "estructurado" (el modo
 * más conservador — el renderer genérico no lo dibuja y deja el fallback al
 * consumidor).
 */
export function modoDeInstrumento(def: InstrumentoDef): ModoInstrumento {
  const opciones = def.opciones;
  if (!opciones || opciones.length === 0) return "estructurado";
  if (def.items.length <= 1) return "numerico";
  if (opciones.length === 2) return "binario";
  return "likert";
}

/**
 * Opciones EFECTIVAS de un ítem: las propias del ítem si las declara (algunos
 * instrumentos las sobreescriben por ítem), o las del instrumento. `[]` si no
 * hay ninguna (instrumento estructurado). Nunca lanza.
 */
export function opcionesDeItem(
  def: InstrumentoDef,
  itemIdx: number,
): readonly OpcionRespuesta[] {
  const item = def.items[itemIdx];
  if (item?.opciones && item.opciones.length > 0) return item.opciones;
  return def.opciones ?? [];
}

// ─── Tono visual de una banda ────────────────────────────────────────────────

/** Tono visual de un resultado — mapea a los tokens de estado de folio.css. */
export type ToneBanda = "good" | "neutral" | "warn" | "bad";

/**
 * Palabras-clave de los ids de banda del catálogo (dass21/phq9/gad7/pcl5/ndi/
 * odi/borg/cssrs/smart), agrupadas por tono. Se comparan por INCLUSIÓN de
 * substring sobre el id normalizado, así que cubren familias enteras
 * ("moderadamente_severa" cae en "sever" → bad; "muy_ligero" en "ligero" →
 * good). El orden de evaluación (bad → warn → good) prioriza la severidad: un
 * id que contenga tanto una clave "warn" como una "bad" se pinta como bad.
 */
const CLAVES_BAD = ["sever", "alto", "extremadamente", "completa", "maximo", "máximo"];
const CLAVES_WARN = ["moderad", "parcial", "intenso"];
const CLAVES_GOOD = [
  "normal",
  "minima",
  "mínima",
  "ninguna",
  "sin_riesgo",
  "muy_ligero",
  "ligero",
  "bajo",
  "completo", // SMART pleno: objetivo completo = buen resultado
];

/**
 * Mapea un id de banda a un tono visual. Estrategia:
 *   1. match por palabra-clave (bad > warn > good) sobre el id — cubre todo el
 *      catálogo actual sin enumerar cada banda de cada instrumento;
 *   2. si no matchea (banda de un instrumento futuro), desempata por POSICIÓN
 *      dentro de `def.bandas` (primer tercio → good, medio → warn, último →
 *      bad), asumiendo que las bandas van de menor a mayor severidad (contrato
 *      del catálogo);
 *   3. sin def o sin banda → neutral.
 *
 * Pura, total, sin logging. `bandaId` null/"" → neutral.
 */
export function toneDeBanda(
  bandaId: string | null | undefined,
  def?: InstrumentoDef,
): ToneBanda {
  if (!bandaId) return "neutral";
  const id = bandaId.toLowerCase();

  if (CLAVES_BAD.some((k) => id.includes(k))) return "bad";
  if (CLAVES_WARN.some((k) => id.includes(k))) return "warn";
  if (CLAVES_GOOD.some((k) => id.includes(k))) return "good";

  // Desempate por posición dentro del catálogo de bandas (menor→mayor severidad).
  if (def && def.bandas.length > 0) {
    const idx = def.bandas.findIndex((b) => b.id === bandaId);
    if (idx >= 0) {
      const n = def.bandas.length;
      if (n === 1) return "neutral";
      const ratio = idx / (n - 1);
      if (ratio <= 0.34) return "good";
      if (ratio >= 0.67) return "bad";
      return "warn";
    }
  }
  return "neutral";
}

/**
 * Etiqueta es-AR de una banda tomada de `def.bandas`, o el propio id como
 * fallback (nunca vacío). Puro.
 */
export function etiquetaDeBanda(bandaId: string, def?: InstrumentoDef): string {
  const b = def?.bandas.find((x) => x.id === bandaId);
  return b?.label ?? bandaId;
}

// ─── Serie longitudinal genérica (sparkline) ─────────────────────────────────

/** Una métrica de la serie: su clave, label es-AR y color (token folio.css). */
export interface MetricaSerie {
  key: string;
  label: string;
  /** Color como var() de folio.css (ej. "var(--accent)"). Sin hex off-theme. */
  color: string;
}

/** Un punto de la serie: fecha + valores por métrica (null = sin dato ese día). */
export interface PuntoSerie {
  /** Fecha de la sesión (YYYY-MM-DD). */
  fecha: string;
  /** Valor por métrica (null cuando la métrica no se registró en ese punto). */
  valores: Record<string, number | null>;
}

/**
 * Escala vertical de la serie: piso/techo del eje Y. `pisoCero=true` ancla el
 * mínimo en 0 (puntajes de escalas, que arrancan en 0) con un margen superior;
 * `pisoCero=false` (vitales: TA/FC no arrancan en 0) usa min/max reales con un
 * margen mínimo de 10 para que una serie plana no colapse. Pura.
 */
export function escalaSerie(
  valores: number[],
  opts: { pisoCero: boolean },
): { min: number; max: number } {
  if (valores.length === 0) return { min: 0, max: 10 };
  if (opts.pisoCero) {
    const max = Math.max(...valores, 10) + 2;
    return { min: 0, max };
  }
  let min = Math.min(...valores);
  let max = Math.max(...valores);
  if (max - min < 10) {
    min -= 5;
    max += 5;
  }
  return { min, max };
}

/**
 * Todos los valores numéricos (no-null) de una serie, aplanados sobre las
 * métricas dadas. Para calcular la escala. Puro.
 */
export function valoresDeSerie(serie: PuntoSerie[], metricas: MetricaSerie[]): number[] {
  const out: number[] = [];
  for (const p of serie) {
    for (const m of metricas) {
      const v = p.valores[m.key];
      if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    }
  }
  return out;
}

/**
 * Puntos (índice, valor) de una métrica que tienen dato (descarta null). Para
 * dibujar la polilínea/círculos de esa métrica. Puro.
 */
export function puntosMetrica(
  serie: PuntoSerie[],
  key: string,
): Array<{ i: number; v: number }> {
  const out: Array<{ i: number; v: number }> = [];
  serie.forEach((p, i) => {
    const v = p.valores[key];
    if (typeof v === "number" && Number.isFinite(v)) out.push({ i, v });
  });
  return out;
}
