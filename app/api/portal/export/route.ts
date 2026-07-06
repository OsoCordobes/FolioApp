/**
 * Folio · /api/portal/export · export SELF-SERVE del paciente (capa 2 · portal)
 * (Ley 25.326 art. 14 — derecho de acceso del titular · Fase 3 · P7).
 *
 * Espeja /api/patient/export (capa profesional X2), pero el actor es el PROPIO
 * PACIENTE logueado en el portal, sin intermediación del profesional. Devuelve un
 * JSON portable AGREGADO: una sección por cada org donde el paciente tiene una
 * ficha vinculada a su `paciente_cuenta`. Reúsa el assembler de X2
 * (lib/patient/export-builder.ts) vía lib/patient/portal-export.ts.
 *
 * ── Gate (anti-IDOR, el riesgo central) ───────────────────────────────────────
 *   1. Sesión de PORTAL válida (getPacienteSession → paciente_cuenta_actual() =
 *      auth.uid()) → si no, 401/403. NO se acepta rol de staff: un member sin
 *      paciente_cuenta recibe `forbidden`.
 *   2. El scope (qué orgs / qué fichas) sale ÍNTEGRAMENTE del fan-out de la
 *      sesión (RLS de M71: paciente.cuenta_id = auth.uid()). El cliente NUNCA
 *      manda org ni paciente_id — no hay query param de scope. El gating es por
 *      `cuenta_id`, jamás por scope de org (regla dura del plan P7).
 *   3. Cada ficha se ensambla con buildPatientExport, que scopea por (org,
 *      paciente_id) y EXCLUYE el SOAP crudo (regla dura). Bajo el cliente ANON
 *      del paciente, además, el intake/count de sesión que lee X2 vuelve vacío/0
 *      (M71 no otorga esas tablas al paciente) ⇒ el portal expone MENOS, no más.
 *
 * ── Audit (Ley 25.326 art. 14 / 26.529 art. 18) ───────────────────────────────
 * Se escribe una fila `paciente.export` por CADA org exportada, con el paciente
 * como actor, canal 'portal', IP/UA. Así el rastro de cumplimiento de cada
 * consultorio queda completo (quién ejerció acceso, cuándo, desde dónde). Nunca
 * incluye PII/PHI en el payload del audit.
 *
 * Node runtime + maxDuration 60: descifra PII app-side y agrega varias orgs.
 * Cache-Control no-store: la respuesta contiene PII y nunca debe cachearse.
 */

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { writeAuditEntry } from "@/lib/db/audit";
import { getPacienteSession } from "@/lib/db/paciente-session";
import { buildPortalExport } from "@/lib/patient/portal-export";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(): Promise<NextResponse> {
  // Sesión de portal. Fuente ÚNICA del scope: cuenta_id = auth.uid() (RLS M71).
  // No hay query param de paciente/org — el cliente no elige NADA.
  const session = await getPacienteSession();
  if (!session.ok) {
    // auth_required → 401 (no hay sesión Supabase). forbidden → 403 (hay sesión
    // pero no es cuenta de portal: staff, o cuenta no provisionada).
    const status = session.error.code === "auth_required" ? 401 : 403;
    return jsonError(session.error.code, session.error.message, status);
  }

  const supabase = await createSupabaseServerClient();

  // Ensamblado agregado: itera las fichas linkeadas (fan-out de la sesión) y
  // delega en buildPatientExport (X2) el ensamblado por-org. Scope por cuenta_id.
  const built = await buildPortalExport({ session: session.data, supabase });
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

  // Audit del export: una fila por org exportada (best-effort, fail-safe: no
  // rompe el export si falla). Deja constancia en CADA consultorio de que el
  // paciente ejerció su derecho de acceso, desde dónde. Sin PII/PHI en el payload.
  const h = await headers();
  const ip = h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? null;
  const userAgent = h.get("user-agent") ?? null;
  for (const orgExport of built.data.organizaciones) {
    await writeAuditEntry({
      organizationId: orgExport.organizacion.id,
      actorId: session.data.userId,
      // El paciente no tiene rol de staff; lo marcamos como PACIENTE en el snapshot.
      actorRole: "PACIENTE",
      action: "paciente.export",
      resourceType: "paciente",
      resourceId: orgExport.paciente.id,
      ip,
      userAgent,
      payload: {
        formato: "json",
        canal: "portal",
        basis: "Ley 25.326 art. 14 — derecho de acceso del titular (self-serve, portal)",
      },
    });
  }

  const filename = `folio-mis-datos-${session.data.cuentaId.slice(0, 8)}-${new Date()
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
