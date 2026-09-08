/**
 * Folio · /api/pacientes/[id]/ficha-pdf · export PDF de ficha/sesión (C10).
 *
 * Genera un PDF de la ficha clínica del paciente (membrete, datos, SOAP,
 * resumen de la herramienta de la especialidad, escalas) y lo devuelve como
 * `application/pdf`. Server-side, Node runtime — @react-pdf/renderer usa APIs de
 * Node y necesita margen de cold-start.
 *
 * ── Entrega clínica autorizada ──────────────────────────────────────────────
 * Toda la PII/PHI se desencripta SERVER-SIDE (getPacienteFicha / getSesionCompleta
 * → lib/crypto) y los bytes del PDF contienen información clínica legible. En
 * ningún momento se serializa una columna `*_cifrado` cruda ni el plaintext en un
 * JSON de respuesta.
 *
 * ── Auth + rol idéntico a /pacientes/[id]/page.tsx ────────────────────────────
 * Mismo gate que la ficha visual: getActiveContext + ROLES_PUEDEN_VER_PHI
 * (OWNER/DIRECTOR/PROFESIONAL). ASISTENTE/COORDINADOR reciben 403. El scoping de
 * tenant + caja-fuerte lo aplica RLS dentro de getPacienteFicha (devuelve
 * not_found si el paciente no pertenece a la org / el rol no puede leerlo).
 *
 * ── Audit del export (Ley 26.529 art. 18 · 25.326 art. 14) ────────────────────
 * La preparación deja `paciente_ficha.export_pdf_prepared` en audit_log con
 * actor, rol e id de sesión. No confirma recepción por el cliente: un cambio
 * de permisos posterior puede impedir la entrega.
 */

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { writeAuditEntry } from "@/lib/db/audit";
import { getActiveContext } from "@/lib/db/active-context";
import { getPacienteFicha } from "@/lib/db/paciente-ficha";
import { readPdfHistory, readPdfCollection, PDF_MAX_BYTES } from "@/lib/pdf/history-reader";
import {
  ESPECIALIDADES_META,
  getEspecialidadMetaByToolId,
} from "@/lib/especialidades/meta";
import { getInstrumento } from "@/lib/instrumentos";
import { buildFichaPdf, type FichaPdfData } from "@/lib/pdf/ficha-pdf";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Descifra PII/PHI app-side + arma el binario PDF: margen sobre el default por
// el cold-start de @react-pdf/renderer (bundle grande de fuentes core).
export const maxDuration = 60;

