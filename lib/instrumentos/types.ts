/**
 * Folio · biblioteca de instrumentos clínicos · tipos + contrato de scoring
 * (server-safe, puro, sin DB, sin React).
 *
 * Este módulo es el KEYSTONE de la profundización clínica (plan C1): define un
 * catálogo de escalas/planillas validadas (DASS-21, PCL-5, NDI, ODI, Borg,
 * PHQ-9, GAD-7, C-SSRS, objetivos SMART) como DEFINICIONES PURAS versionadas en
 * git. Cada definición aporta:
 *   - `items` es-AR (enunciados) + `opciones` de respuesta (Likert / numéricas),
 *   - `score(respuestas)` → resultado con total, subescalas opcionales, banda,
 *     interpretación es-AR y flags clínicas opcionales — o `null` si el
 *     instrumento está incompleto (mismo contrato laxo que psicología).
 *
 * La DB (C2, `instrumento_respuesta`) guarda sólo respuestas cifradas + un
 * snapshot del score en claro (para series longitudinales baratas). El scoring
 * canónico vive acá y se recomputa server-side al persistir. Nada de este
 * módulo importa React ni loguea contenido clínico.
 *
 * NO es diagnóstico: todas las escalas son de tamizaje/seguimiento. La
 * interpretación siempre lo aclara y nunca reemplaza el criterio clínico.
 */

// ─── Dominio clínico (para agrupar/filtrar el catálogo por especialidad) ──────

/**
 * Dominio clínico de un instrumento — permite que cada especialidad ofrezca
 * sólo los instrumentos pertinentes (p. ej. kinesiología → dolor/función;
 * psicología → salud mental). Un instrumento pertenece a un único dominio
 * primario; el registry se filtra por dominio en la UI (C3+).
 */
export type DominioInstrumento =
  | "salud_mental"
  | "dolor_funcion"
  | "esfuerzo_percibido"
  | "riesgo"
  | "objetivos";

export const DOMINIO_LABELS: Record<DominioInstrumento, string> = {
  salud_mental: "Salud mental",
  dolor_funcion: "Dolor y función",
  esfuerzo_percibido: "Esfuerzo percibido",
  riesgo: "Riesgo",
  objetivos: "Objetivos",
};

// ─── Opciones de respuesta ────────────────────────────────────────────────────

/**
 * Una opción de respuesta de un ítem: su `label` es-AR y el `valor` numérico
 * que aporta al puntaje (el índice NO es necesariamente el valor — Borg CR/RPE
 * usa anclas no contiguas). Para escalas Likert clásicas el valor coincide con
 * el índice, pero modelar `valor` explícito mantiene el contrato general.
 */
export interface OpcionRespuesta {
  /** Texto es-AR mostrado en la UI. */
  label: string;
  /** Puntaje que aporta esta opción cuando se elige. */
  valor: number;
}

// ─── Ítems ────────────────────────────────────────────────────────────────────

/**
 * Un ítem de un instrumento. `enunciado` es el texto es-AR; `subescala` (si el
 * instrumento tiene subescalas, p. ej. DASS-21) indica a cuál pertenece.
 * `opciones` puede sobreescribir las del instrumento cuando un ítem usa un set
 * de respuestas distinto (poco común; la mayoría comparte `opciones` a nivel
 * instrumento).
 */
export interface ItemInstrumento {
  /** Enunciado es-AR del ítem. */
  enunciado: string;
  /** Id de la subescala a la que aporta (si el instrumento tiene subescalas). */
  subescala?: string;
  /** Opciones específicas del ítem (sobreescriben las del instrumento). */
  opciones?: readonly OpcionRespuesta[];
}

// ─── Subescalas ───────────────────────────────────────────────────────────────

/** Metadata es-AR de una subescala (p. ej. las 3 del DASS-21). */
export interface SubescalaDef {
  /** Id estable de la subescala (clave en `ScoreInstrumento.subescalas`). */
  id: string;
  /** Nombre es-AR mostrado en la UI. */
  nombre: string;
}

