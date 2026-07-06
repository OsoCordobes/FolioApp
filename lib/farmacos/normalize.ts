/**
 * Folio · referencia de fármacos · normalización y matching (puro, sin DB).
 *
 * Helpers para el form de receta (R2): normalizar el renglón de prescripción
 * (texto libre) y resolver la monodroga contra el catálogo curado con matching
 * tolerante (acentos/mayúsculas/sinónimos). Contrato LAXO: nunca rechaza una
 * monodroga desconocida (vademécum full diferido) — si no matchea el catálogo,
 * la deja como texto libre normalizado. Funciones puras, sin side effects, sin
 * logging (el contenido es PHI cuando se aplica a un paciente: lo cifra R2).
 */

import { MONODROGAS } from "./monodrogas";
import type { Monodroga, RenglonPrescripcion } from "./types";

/** Longitud máxima de un renglón de prescripción de texto libre. */
export const MAX_RENGLON_LEN = 300;
/** Longitud máxima del nombre de una monodroga escrita a mano. */
export const MAX_MONODROGA_LEN = 120;

/**
 * Normaliza texto para COMPARACIÓN (no para mostrar): minúsculas, sin acentos,
 * espacios colapsados, recortado. Base del matching tolerante contra el catálogo
 * y sus sinónimos. NUNCA se persiste este valor — es sólo para comparar.
 */
export function normalizarNombre(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita diacríticos (rango de combining marks)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normaliza texto para MOSTRAR/PERSISTIR: colapsa espacios internos y recorta,
 * pero preserva acentos y capitalización tal como los escribió el prescriptor.
 * Devuelve `""` si el input queda vacío tras recortar.
 */
function normalizarParaMostrar(valor: string): string {
  return valor.replace(/\s+/g, " ").trim();
}

/**
 * Busca una monodroga del catálogo por nombre/sinónimo con matching tolerante.
 * Devuelve la `Monodroga` si el texto normalizado coincide EXACTO con el nombre
 * o alguno de los sinónimos de una entrada; `undefined` si no hay match (el
 * caller la trata como texto libre). No hace match parcial/fuzzy: el
 * autocompletado de la UI (R2) filtra por prefijo; esta función confirma la
 * selección.
 */
export function matchMonodroga(valor: string): Monodroga | undefined {
  const needle = normalizarNombre(valor);
  if (needle.length === 0) return undefined;
  for (const m of MONODROGAS) {
    if (normalizarNombre(m.nombre) === needle) return m;
    if (m.sinonimos?.some((s) => normalizarNombre(s) === needle)) return m;
  }
  return undefined;
}

/**
 * Filtra el catálogo por prefijo del término de búsqueda (para el
 * autocompletado de la UI). Matchea contra el nombre y los sinónimos, con
 * matching tolerante. Query vacía → catálogo completo (orden del módulo).
 */
export function buscarMonodrogas(query: string): readonly Monodroga[] {
  const needle = normalizarNombre(query);
  if (needle.length === 0) return MONODROGAS;
  return MONODROGAS.filter((m) => {
    if (normalizarNombre(m.nombre).includes(needle)) return true;
    return m.sinonimos?.some((s) => normalizarNombre(s).includes(needle)) ?? false;
  });
}

/**
 * Normaliza un renglón de prescripción del form de receta a
 * `RenglonPrescripcion` (el shape que R2 cifra por medicamento), o `null` si el
 * renglón es inválido (texto vacío tras recortar, o excede los límites de
 * longitud).
 *
 * `texto` es el renglón libre (obligatorio). `monodroga` es opcional: si matchea
 * el catálogo se registra el nombre canónico + su `id`; si no matchea, se
 * conserva como texto libre normalizado con `monodrogaId = null` (vademécum full
 * diferido → nunca se rechaza una monodroga fuera del catálogo). Contrato laxo:
 * acepta `unknown` para tolerar inputs ajenos sin romper.
 */
export function normalizarRenglon(input: unknown): RenglonPrescripcion | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const o = input as Record<string, unknown>;

  if (typeof o.texto !== "string") return null;
  const texto = normalizarParaMostrar(o.texto);
  if (texto.length === 0 || texto.length > MAX_RENGLON_LEN) return null;

  // Monodroga opcional. undefined/null/no-string se tratan como ausente (la
  // monodroga es opcional); un no-string explícito distinto de null (número,
  // objeto) sí es un input malformado → null. Whitespace-only equivale a
  // ausente (no invalida el renglón).
  let monodrogaId: string | null = null;
  let monodroga: string | null = null;
  if (o.monodroga !== undefined && o.monodroga !== null) {
    if (typeof o.monodroga !== "string") return null;
    const cruda = normalizarParaMostrar(o.monodroga);
    if (cruda.length > MAX_MONODROGA_LEN) return null;
    if (cruda.length > 0) {
      const match = matchMonodroga(cruda);
      if (match) {
        monodrogaId = match.id;
        monodroga = match.nombre; // nombre canónico del catálogo
      } else {
        monodroga = cruda; // texto libre normalizado (id queda null)
      }
    }
  }

  return { texto, monodrogaId, monodroga };
}
