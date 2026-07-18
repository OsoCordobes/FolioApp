/**
 * Folio · especialidades · nutrición · intake avanzado del alta (Fase 2 · N2).
 *
 * Antecedentes nutricionales/metabólicos que se cargan al dar de alta al paciente
 * (no por sesión — el peso, las circunferencias, los pliegues y el plan van en
 * sesion.tool_data_cifrado). Set inicial conservador y adaptable. Se guarda como
 * JSON cifrado en paciente_intake_avanzado (M60), validado por `schema` antes de
 * cifrar.
 *
 * Campos OPCIONALES (la sección entera es opcional y nunca bloquea el alta) y el
 * schema NO es .strict: additive-friendly (mismo criterio que cardiología /
 * kinesiología). Es un sub-objeto de intake, la garantía cross-tool no aplica
 * acá. Server-safe: sin React.
 */

import { z } from "zod";

import type { IntakeAvanzadoConfig, IntakeCampo } from "@/lib/especialidades/types";

const campos: readonly IntakeCampo[] = [
  { key: "motivoConsulta", label: "Motivo de consulta / objetivo nutricional", tipo: "textarea" },
  {
    key: "patologiaBase",
    label: "Patología de base (diabetes, HTA, dislipidemia, etc.)",
    tipo: "textarea",
  },
  { key: "alergiasIntolerancias", label: "Alergias / intolerancias alimentarias", tipo: "textarea" },
  {
    key: "restriccionAlimentaria",
    label: "Régimen / restricción alimentaria",
    tipo: "select",
    opciones: [
      "Sin restricción",
      "Vegetariano",
      "Vegano",
      "Celíaco / sin TACC",
      "Hiposódico",
      "Hipograso",
      "Diabético",
      "Otro",
    ],
  },
  { key: "medicacionSuplementos", label: "Medicación / suplementos", tipo: "textarea" },
  { key: "actividadFisica", label: "Actividad física habitual", tipo: "textarea" },
  { key: "habitosAlimentarios", label: "Hábitos alimentarios y horarios", tipo: "textarea" },
  { key: "observaciones", label: "Observaciones", tipo: "textarea" },
];

// Todos opcionales: el writer valida el datos del cliente contra esto. No es
// .strict (additive-friendly: claves desconocidas se stripean, no rechazan).
const schema = z.object({
  motivoConsulta: z.string().max(2000).optional(),
  patologiaBase: z.string().max(2000).optional(),
  alergiasIntolerancias: z.string().max(2000).optional(),
  restriccionAlimentaria: z.string().max(200).optional(),
  medicacionSuplementos: z.string().max(2000).optional(),
  actividadFisica: z.string().max(2000).optional(),
  habitosAlimentarios: z.string().max(2000).optional(),
  observaciones: z.string().max(2000).optional(),
});

export const intakeAvanzadoNutricion: IntakeAvanzadoConfig = { schema, campos };
