/**
 * Folio · especialidades · psicología · schema + derivaciones (server-safe).
 *
 * Todo lo que NO es React de la herramienta de psicología (Fase D + C7):
 *   - Schema zod versionado del toolData. El shape de ESCRITURA es v2
 *     (`psicologia.escalas.v2`, C7): sobre v1 AGREGA un bloque `crisisPlan`
 *     OPCIONAL (C-SSRS estructurado + plan de seguridad documentado). El shape v1
 *     (`psicologia.escalas.v1`, escalas + registro + objetivos) se conserva
 *     INTACTO para LEER sesiones viejas (patrón de dos-ids de quiropraxia — acá
 *     DOS ids). Ambos cifrados app-side en sesion.tool_data_cifrado.
 *   - Ítems es-AR de PHQ-9 y GAD-7 + `scorePhq9` / `scoreGad7` — desde C4
 *     TOMADOS DE LA BIBLIOTECA `lib/instrumentos` (defs `phq9.v1`/`gad7.v1`):
 *     los enunciados, la consigna, las opciones y los cortes de banda tienen
 *     una única fuente de verdad allí. Este módulo re-exporta esas constantes y
 *     adapta el score de la biblioteca (`ScoreInstrumento`) a la forma corta
 *     que consumen el resumen y las series (`{ total, banda, etiqueta }`).
 *     Siguen siendo tamizaje: el puntaje NO es diagnóstico.
 *   - `deriveScoreSeries(historial)` — serie cronológica de puntajes para la
 *     curva longitudinal del Tool.
 *   - `resumenSesionPsicologia(toolData)` — string de resumen para
 *     HistorialReciente / TabSesiones ("PHQ-9 12 (moderada) · GAD-7 8 (leve)").
 *   - C7 · `deteccionRiesgo(toolData)` — trigger PURO que decide si abrir el
 *     workflow de riesgo suicida (PHQ-9 ítem 9 > 0 O registro.riesgo in
 *     {ideacion, plan}); `scoreCssrsCrisis` / `resumenCrisisPlan` para el
 *     tracking longitudinal del riesgo vía instrumento_respuesta (C2).
 *
 * Opcional-friendly: una sesión puede cargar solo una escala, solo el registro
 * de estado mental, solo objetivos o solo el plan de crisis — todos los campos
 * son opcionales salvo `v`. Server-safe: lo importan lib/db/* (writer valida
 * antes de cifrar) y el Tool client. PHI: este módulo nunca loguea contenido
 * clínico.
 *
 * Estabilidad (C4→C7): las definiciones de escala tienen una sola fuente de
 * verdad en `lib/instrumentos`; C7 SUBE la versión de escritura a v2 de forma
 * ADITIVA (crisisPlan opcional) — las sesiones v1 se siguen leyendo sin
 * migración de datos.
 */

import { z } from "zod";

import {
  cssrs as cssrsDef,
  dass21 as dass21Def,
  gad7 as gad7Def,
  pcl5 as pcl5Def,
  phq9 as phq9Def,
} from "@/lib/instrumentos";
import { CSSRS_LEN } from "@/lib/instrumentos/scoring/cssrs";
import { PHQ9_ITEM_IDEACION as PHQ9_ITEM_IDEACION_LIB } from "@/lib/instrumentos/scoring/phq9";
import type { InstrumentoDef, ScoreInstrumento } from "@/lib/instrumentos";
// Tipo puro del punto de serie del sparkline genérico (C3) — vive en planilla-core
// (server-safe, sin React); el dashboard (C8) consume PuntoSerie[].
import type { PuntoSerie } from "@/lib/instrumentos/components/planilla-core";
import type { ToolHistorialEntry } from "@/lib/especialidades/types";

// ─── Escalas: ítems es-AR y opciones de frecuencia (desde lib/instrumentos) ──
//
// Fuente de verdad única: las defs `phq9.v1` / `gad7.v1` de la biblioteca. Este
// módulo solo las re-exporta con los nombres históricos de psicología para no
// tocar el Tool ni los tests que ya los importan.

export const PHQ9_LEN = phq9Def.items.length;
export const GAD7_LEN = gad7Def.items.length;

/**
 * Consigna compartida por ambas escalas (encabezado del bloque en la UI). Las
 * dos defs comparten la misma consigna; se toma la de PHQ-9.
 */
export const CONSIGNA_ESCALAS =
  phq9Def.consigna ??
  "En las últimas 2 semanas, ¿con qué frecuencia te molestó cada uno de estos problemas?";

/**
 * Opciones 0–3 (mismas para PHQ-9 y GAD-7). El índice ES el puntaje (Likert
 * clásico: `valor` coincide con la posición). Se derivan de las opciones de la
 * def de PHQ-9.
 */
export const OPCIONES_FRECUENCIA: readonly string[] = (phq9Def.opciones ?? []).map(
  (o) => o.label,
);

export const PHQ9_ITEMS: readonly string[] = phq9Def.items.map((i) => i.enunciado);

export const GAD7_ITEMS: readonly string[] = gad7Def.items.map((i) => i.enunciado);

/** Índice (0-based) del ítem 9 del PHQ-9 (ideación) — aviso clínico si > 0. */
export const PHQ9_ITEM_IDEACION = PHQ9_ITEM_IDEACION_LIB;

// ─── Registro estructurado: examen del estado mental (MSE completo · C8) ─────
//
// C8 profundiza el MSE de 4 selects (apariencia/ánimo/afecto/pensamiento +
// riesgo) a los dominios completos del examen del estado mental (orientación,
// atención, memoria, sensopercepción, contenido del pensamiento, juicio,
// insight, lenguaje, psicomotricidad). Todos los dominios nuevos son ADITIVOS y
// OPCIONALES sobre `registroSchema` (campos comunes v1/v2/v3): las sesiones
// viejas que solo cargaron los 4 dominios originales se siguen leyendo sin
// migración de datos. El value de cada select persiste como enum; los enums
// existentes (apariencia/animo/afecto/pensamiento/riesgo) NO cambian.

export const APARIENCIAS = ["cuidada", "descuidada", "extravagante"] as const;
export type Apariencia = (typeof APARIENCIAS)[number];

