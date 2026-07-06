/**
 * Folio · especialidades · metadata del registry (SERVER-SAFE, sin React).
 *
 * Fuente de verdad de las especialidades soportadas (Fase B del plan
 * multi-especialidad). La parte client (componentes Tool) vive en
 * lib/especialidades/registry.tsx; este módulo lo importan también los
 * readers/writers de lib/db/* que no pueden depender de "use client".
 *
 * Invariantes:
 *   - Los slugs acá == el CHECK organization_especialidad_valida (M50).
 *     Sumar una especialidad = nueva migración ampliando el CHECK + entrada acá.
 *   - `toolId` identifica el shape versionado de sesion.tool_data_cifrado.
 *   - `schema` valida el toolData ANTES de cifrar/persistir (writer único:
 *     lib/db/sesiones.ts).
 */

import { z } from "zod";

import {
  cardiologiaToolDataV3Schema,
  resumenSesionCardiologia,
} from "@/lib/especialidades/cardiologia/schema";
import { intakeAvanzadoCardiologia } from "@/lib/especialidades/cardiologia/intake";
import {
  psicologiaToolDataV3Schema,
  resumenSesionPsicologia,
} from "@/lib/especialidades/psicologia/schema";
import { intakeAvanzadoPsicologia } from "@/lib/especialidades/psicologia/intake";
import {
  quiropraxiaToolDataV2Schema,
  resumenSesionQuiropraxia,
} from "@/lib/especialidades/quiropraxia/schema";
import { intakeAvanzadoQuiropraxia } from "@/lib/especialidades/quiropraxia/intake";
import {
  kinesiologiaToolDataSchema,
  resumenSesionKinesiologia,
} from "@/lib/especialidades/kinesiologia/schema";
import { intakeAvanzadoKinesiologia } from "@/lib/especialidades/kinesiologia/intake";
import {
  nutricionToolDataSchema,
  resumenSesionNutricion,
} from "@/lib/especialidades/nutricion/schema";
import { intakeAvanzadoNutricion } from "@/lib/especialidades/nutricion/intake";
import type { IntakeAvanzadoConfig, SoapGuia } from "@/lib/especialidades/types";

// ─── Slugs ──────────────────────────────────────────────────────────────────

export const ESPECIALIDAD_SLUGS = [
  "quiropraxia",
  "cardiologia",
  "psicologia",
  "kinesiologia",
  "nutricion",
] as const;

export type EspecialidadSlug = (typeof ESPECIALIDAD_SLUGS)[number];

export function isEspecialidadSlug(value: string): value is EspecialidadSlug {
  return (ESPECIALIDAD_SLUGS as readonly string[]).includes(value);
}

/**
 * Cookie de override de especialidad para CUENTAS INTERNAS (is_internal_account).
 * Permite previsualizar la ficha clínica de otra especialidad sin tocar la
 * config real del consultorio. Solo se HONRA server-side cuando la org es
 * interna (ver el layout (app) y pacientes/[id]/page.tsx). Valor = un
 * EspecialidadSlug; ausente o inválido = sin override (se usa la real).
 */
export const ESPECIALIDAD_OVERRIDE_COOKIE = "folio_esp_override";

/**
 * Normaliza un valor arbitrario (ej. columna organization.especialidad) a un
 * slug conocido. Fallback a quiropraxia: una org con valor desconocido (CHECK
 * futuro más amplio que el registry deployado) degrada al comportamiento
 * histórico en vez de romper la ficha.
 */
export function normalizeEspecialidadSlug(value: string | null | undefined): EspecialidadSlug {
  return value && isEspecialidadSlug(value) ? value : "quiropraxia";
}

/**
 * Especialidad EFECTIVA de un profesional (M55): la propia del member si la
 * tiene y el registry la conoce; si no, la de la organización (normalizada).
 *
 *   - member.especialidad NULL  → hereda organization.especialidad (caso de
 *     todas las orgs Solo: comportamiento idéntico al pre-M55).
 *   - slug de member desconocido para este deploy (CHECK futuro más amplio
 *     que el registry) → cae a la org, NO a quiropraxia directo: degrada al
 *     comportamiento org-level histórico en vez de cambiar de herramienta.
 *
 * Pura y testeable (tests/unit/especialidad-efectiva.test.ts). La usan el
 * writer único de sesiones (lib/db/sesiones.ts) y el reader de la ficha
 * (lib/db/paciente-ficha.ts) — derivación server-side, nunca del cliente.
 */
