/**
 * Folio · /api/pacientes/[id]/ficha-pdf · export PDF de ficha/sesión (C10).
 *
 * Genera un PDF de la ficha clínica del paciente (membrete, datos, SOAP,
 * resumen de la herramienta de la especialidad, escalas) y lo devuelve como
 * `application/pdf`. Server-side, Node runtime — @react-pdf/renderer usa APIs de
 * Node y necesita margen de cold-start.
 *
 * ── PHI NUNCA sale sin cifrar al cliente ──────────────────────────────────────
 * Toda la PII/PHI se desencripta SERVER-SIDE (getPacienteFicha / getSesionCompleta
 * → lib/crypto) y sólo los BYTES ya renderizados del PDF viajan al cliente. En
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
 * Cada export deja una fila `paciente_ficha.export_pdf` en audit_log con actor,
 * rol, IP/UA y el id de la sesión exportada (si se pidió una puntual). Deja
 * constancia de QUIÉN exportó PHI de QUIÉN y DESDE DÓNDE.
 */

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { writeAuditEntry } from "@/lib/db/audit";
import { getActiveContext } from "@/lib/db/active-context";
import { getPacienteFicha } from "@/lib/db/paciente-ficha";
import { getSesionCompleta, sesionPerteneceAPaciente } from "@/lib/db/sesiones";
import {
  ESPECIALIDADES_META,
  getEspecialidadMetaByToolId,
} from "@/lib/especialidades/meta";
import { getInstrumento } from "@/lib/instrumentos";
import { evolucionDesdeSesiones } from "@/lib/pdf/ficha-format";
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

const UUID_RE = /^[0-9a-f-]{36}$/i;

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
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

  if (!ROLES_PUEDEN_VER_PHI.has(ctx.data.session.role)) {
    return jsonError("forbidden", "No tenés permiso para exportar esta ficha.", 403);
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
    // Historia COMPLETA: este PDF es el ejercicio del derecho de acceso (Ley
    // 26.529 art. 14) y el audit lo registra como tal. Entregaba las últimas 10
    // visitas: un paciente con 62 recibía 10 y nadie se lo decía.
    // El export de UNA sesión (?sesion=) no necesita el resto, pero pedirlo
    // completo acá es más simple y no lo usa.
    true,
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

  // SOAP: por defecto el de la ficha (última sesión). Si el caller pidió una
  // sesión puntual (?sesion=<uuid>), la traemos descifrada y usamos SU SOAP.
  let soap = ficha.plan.soap;
  let fechaSesion: string | null = null;
  const url = new URL(_request.url);
  const sesionIdRaw = url.searchParams.get("sesion");
  // ¿El caller pidió el PDF de UNA sesión puntual (?sesion=<uuid> válido)? Ese
  // documento está pensado para compartir UNA visita con un colega: no debe
  // arrastrar la Evolución (SOAP de las últimas 10 sesiones) — sobre-exposición
  // de PHI. Un valor no-uuid se ignora (export de la HC entera, como siempre).
  const sesionId = sesionIdRaw != null && UUID_RE.test(sesionIdRaw) ? sesionIdRaw : null;
  const pidioSesionPuntual = sesionId != null;
  if (sesionId != null) {
    const sesionRes = await getSesionCompleta(sesionId);
    // La sesión debe pertenecer al MISMO paciente de la URL. getSesionCompleta
    // scopea por org (no por paciente): sin este check, un actor con acceso
    // clínico podría pedir ?sesion=<uuid-de-otro-paciente-de-su-org> y obtener
    // un PDF con el membrete/identidad del paciente A pero el SOAP del paciente
    // B — una HC legal mislabeled. No es fuga cross-tenant (ambos son de la org
    // y ya son legibles bajo RLS), pero sí un documento clínico con datos del
    // paciente equivocado. Si no coincide, se descarta la sesión y cae al SOAP
    // de la ficha (mismo comportamiento que "sesión no encontrada").
    if (sesionRes.ok && sesionPerteneceAPaciente(sesionRes.data.paciente_id, pacienteId)) {
      const row = sesionRes.data;
      const soapRow = row.soap as { s: string | null; o: string | null; a: string | null; p: string | null } | undefined;
      soap = {
        subjetivo: soapRow?.s ?? "",
        objetivo: soapRow?.o ?? "",
        analisis: soapRow?.a ?? "",
        plan: soapRow?.p ?? "",
      };
      const createdAt = row.created_at;
      fechaSesion = typeof createdAt === "string" ? createdAt.slice(0, 10) : null;
    }
    // Una sesión no encontrada / de otra org (getSesionCompleta scopea por org)
    // / de OTRO paciente de la misma org NO rompe el export: cae al SOAP de la
    // ficha. No se filtra nada cross-tenant ni se mislabela la HC.
  }

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
    organizacion: ctx.data.organization.nombre,
    profesional: profesionalNombre,
    matricula,
    paciente: ficha.paciente.nombre,
    edad: ficha.paciente.edad > 0 ? String(ficha.paciente.edad) : "—",
    genero: ficha.paciente.genero,
    motivo: ficha.paciente.motivo,
    fechaSesion,
    soap: {
      s: soap.subjetivo,
      o: soap.objetivo,
      a: soap.analisis,
      p: soap.plan,
    },
    resumenHerramienta,
    especialidad: metaActiva.nombre,
    // Instrumentos: best-effort (la tabla instrumento_respuesta llega en C2/M73).
    // Hoy degrada a [] sin romper el export; cuando la tabla exista, se llena.
    instrumentos: await loadInstrumentosBestEffort(pacienteId, ctx.data.organization.id),
    // D2 · Evolución: últimas N sesiones cerradas (fecha · servicio · resumen +
    // SOAP compacto). plan.sesiones ya viene DESC con el SOAP descifrado
    // server-side (getPacienteFicha) — sin queries ni descifrados extra.
    // SOLO en el export de la HC entera: con ?sesion= (documento de UNA visita
    // para compartir con un colega) la Evolución se OMITE — incluir el SOAP de
    // las últimas 10 sesiones ahí sobre-expone PHI que el receptor no necesita.
    evolucion: pidioSesionPuntual ? [] : evolucionDesdeSesiones(ficha.plan.sesiones),
    generadoTs: new Date().toISOString(),
  };

  const pdf = await buildFichaPdf(pdfData);

  // Audit del export (best-effort, fail-safe: no rompe el export si falla). Deja
  // constancia de QUIÉN exportó PHI de QUIÉN, DESDE DÓNDE, y qué sesión (si se
  // pidió una puntual). Nunca incluye PHI en el payload.
  const h = await headers();
  await writeAuditEntry({
    organizationId: ctx.data.organization.id,
    actorId: ctx.data.session.userId,
    actorRole: ctx.data.session.role,
    action: "paciente_ficha.export_pdf",
    resourceType: "paciente",
    resourceId: pacienteId,
    ip: h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? null,
    userAgent: h.get("user-agent") ?? null,
    payload: {
      sesion_id: sesionId,
      formato: "pdf",
      basis: "Ley 26.529 art. 18 (registro de acceso a HC)",
    },
  });

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

