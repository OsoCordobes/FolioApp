import { tryDecrypt } from "@/lib/crypto";
import { readVerifiedClinicalCollection } from "./verified-collection";
import { readEnmiendas } from "@/lib/db/enmiendas";
import { err, ok, type Result } from "@/lib/db/errors";
import type { EnmiendaClinica } from "@/lib/ficha/enmienda";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Row = { id: string } & Record<string, unknown>;
import { readExportInstruments, type ExportedInstrument } from "./export-instruments";
import { readClinicalEvidence, type ClinicalEvidenceInventory } from "./export-evidence";

export interface ClinicalExport extends ClinicalEvidenceInventory {
  instrumentos: ExportedInstrument[];
  sesiones: {
    id: string; turno_id: string; created_at: string; updated_at: string | null;
    locked_at: string | null; locked_by_id: string | null;
    eva_antes: number | null; eva_despues: number | null;
    soap: { s: string | null; o: string | null; a: string | null; p: string | null };
    notas: string | null; tool_id: string | null; tool_data: unknown; enmiendas: EnmiendaClinica[];
  }[];
  notas: { id: string; autor_id: string; created_at: string; texto: string | null }[];
  intake: { id: string; especialidad: string; datos: unknown }[];
}

/** Only called by the professional-mediated export after patient scope authorization. */
export async function buildClinicalExport(supabase: Supa, organizationId: string, pacienteId: string): Promise<Result<ClinicalExport>> {
  const read = (table: string) => readVerifiedClinicalCollection<Row>((from, to) => supabase.from(table)
    .select("*", { count: "exact" }).eq("organization_id", organizationId).eq("paciente_id", pacienteId)
    .order("id", { ascending: true }).range(from, to));
  const [sessions, notes, intake] = await Promise.all([read("sesion"), read("nota_clinica"), read("paciente_intake_avanzado")]);
  if (sessions.error || notes.error || intake.error) return err("db_error", "No se pudo recuperar la historia clínica completa.");
  const [instruments, evidence] = await Promise.all([
    readExportInstruments(supabase, organizationId, pacienteId),
    readClinicalEvidence(supabase, organizationId, pacienteId),
  ]);
  if (!instruments.ok) return instruments;
  if (!evidence.ok) return evidence;
  const corrections = await readEnmiendas(supabase, organizationId, sessions.data.map((r) => r.id));
  if (!corrections.ok) return corrections;
  const decode = (row: Row, field: string): string | null => {
    const value = tryDecrypt(row[field] as string | null, `clinical-export.${field}`);
    if (row[field] != null && value === null) throw new Error("unreadable");
    return value;
  };
  try {
    return ok({
      instrumentos: instruments.data,
      ...evidence.data,
      sesiones: sessions.data.map((r) => {
        const tool = decode(r, "tool_data_cifrado");
        return {
          id: r.id, turno_id: String(r.turno_id), created_at: String(r.created_at), updated_at: r.updated_at as string | null,
          locked_at: r.locked_at as string | null, locked_by_id: r.locked_by_id as string | null,
          eva_antes: r.eva_antes as number | null ?? null, eva_despues: r.eva_despues as number | null ?? null,
          soap: { s: decode(r, "soap_s_cifrado"), o: decode(r, "soap_o_cifrado"), a: decode(r, "soap_a_cifrado"), p: decode(r, "soap_p_cifrado") },
          notas: decode(r, "notas_cifrado"), tool_id: r.tool_id as string | null,
          tool_data: tool === null ? { vertebras: r.vertebras_json ?? [] } : JSON.parse(tool) as unknown,
          enmiendas: corrections.data.get(r.id) ?? [],
        };
      }),
      notas: notes.data.map((r) => ({ id: r.id, autor_id: String(r.autor_id), created_at: String(r.created_at), texto: decode(r, "texto_cifrado") })),
      intake: intake.data.map((r) => {
        const plain = decode(r, "datos_cifrado");
        return { id: r.id, especialidad: String(r.especialidad), datos: plain === null ? null : JSON.parse(plain) as unknown };
      }),
    });
  } catch {
    return err("db_error", "No se pudo descifrar o interpretar parte de la historia clínica. No se generó un archivo incompleto.");
  }
}
