/**
 * Folio · /api/patient/export · export ARCO del paciente MEDIADO por el profesional
 * (Ley 25.326 art. 14 — derecho de acceso del titular · capa profesional, X2).
 *
 * El paciente pide sus datos; el profesional tratante los exporta desde la ficha.
 * Devuelve un JSON portable con la PII del paciente (descifrada server-side), sus
 * turnos, sus consentimientos firmados y un resumen clínico curado. NO incluye el
 * SOAP crudo (ver lib/patient/export-builder.ts — regla dura).
 *
 * ── Gate (anti-IDOR, el riesgo central de esta feature) ───────────────────────
 *   1. Sesión Supabase válida (auth.getUser) → si no, 401.
 *   2. Rol con acceso clínico en la org activa (capabilitiesFor().canReadClinical
 *      = OWNER / PROFESIONAL / DIRECTOR colegiado) → si no, 403. Espejo de la RLS
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

import { capabilitiesFor } from "@/lib/auth/capabilities";
import { getActiveContext } from "@/lib/db/active-context";
import { writeAuditEntry } from "@/lib/db/audit";
import { buildPatientExport } from "@/lib/patient/export-builder";
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
      ctx.error.code === "auth_required" ? 401 : ctx.error.code === "no_org" ? 403 : 500;
    return jsonError(ctx.error.code, ctx.error.message, status);
  }

  // Gate de rol clínico (espejo de can_read_clinical). ASISTENTE/COORDINADOR
  // reciben 403 antes de tocar la DB; la RLS de paciente igual los frenaría.
  const caps = capabilitiesFor(ctx.data.session.role, ctx.data.session.esColegiado);
  if (!caps.canReadClinical) {
    return jsonError(
      "forbidden",
      "Tu rol no permite exportar los datos clínicos de un paciente.",
      403,
    );
  }

  const supabase = await createSupabaseServerClient();

  // El builder scopea TODA query por (org de la sesión, paciente_id) y reafirma
  // la coherencia de org — anti-IDOR. Nunca recibe scope del cliente.
  const built = await buildPatientExport({
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

  const filename = `folio-paciente-export-${pacienteId.slice(0, 8)}-${new Date()
    .toISOString()
    .slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(built.data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
