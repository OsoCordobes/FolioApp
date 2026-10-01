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
 *   2. El scope (qué orgs / qué fichas) sale de una lectura completa de vínculos
 *      bajo RLS de la cuenta resuelta por la sesión. El cliente NUNCA
 *      manda org ni paciente_id — no hay query param de scope. El gating es por
 *      `cuenta_id`, jamás por scope de org (regla dura del plan P7).
 *   3. Cada ficha se ensambla con buildPatientExport, que scopea por (org,
 *      paciente_id) y EXCLUYE el SOAP crudo (regla dura). Bajo el cliente ANON
 *      del paciente, además, el intake/count de sesión que lee X2 vuelve vacío/0
 *      (M71 no otorga esas tablas al paciente) ⇒ el portal expone MENOS, no más.
 *   4. Después de serializar y auditar, se revalidan Auth/MFA actuales, cuenta
 *      viva y conjunto completo de fichas/identidades antes de devolver bytes.
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
import type { FolioErrorCode } from "@/lib/db/errors";
import { getPacienteSession } from "@/lib/db/paciente-session";
import { buildPortalExport } from "@/lib/patient/portal-export";
import { capturePortalExportAuthority, revalidatePortalExportAuthority } from "@/lib/patient/portal-export-authorization";
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
  try { return await handleExport(); }
  catch { return exportError("network"); }
}

function exportError(code: FolioErrorCode): NextResponse {
  const status = code === "auth_required" ? 401 : ["forbidden", "mfa_required"].includes(code) ? 403
    : code === "not_found" ? 404 : code === "conflict" ? 409 : code === "network" ? 503 : 500;
  const message = code === "auth_required" ? "Volvé a iniciar sesión para descargar tus datos."
    : code === "mfa_required" ? "Completá la verificación en dos pasos para continuar."
    : code === "forbidden" ? "Tu cuenta no tiene acceso a esta descarga."
    : code === "not_found" ? "Todavía no hay fichas vinculadas disponibles para descargar."
    : code === "conflict" ? "El acceso a tus fichas cambió durante la descarga. Intentá nuevamente desde el portal."
    : "No se pudo preparar tu descarga. Intentá nuevamente.";
  return jsonError(code, message, status);
}

async function handleExport(): Promise<NextResponse> {
  // Sesión de portal. Fuente ÚNICA del scope: cuenta_id = auth.uid() (RLS M71).
  // No hay query param de paciente/org — el cliente no elige NADA.
  const session = await getPacienteSession();
  if (!session.ok) return exportError(session.error.code);

  const supabase = await createSupabaseServerClient();
  const authority = await capturePortalExportAuthority(supabase, session.data);
  if (!authority.ok) return exportError(authority.error.code);
  // The complete RLS read is authoritative; session fan-out supplies display
  // metadata only. A missing name never removes an authorized ficha silently.
  const display = new Map(session.data.pacientes.map(p => [p.pacienteId, p]));
  const pacientes = authority.data.links.map(link => {
    const known = display.get(link.pacienteId);
    return { pacienteId: link.pacienteId, organizationId: link.organizationId,
      organizacionNombre: known?.organizationId === link.organizationId ? known.organizacionNombre : null,
      bookingSlug: null };
  });

  // Ensamblado agregado: itera el conjunto completo de fichas bajo RLS y
  // delega en buildPatientExport (X2) el ensamblado por-org. Scope por cuenta_id.
  const built = await buildPortalExport({ session: { ...session.data, pacientes }, supabase });
  if (!built.ok) return exportError(built.error.code);
  const serialized = JSON.stringify(built.data, null, 2);
  const filename = `folio-mis-datos-${session.data.cuentaId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
  const response = new NextResponse(serialized, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });

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

  const finalAuthority = await revalidatePortalExportAuthority(supabase, authority.data);
  if (!finalAuthority.ok) return exportError(finalAuthority.error.code);
  return response;
}
