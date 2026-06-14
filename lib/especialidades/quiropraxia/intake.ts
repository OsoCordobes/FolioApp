/**
 * Folio · especialidades · quiropraxia · intake avanzado del alta (Workstream 5).
 *
 * Anamnesis inicial del quiropráctico: lo que se pregunta UNA vez al dar de alta
 * al paciente (no por sesión — eso vive en sesion.tool_data_cifrado). Se guarda
 * como JSON cifrado en paciente_intake_avanzado (M60), validado por `schema`
 * antes de cifrar.
 *
 * Campos OPCIONALES (la sección entera es opcional y nunca bloquea el alta) y el
 * schema NO es .strict: additive-friendly (sumar un campo no invalida filas
 * viejas; claves desconocidas se stripean). Server-safe: sin React.
 */

import { z } from "zod";

import type { IntakeAvanzadoConfig, IntakeCampo } from "@/lib/especialidades/types";

/** Opciones del tipo de parto (select). */
const TIPOS_PARTO = ["Vaginal", "Cesárea", "Fórceps", "No sabe"] as const;

const campos: readonly IntakeCampo[] = [
  { key: "recibioQuiropraxiaAntes", label: "¿Recibió quiropraxia antes?", tipo: "boolean" },
  { key: "tipoParto", label: "Tipo de parto", tipo: "select", opciones: TIPOS_PARTO },
  { key: "cirugias", label: "Cirugías", tipo: "textarea" },
  { key: "fracturas", label: "Fracturas", tipo: "textarea" },
  { key: "medicamentos", label: "Medicamentos", tipo: "textarea" },
  { key: "observaciones", label: "Observaciones", tipo: "textarea" },
];

// Todos opcionales: el writer valida el datos del cliente contra esto. No es
// .strict (additive-friendly: claves desconocidas se stripean, no rechazan).
const schema = z.object({
  recibioQuiropraxiaAntes: z.boolean().optional(),
  tipoParto: z.enum(TIPOS_PARTO).optional(),
  cirugias: z.string().max(2000).optional(),
  fracturas: z.string().max(2000).optional(),
  medicamentos: z.string().max(2000).optional(),
  observaciones: z.string().max(2000).optional(),
});

export const intakeAvanzadoQuiropraxia: IntakeAvanzadoConfig = { schema, campos };
