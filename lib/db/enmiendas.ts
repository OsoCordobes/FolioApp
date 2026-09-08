import { tryDecrypt } from "@/lib/crypto";
import type { EnmiendaClinica } from "@/lib/ficha/enmienda";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { readCompleteCollection } from "./complete-collection";
import { err, ok, type Result } from "./errors";

type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>;
interface EnmiendaRow {
  id: string; sesion_id: string; autor_id: string; created_at: string;
  motivo: string; texto_correccion_cifrado: string | null;
}

/** Session ids must come from a patient-scoped read under the same RLS client. */
export async function readEnmiendas(supabase: Supa, organizationId: string, sesionIds: string[]): Promise<Result<Map<string, EnmiendaClinica[]>>> {
  const grouped = new Map<string, EnmiendaClinica[]>();
  for (let i = 0; i < sesionIds.length; i += 100) {
    const result = await readCompleteCollection<EnmiendaRow>((from, to) => supabase
      .from("sesion_enmienda")
      .select("id, sesion_id, autor_id, created_at, motivo, texto_correccion_cifrado", { count: "exact" })
      .eq("organization_id", organizationId).in("sesion_id", sesionIds.slice(i, i + 100))
      .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to));
    if (result.error) return err("db_error", "No se pudieron leer todas las correcciones.");
    for (const row of result.data) {
      if (!sesionIds.slice(i, i + 100).includes(row.sesion_id)) return err("db_error", "No se pudo verificar el alcance de una corrección.");
      const texto = tryDecrypt(row.texto_correccion_cifrado, "enmienda.texto");
      if (texto === null) return err("db_error", "No se pudo descifrar una corrección de la historia clínica.");
      const list = grouped.get(row.sesion_id) ?? [];
      list.push({ id: row.id, autorId: row.autor_id, createdAt: row.created_at, motivo: row.motivo, texto });
      grouped.set(row.sesion_id, list);
    }
  }
  return ok(grouped);
}
