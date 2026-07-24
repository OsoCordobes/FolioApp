/**
 * Folio · biblioteca de instrumentos · componentes (C3) · barrel.
 *
 * Componentes React hand-styled con folio.css (tokens brass/cream, sin Tailwind)
 * que renderizan cualquier InstrumentoDef de la biblioteca:
 *   - PlanillaRenderer  — planilla genérica (likert / binario / numérico),
 *                         colapsable a pedido (D3).
 *   - ResultadoBadge    — chip de banda coloreado por tono (estilo CHIP_BANDA).
 *   - SerieEvolucion    — sparkline longitudinal genérico (unifica los de
 *                         cardio/psico/kinesio/nutri) con tooltips nativos,
 *                         eje Y y modo normalizado (D3).
 *   - EscalaSegmentada  — fila de botones para escalas cortas (EVA 0–10, D3).
 *   - ObjetivosBlock    — panel genérico de objetivos del tratamiento (D3,
 *                         desduplica psico/kinesio/nutri).
 *
 * La lógica pura (modo del instrumento, tono de banda, geometría de la serie)
 * vive en `planilla-core.ts` — server-safe, sin React, testeada en unidad.
 */

export { PlanillaRenderer } from "./PlanillaRenderer";
export type {
  PlanillaRendererProps,
  RespuestasItems,
  RespuestaNumerica,
} from "./PlanillaRenderer";

export { ResultadoBadge } from "./ResultadoBadge";
export type { ResultadoBadgeProps } from "./ResultadoBadge";

export { SerieEvolucion } from "./SerieEvolucion";
export type { SerieEvolucionProps } from "./SerieEvolucion";

export { EscalaSegmentada } from "./EscalaSegmentada";
export type { EscalaSegmentadaProps } from "./EscalaSegmentada";

export { ObjetivosBlock } from "./ObjetivosBlock";
export type { ObjetivosBlockProps, ObjetivoGenerico } from "./ObjetivosBlock";

export {
  distribuirEtiquetas,
  escalaSerie,
  escalasPorMetrica,
  etiquetaDeBanda,
  modoDeInstrumento,
  opcionesDeItem,
  puntosMetrica,
  toneDeBanda,
  valoresDeSerie,
} from "./planilla-core";
export type {
  MetricaSerie,
  ModoInstrumento,
  PuntoSerie,
  ToneBanda,
} from "./planilla-core";
