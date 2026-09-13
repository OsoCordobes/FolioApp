import { capabilitiesFor } from "@/lib/auth/capabilities";
import { canExportCompleteClinicalHistory, COMPLETE_HISTORY_PERMISSION_MESSAGE } from "@/lib/auth/clinical-export-scope";
import { readExportInstruments } from "@/lib/patient/export-instruments";
import { CLINICAL_EXPORT_MAX_BYTES } from "@/lib/patient/verified-collection";
import { revalidateClinicalDelivery } from "@/lib/patient/export-authorization";
import { ok, type Result } from "@/lib/db/errors";
/**
 * Folio · /api/pacientes/[id]/ficha-pdf · export PDF de ficha/sesión (C10).
 *
 * Genera un PDF de la ficha clínica del paciente (membrete, datos, SOAP,
 * resumen de la herramienta de la especialidad, escalas) y lo devuelve como
 * `application/pdf`. Server-side, Node runtime — @react-pdf/renderer usa APIs de
 * Node y necesita margen de cold-start.
 *
 * ── Entrega autorizada de contenido clínico ────────────────────────────────
 * La PII/PHI se descifra en servidor y se entrega dentro del PDF autorizado.
 * El PDF contiene datos legibles: no es un sobre cifrado para archivo. No se
 * registran textos clínicos ni se devuelven columnas cifradas crudas.
 *
 * ── Auth y alcance de entrega ──────────────────────────────────────────────
 * Historia completa: OWNER o DIRECTOR colegiado; sesión puntual: rol clínico.
 * PROFESIONAL conserva acceso a sus propias sesiones bajo RLS. El scoping de
 * tenant + caja-fuerte lo aplica RLS dentro de getPacienteFicha (devuelve
 * not_found si el paciente no pertenece a la org / el rol no puede leerlo).
 *
 * ── Audit del export (Ley 26.529 art. 18 · 25.326 art. 14) ────────────────────
 * La preparación deja `paciente_ficha.export_pdf_prepared` con actor, rol e id
 * de sesión. No confirma recepción: un cambio de permisos posterior puede
 * impedir la entrega y una respuesta HTTP no prueba que el cliente la recibió.
 */

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { writeAuditEntry } from "@/lib/db/audit";
import { getActiveContext } from "@/lib/db/active-context";
import { getPacienteFicha } from "@/lib/db/paciente-ficha";
import { readPdfHistory, readPdfCollection } from "@/lib/pdf/history-reader";
import {
  ESPECIALIDADES_META,
  getEspecialidadMetaByToolId,
} from "@/lib/especialidades/meta";
import { getInstrumento } from "@/lib/instrumentos";
import { evolucionValidada } from "@/lib/pdf/ficha-format";
import { buildFichaPdf, type FichaPdfData } from "@/lib/pdf/ficha-pdf";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Descifra PII/PHI app-side + arma el binario PDF: margen sobre el default por
// el cold-start de @react-pdf/renderer (bundle grande de fuentes core).
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try { return await handleExport(_request, { params }); }
  catch { return jsonError("network", "No se pudo preparar el PDF clínico. Intentá nuevamente.", 503); }
}