export const ANIMOS = ["eutimico", "deprimido", "ansioso", "irritable", "expansivo"] as const;
export type Animo = (typeof ANIMOS)[number];

export const AFECTOS = ["congruente", "restringido", "aplanado", "labil", "incongruente"] as const;
export type Afecto = (typeof AFECTOS)[number];

export const PENSAMIENTOS = [
  "lineal",
  "circunstancial",
  "tangencial",
  "acelerado",
  "enlentecido",
  "disgregado",
] as const;
export type Pensamiento = (typeof PENSAMIENTOS)[number];

export const RIESGOS = ["sin_riesgo", "ideacion", "plan"] as const;
export type Riesgo = (typeof RIESGOS)[number];

// ── Dominios adicionales del MSE (C8) ────────────────────────────────────────

/** Psicomotricidad / actividad motora observada. */
export const PSICOMOTRICIDADES = ["normal", "inquietud", "agitacion", "enlentecimiento", "estupor"] as const;
export type Psicomotricidad = (typeof PSICOMOTRICIDADES)[number];

/** Lenguaje / producción verbal. */
export const LENGUAJES = ["normal", "verborragico", "empobrecido", "disartrico", "mutismo"] as const;
export type Lenguaje = (typeof LENGUAJES)[number];

/** Orientación en tiempo, espacio y persona. */
export const ORIENTACIONES = ["orientado", "desorientado_tiempo", "desorientado_espacio", "desorientado_global"] as const;
export type Orientacion = (typeof ORIENTACIONES)[number];

/** Atención / concentración. */
export const ATENCIONES = ["conservada", "distraibilidad", "hipoprosexia", "hiperprosexia"] as const;
export type Atencion = (typeof ATENCIONES)[number];

/** Memoria (reciente / remota). */
export const MEMORIAS = ["conservada", "hipomnesia_reciente", "hipomnesia_global", "amnesia"] as const;
export type Memoria = (typeof MEMORIAS)[number];

/** Sensopercepción (alucinaciones / ilusiones). */
export const SENSOPERCEPCIONES = ["sin_alteraciones", "ilusiones", "alucinaciones_auditivas", "alucinaciones_visuales", "otras"] as const;
export type Sensopercepcion = (typeof SENSOPERCEPCIONES)[number];

/** Contenido del pensamiento (delirios / ideas sobrevaloradas / obsesiones). */
export const CONTENIDOS_PENSAMIENTO = ["sin_alteraciones", "ideas_sobrevaloradas", "obsesiones", "delirios", "fobias"] as const;
export type ContenidoPensamiento = (typeof CONTENIDOS_PENSAMIENTO)[number];

/** Juicio / prueba de realidad. */
export const JUICIOS = ["conservado", "debilitado", "insuficiente", "desviado"] as const;
export type Juicio = (typeof JUICIOS)[number];

/** Insight / conciencia de enfermedad. */
export const INSIGHTS = ["completo", "parcial", "nulo"] as const;
export type Insight = (typeof INSIGHTS)[number];

/** Labels es-AR para selects (el value persiste como enum del schema). */
export const APARIENCIA_LABELS: Record<Apariencia, string> = {
  cuidada: "Cuidada",
  descuidada: "Descuidada",
  extravagante: "Extravagante",
};

export const ANIMO_LABELS: Record<Animo, string> = {
  eutimico: "Eutímico",
  deprimido: "Deprimido",
  ansioso: "Ansioso",
  irritable: "Irritable",
  expansivo: "Expansivo",
};

export const AFECTO_LABELS: Record<Afecto, string> = {
  congruente: "Congruente",
  restringido: "Restringido",
  aplanado: "Aplanado",
  labil: "Lábil",
  incongruente: "Incongruente",
};

export const PENSAMIENTO_LABELS: Record<Pensamiento, string> = {
  lineal: "Lineal y coherente",
  circunstancial: "Circunstancial",
  tangencial: "Tangencial",
  acelerado: "Acelerado",
  enlentecido: "Enlentecido",
  disgregado: "Disgregado",
};

export const RIESGO_LABELS: Record<Riesgo, string> = {
  sin_riesgo: "Sin riesgo",
  ideacion: "Ideación",
  plan: "Plan",
};

// ── Labels de los dominios adicionales del MSE (C8) ──────────────────────────

export const PSICOMOTRICIDAD_LABELS: Record<Psicomotricidad, string> = {
  normal: "Normal",
  inquietud: "Inquietud psicomotriz",
  agitacion: "Agitación",
  enlentecimiento: "Enlentecimiento",
  estupor: "Estupor",
};

export const LENGUAJE_LABELS: Record<Lenguaje, string> = {
  normal: "Normal",
  verborragico: "Verborrágico",
  empobrecido: "Empobrecido",
  disartrico: "Disártrico",
  mutismo: "Mutismo",
};

export const ORIENTACION_LABELS: Record<Orientacion, string> = {
  orientado: "Orientado en las tres esferas",
  desorientado_tiempo: "Desorientado en tiempo",
  desorientado_espacio: "Desorientado en espacio",
  desorientado_global: "Desorientación global",
};

export const ATENCION_LABELS: Record<Atencion, string> = {
  conservada: "Conservada",
  distraibilidad: "Distraibilidad",
  hipoprosexia: "Hipoprosexia",
  hiperprosexia: "Hiperprosexia",
};

export const MEMORIA_LABELS: Record<Memoria, string> = {
  conservada: "Conservada",
  hipomnesia_reciente: "Hipomnesia reciente",
  hipomnesia_global: "Hipomnesia global",
  amnesia: "Amnesia",
};

export const SENSOPERCEPCION_LABELS: Record<Sensopercepcion, string> = {
  sin_alteraciones: "Sin alteraciones",
  ilusiones: "Ilusiones",
  alucinaciones_auditivas: "Alucinaciones auditivas",
  alucinaciones_visuales: "Alucinaciones visuales",
  otras: "Otras alteraciones",
};

export const CONTENIDO_PENSAMIENTO_LABELS: Record<ContenidoPensamiento, string> = {
  sin_alteraciones: "Sin alteraciones",
  ideas_sobrevaloradas: "Ideas sobrevaloradas",
  obsesiones: "Obsesiones",
  delirios: "Delirios",
  fobias: "Fobias",
};

