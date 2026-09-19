import { getPacientesDirectorio } from "@/lib/db/pacientes-dir";
import { getActiveSession } from "@/lib/db/session";
import { collectDirectoryExport, directoryFilterSchema, DIRECTORY_EXPORT_MAX_BYTES } from "@/lib/pacientes/directory";
import { csvEscapeTexto } from "@/lib/format/csv";
import { formatCobertura } from "@/lib/pacientes/cobertura";

export const dynamic = "force-dynamic";
const failure = (message: string, status: number) => new Response(message, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(req: Request): Promise<Response> {
  if (req.headers.get("origin") !== new URL(req.url).origin) return failure("Origen no permitido.", 403);
  const session = await getActiveSession();
  if (!session.ok) return failure("No autorizado.", 401);
  const text = await req.text();
  if (text.length > 4096) return failure("Filtros inválidos.", 400);
  const parsed = directoryFilterSchema.safeParse(Object.fromEntries(new URLSearchParams(text)));
  if (!parsed.success) return failure("Filtros inválidos.", 400);
  try {
    const rows = await collectDirectoryExport(async (cursor, cutoff) => {
      const page = await getPacientesDirectorio({ ...parsed.data, cursor }, cutoff, {
        organizationId: session.data.organizationId, memberId: session.data.memberId,
      });
      if (!page.ok) throw new Error("directory_export_failed");
      return page.data;
    });
    const lines = rows.map((r) => [r.nombre, r.tel, r.email, formatCobertura(r.cobertura, r.coberturaPlan),
      r.tipo, String(r.sesiones), r.ultima ?? "", r.proximo ?? "", r.estado, r.tags.join("; ")].map(csvEscapeTexto).join(","));
    const csv = "\uFEFF" + ["Nombre,Telefono,Email,Cobertura,Tipo,Sesiones,Ultima,Proximo,Estado,Tags", ...lines].join("\r\n");
    if (new TextEncoder().encode(csv).byteLength > DIRECTORY_EXPORT_MAX_BYTES) return failure("La exportación supera 4 MB. Acotá los filtros.", 413);
    return new Response(csv, { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="pacientes-folio.csv"', "Cache-Control": "no-store",
    } });
  } catch {
    return failure("No se generó un archivo completo: los datos cambiaron o se superó el límite de 10.000 filas / 4 MB. Reintentá con filtros más acotados.", 409);
  }
}
