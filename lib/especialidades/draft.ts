/**
 * Folio · especialidades · transformación borrador (ficha) → UpsertSesionInput.
 *
 * Función PURA (sin React ni dependencias de server) que arma el input del
 * writer único de sesiones (lib/db/sesiones.ts) a partir del borrador local
 * del tab Plan: SOAP (shape del prototipo: subjetivo/objetivo/analisis/plan)
 * + toolValue del slot clínico (opaco — lo valida el writer contra el schema
 * zod del registry ANTES de cifrar).
 *
 * Reglas:
 *   - Campos SOAP: trim; vacíos → undefined (el writer persiste NULL).
 *   - toolValue == null → SIN toolId/toolData. Ojo: el writer igualmente
 *     sobreescribe tool_id/tool_data_cifrado con NULL en el upsert (semántica
 *     "el borrador es la verdad completa de la sesión"), por eso el caller
 *     re-hidrata el borrador con el toolData ya guardado del turno activo
 *     (PlanData.turnoActivo.toolDraft) — un guardado posterior que solo toque
 *     el SOAP no pierde lo cargado en la herramienta.
 *   - toolValue != null → toolId de la especialidad de la org (fallback
 *     quiropraxia para slugs desconocidos, mismo criterio que el registry).
 *     El toolData viaja puro; para quiropraxia el writer espeja
 *     vertebras_json por su cuenta (compat M14, se retira en Fase F).
 *
 * PHI: este módulo no loguea nada — el contenido clínico pasa opaco.
 */

import type { UpsertSesionInput } from "@/lib/db/sesiones";

import { getEspecialidadMeta } from "./meta";

/** SOAP como lo edita la ficha (mismo shape que PlanData["soap"]). */
export interface FichaSoapDraft {
  subjetivo: string;
  objetivo: string;
  analisis: string;
  plan: string;
}

export interface SesionFichaDraft {
  turnoId: string;
  pacienteId: string;
  /** Slug de organization.especialidad (desconocido → quiropraxia). */
  especialidad: string | null | undefined;
  /** Borrador del Tool del slot, o null si no se tocó la herramienta. */
  toolValue: unknown;
  soap: FichaSoapDraft;
}

function campoSoap(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function buildUpsertSesionInput(draft: SesionFichaDraft): UpsertSesionInput {
  const input: UpsertSesionInput = {
    turnoId: draft.turnoId,
    pacienteId: draft.pacienteId,
    soap: {
      s: campoSoap(draft.soap.subjetivo),
      o: campoSoap(draft.soap.objetivo),
      a: campoSoap(draft.soap.analisis),
      p: campoSoap(draft.soap.plan),
    },
  };
  if (draft.toolValue == null) return input;

  const meta = getEspecialidadMeta(draft.especialidad);
  return { ...input, toolId: meta.toolId, toolData: draft.toolValue };
}