export const JUICIO_LABELS: Record<Juicio, string> = {
  conservado: "Conservado",
  debilitado: "Debilitado",
  insuficiente: "Insuficiente",
  desviado: "Desviado",
};

export const INSIGHT_LABELS: Record<Insight, string> = {
  completo: "Completo",
  parcial: "Parcial",
  nulo: "Nulo",
};

// ─── Objetivos terapéuticos ─────────────────────────────────────────────────

export const ESTADOS_OBJETIVO = ["en_curso", "logrado", "pausado"] as const;
export type EstadoObjetivo = (typeof ESTADOS_OBJETIVO)[number];

export const ESTADO_OBJETIVO_LABELS: Record<EstadoObjetivo, string> = {
  en_curso: "En curso",
  logrado: "Logrado",
  pausado: "Pausado",
};

// ─── toolData (sesion.tool_data_cifrado, tool_id = psicologia.escalas.v1) ───

/** Una respuesta de escala: entero 0–3 (índice de OPCIONES_FRECUENCIA). */
const itemEscalaSchema = z.number().int().min(0).max(3);

/**
 * Registro del examen del estado mental (MSE). Los 5 dominios originales
 * (apariencia/animo/afecto/pensamiento/riesgo) NO cambian; C8 AGREGA los
 * dominios restantes del MSE, todos OPCIONALES: una sesión v1/v2 que solo cargó
 * los originales sigue parseando (aditivo, sin migración de datos). NO lleva
 * `.strict()` a propósito — es un sub-objeto de `camposComunes`, y la garantía
 * cross-tool la da el `.strict()` de los schemas raíz (v1/v2/v3); acá agregar un
 * dominio nuevo no debe invalidar filas viejas que traigan claves aún no
 * modeladas del borrador.
 */
const registroSchema = z.object({
  // Dominios originales (v1) — no se tocan.
  apariencia: z.enum(APARIENCIAS).optional(),
  animo: z.enum(ANIMOS).optional(),
  afecto: z.enum(AFECTOS).optional(),
  pensamiento: z.enum(PENSAMIENTOS).optional(),
  riesgo: z.enum(RIESGOS).optional(),
  // Dominios agregados por C8 (MSE completo).
  psicomotricidad: z.enum(PSICOMOTRICIDADES).optional(),
  lenguaje: z.enum(LENGUAJES).optional(),
  orientacion: z.enum(ORIENTACIONES).optional(),
  atencion: z.enum(ATENCIONES).optional(),
  memoria: z.enum(MEMORIAS).optional(),
  sensopercepcion: z.enum(SENSOPERCEPCIONES).optional(),
  contenidoPensamiento: z.enum(CONTENIDOS_PENSAMIENTO).optional(),
  juicio: z.enum(JUICIOS).optional(),
  insight: z.enum(INSIGHTS).optional(),
});

const objetivoSchema = z.object({
  texto: z.string().min(1).max(500),
  estado: z.enum(ESTADOS_OBJETIVO),
});

// ─── Plan de crisis / riesgo suicida (v2 · C7) ───────────────────────────────
//
// Cuando el trigger de riesgo (deteccionRiesgo) se dispara — PHQ-9 ítem 9 > 0 O
// registro.riesgo in {ideacion, plan} — la Tool abre un workflow ESTRUCTURADO en
// vez del banner role=alert histórico: un screener C-SSRS de 6 ítems sí/no (de
// lib/instrumentos) + un plan de seguridad documentado (acceso a medios,
// factores protectores, texto del plan). Todo el bloque es OPCIONAL — el
// profesional puede documentar solo el plan sin completar el screener, o al
// revés — y persiste en el toolData (cifrado) como parte de la sesión.
//
// Longitudinal (C2): además del toolData, el screener C-SSRS se registra en
// instrumento_respuesta (lib/db/instrumentos.ts) para el tracking del riesgo a
// lo largo del tratamiento (serie de bandas), independiente del SOAP. La
// serialización del screener es number[] de 6 con 0/1 (mismo shape que consume
// scoreCssrs y el PlanillaRenderer en modo binario).

/** Longitud del screener C-SSRS (re-export de la def de la biblioteca). */
export const CSSRS_ITEMS_LEN = CSSRS_LEN;

/** Enunciados es-AR del C-SSRS (fuente de verdad única: la def de la biblioteca). */
export const CSSRS_ITEMS: readonly string[] = cssrsDef.items.map((i) => i.enunciado);

/** Id versionado del instrumento C-SSRS que se persiste en instrumento_respuesta. */
export const CSSRS_INSTRUMENTO_ID = cssrsDef.id;

/**
 * Una respuesta del screener C-SSRS: entero 0 (No) o 1 (Sí). Se guarda como
 * número (no boolean) para alinear con la serialización de instrumento_respuesta
 * y con el PlanillaRenderer binario, que emite `number | null`. scoreCssrs
 * acepta ambos (boolean[] y (0|1)[]).
 */
const itemCssrsSchema = z.number().int().min(0).max(1);

/**
 * Plan de crisis / seguridad. Todos los campos OPCIONALES (el bloque entero
 * también): documentar el plan no exige el screener y viceversa. `.strict()`
 * igual que el resto: una clave desconocida RECHAZA (no se stripea) — mantiene
 * la garantía cross-tool del toolData.
 */
const crisisPlanSchema = z.object({
  /**
   * Screener C-SSRS (6 respuestas 0/1, completo). Persiste SOLO completo (mismo
   * criterio que PHQ-9/GAD-7: el scoring estándar exige el instrumento entero);
   * el borrador puede tener respuestas parciales en memoria.
   */
  cssrs: z.array(itemCssrsSchema).length(CSSRS_LEN).optional(),
  /** Acceso a medios letales y su restricción (texto libre, PHI). */
  accesoMedios: z.string().max(2000).optional(),
  /** Factores protectores identificados (texto libre, PHI). */
  factoresProtectores: z.string().max(2000).optional(),
  /** Texto del plan de seguridad acordado (texto libre, PHI). */
  planTexto: z.string().max(4000).optional(),
}).strict();

