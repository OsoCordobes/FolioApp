/**
 * Folio · biblioteca de instrumentos · barrel público (server-safe, puro).
 *
 * Punto de entrada único de la biblioteca de instrumentos clínicos (C1). Reúne
 * los tipos, el registry y las definiciones. Consumidores previstos:
 *   - lib/db/instrumentos.ts (C2) — valida + recomputa score al persistir.
 *   - components (C3+) — renderer genérico, badges y series.
 *   - especialidades (C4+, N1, N2) — embeben instrumentos en sus fichas.
 *
 * No importa React ni toca la DB.
 */

export type {
  BandaDef,
  DominioInstrumento,
  InstrumentoDef,
  ItemInstrumento,
  OpcionRespuesta,
  ScoreInstrumento,
  ScoreSubescala,
  SubescalaDef,
} from "./types";
export { DOMINIO_LABELS } from "./types";

export {
  getInstrumento,
  INSTRUMENTOS,
  instrumentoIds,
  instrumentosPorDominio,
} from "./registry";

// Definiciones individuales (para import selectivo cuando no se quiere el índice).
export { borg } from "./scoring/borg";
export { cssrs } from "./scoring/cssrs";
export { dass21 } from "./scoring/dass21";
export { gad7 } from "./scoring/gad7";
export { ndi } from "./scoring/ndi";
export { odi } from "./scoring/odi";
export { pcl5 } from "./scoring/pcl5";
export { phq9 } from "./scoring/phq9";
export { smartGoals } from "./scoring/smart-goals";