/**
 * Carga resultados de instrumentos/planillas del paciente (score + banda), sin
 * respuestas crudas. BEST-EFFORT: la tabla `instrumento_respuesta` llega en C2
 * (M73, Ola 2). Mientras no exista, la query falla con 42P01 y degradamos a []
 * — el PDF simplemente omite la sección. Cuando C2 aterrice, esta función ya la
 * consume sin cambios de contrato (score/banda ya vienen en claro por diseño de
 * la biblioteca de instrumentos). No se descifra nada acá: score/banda son
 * metadata en claro; las respuestas cifradas NO se leen para el PDF.
 */
async function loadInstrumentosBestEffort(
  pacienteId: string,
  organizationId: string,
): Promise<FichaPdfData["instrumentos"]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("instrumento_respuesta")
      .select("instrumento_id, score_total, banda, created_at")
      .eq("paciente_id", pacienteId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error || !data) {
      // 42P01 = tabla aún no aplicada en este entorno (degradación esperada,
      // silenciosa). Cualquier OTRO código es un bug real (p. ej. drift de
      // columna) y NO debe pasar desapercibido → se loguea [audit-fixes · ALTO-2].
      if (error && error.code !== "42P01") {
        console.warn(
          `[ficha-pdf] instrumento_respuesta query falló (code=${error.code}); sección omitida`,
        );
      }
      return [];
    }
    return (data as InstrumentoRespuestaRow[]).map((r) => {
      const meta = getInstrumentoNombre(r.instrumento_id);
      return {
        nombre: meta,
        total: r.score_total != null ? String(r.score_total) : "—",
        banda: r.banda ?? null,
        fecha: typeof r.created_at === "string" ? r.created_at.slice(0, 10) : null,
      };
    });
  } catch {
    return [];
  }
}

/** Fila de instrumento_respuesta (C2/M73). Tipada localmente hasta que exista. */
interface InstrumentoRespuestaRow {
  instrumento_id: string;
  score_total: number | null;
  banda: string | null;
  created_at: string;
}

/**
 * Nombre display de un instrumento a partir de su id versionado. Usa la
 * biblioteca de instrumentos (C1, ya en la rama) para no hardcodear nombres;
 * cae al id crudo si no lo conoce este deploy.
 */
function getInstrumentoNombre(instrumentoId: string): string {
  return getInstrumento(instrumentoId)?.nombre ?? instrumentoId;
}