export function resolveEspecialidadEfectiva(
  memberEspecialidad: string | null | undefined,
  orgEspecialidad: string | null | undefined,
): EspecialidadSlug {
  if (memberEspecialidad && isEspecialidadSlug(memberEspecialidad)) return memberEspecialidad;
  return normalizeEspecialidadSlug(orgEspecialidad);
}

/**
 * ¿Un `sesion.tool_id` persistido pertenece a la herramienta de esta
 * especialidad? `null` = fila legacy pre-M50 (quiropraxia implícita por
 * vertebras_json) → solo matchea quiropraxia. tool_id desconocido para el
 * registry → no matchea ninguna (no se mezcla con la tool activa).
 */
export function toolPerteneceAEspecialidad(
  toolId: string | null | undefined,
  especialidad: EspecialidadSlug,
): boolean {
  if (toolId == null) return especialidad === "quiropraxia";
  return getEspecialidadMetaByToolId(toolId)?.slug === especialidad;
}

/**
 * Filtra un historial de tool por la especialidad activa: la Tool del slot
 * clínico recibe SOLO las entradas de SU tool_id (+ legacy NULL si la activa
 * es quiropraxia). En una ficha mixta (cardio + psico del mismo paciente)
 * cada profesional ve su propio historial; el resumen por sesión de
 * TabSesiones/HistorialReciente sigue siendo por tool_id persistido.
 */
export function filtrarToolHistorial<T extends { toolId?: string | null }>(
  historial: readonly T[],
  especialidad: EspecialidadSlug,
): T[] {
  return historial.filter((entry) => toolPerteneceAEspecialidad(entry.toolId ?? null, especialidad));
}

// ─── Metadata por especialidad ──────────────────────────────────────────────

export interface EspecialidadMeta {
  slug: EspecialidadSlug;
  /** Nombre humano es-AR ("Quiropraxia", "Cardiología", ...). */
  nombre: string;
  /** Texto del badge del tab Plan ("Módulo · Quiropraxia"). */
  badgeLabel: string;
  /**
   * Id versionado que el writer ESTAMPA en sesion.tool_id al guardar (M50). Es
   * el shape de ESCRITURA actual; para quiropraxia es `quiropraxia.ficha.v2`
   * (Workstream 6). Las sesiones viejas conservan el id con que se guardaron.
   */
  toolId: string;
  /**
   * TODOS los tool_ids que esta especialidad sabe LEER (incluye el de escritura
   * `toolId` + los versionados anteriores). La resolución por tool_id
   * (getEspecialidadMetaByToolId) matchea por membresía en este array, no por
   * igualdad con `toolId`: así un id versionado viejo (ej. `quiropraxia.spine.v1`)
   * sigue resolviendo a su especialidad y las sesiones legacy no quedan
   * huérfanas al bumpear el shape de escritura. Workstream 6 · BLOCKER FIX.
   */
  toolIds: readonly string[];
  /** Schema zod del toolData — el writer valida antes de cifrar. */
  schema: z.ZodType;
  /** Resumen de una sesión para HistorialReciente / TabSesiones. */
  resumenSesion(toolData: unknown): string;
  /**
   * Workstream 5 · config de la sección "Información avanzada (opcional)" del
   * alta: campos a renderizar + schema zod que el writer valida antes de cifrar
   * en paciente_intake_avanzado (M60). Vive en lib/especialidades/<slug>/intake.ts.
   */
  intakeAvanzado: IntakeAvanzadoConfig;
  /**
   * C9 · guía SOAP opcional por especialidad: prompts/checklists por sección
   * (S/O/A/P) que la ficha (SoapStacked) renderiza como andamiaje VISUAL arriba
   * de cada textarea. ADITIVO: el texto libre no cambia; ausente = SOAP genérico
   * sin guía (comportamiento histórico). No persiste — no es PHI ni toolData.
   */
  soapGuia?: SoapGuia;
}

// ─── Guías SOAP por especialidad (C9) ─────────────────────────────────────────
//
// Andamiaje visual es-AR sobre las 4 secciones del SOAP. Redactadas con lenguaje
// clínico profesional propio de cada práctica; opcionales sección por sección.
// El texto libre del SOAP no cambia — esto solo orienta qué registrar.

