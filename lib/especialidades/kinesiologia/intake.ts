/**
 * Folio · especialidades · kinesiología · intake avanzado del alta (Fase 2 · N1).
 *
 * Antecedentes músculo-esqueléticos que se cargan al dar de alta al paciente (no
 * por sesión — el ROM, los tests y los outcomes van en sesion.tool_data_cifrado).
 * Set inicial conservador y adaptable. Se guarda como JSON cifrado en
 * paciente_intake_avanzado (M60), validado por `schema` antes de cifrar.
 *
 * Campos OPCIONALES (la sección entera es opcional y nunca bloquea el alta) y el
 * schema NO es .strict: additive-friendly (mismo criterio que cardiología). Es un
 * sub-objeto de intake, la garantía cross-tool no aplica acá. Server-safe: sin
 * React.
 */

import { z } from "zod";

import type { IntakeAvanzadoConfig, IntakeCampo } from "@/lib/especialidades/types";

const campos: readonly IntakeCampo[] = [
  { key: "motivoDerivacion", label: "Motivo de derivación / diagnóstico médico", tipo: "textarea" },
  { key: "lesionesPrevias", label: "Lesiones o cirugías previas", tipo: "textarea" },
  { key: "cirugiaReciente", label: "Cirugía reciente (últimos 6 meses)", tipo: "boolean" },
  { key: "dolorCronico", label: "Dolor crónico", tipo: "boolean" },
  { key: "actividadFisica", label: "Actividad física / laboral habitual", tipo: "textarea" },
  { key: "medicamentos", label: "Medicamentos", tipo: "textarea" },
  {
    key: "banderasRojas",
    label: "Banderas rojas / contraindicaciones",
    tipo: "textarea",
  },
  { key: "observaciones", label: "Observaciones", tipo: "textarea" },
];

// Todos opcionales: el writer valida el datos del cliente contra esto. No es
// .strict (additive-friendly: claves desconocidas se stripean, no rechazan).
const schema = z.object({
  motivoDerivacion: z.string().max(2000).optional(),
  lesionesPrevias: z.string().max(2000).optional(),
  cirugiaReciente: z.boolean().optional(),
  dolorCronico: z.boolean().optional(),
  actividadFisica: z.string().max(2000).optional(),
  medicamentos: z.string().max(2000).optional(),
  banderasRojas: z.string().max(2000).optional(),
  observaciones: z.string().max(2000).optional(),
});

export const intakeAvanzadoKinesiologia: IntakeAvanzadoConfig = { schema, campos };