/** Puntaje de una subescala dentro de un score compuesto. */
export interface ScoreSubescala {
  /** Id de la subescala (coincide con `SubescalaDef.id`). */
  id: string;
  /** Nombre es-AR (copiado de la def para conveniencia de la UI). */
  nombre: string;
  /** Puntaje total de la subescala. */
  total: number;
  /** Id de la banda de severidad de la subescala. */
  banda: string;
  /** Etiqueta es-AR de la banda ("moderado", "severo"…). */
  etiqueta: string;
}

// ─── Bandas de severidad ──────────────────────────────────────────────────────

/**
 * Una banda de severidad: `id` estable (persiste en `instrumento_respuesta`),
 * `label` es-AR para la UI. El corte se resuelve dentro de `score()`; la lista
 * de bandas sirve a la UI (leyenda de colores, orden).
 */
export interface BandaDef {
  /** Id estable de la banda (persiste; nunca cambia). */
  id: string;
  /** Etiqueta es-AR mostrada en la UI. */
  label: string;
}

// ─── Resultado de scoring ─────────────────────────────────────────────────────

/**
 * Resultado de puntuar un instrumento completo. Contrato uniforme para toda la
 * biblioteca; la DB (C2) guarda `total` + `banda` en claro para series y cifra
 * las respuestas crudas.
 */
export interface ScoreInstrumento {
  /**
   * Puntaje total del instrumento. Para instrumentos con subescalas es la suma
   * global (o el valor representativo — cada instrumento documenta su total).
   */
  total: number;
  /** Id de la banda de severidad global. */
  banda: string;
  /** Interpretación es-AR lista para la UI (siempre marca que es orientativa). */
  interpretacion: string;
  /** Subescalas, si el instrumento las tiene (p. ej. DASS-21). */
  subescalas?: ScoreSubescala[];
  /**
   * Flags clínicas accionables (p. ej. ideación suicida en PHQ-9 ítem 9, o
   * conducta suicida en C-SSRS). Sólo enums/strings no-PHI; nunca respuestas
   * crudas ni texto libre. La UI las destaca para continuidad de cuidado.
   */
  flags?: readonly string[];
}

// ─── Definición de un instrumento ─────────────────────────────────────────────

/**
 * Definición pura de un instrumento clínico. Versionada en git; es el contrato
 * único de scoring. `id` incluye versión (`dass21.v1`) — nuevas versiones son
 * ADITIVAS (nunca se edita una `.v1` publicada), como el patrón de dos-ids de
 * quiropraxia.
 */
export interface InstrumentoDef {
  /** Id estable con versión, p. ej. "dass21.v1". Persiste en la DB. */
  id: string;
  /** Nombre corto es-AR ("DASS-21", "PCL-5"). */
  nombre: string;
  /** Descripción es-AR de una línea (qué mide, tamizaje/seguimiento). */
  descripcion: string;
  /** Dominio clínico primario (para filtrar el catálogo por especialidad). */
  dominio: DominioInstrumento;
  /**
   * Consigna es-AR (encabezado del bloque de ítems), p. ej. la ventana temporal
   * ("En las últimas 2 semanas…"). Opcional: instrumentos sin consigna común.
   */
  consigna?: string;
  /** Opciones de respuesta compartidas por los ítems (Likert clásico). */
  opciones?: readonly OpcionRespuesta[];
  /** Ítems del instrumento, en orden. */
  items: readonly ItemInstrumento[];
  /** Subescalas, si las tiene (DASS-21). Ausente → escala de una sola dimensión. */
  subescalas?: readonly SubescalaDef[];
  /** Bandas de severidad globales, en orden ascendente. */
  bandas: readonly BandaDef[];
  /**
   * Puntúa el instrumento a partir de las respuestas crudas. Contrato LAXO
   * (acepta `unknown` — el historial trae shapes ajenos): devuelve `null` si el
   * instrumento no está completo o las respuestas no son válidas. Función pura,
   * sin side effects, sin logging.
   *
   * El formato de `respuestas` depende del instrumento (documentado en cada
   * scoring): la mayoría espera `number[]` (un valor por ítem, en orden); Borg
   * espera un único `number`; C-SSRS espera `boolean[]`; objetivos SMART espera
   * un objeto estructurado.
   */
  score(respuestas: unknown): ScoreInstrumento | null;
}