async function handleExport(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: pacienteId } = await params;
  if (!UUID_RE.test(pacienteId)) {
    return jsonError("validation", "ID de paciente inválido.", 400);
  }

  const ctx = await getActiveContext();
  if (!ctx.ok) {
    const status =
      ctx.error.code === "auth_required" ? 401 : ["no_org", "forbidden", "mfa_required"].includes(ctx.error.code) ? 403 : 500;
    return jsonError(ctx.error.code, ctx.error.message, status);
  }

  if (!capabilitiesFor(ctx.data.session.role, ctx.data.session.esColegiado).canReadClinical) {
    return jsonError("forbidden", "No tenés permiso para exportar esta ficha.", 403);
  }

  const url = new URL(_request.url);
  const sesionIdRaw = url.searchParams.get("sesion");
  const sesionId = sesionIdRaw != null && UUID_RE.test(sesionIdRaw) ? sesionIdRaw : null;
  if (sesionIdRaw !== null && sesionId === null) return jsonError("validation", "ID de sesión inválido.", 400);
  const pidioSesionPuntual = sesionId != null;
  if (!pidioSesionPuntual && !canExportCompleteClinicalHistory(ctx.data.session.role, ctx.data.session.esColegiado)) {
    return jsonError("forbidden", COMPLETE_HISTORY_PERMISSION_MESSAGE, 403);
  }

  // Ficha completa (PII/PHI desencriptada server-side). El scoping org+paciente
  // + caja-fuerte lo aplica RLS acá dentro: si el paciente no es de la org o el
  // rol no puede leerlo, devuelve not_found (no filtramos existencia cross-tenant).
  const fichaRes = await getPacienteFicha(
    pacienteId,
    ctx.data.organization.id,
    ctx.data.organization.especialidad,
    null,
    ctx.data.organization.timezone,
    // La sesión puntual se recupera por separado bajo su propia RLS.
    !pidioSesionPuntual,
  );
  if (!fichaRes.ok) {
    if (fichaRes.error.code === "not_found") {
      return jsonError("not_found", "Paciente no encontrado.", 404);
    }
    return jsonError(fichaRes.error.code, fichaRes.error.message, 500);
  }
  const ficha = fichaRes.data;

  const supabase = await createSupabaseServerClient();
  let history: Awaited<ReturnType<typeof readPdfHistory>>;
  let evolucion: FichaPdfData["evolucion"];
  try {
    // Validate persisted tool versions and preserve original SOAP/enmiendas.
    // The full ficha also includes notes and closed visits without a session.
    history = await readPdfHistory(supabase, ctx.data.organization.id, pacienteId, sesionId, ficha.paciente.fechaNacimiento ?? null);
    evolucion = pidioSesionPuntual ? [] : evolucionValidada(ficha.plan.sesiones, history);
  } catch {
    return jsonError("db_error", "No se pudo leer toda la historia autorizada. No se generó un PDF incompleto. Reintentá.", 500);
  }
  // The reader sorts by actual encounter time, even for retroactive notes.
  const latest = history[0];
  const soap = latest?.soap ?? { s: "", o: "", a: "", p: "" };
  const fechaSesion = pidioSesionPuntual ? latest?.fecha ?? null : null;
  const metaActiva = getEspecialidadMetaByToolId(latest?.toolId) ?? ESPECIALIDADES_META[ctx.data.organization.especialidad];

  const profesionalNombre =
    [ctx.data.profile.nombre, ctx.data.profile.apellido].filter(Boolean).join(" ").trim() || null;

  // Matrícula: SÓLO si el member actual optó por mostrarla (M62 mostrar_matricula).
  // El valor vive en profile.matricula; el opt-in en member. Lectura angosta
  // bajo RLS (member propio). Un error de lectura degrada a "no mostrar".
  const matricula = await resolveMatriculaVisible(
    ctx.data.session.memberId,
    ctx.data.profile.matricula,
  );

  const instrumentosRes = await loadInstrumentos(pacienteId, ctx.data.organization.id, sesionId);
  if (!instrumentosRes.ok) return jsonError("db_error", instrumentosRes.error.message, 500);
  const pdfData: FichaPdfData = {
    alcanceEntrega: "Documento de lectura clínica. Incluye respuestas y resultados de instrumentos tal como se registraron, sin nueva interpretación. No incluye bytes de adjuntos, firmas ni un archivo restaurable. Las lecturas no constituyen un snapshot transaccional global.",
    enmiendas: pidioSesionPuntual ? latest?.enmiendas ?? [] : [],
    notasSesion: pidioSesionPuntual ? latest?.notas ?? null : null,
    notasFicha: pidioSesionPuntual ? [] : ficha.notas,
    organizacion: ctx.data.organization.nombre,
    profesional: profesionalNombre,
    matricula,
    paciente: ficha.paciente.nombre,
    edad: ficha.paciente.edad > 0 ? String(ficha.paciente.edad) : "—",
    genero: ficha.paciente.genero,
    motivo: ficha.paciente.motivo,
    fechaSesion,
    soap: {
      s: soap.s,
      o: soap.o,
      a: soap.a,
      p: soap.p,
    },
    resumenHerramienta: latest?.resumen ?? null,
    especialidad: metaActiva.nombre,
    instrumentos: instrumentosRes.data,
    // La historia completa conserva todas las sesiones; la entrega puntual sólo esa visita.
    evolucion,
    generadoTs: new Date().toISOString(),
  };

  const pdf = await buildFichaPdf(pdfData);
  if (pdf.length > CLINICAL_EXPORT_MAX_BYTES) return jsonError("validation", "El PDF supera 4 MB. No se generó una entrega incompleta; solicitá el circuito de archivo clínico.", 413);

  // Record preparation only: the final guard may still refuse these bytes.
  // Never include clinical text or claim confirmed delivery in the audit.
  const h = await headers();
  await writeAuditEntry({
    organizationId: ctx.data.organization.id,
    actorId: ctx.data.session.userId,
    actorRole: ctx.data.session.role,
    action: "paciente_ficha.export_pdf_prepared",
    resourceType: "paciente",
    resourceId: pacienteId,
    ip: h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? null,
    userAgent: h.get("user-agent") ?? null,
    payload: {
      sesion_id: sesionId,
      formato: "pdf",
      delivery_confirmed: false,
      basis: "Ley 26.529 art. 18 (registro de acceso a HC)",
    },
  });

  const deliveryClient = await createSupabaseServerClient();
  try {
    for (let index = 0; index < history.length; index += 100) {
      const ids = history.slice(index, index + 100).map(row => row.sesionId);
      const allowed = await readPdfCollection<{ id: string }>((from, to) => deliveryClient.from("sesion").select("id", { count: "exact" })
        .eq("organization_id", ctx.data.organization.id).eq("paciente_id", pacienteId).in("id", ids).order("id", { ascending: true }).range(from, to));
      if (allowed.length !== ids.length || allowed.some(row => !ids.includes(row.id))) return jsonError("forbidden", "Cambió el acceso a una sesión durante la entrega.", 403);
    }
  } catch { return jsonError("forbidden", "No se pudo confirmar el acceso a las sesiones al finalizar la entrega.", 403); }
  // Fresh patient/vault RLS, Auth, current member and M101 MFA are the final
  // authority, immediately before delivery. No intervening audit or rendering.
  const authorized = await revalidateClinicalDelivery(deliveryClient, ctx.data.session, pacienteId, sesionId);
  if (!authorized.ok) return jsonError(authorized.error.code, authorized.error.message,
    authorized.error.code === "auth_required" ? 401 : ["no_org", "forbidden", "mfa_required"].includes(authorized.error.code) ? 403 : 503);

  const filename = `folio-ficha-${pacienteId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.pdf`;
  // Content-Length ancla el stream para clientes que lo esperan; Buffer.length
  // son bytes reales del PDF.
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Resuelve la matrícula a imprimir en el membrete: devuelve `profileMatricula`
 * SÓLO si el member actual tiene `mostrar_matricula = true` (opt-in M62). Si el
 * opt-in es false, o la lectura falla, devuelve null (no se imprime). Lectura
 * angosta bajo RLS: sólo el member propio (id == memberId de la sesión).
 */
