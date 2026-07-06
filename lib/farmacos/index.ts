/**
 * Folio · referencia de fármacos · barrel público (server-safe, puro).
 *
 * Punto de entrada único de la referencia de fármacos (R1): catálogo curado de
 * monodrogas + normalización del renglón de prescripción de texto libre. Es la
 * capa de REFERENCIA de la receta digital — el vademécum completo (marcas,
 * dosis, interacciones) queda diferido (ver header de types.ts). Consumidor
 * previsto: el form de receta (R2, lib/db/recetas.ts) para autocompletar la
 * monodroga y normalizar cada renglón antes de cifrarlo.
 *
 * No importa React ni toca la DB.
 */

export type {
  GrupoTerapeutico,
  Monodroga,
  RenglonPrescripcion,
} from "./types";
export { GRUPO_TERAPEUTICO_LABELS } from "./types";

export { getMonodroga, MONODROGAS, monodrogaIds } from "./monodrogas";

export {
  buscarMonodrogas,
  matchMonodroga,
  MAX_MONODROGA_LEN,
  MAX_RENGLON_LEN,
  normalizarNombre,
  normalizarRenglon,
} from "./normalize";
