/** Complete filtered CSV, generated only after all pages and revisions validate. */
import { capabilitiesForSession } from "@/lib/auth/guard";
import { getActiveContext } from "@/lib/db/active-context";
import { computeRangeOverride, financePeriodBounds, getFinanzasExportRows, type FinanzasPeriodo } from "@/lib/db/finanzas";
import { movementRequestSchema } from "@/lib/finanzas/filter-schema";
import { EXPORT_MAX_BYTES } from "@/lib/finanzas/movements";
import { centsToDecimal } from "@/lib/format/financial-money";
import { csvEscapeTexto } from "@/lib/format/csv";

export const dynamic = "force-dynamic";
const PERIODOS: FinanzasPeriodo[] = ["hoy", "semana", "mes", "6m", "anio"];
const failure = (message: string, status: number) => new Response(message, { status, headers: { "Cache-Control": "no-store" } });

async function exportCsv(req: Request, filtered: boolean): Promise<Response> {
  const ctx = await getActiveContext();
  if (!ctx.ok) return failure("No autorizado.", 401);
  if (!capabilitiesForSession(ctx.data.session).canSeeFinanzas) return failure("No encontrado.", 404);
  const timezone = ctx.data.organization.timezone || "America/Argentina/Cordoba";
  let filter: { status: "todos" | "cobrados" | "pendientes"; query: string } = { status: "todos", query: "" };
  let periodo: FinanzasPeriodo = "mes";
  let rangeOverride;
  if (filtered) {
    if (req.headers.get("origin") !== new URL(req.url).origin) return failure("Origen no permitido.", 403);
    const text = await req.text();
    if (text.length > 4096) return failure("Filtros inválidos.", 400);
    const parsed = movementRequestSchema.safeParse(Object.fromEntries(new URLSearchParams(text)));
    if (!parsed.success) return failure("Filtros inválidos.", 400);
    periodo = parsed.data.periodo;
    filter = { status: parsed.data.status, query: parsed.data.query };
    rangeOverride = { startUtc: parsed.data.startUtc, endUtc: parsed.data.endUtc, label: periodo };
  } else {
    const raw = new URL(req.url).searchParams.get("periodo") as FinanzasPeriodo;
    periodo = PERIODOS.includes(raw) ? raw : "mes";
    // The legacy GET explicitly exports the entire period, never a partial table page.
    const bounds = financePeriodBounds({ organizationId: ctx.data.organization.id, timezone,
      rangeOverride: computeRangeOverride(periodo, timezone) });
    rangeOverride = { startUtc: bounds.startUtc, endUtc: bounds.endUtc, label: periodo };
  }
  const result = await getFinanzasExportRows({ organizationId: ctx.data.organization.id, timezone, rangeOverride }, filter);
  if (!result.ok) return failure(result.error.message, 409);
  const lines = result.data.rows.map((r) => [new Date(r.fecha).toISOString(), csvEscapeTexto(r.paciente),
    csvEscapeTexto(r.servicio), centsToDecimal(r.montoCents!), r.metodo, r.estado].join(","));
  const csv = "\uFEFF" + ["Fecha,Paciente,Servicio,Monto,Metodo,Estado", ...lines].join("\r\n");
  if (new TextEncoder().encode(csv).byteLength > EXPORT_MAX_BYTES) return failure("La exportación supera 10 MB. Elegí un período menor.", 413);
  return new Response(csv, { status: 200, headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="transacciones-folio-${periodo}.csv"`,
    "Cache-Control": "no-store",
  } });
}

export async function GET(req: Request): Promise<Response> { return exportCsv(req, false); }
export async function POST(req: Request): Promise<Response> { return exportCsv(req, true); }