const SOAP_GUIA_QUIROPRAXIA: SoapGuia = {
  subjetivo: {
    prompt: "Motivo de consulta, dolor y su evolución desde la última visita.",
    checklist: [
      "Localización, tipo e intensidad del dolor (EVA 0–10)",
      "Factores que agravan o alivian (posturas, actividad, reposo)",
      "Impacto funcional: sueño, trabajo, actividad física",
      "Respuesta al último ajuste (mejoría, sin cambios, exacerbación)",
    ],
  },
  objetivo: {
    prompt: "Hallazgos de la evaluación postural, palpatoria y de movilidad.",
    checklist: [
      "Postura y análisis de la marcha",
      "Palpación estática y por movimiento (segmentos restringidos)",
      "Rango de movilidad activo/pasivo por región",
      "Tests ortopédicos y neurológicos relevantes",
    ],
  },
  analisis: {
    prompt: "Impresión clínica: subluxaciones/disfunciones y su correlato con el cuadro.",
    checklist: [
      "Segmentos a ajustar y técnica indicada",
      "Diagnóstico diferencial y banderas rojas descartadas",
      "Correlación con estudios de imagen si los hay",
    ],
  },
  plan: {
    prompt: "Ajuste realizado, indicaciones y frecuencia del tratamiento.",
    checklist: [
      "Segmentos ajustados y técnica aplicada esta sesión",
      "Ejercicios, higiene postural y pautas domiciliarias",
      "Frecuencia y próxima visita; criterios de derivación",
    ],
  },
};

const SOAP_GUIA_CARDIOLOGIA: SoapGuia = {
  subjetivo: {
    prompt: "Síntomas cardiovasculares actuales y adherencia al tratamiento.",
    checklist: [
      "Dolor torácico, disnea, palpitaciones, síncope, edemas",
      "Clase funcional (NYHA) y tolerancia al esfuerzo",
      "Adherencia a medicación y efectos adversos",
      "Factores de riesgo: tabaquismo, dieta, actividad física",
    ],
  },
  objetivo: {
    prompt: "Signos vitales, examen cardiovascular y resultados de estudios.",
    checklist: [
      "TA, FC y ritmo; peso e IMC",
      "Auscultación cardíaca y pulmonar; ingurgitación yugular, edemas",
      "ECG, laboratorio (perfil lipídico, función renal) y estudios por imagen",
    ],
  },
  analisis: {
    prompt: "Estratificación de riesgo cardiovascular e impresión diagnóstica.",
    checklist: [
      "Score de riesgo CV y control de factores modificables",
      "Diagnóstico principal y comorbilidades relevantes",
      "Necesidad de estudios complementarios o interconsulta",
    ],
  },
  plan: {
    prompt: "Ajustes farmacológicos, metas y seguimiento.",
    checklist: [
      "Cambios en medicación con dosis y justificación",
      "Metas de TA, LDL y estilo de vida",
      "Estudios a solicitar y fecha de control",
    ],
  },
};

const SOAP_GUIA_PSICOLOGIA: SoapGuia = {
  subjetivo: {
    prompt: "Relato del paciente: estado anímico, eventos y motivo de esta sesión.",
    checklist: [
      "Estado de ánimo y sueño desde la última sesión",
      "Eventos vitales o estresores recientes",
      "Ideación de riesgo (autolesión / heteroagresión) — indagar explícitamente",
      "Adherencia a pautas y a medicación psiquiátrica si corresponde",
    ],
  },
  objetivo: {
    prompt: "Examen del estado mental y resultados de escalas aplicadas.",
    checklist: [
      "Presentación, afecto, discurso y contenido del pensamiento",
      "Atención, orientación e insight",
      "Puntajes de escalas (PHQ-9 / GAD-7) y su tendencia",
    ],
  },
  analisis: {
    prompt: "Formulación clínica y evolución respecto de los objetivos terapéuticos.",
    checklist: [
      "Impresión diagnóstica y evolución del cuadro",
      "Nivel de riesgo actual y factores protectores",
      "Progreso frente a los objetivos del tratamiento",
    ],
  },
  plan: {
    prompt: "Intervenciones, tareas y encuadre de la próxima sesión.",
    checklist: [
      "Técnicas trabajadas y tareas entre sesiones",
      "Plan de seguridad si hay riesgo; derivación si corresponde",
      "Frecuencia y foco de la próxima sesión",
    ],
  },
};

