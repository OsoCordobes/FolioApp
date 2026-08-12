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
import type { NotaClinicaFicha } from "@/lib/ficha/nota-clinica";
import type { IntakeAvanzadoFicha, PacienteFichaInfo, PlanData } from "@/lib/db/paciente-ficha";

interface PacienteFichaContextValue {
  paciente: PacienteFichaInfo;
  plan: PlanData;
  cumple: string;
  /**
   * Especialidad ACTIVA del slot clínico (M55): la EFECTIVA del profesional
   * del turno en curso (member.especialidad ?? organization.especialidad) o,
   * sin turno en curso, la de la org. Decide la herramienta del tab Plan.
   */
  especialidad: EspecialidadSlug;
  /**
   * Workstream 5 · intake avanzado de la especialidad ACTIVA (M60) o null. El
   * tab Información lo muestra read-only + un modal de edición.
   */
  intakeAvanzado: IntakeAvanzadoFicha | null;
  /**
   * X7 · nombre de la organización (consultorio/clínica). Se usa en el
   * encabezado membretado de impresión (`.fi-print-header`) para que una hoja
   * impresa identifique de dónde salió el documento.
   */
  organizacionNombre: string;
  /**
   * M96 · notas de la ficha (sin turno), de la más nueva a la más vieja. Es la
   * parte de la historia clínica que ocurre ENTRE turnos.
   */
  notas: NotaClinicaFicha[];
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
