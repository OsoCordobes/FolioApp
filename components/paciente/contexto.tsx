"use client";

/**
 * Folio · /pacientes/[id] · contexto compartido.
 *
 * El componente `PacienteDetalle` (port del prototipo) tiene varios
 * sub-componentes (TabPlan, TabInformacion, TabSesiones, PacienteHeader,
 * PlanTratamiento, etc) que accedían a `PACIENTE_DETALLE` y `PLAN` como
 * constantes de módulo. Para conectarlo a data real sin prop-drilling
 * masivo, inyectamos paciente + plan vía React Context.
 *
 * El Provider se monta en `PacienteDetalle({ paciente, plan, cumple })` y
 * los sub-componentes consumen `usePacienteFicha()`.
 */

import { createContext, useContext, type ReactNode } from "react";

import type { EspecialidadSlug } from "@/lib/especialidades/meta";
import type { PacienteFichaInfo, PlanData } from "@/lib/db/paciente-ficha";

interface PacienteFichaContextValue {
  paciente: PacienteFichaInfo;
  plan: PlanData;
  cumple: string;
  /** Especialidad de la org (M50) — decide la herramienta del tab Plan. */
  especialidad: EspecialidadSlug;
}

const PacienteFichaContext = createContext<PacienteFichaContextValue | null>(null);

export function PacienteFichaProvider({
  value,
  children,
}: {
  value: PacienteFichaContextValue;
  children: ReactNode;
}) {
  return <PacienteFichaContext.Provider value={value}>{children}</PacienteFichaContext.Provider>;
}

export function usePacienteFicha(): PacienteFichaContextValue {
  const ctx = useContext(PacienteFichaContext);
  if (!ctx) {
    throw new Error("usePacienteFicha debe usarse dentro de <PacienteFichaProvider>");
  }
  return ctx;
}