const SOAP_GUIA_KINESIOLOGIA: SoapGuia = {
  subjetivo: {
    prompt: "Motivo de consulta, dolor y evolución funcional desde la última sesión.",
    checklist: [
      "Localización, tipo e intensidad del dolor (EVA 0–10)",
      "Factores que agravan o alivian (movimiento, carga, reposo)",
      "Limitación funcional: actividades de la vida diaria, trabajo, deporte",
      "Respuesta al tratamiento previo (mejoría, sin cambios, exacerbación)",
    ],
  },
  objetivo: {
    prompt: "Hallazgos de la evaluación física: postura, rango de movilidad y tests.",
    checklist: [
      "Rango de movilidad activo/pasivo por región (ROM en grados)",
      "Fuerza muscular, tono y trofismo",
      "Tests ortopédicos y neurológicos con su resultado",
      "Índices de outcome aplicados (NDI / ODI / Borg)",
    ],
  },
  analisis: {
    prompt: "Diagnóstico kinésico funcional y correlato con el cuadro.",
    checklist: [
      "Estructuras y funciones comprometidas",
      "Banderas rojas descartadas / criterios de derivación",
      "Progreso frente a los objetivos funcionales",
    ],
  },
  plan: {
    prompt: "Tratamiento realizado, dosificación y pautas domiciliarias.",
    checklist: [
      "Técnicas y ejercicios aplicados esta sesión, con dosis",
      "Ejercicios y pautas para el domicilio",
      "Frecuencia, próxima sesión y objetivos de corto plazo",
    ],
  },
};

const SOAP_GUIA_NUTRICION: SoapGuia = {
  subjetivo: {
    prompt: "Relato del paciente: hábitos, adherencia al plan y evolución desde el último control.",
    checklist: [
      "Motivo de consulta y objetivo nutricional",
      "Adherencia al plan anterior y dificultades encontradas",
      "Recordatorio alimentario y horarios de comida",
      "Actividad física, sueño y estado general",
    ],
  },
  objetivo: {
    prompt: "Mediciones antropométricas y datos objetivos del control.",
    checklist: [
      "Peso, talla e IMC derivado",
      "Circunferencias (cintura, cadera) y pliegues cutáneos",
      "Laboratorio relevante (glucemia, perfil lipídico) si lo hay",
      "Composición corporal y su tendencia",
    ],
  },
  analisis: {
    prompt: "Diagnóstico nutricional y evolución respecto de los objetivos.",
    checklist: [
      "Estado nutricional según IMC y composición corporal",
      "Riesgo asociado (obesidad, desnutrición, comorbilidades)",
      "Progreso frente a las metas de peso y hábitos",
    ],
  },
  plan: {
    prompt: "Plan alimentario indicado, metas y seguimiento.",
    checklist: [
      "Plan alimentario: distribución, calorías y macronutrientes",
      "Metas de peso, hábitos y actividad física",
      "Suplementación si corresponde y próxima fecha de control",
    ],
  },
};

