/**
 * Folio · /api/patient/export · export ARCO del paciente MEDIADO por el profesional
 * (Ley 25.326 art. 14 — derecho de acceso del titular · capa profesional, X2).
 *
 * El paciente pide sus datos; el profesional tratante los exporta desde la ficha.
 * Devuelve un JSON portable con la PII del paciente (descifrada server-side), sus
 * turnos, consentimientos firmados, sesiones originales, notas e intake y
 * enmiendas con procedencia.
 *
 * ── Gate (anti-IDOR, el riesgo central de esta feature) ───────────────────────
 *   1. Sesión Supabase válida (auth.getUser) → si no, 401.
 *   2. Rol con alcance de todas las sesiones (OWNER / DIRECTOR colegiado) → si no, 403. Espejo de la RLS
 *      de `paciente`/`sesion`; ASISTENTE/COORDINADOR no exportan PHI.
 *   3. El scope (organizationId + pacienteId) sale de la SESIÓN, no del cliente:
 *      el pacienteId viaja como query param pero SIEMPRE se lee scopeado por la
 *      org de la sesión (`.eq("organization_id", session.organizationId)`), y el
 *      builder reafirma la coherencia de org (assertPacienteScope). Un paciente
 *      de otra org → not_found (no se filtra su existencia cross-tenant).
 *
 * ── Audit (Ley 25.326 art. 14 / 26.529 art. 18) ───────────────────────────────
 * Cada export deja `paciente.export` en audit_log con actor, rol, IP/UA y el
 * paciente exportado. Deja constancia de QUIÉN exportó los datos de QUIÉN y DESDE
 * DÓNDE. Nunca incluye PII/PHI en el payload del audit.
 *
 * Node runtime + maxDuration 60: descifra PII app-side + agrega varias tablas.
 * Cache-Control no-store: la respuesta contiene PII y nunca debe cachearse.
 */

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { canExportCompleteClinicalHistory, COMPLETE_HISTORY_PERMISSION_MESSAGE } from "@/lib/auth/clinical-export-scope";
import { getActiveContext } from "@/lib/db/active-context";
import { writeAuditEntry } from "@/lib/db/audit";
import { buildPatientExport } from "@/lib/patient/export-builder";
import { CLINICAL_EXPORT_MAX_BYTES } from "@/lib/patient/verified-collection";
import { revalidateClinicalDelivery } from "@/lib/patient/export-authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  try { return await handleExport(request); }
  catch { return jsonError("network", "No se pudo preparar la entrega clínica. Intentá nuevamente.", 503); }
}

async function handleExport(request: Request): Promise<NextResponse> {
  // El pacienteId viaja como query param, pero NUNCA se usa como fuente de
  // scope: sólo dice CUÁL paciente de la org activa exportar. La org y la
  // membresía salen de la sesión.
  const url = new URL(request.url);
  const pacienteId = url.searchParams.get("paciente") ?? "";
  if (!UUID_RE.test(pacienteId)) {
    return jsonError("validation", "ID de paciente inválido.", 400);
  }

  const ctx = await getActiveContext();
  if (!ctx.ok) {
    const status =
      ctx.error.code === "auth_required" ? 401 : ["no_org", "forbidden", "mfa_required"].includes(ctx.error.code) ? 403 : 500;
    return jsonError(ctx.error.code, ctx.error.message, status);
  }

  // M46 recorta las sesiones del profesional: su COUNT no demuestra integridad.
  // La entrega completa requiere alcance de todas las sesiones y conserva RLS.
  if (!canExportCompleteClinicalHistory(ctx.data.session.role, ctx.data.session.esColegiado)) {
    return jsonError(
      "forbidden",
      COMPLETE_HISTORY_PERMISSION_MESSAGE,
      403,
    );
  }

  const supabase = await createSupabaseServerClient();

  // El builder scopea TODA query por (org de la sesión, paciente_id) y reafirma
  // la coherencia de org — anti-IDOR. Nunca recibe scope del cliente.
  const built = await buildPatientExport({
    clinicalHistory: "professional-reviewed",
    supabase,
    organizationId: ctx.data.organization.id,
    organizationNombre: ctx.data.organization.nombre,
    pacienteId,
  });

  if (!built.ok) {
    const status =
      built.error.code === "not_found"
        ? 404
        : built.error.code === "forbidden"
          ? 403
          : built.error.code === "auth_required"
            ? 401
            : 500;
    return jsonError(built.error.code, built.error.message, status);
  }

  const serialized = JSON.stringify(built.data, null, 2);
  if (Buffer.byteLength(serialized) > CLINICAL_EXPORT_MAX_BYTES) return jsonError("validation", "La entrega supera 4 MB. No se generó un archivo incompleto; solicitá una entrega por el circuito de archivo clínico.", 413);

  // Audit del export (best-effort, fail-safe: no rompe el export si falla). Deja
  // constancia de QUIÉN exportó los datos de QUIÉN y DESDE DÓNDE. Sin PII/PHI.
  const h = await headers();
  await writeAuditEntry({
    organizationId: ctx.data.organization.id,
    actorId: ctx.data.session.userId,
    actorRole: ctx.data.session.role,
    action: "paciente.export",
    resourceType: "paciente",
    resourceId: pacienteId,
    ip: h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? null,
    userAgent: h.get("user-agent") ?? null,
    payload: {
      formato: "json",
      canal: "profesional",
      basis: "Ley 25.326 art. 14 — derecho de acceso del titular (mediado por el profesional)",
    },
  });

  const authorized = await revalidateClinicalDelivery(supabase, ctx.data.session, pacienteId);
  if (!authorized.ok) return jsonError(authorized.error.code, authorized.error.message,
    authorized.error.code === "auth_required" ? 401 : ["no_org", "forbidden", "mfa_required"].includes(authorized.error.code) ? 403 : 503);

  const filename = `folio-paciente-export-${pacienteId.slice(0, 8)}-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;

  return new NextResponse(serialized, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
