/**
 * Folio · referencia de fármacos · tipos + contrato (server-safe, puro, sin DB,
 * sin React).
 *
 * Capa de REFERENCIA de la receta digital (Fase 5 · R1). El MVP de receta
 * (R2/R3) permite prescribir por TEXTO LIBRE (una línea por medicamento) y,
 * opcionalmente, individualizar la MONODROGA (denominación común internacional
 * / DCI — el principio activo). Este módulo NO es un vademécum completo (marcas,
 * presentaciones, interacciones, dosis máximas → diferido, ver R2): es un
 * catálogo curado de monodrogas frecuentes en Argentina para:
 *   - autocompletar la monodroga en el form de receta (R2),
 *   - normalizar/validar tanto la monodroga elegida del catálogo como el texto
 *     libre del renglón de prescripción,
 *   - permitir filtrar el catálogo por grupo terapéutico en la UI.
 *
 * Contrato de datos: la MONODROGA es un dato de referencia PÚBLICO (no PII, no
 * PHI) → puede vivir en git en claro. Lo que se prescribe a UN paciente concreto
 * (renglón + monodroga + dosis) es PHI y lo cifra la tabla `receta` (R2, M79) —
 * NO este módulo. Acá no se importa React ni se toca la DB.
 *
 * "texto libre + monodroga": el renglón de prescripción es texto libre
 * (validado sólo en longitud); la monodroga es OPCIONAL y, si se provee, se
 * normaliza contra el catálogo cuando matchea, o queda como texto libre
 * normalizado cuando el prescriptor escribe una monodroga fuera del catálogo
 * curado (vademécum full diferido → nunca se rechaza una monodroga desconocida).
 */

// ─── Grupo terapéutico (para agrupar/filtrar el catálogo en la UI) ────────────

/**
 * Grupo terapéutico grueso de una monodroga — permite que el form de receta
 * agrupe el catálogo. NO es la clasificación ATC completa (diferida): es un
 * subconjunto pragmático para navegar el catálogo curado.
 */
export type GrupoTerapeutico =
  | "analgesico_aine"
  | "antibiotico"
  | "cardiovascular"
  | "gastrointestinal"
  | "respiratorio"
  | "salud_mental"
  | "endocrino_metabolico"
  | "otros";

export const GRUPO_TERAPEUTICO_LABELS: Record<GrupoTerapeutico, string> = {
  analgesico_aine: "Analgésicos y AINE",
  antibiotico: "Antibióticos",
  cardiovascular: "Cardiovascular",
  gastrointestinal: "Gastrointestinal",
  respiratorio: "Respiratorio",
  salud_mental: "Salud mental",
  endocrino_metabolico: "Endocrino / metabólico",
  otros: "Otros",
};

// ─── Monodroga (principio activo) ─────────────────────────────────────────────

/**
 * Una monodroga del catálogo curado. `id` estable (slug del nombre normalizado)
 * — es lo que un consumidor podría persistir como referencia; `nombre` es la
 * denominación común (DCI) es-AR para mostrar. `sinonimos` cubre variantes de
 * escritura frecuentes (p. ej. acentos, nombres alternativos) para que el match
 * del autocompletado sea tolerante.
 */
export interface Monodroga {
  /** Slug estable (normalizado, sin acentos, minúsculas). P. ej. "ibuprofeno". */
  id: string;
  /** Denominación común (DCI) es-AR para la UI. P. ej. "Ibuprofeno". */
  nombre: string;
  /** Grupo terapéutico grueso (para filtrar el catálogo). */
  grupo: GrupoTerapeutico;
  /** Variantes de escritura/alias que también deben matchear en la búsqueda. */
  sinonimos?: readonly string[];
}

// ─── Renglón de prescripción normalizado ──────────────────────────────────────

/**
 * Resultado de normalizar un renglón de prescripción del form de receta. Es el
 * shape que R2 persiste (cifrado) por cada medicamento de la receta:
 *   - `texto`: el renglón de prescripción, texto libre normalizado (colapsa
 *     espacios, recorta). SIEMPRE presente (es lo mínimo de una prescripción).
 *   - `monodrogaId`: id del catálogo si la monodroga matcheó una entrada
 *     conocida; `null` si no se indicó monodroga o quedó como texto libre.
 *   - `monodroga`: la monodroga tal como se registra (nombre del catálogo si
 *     matcheó, o el texto libre normalizado que escribió el prescriptor); `null`
 *     si no se indicó monodroga.
 */
export interface RenglonPrescripcion {
  texto: string;
  monodrogaId: string | null;
  monodroga: string | null;
}
