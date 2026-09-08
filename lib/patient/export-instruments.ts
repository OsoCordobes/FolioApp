import { decryptClinicalExportField } from "./export-decrypt";
import { err, ok, type Result } from "@/lib/db/errors";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { readVerifiedClinicalCollection } from "./verified-collection";

type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>;
export interface ExportedInstrument {
  id: string; sesion_id: string | null; instrumento_id: string; instrumento_version: number;
  respuestas: unknown; respuestas_estado: "registradas" | "ausentes_en_origen";
  score_total: number | null; banda: string | null; completado_por: string;
  created_at: string; updated_at: string | null; locked_at: string | null;
}
type InstrumentRow = Omit<ExportedInstrument, "respuestas" | "respuestas_estado"> & { respuestas_cifrado: string | null; organization_id: string; paciente_id: string };
/** Preserve the original version and score. Never reinterpret historical answers. */
export async function readExportInstruments(client: Supa, organizationId: string, pacienteId: string, sesionId?: string | null): Promise<Result<ExportedInstrument[]>> {
  const result = await readVerifiedClinicalCollection<InstrumentRow>((from, to) => {
    let query = client.from("instrumento_respuesta").select("id,organization_id,paciente_id,sesion_id,instrumento_id,instrumento_version,respuestas_cifrado,score_total,banda,completado_por,created_at,updated_at,locked_at", { count: "exact" })
      .eq("organization_id", organizationId).eq("paciente_id", pacienteId);
    if (sesionId) query = query.eq("sesion_id", sesionId);
    return query.order("id", { ascending: true }).range(from, to);
  });
  if (result.error) return err("db_error", "No se pudieron verificar todas las aplicaciones de instrumentos.");
  try {
    return ok(result.data.map(({ respuestas_cifrado, organization_id, paciente_id, ...r }) => {
      if (organization_id !== organizationId || paciente_id !== pacienteId || (sesionId && r.sesion_id !== sesionId)) throw new Error("invalid_instrument_scope");
      if (!Number.isSafeInteger(r.instrumento_version) || r.instrumento_version < 1 || typeof r.instrumento_id !== "string") throw new Error("invalid_instrument");
      const plain = decryptClinicalExportField(respuestas_cifrado);
      return { ...r, respuestas: plain === null ? null : JSON.parse(plain) as unknown,
        respuestas_estado: plain === null ? "ausentes_en_origen" as const : "registradas" as const };
    }));
  } catch { return err("db_error", "No se pudo leer una respuesta original. No se generó una entrega incompleta."); }
}