// Mismo gate de rol que /pacientes/[id]/page.tsx: la ficha contiene PHI
// sensible. COORDINADOR/ASISTENTE no tienen acceso clínico (RLS también lo
// niega en getPacienteFicha; el check app-side da un 403 limpio antes de tocar
// la DB).
const ROLES_PUEDEN_VER_PHI = new Set(["OWNER", "DIRECTOR", "PROFESIONAL"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(
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
      ctx.error.code === "auth_required" ? 401 : ctx.error.code === "no_org" ? 403 : 500;
    return jsonError(ctx.error.code, ctx.error.message, status);
  }

  if (!ROLES_PUEDEN_VER_PHI.has(ctx.data.session.role) || (ctx.data.session.role === "DIRECTOR" && ctx.data.session.esColegiado !== true)) {
    return jsonError("forbidden", "No tenés permiso para exportar esta ficha.", 403);
  }

  const url = new URL(_request.url);
  const sesionId = url.searchParams.get("sesion");
  if (sesionId !== null && !UUID_RE.test(sesionId)) return jsonError("validation", "ID de sesión inválido.", 400);
  const pidioSesionPuntual = sesionId !== null;

  // Ficha completa (PII/PHI desencriptada server-side). El scoping org+paciente
  // + caja-fuerte lo aplica RLS acá dentro: si el paciente no es de la org o el
  // rol no puede leerlo, devuelve not_found (no filtramos existencia cross-tenant).
  const fichaRes = await getPacienteFicha(
    pacienteId,
    ctx.data.organization.id,
    ctx.data.organization.especialidad,
    null,
    ctx.data.organization.timezone,
    // The PDF reads its own complete, authorized session collection below.
    false,
  );
  if (!fichaRes.ok) {
    if (fichaRes.error.code === "not_found") {
      return jsonError("not_found", "Paciente no encontrado.", 404);
    }
    return jsonError(fichaRes.error.code, fichaRes.error.message, 500);
  }
  const ficha = fichaRes.data;

  // Resumen humano de la herramienta de la especialidad ACTIVA del slot (no PHI
  // cruda: resumenSesion produce una frase de estado). Refleja el estado clínico
  // ACTUAL del paciente (turnoActivo.toolDraft si existe, o el último entry del
  // historial de esa especialidad) — no varía con ?sesion (esa query trae el
  // SOAP de una sesión puntual, pero el resumen de herramienta se mantiene como
  // "estado vigente"; la vista sesion_con_enmiendas no expone el tool_data
  // descifrado por sesión, y decodificarlo por-sesión queda para C2/C3).
  const especialidadActiva = ficha.plan.turnoActivo?.especialidad ?? ctx.data.organization.especialidad;
  const metaActiva = ESPECIALIDADES_META[especialidadActiva];
  const ultimaToolData =
    ficha.plan.turnoActivo?.toolDraft ??
    ficha.plan.toolHistorial.find((h) => {
      const meta = getEspecialidadMetaByToolId(h.toolId) ?? metaActiva;
      return meta.slug === especialidadActiva;
    })?.toolData ??
    null;
  const resumenHerramienta =
    ultimaToolData != null ? metaActiva.resumenSesion(ultimaToolData) : null;

  const supabase = await createSupabaseServerClient();
  let history: Awaited<ReturnType<typeof readPdfHistory>>;
  let instrumentos: FichaPdfData["instrumentos"];
  try {
    history = await readPdfHistory(supabase, ctx.data.organization.id, pacienteId, sesionId);
    instrumentos = await loadInstrumentos(pacienteId, ctx.data.organization.id, sesionId);
  } catch {
    return jsonError("db_error", "No se pudo leer toda la historia autorizada. No se generó un PDF incompleto. Reintentá.", 500);
  }
  const soap = history[0]?.soap ?? { s: "", o: "", a: "", p: "" };
  const fechaSesion = pidioSesionPuntual ? history[0]?.fecha ?? null : null;

  const profesionalNombre =
    [ctx.data.profile.nombre, ctx.data.profile.apellido].filter(Boolean).join(" ").trim() || null;

  // Matrícula: SÓLO si el member actual optó por mostrarla (M62 mostrar_matricula).
  // El valor vive en profile.matricula; el opt-in en member. Lectura angosta
  // bajo RLS (member propio). Un error de lectura degrada a "no mostrar".
  const matricula = await resolveMatriculaVisible(
    ctx.data.session.memberId,
    ctx.data.profile.matricula,
  );

  const pdfData: FichaPdfData = {
    alcance: "Historial autorizado para el rol actual: puede excluir registros restringidos a otros profesionales. Incluye sesiones originales y enmiendas accesibles, sin adjuntos ni firmas. No es un archivo completo restaurable ni un snapshot transaccional único.",
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
    resumenHerramienta: pidioSesionPuntual ? null : resumenHerramienta,
    especialidad: metaActiva.nombre,
    instrumentos,
    // A punctual delivery contains only that session, including its amendments.
    evolucion: history,
    generadoTs: new Date().toISOString(),
  };

  const pdf = await buildFichaPdf(pdfData);
  if (pdf.length > PDF_MAX_BYTES) return jsonError("validation", "El PDF supera 4 MB. Solicitá una entrega por sesión; no se generó un archivo incompleto.", 413);

  // Record preparation, not successful delivery: authorization can still change
  // during this audit write and the final guard must then deny the response.
  // Receiving bytes at the client cannot be proven by preparing an HTTP response.
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

  // Reauthorize after rendering/audit: a revoked member cannot receive bytes
  // merely because they were allowed when generation started.
  try {
    const current = await getActiveContext();
    if (!current.ok || current.data.session.memberId !== ctx.data.session.memberId || current.data.session.userId !== ctx.data.session.userId ||
      current.data.session.esColegiado !== ctx.data.session.esColegiado ||
      current.data.organization.id !== ctx.data.organization.id || current.data.session.role !== ctx.data.session.role || !ROLES_PUEDEN_VER_PHI.has(current.data.session.role) ||
      (current.data.session.role === "DIRECTOR" && current.data.session.esColegiado !== true)) {
      return jsonError("forbidden", "No se pudo confirmar el acceso al finalizar la entrega.", 403);
    }
    const scope = await supabase.from("paciente").select("id").eq("id", pacienteId).eq("organization_id", ctx.data.organization.id).is("deleted_at", null).maybeSingle();
    if (scope.error || scope.data?.id !== pacienteId) return jsonError("forbidden", "No se pudo confirmar el acceso al paciente.", 403);
    for (let index = 0; index < history.length; index += 100) {
      const ids = history.slice(index, index + 100).map(row => row.sesionId);
      const allowed = await readPdfCollection<{ id: string }>((from, to) => supabase.from("sesion").select("id", { count: "exact" })
        .eq("organization_id", ctx.data.organization.id).eq("paciente_id", pacienteId).in("id", ids).order("id", { ascending: true }).range(from, to));
      if (allowed.length !== ids.length || allowed.some(row => !ids.includes(row.id))) return jsonError("forbidden", "Cambió el acceso a una sesión durante la entrega.", 403);
    }
  } catch { return jsonError("forbidden", "No se pudo confirmar el acceso al finalizar la entrega.", 403); }

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

/** Paginated M73 records; no best-effort omission and no cross-session rows. */
async function loadInstrumentos(pacienteId: string, organizationId: string, sesionId: string | null): Promise<FichaPdfData["instrumentos"]> {
  const client = await createSupabaseServerClient();
  const rows = await readPdfCollection<InstrumentoRespuestaRow>((from, to) => {
    let query = client.from("instrumento_respuesta").select("id,instrumento_id,score_total,banda,created_at", { count: "exact" })
      .eq("paciente_id", pacienteId).eq("organization_id", organizationId);
    if (sesionId) query = query.eq("sesion_id", sesionId);
    return query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
  });
  return rows.map(r => ({ nombre: getInstrumentoNombre(r.instrumento_id), total: r.score_total == null ? "—" : String(r.score_total), banda: r.banda,
    fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Cordoba", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(r.created_at)) }));
}
interface InstrumentoRespuestaRow {
  id: string; instrumento_id: string; score_total: number | null; banda: string | null; created_at: string;
}

/**
 * Nombre display de un instrumento a partir de su id versionado. Usa la
 * biblioteca de instrumentos (C1, ya en la rama) para no hardcodear nombres;
 * cae al id crudo si no lo conoce este deploy.
 */
function getInstrumentoNombre(instrumentoId: string): string {
  return getInstrumento(instrumentoId)?.nombre ?? instrumentoId;
}
