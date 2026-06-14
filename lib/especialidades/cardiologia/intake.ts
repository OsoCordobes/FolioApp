/**
 * Folio · especialidades · cardiología · intake avanzado del alta (Workstream 5).
 *
 * Antecedentes cardiovasculares que se cargan al dar de alta al paciente (no por
 * sesión — los vitales/estudios van en sesion.tool_data_cifrado). Set inicial
 * conservador y adaptable. Se guarda como JSON cifrado en
 * paciente_intake_avanzado (M60), validado por `schema` antes de cifrar.
 *
 * Campos OPCIONALES (la sección entera es opcional y nunca bloquea el alta) y el
 * schema NO es .strict: additive-friendly. Server-safe: sin React.
 */

import { z } from "zod";

import type { IntakeAvanzadoConfig, IntakeCampo } from "@/lib/especialidades/types";

const campos: readonly IntakeCampo[] = [
  { key: "tabaquismo", label: "Tabaquismo", tipo: "boolean" },
  { key: "diabetes", label: "Diabetes", tipo: "boolean" },
  { key: "hipertension", label: "Hipertensión arterial", tipo: "boolean" },
  { key: "dislipemia", label: "Dislipemia", tipo: "boolean" },
  { key: "antecedentesFamiliares", label: "Antecedentes familiares", tipo: "textarea" },
  { key: "medicamentos", label: "Medicamentos", tipo: "textarea" },
  { key: "cirugiasCardiovasculares", label: "Cirugías cardiovasculares", tipo: "textarea" },
  { key: "observaciones", label: "Observaciones", tipo: "textarea" },
];

// Todos opcionales: el writer valida el datos del cliente contra esto. No es
// .strict (additive-friendly: claves desconocidas se stripean, no rechazan).
const schema = z.object({
  tabaquismo: z.boolean().optional(),
  diabetes: z.boolean().optional(),
  hipertension: z.boolean().optional(),
  dislipemia: z.boolean().optional(),
  antecedentesFamiliares: z.string().max(2000).optional(),
  medicamentos: z.string().max(2000).optional(),
  cirugiasCardiovasculares: z.string().max(2000).optional(),
  observaciones: z.string().max(2000).optional(),
});

export const intakeAvanzadoCardiologia: IntakeAvanzadoConfig = { schema, campos };
