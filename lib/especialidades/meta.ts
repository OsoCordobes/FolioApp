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
  cardiologiaToolDataSchema,
  resumenSesionCardiologia,
} from "@/lib/especialidades/cardiologia/schema";
import { intakeAvanzadoCardiologia } from "@/lib/especialidades/cardiologia/intake";
import {
  psicologiaToolDataSchema,
  resumenSesionPsicologia,
} from "@/lib/especialidades/psicologia/schema";
import { intakeAvanzadoPsicologia } from "@/lib/especialidades/psicologia/intake";
import {
  quiropraxiaToolDataV2Schema,
  resumenSesionQuiropraxia,
} from "@/lib/especialidades/quiropraxia/schema";
import { intakeAvanzadoQuiropraxia } from "@/lib/especialidades/quiropraxia/intake";
import type { IntakeAvanzadoConfig } from "@/lib/especialidades/types";

// ─── Slugs ──────────────────────────────────────────────────────────────────

export const ESPECIALIDAD_SLUGS = ["quiropraxia", "cardiologia", "psicologia"] as const;

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
}

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
  },
  cardiologia: {
    slug: "cardiologia",
    nombre: "Cardiología",
    badgeLabel: "Módulo · Cardiología",
    toolId: "cardiologia.cv.v1",
    toolIds: ["cardiologia.cv.v1"],
    schema: cardiologiaToolDataSchema,
    resumenSesion: resumenSesionCardiologia,
    intakeAvanzado: intakeAvanzadoCardiologia,
  },
  psicologia: {
    slug: "psicologia",
    nombre: "Psicología",
    badgeLabel: "Módulo · Psicología",
    toolId: "psicologia.escalas.v1",
    toolIds: ["psicologia.escalas.v1"],
    schema: psicologiaToolDataSchema,
    resumenSesion: resumenSesionPsicologia,
    intakeAvanzado: intakeAvanzadoPsicologia,
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