async function resolveMatriculaVisible(
  memberId: string,
  profileMatricula: string | null,
): Promise<string | null> {
  if (!profileMatricula) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("member")
      .select("mostrar_matricula")
      .eq("id", memberId)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { mostrar_matricula: boolean }).mostrar_matricula ? profileMatricula : null;
  } catch {
    return null;
  }
}

/** Lectura completa bajo RLS; una entrega puntual filtra por sesión. */
async function loadInstrumentos(
  pacienteId: string,
  organizationId: string,
  sesionId: string | null,
): Promise<Result<FichaPdfData["instrumentos"]>> {
  const supabase = await createSupabaseServerClient();
  const result = await readExportInstruments(supabase, organizationId, pacienteId, sesionId);
  if (!result.ok) return result;
  return ok(result.data.map((r) => ({
    nombre: getInstrumentoNombre(r.instrumento_id), instrumentoId: r.instrumento_id,
    version: r.instrumento_version, respuestas: r.respuestas, respuestasEstado: r.respuestas_estado,
    total: r.score_total != null ? String(r.score_total) : "—", banda: r.banda,
    fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Cordoba", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(r.created_at)),
  })));
}

/**
 * Nombre display de un instrumento a partir de su id versionado. Usa la
 * biblioteca de instrumentos (C1, ya en la rama) para no hardcodear nombres;
 * cae al id crudo si no lo conoce este deploy.
 */
function getInstrumentoNombre(instrumentoId: string): string {
  return getInstrumento(instrumentoId)?.nombre ?? instrumentoId;
}
