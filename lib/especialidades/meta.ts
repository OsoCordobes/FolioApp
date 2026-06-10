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
import {
  psicologiaToolDataSchema,
  resumenSesionPsicologia,
} from "@/lib/especialidades/psicologia/schema";
import {
  quiropraxiaToolDataSchema,
  resumenSesionQuiropraxia,
} from "@/lib/especialidades/quiropraxia/schema";

// ─── Slugs ──────────────────────────────────────────────────────────────────

export const ESPECIALIDAD_SLUGS = ["quiropraxia", "cardiologia", "psicologia"] as const;

export type EspecialidadSlug = (typeof ESPECIALIDAD_SLUGS)[number];

export function isEspecialidadSlug(value: string): value is EspecialidadSlug {
  return (ESPECIALIDAD_SLUGS as readonly string[]).includes(value);
}

/**
 * Normaliza un valor arbitrario (ej. columna organization.especialidad) a un
 * slug conocido. Fallback a quiropraxia: una org con valor desconocido (CHECK
 * futuro más amplio que el registry deployado) degrada al comportamiento
 * histórico en vez de romper la ficha.
 */
export function normalizeEspecialidadSlug(value: string | null | undefined): EspecialidadSlug {
  return value && isEspecialidadSlug(value) ? value : "quiropraxia";
}

// ─── Metadata por especialidad ──────────────────────────────────────────────

export interface EspecialidadMeta {
  slug: EspecialidadSlug;
  /** Nombre humano es-AR ("Quiropraxia", "Cardiología", ...). */
  nombre: string;
  /** Texto del badge del tab Plan ("Módulo · Quiropraxia"). */
  badgeLabel: string;
  /** Id versionado del shape de sesion.tool_data_cifrado (M50). */
  toolId: string;
  /** Schema zod del toolData — el writer valida antes de cifrar. */
  schema: z.ZodType;
  /** Resumen de una sesión para HistorialReciente / TabSesiones. */
  resumenSesion(toolData: unknown): string;
}

export const ESPECIALIDADES_META: Record<EspecialidadSlug, EspecialidadMeta> = {
  quiropraxia: {
    slug: "quiropraxia",
    nombre: "Quiropraxia",
    badgeLabel: "Módulo · Quiropraxia",
    toolId: "quiropraxia.spine.v1",
    schema: quiropraxiaToolDataSchema,
    resumenSesion: resumenSesionQuiropraxia,
  },
  cardiologia: {
    slug: "cardiologia",
    nombre: "Cardiología",
    badgeLabel: "Módulo · Cardiología",
    toolId: "cardiologia.cv.v1",
    schema: cardiologiaToolDataSchema,
    resumenSesion: resumenSesionCardiologia,
  },
  psicologia: {
    slug: "psicologia",
    nombre: "Psicología",
    badgeLabel: "Módulo · Psicología",
    toolId: "psicologia.escalas.v1",
    schema: psicologiaToolDataSchema,
    resumenSesion: resumenSesionPsicologia,
  },
};

/** Meta por slug, con fallback a quiropraxia para valores desconocidos. */
export function getEspecialidadMeta(slug: string | null | undefined): EspecialidadMeta {
  return ESPECIALIDADES_META[normalizeEspecialidadSlug(slug)];
}

/** Meta por toolId (sesion.tool_id) o null si el registry no lo conoce. */
export function getEspecialidadMetaByToolId(toolId: string | null | undefined): EspecialidadMeta | null {
  if (!toolId) return null;
  for (const slug of ESPECIALIDAD_SLUGS) {
    if (ESPECIALIDADES_META[slug].toolId === toolId) return ESPECIALIDADES_META[slug];
  }
  return null;
}
