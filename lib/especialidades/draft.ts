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
 *   - toolValue == null → SIN toolData. El writer decide qué hacer con las
 *     columnas tool existentes: si la ficha pudo re-hidratar el borrador
 *     (PlanData.turnoActivo.toolDraft — tool_id de la especialidad efectiva),
 *     el null es un vaciado deliberado y las columnas van a NULL; si NO pudo
 *     (tool_id de otra especialidad / fila legacy), las PRESERVA
 *     (debePreservarToolData, lib/db/sesiones.ts) — un guardado solo-SOAP
 *     nunca pisa datos de herramienta que la UI no mostró.
 *   - toolValue != null → viaja como toolData OPACO, sin toolId. El toolId lo
 *     deriva el WRITER server-side de la especialidad efectiva del PROFESIONAL
 *     del turno (M55: member.especialidad ?? organization.especialidad) — ni
 *     el cliente ni este módulo deciden la herramienta. El toolData se valida
 *     contra el schema zod de esa especialidad antes de cifrar; para
 *     quiropraxia el writer espeja vertebras_json por su cuenta (compat M14,
 *     se retira en Fase F).
 *
 * PHI: este módulo no loguea nada — el contenido clínico pasa opaco.
 */

import type { UpsertSesionInput } from "@/lib/db/sesiones";

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

  return { ...input, toolData: draft.toolValue };
}
