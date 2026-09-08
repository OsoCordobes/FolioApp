import { decryptColumn } from "@/lib/crypto";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { EvolucionPdfEntrada } from "./ficha-format";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type Row = { id: string } & Record<string, unknown>;
export const PDF_MAX_BYTES = 4 * 1024 * 1024;
/** Exact-count traversal; any interrupted/truncated/changing collection aborts. */
export async function readPdfCollection<T extends { id: string }>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; count: number | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [], ids = new Set<string>();
  let total: number | undefined, bytes = 0;
  do {
    const page = await fetchPage(rows.length, rows.length + 199);
    if (page.error || !Array.isArray(page.data) || !Number.isSafeInteger(page.count) || page.count === null || page.count < 0 || page.count > 10000 ||
      (total !== undefined && total !== page.count) || page.data.length > 200 || (!page.data.length && rows.length < page.count)) throw new Error("pdf_incomplete");
    total = page.count;
    for (const row of page.data) {
      if (!row.id || ids.has(row.id)) throw new Error("pdf_duplicate");
      ids.add(row.id); bytes += Buffer.byteLength(JSON.stringify(row));
      if (bytes > PDF_MAX_BYTES) throw new Error("pdf_limit");
      rows.push(row);
    }
    if (rows.length > total) throw new Error("pdf_count");
  } while (rows.length < total);
  return rows;
}
export function decodePdfField(value: unknown): string | null {
  const text = decryptColumn(value as string | null);
  if (value != null && text === null) throw new Error("pdf_unreadable");
  return text;
}
export async function readPdfHistory(client: Client, org: string, patient: string, sessionId: string | null): Promise<EvolucionPdfEntrada[]> {
  const sessions = await readPdfCollection<Row>((from, to) => {
    let query = client.from("sesion").select("id,organization_id,paciente_id,turno_id,created_at,locked_at,soap_s_cifrado,soap_o_cifrado,soap_a_cifrado,soap_p_cifrado,notas_cifrado", { count: "exact" })
      .eq("organization_id", org).eq("paciente_id", patient);
    if (sessionId) query = query.eq("id", sessionId);
    return query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
  });
  if (sessionId && (sessions.length !== 1 || sessions[0].id !== sessionId)) throw new Error("pdf_session_missing");
  let totalBytes = Buffer.byteLength(JSON.stringify(sessions));
  const account = (rows: Row[]) => { totalBytes += Buffer.byteLength(JSON.stringify(rows)); if (totalBytes > PDF_MAX_BYTES) throw new Error("pdf_limit"); };
  const corrections = new Map<string, NonNullable<EvolucionPdfEntrada["enmiendas"]>>();
  const visits = new Map<string, Row>();
  for (let index = 0; index < sessions.length; index += 100) {
    const batch = sessions.slice(index, index + 100), sessionIds = batch.map(s => s.id);
    const changes = await readPdfCollection<Row>((from, to) => client.from("sesion_enmienda")
      .select("id,organization_id,sesion_id,autor_id,created_at,motivo,texto_correccion_cifrado", { count: "exact" })
      .eq("organization_id", org).in("sesion_id", sessionIds).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to));
    account(changes);
    for (const r of changes) {
      if (r.organization_id !== org || !sessionIds.includes(String(r.sesion_id))) throw new Error("pdf_scope");
      const text = decodePdfField(r.texto_correccion_cifrado);
      if (text === null) throw new Error("pdf_correction_missing");
      const list = corrections.get(String(r.sesion_id)) ?? [];
      list.push({ id: r.id, autor: String(r.autor_id), fecha: String(r.created_at), motivo: String(r.motivo), texto: text });
      corrections.set(String(r.sesion_id), list);
    }
    const turns = await readPdfCollection<Row>((from, to) => client.from("turno")
      .select("id,inicio,servicio:servicio(nombre)", { count: "exact" }).eq("organization_id", org).eq("paciente_id", patient)
      .in("id", batch.map(s => String(s.turno_id))).order("id", { ascending: true }).range(from, to));
    account(turns);
    for (const turn of turns) visits.set(turn.id, turn);
  }
  return sessions.map(r => {
    if (r.organization_id !== org || r.paciente_id !== patient) throw new Error("pdf_scope");
    const visit = visits.get(String(r.turno_id));
    if (!visit) throw new Error("pdf_visit_missing");
    const embedded = Array.isArray(visit.servicio) ? visit.servicio[0] : visit.servicio;
    const servicio = embedded && typeof embedded === "object" && "nombre" in embedded ? String(embedded.nombre) : "Servicio sin nombre disponible";
    return { sesionId: r.id, fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Cordoba", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(String(visit.inicio))),
      servicio, resumen: r.locked_at ? "Sesión cerrada" : "Borrador sin cierre", notas: decodePdfField(r.notas_cifrado),
      soap: { s: decodePdfField(r.soap_s_cifrado) ?? "", o: decodePdfField(r.soap_o_cifrado) ?? "", a: decodePdfField(r.soap_a_cifrado) ?? "", p: decodePdfField(r.soap_p_cifrado) ?? "" },
      enmiendas: corrections.get(r.id) ?? [] };
  });
}
