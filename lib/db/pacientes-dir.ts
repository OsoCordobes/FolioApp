import "server-only";
import { createHash } from "node:crypto";
import { blindIndex, blindIndexCandidatos, blindIndexPhoneCandidatos, decryptColumn } from "@/lib/crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { directoryRequestSchema, type DirectoryPage } from "@/lib/pacientes/directory";
import { getActiveSession } from "./session";
import { err, ok, type Result } from "./errors";

export interface PacienteDirRow {
  id: string;
  nombre: string;
  tel: string;
  email: string;
  tipo: "nuevo" | "recurrente";
  sesiones: number;
  ultima: string | null;
  proximo: string | null;
  tags: string[];
  estado: "activo" | "inactivo" | "pausa" | "alta";
  cobertura: string | null;
  coberturaPlan: string | null;
}
interface DirectoryDatabaseRow {
  paciente_id: string;
  nombre_cifrado: string | null;
  apellido_cifrado: string | null;
  telefono_cifrado: string | null;
  email_cifrado: string | null;
  tipo_paciente: string;
  sesiones_completadas: number;
  ultima_visita: string | null;
  proximo_turno: string | null;
  tags: string[] | null;
  estado: PacienteDirRow["estado"];
  cobertura_nombre: string | null;
  cobertura_plan: string | null;
}
const dateInCordoba = (value: string | null): string | null => value
  ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Cordoba", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) : null;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Only the bounded page is decrypted. RLS is enforced by the invoker RPC. */
export async function getPacientesDirectorio(input: unknown = {}, exportCutoff?: string, expectedContext?: { organizationId: string; memberId: string }): Promise<Result<DirectoryPage>> {
  const parsed = directoryRequestSchema.safeParse(input);
  if (!parsed.success) return err("validation", "Filtros inválidos.");
  const session = await getActiveSession();
  if (!session.ok) return session;
  if (expectedContext && (session.data.organizationId !== expectedContext.organizationId || session.data.memberId !== expectedContext.memberId)) return err("forbidden", "El contexto cambió. Reiniciá la exportación.");
  try {
    const { query, status, coverage, cursor } = parsed.data;
    const org = session.data.organizationId;
    const binding = blindIndex(createHash("sha256").update(JSON.stringify(["directory-v1", org, session.data.memberId, query, status, coverage])).digest("hex"));
    let beforeCreated: string | null = null;
    let beforeId: string | null = null;
    let cutoff = exportCutoff ?? null;
    if (cursor) {
      const token = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      const signature = blindIndex(JSON.stringify([binding, token.createdAt, token.id, token.cutoff]));
      if (token.signature !== signature || !uuid.test(token.id) || typeof token.createdAt !== "string" || typeof token.cutoff !== "string") return err("validation", "Volvé a iniciar la búsqueda.");
      beforeCreated = token.createdAt;
      beforeId = token.id;
      cutoff = token.cutoff;
      if (exportCutoff && cutoff !== exportCutoff) return err("validation", "Volvé a iniciar la búsqueda.");
    }
    const client = await createSupabaseServerClient();
    const { data, error } = await client.rpc("pacientes_directory_page", {
      p_org: org,
      p_hashes: [...new Set([...blindIndexCandidatos(query, org), ...blindIndexCandidatos(query)])],
      p_phone_hashes: [...new Set([...blindIndexPhoneCandidatos(query, org), ...blindIndexPhoneCandidatos(query)])],
      p_search: query.length > 0, p_status: status, p_coverage: coverage,
      p_before_created: beforeCreated, p_before_id: beforeId, p_limit: 50, p_cutoff: cutoff,
    });
    if (error || !data || !Array.isArray(data.rows) || data.rows.length > 50 ||
      !Number.isSafeInteger(data.total) || data.total < 0 || !/^[a-f0-9]{32}$/.test(data.revision) ||
      typeof data.cutoff !== "string" || !Array.isArray(data.coberturas) || !data.counts) throw new Error("directory_invalid_response");
    const seen = new Set<string>();
    const rows: PacienteDirRow[] = data.rows.map((r: DirectoryDatabaseRow) => {
      if (!uuid.test(r.paciente_id) || seen.has(r.paciente_id) || !Number.isSafeInteger(r.sesiones_completadas) ||
        !["activo", "inactivo", "pausa", "alta"].includes(r.estado)) throw new Error("directory_invalid_row");
      seen.add(r.paciente_id);
      return {
        id: r.paciente_id,
        nombre: [decryptColumn(r.nombre_cifrado), decryptColumn(r.apellido_cifrado)].filter(Boolean).join(" ") || "Sin nombre",
        tel: decryptColumn(r.telefono_cifrado) ?? "", email: decryptColumn(r.email_cifrado) ?? "",
        tipo: r.tipo_paciente === "NUEVO" ? "nuevo" : "recurrente", sesiones: r.sesiones_completadas,
        ultima: dateInCordoba(r.ultima_visita), proximo: dateInCordoba(r.proximo_turno), tags: r.tags ?? [],
        estado: r.estado, cobertura: r.cobertura_nombre, coberturaPlan: r.cobertura_plan,
      };
    });
    let nextCursor: string | null = null;
    if (data.next_cursor) {
      const { createdAt, id } = data.next_cursor;
      if (typeof createdAt !== "string" || !uuid.test(id) || id !== rows.at(-1)?.id) throw new Error("directory_invalid_cursor");
      nextCursor = Buffer.from(JSON.stringify({ createdAt, id, cutoff: data.cutoff,
        signature: blindIndex(JSON.stringify([binding, createdAt, id, data.cutoff])) })).toString("base64url");
    }
    return ok({ rows, total: data.total, counts: data.counts, coberturas: data.coberturas,
      nextCursor, revision: data.revision, cutoff: data.cutoff });
  } catch {
    return err("db_error", "No se pudo cargar el directorio. Reintentá la búsqueda.");
  }
}
