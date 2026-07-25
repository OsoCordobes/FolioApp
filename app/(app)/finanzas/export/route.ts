/**
 * Folio · GET /finanzas/export — export CSV COMPLETO del período (E2).
 *
 * El botón "Exportar" descargaba solo las ≤20 transacciones renderizadas: con
 * período "Año" el dueño exportaba 20 filas creyendo que exportaba el año.
 * Este route handler reusa el MISMO rango (computeRangeOverride) y la MISMA
 * query de pagos que la página (getFinanzasExportRows), sin cap.
 *
 * Autorización: idéntica a app/(app)/finanzas/page.tsx — el layout de (app) no
 * cubre route handlers, así que acá se repite el gate completo:
 *   - sesión activa (getActiveContext),
 *   - capabilities.canSeeFinanzas (recepción/coordinación → 404),
 *   - scoping por profesional (PROFESIONAL sin canSeeFinanzasAll exporta SOLO
 *     lo suyo — mismo fix del leak E1).
 *
 * PII: el CSV lleva nombres de pacientes (igual que la pantalla que el rol ya
 * ve). Sale con Content-Disposition attachment y BOM UTF-8 para que Excel
 * es-AR abra tildes bien.
 */

import { capabilitiesForSession } from "@/lib/auth/guard";
import { finanzasScopeMemberId } from "@/lib/auth/finanzas-scope";
import { getActiveContext } from "@/lib/db/active-context";
import {
  computeRangeOverride,
  getFinanzasExportRows,
  type FinanzasPeriodo,
} from "@/lib/db/finanzas";

export const dynamic = "force-dynamic";

const PERIODOS: FinanzasPeriodo[] = ["hoy", "semana", "mes", "6m", "anio"];

function parsePeriodo(raw: string | null): FinanzasPeriodo {
  return PERIODOS.includes(raw as FinanzasPeriodo) ? (raw as FinanzasPeriodo) : "mes";
}

function csvEscape(v: string): string {
  const needsQuote = /[",\r\n]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

export async function GET(req: Request): Promise<Response> {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    return new Response("No autorizado.", { status: 401 });
  }

  const caps = capabilitiesForSession(ctx.data.session);
  if (!caps.canSeeFinanzas) {
    // Mismo corte que la página (notFound) para no revelar la ruta a roles
    // sin panel de finanzas.
    return new Response("No encontrado.", { status: 404 });
  }

  const tz = ctx.data.organization.timezone || "America/Argentina/Cordoba";
  const periodo = parsePeriodo(new URL(req.url).searchParams.get("periodo"));
  const rangeOverride = computeRangeOverride(periodo, tz);
  const profesionalMemberId = finanzasScopeMemberId(caps, ctx.data.session.memberId);

  const result = await getFinanzasExportRows({
    organizationId: ctx.data.organization.id,
    timezone: tz,
    rangeOverride,
    profesionalMemberId,
  });
  if (!result.ok) {
    return new Response("Error generando el export.", { status: 500 });
  }

  const headers = ["Fecha", "Paciente", "Servicio", "Monto", "Metodo", "Estado"];
  const lines = result.data.rows.map((r) =>
    [
      new Date(r.fecha).toISOString(),
      csvEscape(r.paciente),
      csvEscape(r.servicio),
      String(r.monto),
      r.metodo,
      r.estado,
    ].join(","),
  );
  // BOM UTF-8 (U+FEFF): sin esto Excel es-AR abre "José" como mojibake.
  const BOM = String.fromCharCode(0xfeff);
  const csv = BOM + [headers.join(","), ...lines].join("\r\n");

  const filename = `transacciones-folio-${periodo}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
