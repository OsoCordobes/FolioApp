/**
 * Folio · especialidades · psicología · intake avanzado del alta (Workstream 5).
 *
 * Antecedentes que se cargan al dar de alta al paciente (no por sesión — las
 * escalas/registro van en sesion.tool_data_cifrado). Set inicial conservador y
 * adaptable. Se guarda como JSON cifrado en paciente_intake_avanzado (M60),
 * validado por `schema` antes de cifrar.
 *
 * Campos OPCIONALES (la sección entera es opcional y nunca bloquea el alta) y el
 * schema NO es .strict: additive-friendly. Server-safe: sin React.
 */

import { z } from "zod";

import type { IntakeAvanzadoConfig, IntakeCampo } from "@/lib/especialidades/types";

const campos: readonly IntakeCampo[] = [
  { key: "medicacionPsiquiatrica", label: "Medicación psiquiátrica", tipo: "textarea" },
  { key: "tratamientosPrevios", label: "Tratamientos previos", tipo: "textarea" },
  { key: "antecedentesFamiliares", label: "Antecedentes familiares", tipo: "textarea" },
  { key: "observaciones", label: "Observaciones", tipo: "textarea" },
];

// Todos opcionales: el writer valida el datos del cliente contra esto. No es
// .strict (additive-friendly: claves desconocidas se stripean, no rechazan).
const schema = z.object({
  medicacionPsiquiatrica: z.string().max(2000).optional(),
  tratamientosPrevios: z.string().max(2000).optional(),
  antecedentesFamiliares: z.string().max(2000).optional(),
  observaciones: z.string().max(2000).optional(),
});

export const intakeAvanzadoPsicologia: IntakeAvanzadoConfig = { schema, campos };