export const ESPECIALIDADES_META: Record<EspecialidadSlug, EspecialidadMeta> = {
  quiropraxia: {
    slug: "quiropraxia",
    nombre: "Quiropraxia",
    badgeLabel: "Módulo · Quiropraxia",
    // Workstream 6 · el writer estampa v2; v1 (quiropraxia.spine.v1) se sigue
    // LEYENDO (sesiones viejas) vía toolIds — no queda huérfana.
    toolId: "quiropraxia.ficha.v2",
    toolIds: ["quiropraxia.ficha.v2", "quiropraxia.spine.v1"],
    schema: quiropraxiaToolDataV2Schema,
    resumenSesion: resumenSesionQuiropraxia,
    intakeAvanzado: intakeAvanzadoQuiropraxia,
    soapGuia: SOAP_GUIA_QUIROPRAXIA,
  },
  cardiologia: {
    slug: "cardiologia",
    nombre: "Cardiología",
    badgeLabel: "Módulo · Cardiología",
    // C6 · el writer estampa v3 (panel + medicación + derivación); v2 y v1
    // (cardiologia.cv.v2/v1) se siguen LEYENDO (sesiones viejas) vía toolIds —
    // no quedan huérfanas (patrón dos-ids de quiropraxia, acá tres).
    toolId: "cardiologia.cv.v3",
    toolIds: ["cardiologia.cv.v3", "cardiologia.cv.v2", "cardiologia.cv.v1"],
    schema: cardiologiaToolDataV3Schema,
    resumenSesion: resumenSesionCardiologia,
    intakeAvanzado: intakeAvanzadoCardiologia,
    soapGuia: SOAP_GUIA_CARDIOLOGIA,
  },
  psicologia: {
    slug: "psicologia",
    nombre: "Psicología",
    badgeLabel: "Módulo · Psicología",
    // C8 · el writer estampa v3 (escalas + registro/MSE completo + objetivos +
    // plan de crisis opcional + nota de proceso guiada SOAP/DAP/BIRP); v2 y v1
    // (psicologia.escalas.v2/v1) se siguen LEYENDO (sesiones viejas) vía toolIds
    // — no quedan huérfanas (patrón de ids de quiropraxia, acá TRES).
    toolId: "psicologia.escalas.v3",
    toolIds: ["psicologia.escalas.v3", "psicologia.escalas.v2", "psicologia.escalas.v1"],
    schema: psicologiaToolDataV3Schema,
    resumenSesion: resumenSesionPsicologia,
    intakeAvanzado: intakeAvanzadoPsicologia,
    soapGuia: SOAP_GUIA_PSICOLOGIA,
  },
  kinesiologia: {
    slug: "kinesiologia",
    nombre: "Kinesiología",
    badgeLabel: "Módulo · Kinesiología",
    // N1 · el writer estampa v1 (única versión por ahora). Instrumentos de
    // outcome embebidos de lib/instrumentos (NDI/ODI/Borg) + dolor EVA/VAS.
    toolId: "kinesiologia.ficha.v1",
    toolIds: ["kinesiologia.ficha.v1"],
    schema: kinesiologiaToolDataSchema,
    resumenSesion: resumenSesionKinesiologia,
    intakeAvanzado: intakeAvanzadoKinesiologia,
    soapGuia: SOAP_GUIA_KINESIOLOGIA,
  },
  nutricion: {
    slug: "nutricion",
    nombre: "Nutrición",
    badgeLabel: "Módulo · Nutrición",
    // N2 · el writer estampa v1 (única versión por ahora). Antropometría
    // longitudinal (peso/talla/IMC derivado/circunferencias/pliegues) +
    // plan alimentario texto + objetivos; reusa <SerieEvolucion> de la biblioteca.
    toolId: "nutricion.ficha.v1",
    toolIds: ["nutricion.ficha.v1"],
    schema: nutricionToolDataSchema,
    resumenSesion: resumenSesionNutricion,
    intakeAvanzado: intakeAvanzadoNutricion,
    soapGuia: SOAP_GUIA_NUTRICION,
  },
};

/** Meta por slug, con fallback a quiropraxia para valores desconocidos. */
export function getEspecialidadMeta(slug: string | null | undefined): EspecialidadMeta {
  return ESPECIALIDADES_META[normalizeEspecialidadSlug(slug)];
}

/**
 * Config del intake avanzado de una especialidad, con fallback a quiropraxia
 * para slugs desconocidos (mismo criterio que getEspecialidadMeta). La usan el
 * form del alta, el writer (lib/db/paciente-intake.ts) y la vista de la ficha.
 */
export function getIntakeAvanzadoConfig(slug: string | null | undefined): IntakeAvanzadoConfig {
  return ESPECIALIDADES_META[normalizeEspecialidadSlug(slug)].intakeAvanzado;
}

/**
 * Meta por toolId (sesion.tool_id) o null si el registry no lo conoce. Matchea
 * por MEMBRESÍA en `toolIds` (no por igualdad con `toolId`): un id versionado
 * viejo — ej. `quiropraxia.spine.v1` — sigue resolviendo a su especialidad
 * después de que el shape de escritura se bumpea (Workstream 6 · two-id).
 */
export function getEspecialidadMetaByToolId(toolId: string | null | undefined): EspecialidadMeta | null {
  if (!toolId) return null;
  for (const slug of ESPECIALIDAD_SLUGS) {
    if (ESPECIALIDADES_META[slug].toolIds.includes(toolId)) return ESPECIALIDADES_META[slug];
  }
  return null;
}
