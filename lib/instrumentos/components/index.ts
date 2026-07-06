/**
 * Folio · biblioteca de instrumentos · componentes (C3) · barrel.
 *
 * Componentes React hand-styled con folio.css (tokens brass/cream, sin Tailwind)
 * que renderizan cualquier InstrumentoDef de la biblioteca:
 *   - PlanillaRenderer — planilla genérica (likert / binario / numérico).
 *   - ResultadoBadge   — chip de banda coloreado por tono (estilo CHIP_BANDA).
 *   - SerieEvolucion   — sparkline longitudinal genérico (unifica los de cardio/psico).
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

export {
  escalaSerie,
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
