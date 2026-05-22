/**
 * Folio · /api/me/export · ARCO Access (Ley 25.326 art. 14).
 *
 * Devuelve un JSON estructurado y portable con todos los datos personales
 * del usuario autenticado. Apto como evidencia de cumplimiento del derecho
 * de acceso y como mecanismo de portabilidad.
 *
 * Scope del export:
 *   - profile (PII descifrada)
 *   - memberships (organization_id, rol, scope, equipo, es_colegiado, timestamps)
 *   - subscripciones / planes asociados al profile (si los hay)
 *   - integraciones (proveedor + fecha; tokens NO se exportan por seguridad)
 *
 * El export NO incluye:
 *   - PHI de pacientes: el profesional la accede vía la UI normal (no es
 *     dato personal *suyo*; lo es del paciente, que tiene derecho de
 *     acceso vía el profesional o vía privacidad@folio.app).
 *   - Tokens OAuth, secrets, certificados AFIP cifrados.
 *
 * Audit log:
 *   - Cada export deja una fila `profile.export` en audit_log con
 *     organization_id de la primera membresía. Sirve como prueba de
 *     atención a la solicitud ARCO.
 */

import { NextResponse } from "next/server";

import { decryptColumn } from "@/lib/crypto";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/versions";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, error: { code: "auth_required", message: "No estás autenticado." } },
      { status: 401 },
    );
  }

  const service = createSupabaseServiceClient();

  // 1. Profile (PII cifrada en DB → la desciframos para el titular).
  const { data: profileRow, error: profileErr } = await service
    .from("profile")
    .select("id, email, nombre_cifrado, apellido_cifrado, matricula, avatar_url, two_factor_enabled, created_at, updated_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr || !profileRow) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "Profile no encontrado." } },
      { status: 404 },
    );
  }

  // 2. Memberships (todas las orgs donde el profile es miembro, incluso
  //    soft-deleted: el titular tiene derecho a conocer su histórico).
  const { data: members } = await service
    .from("member")
    .select(
      "id, organization_id, role, alcance, profesionales_gestionados, equipo_id, es_colegiado, accepted_at, deleted_at, created_at",
    )
    .eq("profile_id", user.id);

  // 3. Integraciones del profesional (sin tokens).
  const { data: integraciones } = await service
    .from("integration")
    .select("id, organization_id, proveedor, expira_ts, ultimo_uso_ts, created_at")
    .eq("profesional_id", members?.[0]?.id ?? "00000000-0000-0000-0000-000000000000");

  // 4. Suscripción (si existe la tabla en este deploy).
  const { data: suscripciones } = await service
    .from("suscripcion")
    .select("id, organization_id, estado, plan, periodo_actual_fin, created_at")
    .in(
      "organization_id",
      (members ?? []).map((m) => m.organization_id),
    );

  // 5. Audit del export (Ley 25.326 art. 14 — evidencia de respuesta).
  if (members && members.length > 0) {
    await service.from("audit_log").insert({
      organization_id: members[0].organization_id,
      actor_id: user.id,
      actor_role: members[0].role,
      action: "profile.export",
      resource_type: "profile",
      resource_id: user.id,
      payload: { reason: "ARCO art. 14 — derecho de acceso del titular" },
    });
  }

  const payload = {
    ok: true,
    exported_at: new Date().toISOString(),
    ley_25326_basis: "art. 14 (derecho de acceso) — art. 16 (portabilidad implícita)",
    privacy_policy_version: PRIVACY_VERSION,
    terms_version: TERMS_VERSION,
    profile: {
      id: profileRow.id,
      email: profileRow.email,
      nombre: decryptColumn(profileRow.nombre_cifrado as unknown as Buffer),
      apellido: decryptColumn(profileRow.apellido_cifrado as unknown as Buffer),
      matricula: profileRow.matricula,
      avatar_url: profileRow.avatar_url,
      two_factor_enabled: profileRow.two_factor_enabled,
      created_at: profileRow.created_at,
      updated_at: profileRow.updated_at,
    },
    memberships: members ?? [],
    integraciones: (integraciones ?? []).map((i) => ({
      id: i.id,
      organization_id: i.organization_id,
      proveedor: i.proveedor,
      expira_ts: i.expira_ts,
      ultimo_uso_ts: i.ultimo_uso_ts,
      created_at: i.created_at,
      // Tokens deliberadamente omitidos.
    })),
    suscripciones: suscripciones ?? [],
    notas: [
      "Este export contiene los datos personales del titular del profile.",
      "Los datos clínicos de pacientes (PHI) NO están incluidos porque el responsable de esos datos es el profesional tratante en su rol de data controller bajo Ley 25.326. Los pacientes pueden ejercer su derecho de acceso solicitándolo al profesional o, subsidiariamente, a privacidad@folio.app.",
      "Tokens OAuth, certificados AFIP y secretos se omiten por seguridad.",
      "Para ejercer derecho de rectificación: Configuración → Cuenta. Para supresión: Configuración → Eliminar cuenta.",
    ],
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="folio-export-${user.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