// ─── Nota de proceso guiada: SOAP / DAP / BIRP (v3 · C8) ─────────────────────
//
// C8 agrega notas de PROCESO estructuradas, apoyándose en el SOAP guiado de
// Fase 0 (soapGuia): además del texto libre del SOAP de la ficha, el
// profesional puede redactar la nota de proceso de la sesión en uno de tres
// formatos clínicos estándar de psicología —
//   - SOAP: Subjetivo · Objetivo · Análisis · Plan (mismo marco que la ficha).
//   - DAP:  Datos · Análisis · Plan (nota de proceso condensada).
//   - BIRP: Conducta · Intervención · Respuesta · Plan (foco en la sesión).
// La nota persiste en el toolData (cifrado, PHI) como parte de la sesión. El
// SOAP de texto libre de la ficha NO cambia — esto es una nota clínica
// estructurada ADICIONAL, elegible en el formato que el profesional prefiera.

/** Formatos de nota de proceso soportados. */
export const NOTA_FORMATOS = ["soap", "dap", "birp"] as const;
export type NotaFormato = (typeof NOTA_FORMATOS)[number];

export const NOTA_FORMATO_LABELS: Record<NotaFormato, string> = {
  soap: "SOAP",
  dap: "DAP",
  birp: "BIRP",
};

/** Una sección de un formato de nota: su clave, label es-AR y guía de qué registrar. */
export interface NotaSeccionDef {
  /** Clave estable de la sección (persiste en procesoNota.campos). */
  key: string;
  /** Label es-AR de la sección ("Subjetivo", "Datos", "Conducta"…). */
  label: string;
  /** Prompt orientador es-AR (qué registrar en esta sección). */
  guia: string;
}

/**
 * Estructura de cada formato de nota: sus secciones en orden, con la guía es-AR
 * que orienta qué registrar. Metadata estática (no PHI); la Tool la usa para
 * armar los textareas guiados. Las claves son estables — el texto persiste bajo
 * `procesoNota.campos[key]`.
 */
export const NOTA_FORMATO_SECCIONES: Record<NotaFormato, readonly NotaSeccionDef[]> = {
  soap: [
    { key: "subjetivo", label: "Subjetivo", guia: "Relato del paciente: estado anímico, eventos y motivo de esta sesión." },
    { key: "objetivo", label: "Objetivo", guia: "Observación clínica: examen del estado mental y puntajes de escalas." },
    { key: "analisis", label: "Análisis", guia: "Formulación clínica y evolución respecto de los objetivos terapéuticos." },
    { key: "plan", label: "Plan", guia: "Intervenciones, tareas entre sesiones y encuadre de la próxima." },
  ],
  dap: [
    { key: "datos", label: "Datos", guia: "Datos subjetivos y objetivos de la sesión: relato, observación y hallazgos." },
    { key: "analisis", label: "Análisis", guia: "Interpretación clínica, progreso y evolución del cuadro." },
    { key: "plan", label: "Plan", guia: "Próximos pasos, tareas y foco de la próxima sesión." },
  ],
  birp: [
    { key: "conducta", label: "Conducta", guia: "Comportamiento y presentación observados en la sesión (Behavior)." },
    { key: "intervencion", label: "Intervención", guia: "Técnicas e intervenciones aplicadas durante la sesión." },
    { key: "respuesta", label: "Respuesta", guia: "Respuesta del paciente a las intervenciones y su progreso." },
    { key: "plan", label: "Plan", guia: "Plan de continuidad, tareas y foco de la próxima sesión." },
  ],
};

/** Claves válidas de sección de nota (unión de todas las secciones de todos los formatos). */
const NOTA_SECCION_KEYS = Array.from(
  new Set(
    NOTA_FORMATOS.flatMap((f) => NOTA_FORMATO_SECCIONES[f].map((s) => s.key)),
  ),
);

/**
 * Nota de proceso (v3). `formato` elige el marco (SOAP/DAP/BIRP); `campos` mapea
 * clave de sección → texto libre (PHI). Ambos OPCIONALES: una nota puede tener
 * formato elegido sin texto todavía, o texto de un formato previo. `.strict()`
 * en el bloque; `campos` es un record acotado a las claves conocidas de sección
 * (una clave ajena RECHAZA — la garantía cross-tool también aplica al sub-bloque).
 */
// z.partialRecord (zod v4): a record acotado a las claves de sección conocidas
// que NO exige todas presentes (a diferencia de z.record con enum, que las pide
// exhaustivas) y RECHAZA claves ajenas. Cada valor es texto libre (PHI) ≤ 5000.
const notaSeccionesRecord = z
  .partialRecord(z.enum(NOTA_SECCION_KEYS as [string, ...string[]]), z.string().max(5000))
  .optional();

const procesoNotaSchema = z.object({
  formato: z.enum(NOTA_FORMATOS).optional(),
  campos: notaSeccionesRecord,
}).strict();

/**
 * Campos comunes v1/v2/v3 del toolData de psicología. El shape v1 los usa tal
 * cual; v2 le AGREGA `crisisPlan`; v3 le AGREGA `procesoNota`. Las escalas
 * persisten SOLO completas (longitud exacta, todos los ítems respondidos) — el
 * scoring estándar de PHQ-9/GAD-7 exige el instrumento entero. El borrador del
 * Tool puede tener respuestas parciales en memoria; la UI avisa que una escala
 * incompleta no se puede guardar.
 */
const camposComunes = {
  phq9: z.array(itemEscalaSchema).length(PHQ9_LEN).optional(),
  gad7: z.array(itemEscalaSchema).length(GAD7_LEN).optional(),
  registro: registroSchema.optional(),
  objetivos: z.array(objetivoSchema).max(20).optional(),
} as const;

/**
 * toolData v1 (LEGACY · tool_id = psicologia.escalas.v1).
 *
 * Shape ORIGINAL: escalas + registro de estado mental + objetivos. YA NO es el
 * shape de escritura (lo es v2), pero se conserva INTACTO para LEER las sesiones
 * de psicología pre-C7. No se edita ni se borra (regla aditiva / patrón dos-ids
 * de quiro).
 *
 * .strict(): claves desconocidas RECHAZAN en vez de stripearse. Como todos
 * los campos de contenido son .optional(), sin strict un payload de OTRA
 * herramienta (quiro/cardio) parsearía OK reducido a `{ v: 1 }` y se
 * persistiría con tool_id psico — corrupción silenciosa de PHI. El writer
 * (lib/db/sesiones.ts) depende de este rechazo cross-tool; invariante
 * cubierta en tests/unit/especialidades-meta.test.ts.
 */
