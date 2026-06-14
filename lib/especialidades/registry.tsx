"use client";

/**
 * Folio · especialidades · registry client (Fase B).
 *
 * Mapea cada slug de especialidad a su componente Tool (el que se renderiza
 * en el slot clínico del tab Plan) + el ícono del badge. La metadata
 * server-safe (schemas, resumenSesion, toolIds) vive en
 * lib/especialidades/meta.ts y se reexporta acá para los consumers client.
 *
 * `getEspecialidad(slug)` hace fallback a quiropraxia para valores
 * desconocidos — una org con especialidad fuera del registry deployado
 * degrada al comportamiento histórico en vez de romper la ficha.
 */

import type { ComponentType } from "react";

import * as I from "@/components/icons";
import {
  ESPECIALIDADES_META,
  normalizeEspecialidadSlug,
  type EspecialidadMeta,
  type EspecialidadSlug,
} from "@/lib/especialidades/meta";
import type { SpecialtyToolProps } from "@/lib/especialidades/types";
import { QuiropraxiaTool } from "@/lib/especialidades/quiropraxia/tool";
import { CardiologiaTool } from "@/lib/especialidades/cardiologia/tool";
import { PsicologiaTool } from "@/lib/especialidades/psicologia/tool";

export interface EspecialidadDef extends EspecialidadMeta {
  /** Herramienta clínica del slot (tab Plan de la ficha del paciente). */
  Tool: ComponentType<SpecialtyToolProps>;
  /** Ícono del badge "Módulo · {nombre}". */
  Icon: ComponentType<{ size?: number }>;
}

export const ESPECIALIDADES: Record<EspecialidadSlug, EspecialidadDef> = {
  quiropraxia: {
    ...ESPECIALIDADES_META.quiropraxia,
    Tool: QuiropraxiaTool,
    Icon: I.Vertebra,
  },
  cardiologia: {
    ...ESPECIALIDADES_META.cardiologia,
    Tool: CardiologiaTool,
    Icon: I.Activity,
  },
  psicologia: {
    ...ESPECIALIDADES_META.psicologia,
    Tool: PsicologiaTool,
    Icon: I.User,
  },
};

/** Def por slug, con fallback a quiropraxia para valores desconocidos. */
export function getEspecialidad(slug: string | null | undefined): EspecialidadDef {
  return ESPECIALIDADES[normalizeEspecialidadSlug(slug)];
}

// Reexports para que los consumers client importen todo de un solo módulo.
export {
  ESPECIALIDAD_SLUGS,
  ESPECIALIDADES_META,
  filtrarToolHistorial,
  getEspecialidadMeta,
  getEspecialidadMetaByToolId,
  getIntakeAvanzadoConfig,
  isEspecialidadSlug,
  normalizeEspecialidadSlug,
  resolveEspecialidadEfectiva,
  toolPerteneceAEspecialidad,
} from "@/lib/especialidades/meta";
export type { EspecialidadMeta, EspecialidadSlug } from "@/lib/especialidades/meta";
export type {
  IntakeAvanzadoConfig,
  IntakeCampo,
  IntakeCampoTipo,
  SpecialtyToolProps,
  ToolHistorialEntry,
} from "@/lib/especialidades/types";