export const psicologiaToolDataSchema = z.object({
  v: z.literal(1),
  ...camposComunes,
}).strict();

/**
 * toolData v2 (tool_id = psicologia.escalas.v2, C7).
 *
 * ADITIVO sobre v1: agrega el bloque `crisisPlan` (C-SSRS + plan de seguridad).
 * Escalas, registro y objetivos NO cambian. `v: z.literal(2)` + .strict() igual
 * que v1: un payload de OTRA herramienta (o v1 pelado) RECHAZA — el writer
 * depende de esto para no persistir PHI ajena con el tool_id de psicología.
 * Ya NO es el shape de escritura (lo es v3); se conserva INTACTO para LEER las
 * sesiones pre-C8 (regla aditiva / patrón de ids de quiro — acá TRES ids).
 */
export const psicologiaToolDataV2Schema = z.object({
  v: z.literal(2),
  ...camposComunes,
  crisisPlan: crisisPlanSchema.optional(),
}).strict();

/**
 * toolData v3 (ACTIVO · tool_id = psicologia.escalas.v3, C8).
 *
 * ADITIVO sobre v2: agrega el bloque `procesoNota` (nota de proceso guiada
 * SOAP/DAP/BIRP). El MSE completo se modela como dominios OPCIONALES nuevos
 * dentro de `registro` (camposComunes) — no cambia la forma raíz, así que v1/v2
 * también los leen; solo v3 permite escribir la nota de proceso. Escalas,
 * registro, objetivos y crisisPlan NO cambian. `v: z.literal(3)` + .strict()
 * igual que v1/v2: un payload ajeno (o v1/v2 pelado) RECHAZA — el writer depende
 * de esto para no persistir PHI ajena con el tool_id de psicología.
 */
export const psicologiaToolDataV3Schema = z.object({
  v: z.literal(3),
  ...camposComunes,
  crisisPlan: crisisPlanSchema.optional(),
  procesoNota: procesoNotaSchema.optional(),
}).strict();

export type PsicologiaToolData = z.infer<typeof psicologiaToolDataSchema>;
export type PsicologiaToolDataV2 = z.infer<typeof psicologiaToolDataV2Schema>;
export type PsicologiaToolDataV3 = z.infer<typeof psicologiaToolDataV3Schema>;
export type RegistroSesion = z.infer<typeof registroSchema>;
export type Objetivo = z.infer<typeof objetivoSchema>;
export type CrisisPlan = z.infer<typeof crisisPlanSchema>;
export type ProcesoNota = z.infer<typeof procesoNotaSchema>;

/**
 * Discrimina un toolData psico persistido (descifrado + JSON.parse) entre v3, v2,
 * v1 o vacío. Intenta v3 primero (shape de escritura actual, C8), luego v2 (C7),
 * luego v1 (legacy); si ninguno parsea devuelve `{ kind: "empty" }` (sesión sin
 * tool / de otra herramienta). Espejo de `parseCardiologiaToolData`.
 */
export function parsePsicologiaToolData(
  value: unknown,
):
  | { kind: "v3"; data: PsicologiaToolDataV3 }
  | { kind: "v2"; data: PsicologiaToolDataV2 }
  | { kind: "v1"; data: PsicologiaToolData }
  | { kind: "empty" } {
  const asV3 = psicologiaToolDataV3Schema.safeParse(value);
  if (asV3.success) return { kind: "v3", data: asV3.data };
  const asV2 = psicologiaToolDataV2Schema.safeParse(value);
  if (asV2.success) return { kind: "v2", data: asV2.data };
  const asV1 = psicologiaToolDataSchema.safeParse(value);
  if (asV1.success) return { kind: "v1", data: asV1.data };
  return { kind: "empty" };
}

// ─── Scoring (delega en lib/instrumentos, adapta a la forma corta de psico) ──
//
// Desde C4 el scoring canónico de PHQ-9/GAD-7 vive en las defs de la biblioteca
// (`phq9.v1` / `gad7.v1`): mismos cortes de banda, misma flag de ideación. Acá
// solo se ADAPTA su `ScoreInstrumento` ({ total, banda, interpretacion, flags? })
// a la forma corta que el resumen y las series de psicología ya consumen
// ({ total, banda, etiqueta }). Sin duplicar cutoffs: una sola fuente de verdad.

export type BandaPhq9 = "minima" | "leve" | "moderada" | "moderadamente_severa" | "severa";
export type BandaGad7 = "minima" | "leve" | "moderada" | "severa";

/**
 * Labels es-AR de las bandas. Se derivan de la def de PHQ-9 (que incluye las 4
 * bandas de GAD-7 más "moderadamente severa"), en minúscula para el resumen
 * ("PHQ-9 12 (moderada)"). Es la única banda extra respecto de GAD-7.
 */
export const BANDA_LABELS: Record<BandaPhq9, string> = Object.fromEntries(
  phq9Def.bandas.map((b) => [b.id, b.label.toLowerCase()]),
) as Record<BandaPhq9, string>;

export interface ScorePhq9 {
  total: number;
  banda: BandaPhq9;
  /** Label es-AR de la banda ("moderadamente severa"). */
  etiqueta: string;
}

export interface ScoreGad7 {
  total: number;
  banda: BandaGad7;
  etiqueta: string;
}

/**
 * Puntaje PHQ-9 (0–27) con bandas estándar (0–4 mínima, 5–9 leve, 10–14
 * moderada, 15–19 moderadamente severa, 20–27 severa). Delega en la def de la
 * biblioteca: acepta input desconocido (el historial trae shapes ajenos) y
 * devuelve null si la escala no está completa o no es válida. Tamizaje, NO
 * diagnóstico.
 */
export function scorePhq9(items: unknown): ScorePhq9 | null {
  const r = phq9Def.score(items);
  if (r === null) return null;
  const banda = r.banda as BandaPhq9;
  return { total: r.total, banda, etiqueta: BANDA_LABELS[banda] };
}

/**
 * Puntaje GAD-7 (0–21) con bandas estándar (0–4 mínima, 5–9 leve, 10–14
 * moderada, 15–21 severa). Mismo contrato laxo que scorePhq9 (delega en la def
 * de la biblioteca).
 */
export function scoreGad7(items: unknown): ScoreGad7 | null {
  const r = gad7Def.score(items);
  if (r === null) return null;
  const banda = r.banda as BandaGad7;
  return { total: r.total, banda, etiqueta: BANDA_LABELS[banda] };
}

// ─── Extracciones laxas (historial puede traer shapes viejos/ajenos) ────────

function rawCampo(toolData: unknown, campo: string): unknown {
  if (toolData === null || typeof toolData !== "object") return undefined;
  return (toolData as Record<string, unknown>)[campo];
}

/**
 * Respuestas laxas de una escala para el borrador del Tool: array de longitud
 * fija con null en lo no respondido. Devuelve null si no hay NINGUNA
 * respuesta válida (escala sin cargar).
 */
export function extractRespuestasEscala(raw: unknown, len: number): Array<number | null> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<number | null> = [];
  for (let i = 0; i < len; i++) {
    const v = raw[i];
    out.push(typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3 ? v : null);
  }
  return out.some((v) => v !== null) ? out : null;
}

/** Registro de estado mental laxo: campo a campo, descarta valores fuera de enum. */
export function extractRegistro(raw: unknown): RegistroSesion | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: RegistroSesion = {};
  const set = <K extends keyof RegistroSesion>(k: K, valores: readonly string[]) => {
    const v = r[k];
    if (typeof v === "string" && valores.includes(v)) out[k] = v as RegistroSesion[K];
  };
  set("apariencia", APARIENCIAS);
  set("animo", ANIMOS);
  set("afecto", AFECTOS);
  set("pensamiento", PENSAMIENTOS);
  set("riesgo", RIESGOS);
  // Dominios agregados por C8 (MSE completo) — mismo trato laxo.
  set("psicomotricidad", PSICOMOTRICIDADES);
  set("lenguaje", LENGUAJES);
  set("orientacion", ORIENTACIONES);
  set("atencion", ATENCIONES);
  set("memoria", MEMORIAS);
  set("sensopercepcion", SENSOPERCEPCIONES);
  set("contenidoPensamiento", CONTENIDOS_PENSAMIENTO);
  set("juicio", JUICIOS);
  set("insight", INSIGHTS);
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Nota de proceso (`procesoNota`) de un toolData desconocido, validada como un
 * todo (shape inválido → null). Tolera v1/v2 (sin procesoNota) y ajenos. El
 * historial nunca rompe la ficha. PHI: no loguea el texto de la nota.
 */
export function extractProcesoNota(toolData: unknown): ProcesoNota | null {
  const raw = rawCampo(toolData, "procesoNota");
  const parsed = procesoNotaSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Objetivos de un toolData desconocido, validados item a item (los inválidos
 * se descartan en silencio — el historial no debe romper la ficha).
 */
export function extractObjetivos(toolData: unknown): Objetivo[] {
  const raw = rawCampo(toolData, "objetivos");
  if (!Array.isArray(raw)) return [];
  const out: Objetivo[] = [];
  for (const o of raw) {
    const parsed = objetivoSchema.safeParse(o);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

// ─── Detección de riesgo suicida (C7 · trigger del workflow) ─────────────────
//
// El disparador del workflow de riesgo. PURO y testeable: decide si la Tool debe
// abrir el C-SSRS + plan de seguridad en vez del banner role=alert histórico.

/** Motivo del disparo del workflow (para la copy/UX de la Tool). */
export type MotivoRiesgo = "phq9_item9" | "registro_riesgo";

export interface DeteccionRiesgo {
  /** true = corresponde abrir el workflow de riesgo (C-SSRS + plan de seguridad). */
  activo: boolean;
  /** Motivos concretos que dispararon el workflow (uno o ambos). */
  motivos: MotivoRiesgo[];
}

/**
 * Decide si el workflow de riesgo suicida debe abrirse a partir de las señales
 * ya presentes en el borrador/toolData:
 *
 *   - PHQ-9 ítem 9 (ideación de muerte/autolesión) > 0, O
 *   - registro.riesgo in {ideacion, plan}.
 *
 * Contrato LAXO (acepta borradores parciales y shapes ajenos): lee el ítem 9 del
 * PHQ-9 aunque la escala esté incompleta (basta ese ítem para el trigger clínico)
 * y el enum de riesgo del registro. Función pura, sin side effects, sin logging.
 */
export function deteccionRiesgo(toolData: unknown): DeteccionRiesgo {
  const motivos: MotivoRiesgo[] = [];

  const phq9 = rawCampo(toolData, "phq9");
  if (Array.isArray(phq9)) {
    const item9 = phq9[PHQ9_ITEM_IDEACION];
    if (typeof item9 === "number" && Number.isInteger(item9) && item9 > 0) {
      motivos.push("phq9_item9");
    }
  }

  const registro = rawCampo(toolData, "registro");
  if (registro !== null && typeof registro === "object") {
    const riesgo = (registro as Record<string, unknown>).riesgo;
    if (riesgo === "ideacion" || riesgo === "plan") motivos.push("registro_riesgo");
  }

  return { activo: motivos.length > 0, motivos };
}

// ─── Plan de crisis: extracción laxa + scoring del C-SSRS ────────────────────

/**
 * Bloque `crisisPlan` de un toolData desconocido, validado como un todo (un
 * shape inválido → null). Tolera v1 (sin crisisPlan) y ajenos. El historial
 * nunca rompe la ficha.
 */
export function extractCrisisPlan(toolData: unknown): CrisisPlan | null {
  const raw = rawCampo(toolData, "crisisPlan");
  const parsed = crisisPlanSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Puntúa el screener C-SSRS del plan de crisis con la def canónica de la
 * biblioteca (misma fuente que instrumento_respuesta usa server-side). Contrato
 * laxo: null si el screener está incompleto/inválido (no seis respuestas 0/1).
 * scoreCssrs acepta (0|1)[] — el shape persistido del crisisPlan.
 */
export function scoreCssrsCrisis(respuestas: unknown): ScoreInstrumento | null {
  return cssrsDef.score(respuestas);
}

/**
 * Resumen es-AR corto de un plan de crisis para el historial. Solo enum/estado
 * (banda del C-SSRS + si hay plan documentado); NUNCA respuestas crudas ni el
 * texto libre del plan. Devuelve null si el bloque no aporta nada.
 */
export function resumenCrisisPlan(crisisPlan: CrisisPlan | null | undefined): string | null {
  if (!crisisPlan) return null;
  const partes: string[] = [];
  const score = scoreCssrsCrisis(crisisPlan.cssrs);
  if (score) partes.push(`C-SSRS ${cssrsBandaLabel(score.banda)}`);
  const tienePlan =
    (crisisPlan.planTexto?.trim().length ?? 0) > 0 ||
    (crisisPlan.accesoMedios?.trim().length ?? 0) > 0 ||
    (crisisPlan.factoresProtectores?.trim().length ?? 0) > 0;
  if (tienePlan) partes.push("plan de seguridad");
  return partes.length > 0 ? partes.join(" · ") : null;
}

/** Label es-AR de una banda del C-SSRS (de la def de la biblioteca). */
export function cssrsBandaLabel(banda: string): string {
  const b = cssrsDef.bandas.find((x) => x.id === banda);
  return (b?.label ?? banda).toLowerCase();
}

// ─── Serie longitudinal de puntajes ─────────────────────────────────────────

export interface PsicoSeriesPoint {
  /** Fecha de la sesión (YYYY-MM-DD). */
  fecha: string;
  phq9: number | null;
  gad7: number | null;
}

/**
 * Serie cronológica (ASC, la más vieja primero) de puntajes PHQ-9/GAD-7 para
 * la curva longitudinal. El historial llega DESC (contrato del slot); las
 * sesiones sin ninguna escala completa se omiten. Función pura.
 */
export function deriveScoreSeries(historial: ToolHistorialEntry[]): PsicoSeriesPoint[] {
  const out: PsicoSeriesPoint[] = [];
  // DESC → ASC preservando el orden relativo dentro de la misma fecha.
  for (let i = historial.length - 1; i >= 0; i--) {
    const entry = historial[i];
    const phq9 = scorePhq9(rawCampo(entry.toolData, "phq9"))?.total ?? null;
    const gad7 = scoreGad7(rawCampo(entry.toolData, "gad7"))?.total ?? null;
    if (phq9 === null && gad7 === null) continue;
    out.push({ fecha: entry.fecha, phq9, gad7 });
  }
  // Orden defensivo por fecha (sort estable: empates mantienen el orden).
  out.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return out;
}

// ─── Resumen por sesión ─────────────────────────────────────────────────────

/**
 * Resumen es-AR de una sesión de psicología para el historial:
 *   "PHQ-9 12 (moderada) · GAD-7 8 (leve)"
 *   "PHQ-9 21 (severa) · riesgo: plan · C-SSRS alto · plan de seguridad"
 *   "Registro de sesión"
 * Lee v1, v2 y v3 (parsePsicologiaToolData): escalas, registro y objetivos son
 * comunes a los tres shapes; el plan de crisis (C-SSRS + plan de seguridad, C7)
 * aparece en v2/v3 si está presente. Shapes desconocidos/vacíos degradan a
 * "Sesión registrada" (mismo copy que el resto del registry — el historial nunca
 * rompe). El puntaje detallado (ítem por ítem), el texto libre del plan y el de
 * la nota de proceso (C8) NO viajan al resumen.
 */
export function resumenSesionPsicologia(toolData: unknown): string {
  const parsed = parsePsicologiaToolData(toolData);
  if (parsed.kind === "empty") return "Sesión registrada";

  const { phq9, gad7, registro, objetivos } = parsed.data;
  const partes: string[] = [];

  const sPhq9 = scorePhq9(phq9);
  if (sPhq9) partes.push(`PHQ-9 ${sPhq9.total} (${sPhq9.etiqueta})`);
  const sGad7 = scoreGad7(gad7);
  if (sGad7) partes.push(`GAD-7 ${sGad7.total} (${sGad7.etiqueta})`);

  // Version-agnóstico y laxo: v2 y v3 pueden traer crisisPlan; extractCrisisPlan
  // valida el sub-bloque sin depender del literal de versión.
  const crisisPlan = extractCrisisPlan(toolData);

  const hayRegistro = registro !== undefined && Object.values(registro).some((v) => v !== undefined);
  const hayObjetivos = objetivos !== undefined && objetivos.length > 0;
  const hayCrisis = resumenCrisisPlan(crisisPlan) !== null;
  if (partes.length === 0 && (hayRegistro || hayObjetivos || hayCrisis)) {
    partes.push("Registro de sesión");
  }

  // Decisión clínica/UX deliberada (documentada en docs/PLAN.md, Fase D; C7
  // preserva el comportamiento): el flag categórico de riesgo se destaca en el
  // resumen del historial por continuidad de cuidado — esconder un indicador de
  // riesgo suicida tras navegación extra aumenta el riesgo de pasarlo por alto.
  // Solo viaja el enum/banda (nunca ítems de escala ni texto libre) y el
  // historial de la ficha solo lo ven roles clínicos (gate server-side en
  // pacientes/[id]/page.tsx + RLS can_read_clinical). Revisitar si el resumen
  // sale de la ficha.
  if (registro?.riesgo === "ideacion") partes.push("riesgo: ideación");
  else if (registro?.riesgo === "plan") partes.push("riesgo: plan");

  // C7 · el plan de crisis (banda del C-SSRS + si hay plan documentado) se suma
  // al resumen por la misma razón de continuidad de cuidado. Solo enum/estado.
  const sCrisis = resumenCrisisPlan(crisisPlan);
  if (sCrisis) partes.push(sCrisis);

  return partes.length > 0 ? partes.join(" · ") : "Sesión registrada";
}

// ─── Dashboard de outcomes (C8) ──────────────────────────────────────────────
//
// El dashboard (psicologia/dashboard.tsx) agrega las series de instrumento_respuesta
// (PHQ-9 / GAD-7 / DASS-21 / PCL-5 en el tiempo) usando <SerieEvolucion> de C3, más
// el estado de los objetivos terapéuticos. Estas funciones son PURAS y testeables:
// mapean las filas de instrumento_respuesta (score en claro, no descifra) a los
// puntos genéricos del sparkline, y resumen el estado de objetivos del historial.
// No importan React ni tocan la DB; el snapshot de score (score_total) ya viene
// en claro (C2), así que el dashboard no descifra N filas por render.

/**
 * Instrumentos de salud mental que el dashboard grafica en el tiempo, con su
 * label es-AR y el color (token folio.css). El `id` es el prefijo del
 * `instrumento_id` versionado (phq9.v1, gad7.v1, dass21.v1, pcl5.v1): se compara
 * por familia (sin la versión) para tolerar bumps de versión futuros.
 */
export interface OutcomeInstrumento {
  /** Def de la biblioteca (fuente de nombre + bandas). */
  def: InstrumentoDef;
  /** Clave de la métrica en la serie (== familia del id: "phq9", "gad7"…). */
  key: string;
  /** Color de la línea (token folio.css, sin hex off-theme). */
  color: string;
}

/** Familia (sin versión) de un instrumento_id versionado ("phq9.v1" → "phq9"). */
export function familiaInstrumento(instrumentoId: string): string {
  const dot = instrumentoId.indexOf(".");
  return dot >= 0 ? instrumentoId.slice(0, dot) : instrumentoId;
}

/**
 * Instrumentos de salud mental del dashboard, en orden de presentación. Cada
 * uno es una línea de <SerieEvolucion>. Colores tomados de los tokens de estado
 * / acento de folio.css (sin hex nuevo).
 */
export const OUTCOME_INSTRUMENTOS: readonly OutcomeInstrumento[] = [
  { def: phq9Def, key: familiaInstrumento(phq9Def.id), color: "var(--accent)" },
  { def: gad7Def, key: familiaInstrumento(gad7Def.id), color: "var(--slate)" },
  { def: dass21Def, key: familiaInstrumento(dass21Def.id), color: "var(--amber)" },
  { def: pcl5Def, key: familiaInstrumento(pcl5Def.id), color: "var(--red)" },
];

/**
 * Una fila de instrumento_respuesta que necesita el dashboard: el id versionado,
 * el snapshot de score EN CLARO (null si el instrumento estaba incompleto) y la
 * fecha. Subset estructural de RespuestaInstrumento (lib/db/instrumentos.ts) —
 * se declara acá para no acoplar este módulo puro a la capa de DB.
 */
export interface OutcomeRespuesta {
  instrumentoId: string;
  scoreTotal: number | null;
  /** ISO timestamp (created_at) — se recorta a YYYY-MM-DD para la serie. */
  createdAt: string;
}

/**
 * Deriva la serie longitudinal multi-instrumento para el dashboard a partir de
 * las filas de instrumento_respuesta. Agrupa por FECHA (YYYY-MM-DD) y, dentro de
 * cada fecha, toma el ÚLTIMO score de cada familia de instrumento (una sesión
 * puede aplicar el mismo instrumento más de una vez; el más reciente manda).
 * Solo incluye las familias del dashboard (OUTCOME_INSTRUMENTOS); ignora otras
 * (p. ej. C-SSRS de riesgo, que tiene su propia serie). Filas con score null se
 * omiten (borrador/pre-admisión incompleta). Devuelve puntos ASC por fecha.
 *
 * Puro y total: input raro (fechas mal formadas, ids desconocidos) se descarta
 * sin lanzar. No loguea contenido clínico.
 */
export function deriveOutcomeSeries(respuestas: readonly OutcomeRespuesta[]): PuntoSerie[] {
  const claves = new Set(OUTCOME_INSTRUMENTOS.map((o) => o.key));
  // fecha → (familia → { orden, valor }) — el mayor `orden` (índice de entrada)
  // gana dentro de la misma fecha (el input llega ASC por created_at; sin
  // asumirlo, comparamos por índice para quedarnos con el último visto).
  const porFecha = new Map<string, Map<string, { orden: number; valor: number }>>();

  respuestas.forEach((r, orden) => {
    if (typeof r.scoreTotal !== "number" || !Number.isFinite(r.scoreTotal)) return;
    const familia = familiaInstrumento(r.instrumentoId);
    if (!claves.has(familia)) return;
    const fecha = typeof r.createdAt === "string" ? r.createdAt.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;

    let fila = porFecha.get(fecha);
    if (!fila) {
      fila = new Map();
      porFecha.set(fecha, fila);
    }
    const prev = fila.get(familia);
    if (!prev || orden >= prev.orden) fila.set(familia, { orden, valor: r.scoreTotal });
  });

  const fechas = Array.from(porFecha.keys()).sort((a, b) => a.localeCompare(b));
  return fechas.map((fecha) => {
    const valores: Record<string, number | null> = {};
    const fila = porFecha.get(fecha)!;
    for (const key of claves) {
      valores[key] = fila.get(key)?.valor ?? null;
    }
    return { fecha, valores };
  });
}

/** Métricas de <SerieEvolucion> para el dashboard, derivadas del catálogo de outcomes. */
export const OUTCOME_METRICAS = OUTCOME_INSTRUMENTOS.map((o) => ({
  key: o.key,
  label: o.def.nombre,
  color: o.color,
}));

/**
 * Estado de los objetivos terapéuticos para el dashboard: la cantidad por estado
 * (en curso / logrados / pausados) tomada de la ÚLTIMA sesión del historial que
 * tenga objetivos (el historial llega DESC; la primera con objetivos es la más
 * reciente). Solo agrega conteos por enum — nunca el texto libre del objetivo.
 * Puro. Devuelve null si ninguna sesión registró objetivos.
 */
export interface EstadoObjetivos {
  /** Fecha de la sesión de la que se toman los objetivos (YYYY-MM-DD). */
  fecha: string;
  enCurso: number;
  logrados: number;
  pausados: number;
  total: number;
}

export function deriveEstadoObjetivos(
  historial: readonly ToolHistorialEntry[],
): EstadoObjetivos | null {
  for (const entry of historial) {
    const objetivos = extractObjetivos(entry.toolData);
    if (objetivos.length === 0) continue;
    const enCurso = objetivos.filter((o) => o.estado === "en_curso").length;
    const logrados = objetivos.filter((o) => o.estado === "logrado").length;
    const pausados = objetivos.filter((o) => o.estado === "pausado").length;
    return { fecha: entry.fecha, enCurso, logrados, pausados, total: objetivos.length };
  }
  return null;
}
