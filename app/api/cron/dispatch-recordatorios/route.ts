/**
 * Folio · /api/cron/dispatch-recordatorios
 *
 * Disparado cada 15min por GitHub Actions (.github/workflows/
 * dispatch-recordatorios.yml — Vercel Hobby solo permite crons diarios) con
 * el cron diario de vercel.json como backstop. Procesa la cola
 * `recordatorio_job`:
 *
 *   - Filtra: enviado_ts IS NULL AND scheduled_ts <= now() AND intentos < 5
 *     AND scheduled_ts > now() - 6h (no enviamos recordatorios viejos
 *     que el cron no procesó por downtime — alerta al user en su lugar)
 *   - Para cada job: claim CAS sobre `intentos` (UPDATE guardado por
 *     enviado_ts IS NULL + intentos = <valor leído>) ANTES de enviar; recién
 *     después hidrata turno + paciente (PII descifrada) + organization
 *     + servicio y envía el template WhatsApp.
 *   - Fallback email (M67): si el teléfono no normaliza a E.164 o el envío
 *     WhatsApp lanza, y el paciente tiene email en paciente_identidad, se
 *     envía el template de email equivalente y se marca canal='email'.
 *     Sin teléfono utilizable NI email → canal='ninguno' + error_msg
 *     'sin canal de contacto' (consume presupuesto de intentos como
 *     cualquier falla). La decisión es pura: `decideCanalRecordatorio`.
 *   - Éxito: enviado_ts = now() + canal ('whatsapp' | 'email')
 *   - Falla: error_msg = mensaje (el claim ya incrementó intentos; 5 máx)
 *
 * Semántica de `intentos`: cuenta intentos INICIADOS (el claim incrementa
 * antes de enviar, éxitos incluidos), no fallas. El presupuesto efectivo
 * sigue siendo 5: el pick filtra intentos < 5 ANTES del claim y el éxito
 * setea enviado_ts.
 *
 * Seguridad:
 *   - Authorization: Bearer ${CRON_SECRET} requerido.
 *   - Concurrencia: el claim CAS dedupea invocaciones solapadas que pickearon
 *     el mismo snapshot — el perdedor cuenta `skipped` y no envía. Residuales
 *     at-least-once (aceptados; eliminarlos requiere estado 'enviando'/lease
 *     con migración):
 *       (a) job in-flight: si otra invocación pickea DESPUÉS del claim (lee
 *           intentos=1) y ANTES del set de enviado_ts, su claim con token 1
 *           pasa y puede duplicar ESE único job (≤1 por solape, vs batch
 *           entero sin claim);
 *       (b) crash/timeout entre el envío WhatsApp exitoso y el update de
 *           enviado_ts puede duplicar en la corrida siguiente.
 *
 * Performance:
 *   - Batch de 25 jobs por invocación (cap para mantener latencia <30s
 *     en función Vercel Hobby).
 *   - F11: alerta Sentry si batch_size > 80% durante 3 corridas seguidas
 *     (señal de saturación; subir frecuencia o paralelizar).
 */

import { NextRequest, NextResponse } from "next/server";

import { decryptColumn, tryDecrypt } from "@/lib/crypto";
import {
  decideCanalRecordatorio,
  decideClaimRecordatorio,
  decideSkipRecordatorioOrgInterna,
} from "@/lib/db/recordatorios";
import { sendEmail } from "@/lib/email/client";
import {
  buildConfirmacion24hEmail,
  buildPostVisitaEmail,
  buildRecordatorio2hEmail,
} from "@/lib/email/templates/recordatorio-turno";
import { toWhatsappE164 } from "@/lib/format/phone";
import { verifyBearer } from "@/lib/security/verify-bearer";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  sendConfirmacion24h,
  sendPostVisita,
  sendRecordatorio2h,
} from "@/lib/whatsapp/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 25;
const MAX_AGE_HOURS = 6;                            // no enviar recordatorios atrasados >6h
const MAX_INTENTOS = 5;

interface RecordatorioRow {
  id: string;
  organization_id: string;
  turno_id: string;
  tipo: "CONFIRMACION_24H" | "RECORDATORIO_2H" | "POST_VISITA";
  scheduled_ts: string;
  intentos: number;
}

async function runDispatch(): Promise<NextResponse> {
  const service = createSupabaseServiceClient();
  const now = new Date();
  const minScheduled = new Date(now.getTime() - MAX_AGE_HOURS * 60 * 60_000).toISOString();

  // Pickear jobs due
  const { data: jobs, error: pickErr } = await service
    .from("recordatorio_job")
    .select("id, organization_id, turno_id, tipo, scheduled_ts, intentos")
    .is("enviado_ts", null)
    .lte("scheduled_ts", now.toISOString())
    .gte("scheduled_ts", minScheduled)
    .lt("intentos", MAX_INTENTOS)
    .order("scheduled_ts", { ascending: true })
    .limit(BATCH_SIZE);

  if (pickErr) {
    return NextResponse.json({ ok: false, error: pickErr.message }, { status: 500 });
  }
  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
  };

  for (const job of jobs as RecordatorioRow[]) {
    // Claim CAS: un solo UPDATE guardado (atómico en Postgres). `intentos`
    // actúa de token de concurrencia optimista — si otra invocación ya lo
    // claimeó (o ya lo envió), afecta 0 filas y salteamos sin enviar.
    const { data: claimRows, error: claimErr } = await service
      .from("recordatorio_job")
      .update({ intentos: job.intentos + 1 })
      .eq("id", job.id)
      .is("enviado_ts", null)
      .eq("intentos", job.intentos)
      .select("id");

    const claim = decideClaimRecordatorio(claimRows?.length ?? 0, Boolean(claimErr));
    if (claim === "db_error") {
      results.failed += 1;
      results.errors.push(`${job.id}: claim: ${claimErr?.message}`);
      continue;
    }
    if (claim === "skip") {
      results.skipped += 1;
      continue;
    }

    results.processed += 1;
    try {
      await processJob(service, job);
      results.succeeded += 1;
    } catch (e) {
      results.failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      results.errors.push(`${job.id}: ${msg}`);
      // El claim ya incrementó `intentos`; acá solo registramos el error.
      // (Escribir job.intentos + 1 de nuevo sería un lost-update stale.)
      await service
        .from("recordatorio_job")
        .update({ error_msg: msg.slice(0, 500) })
        .eq("id", job.id);
    }
  }

  return NextResponse.json({ ok: true, ...results });
}

function authorize(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET no configurado" }, { status: 500 });
  }
  if (!verifyBearer(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  return runDispatch();
}

export async function POST(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  return runDispatch();
}

/** Levanta datos relacionados, envía el template, marca enviado_ts. */
async function processJob(
  service: ReturnType<typeof createSupabaseServiceClient>,
  job: RecordatorioRow,
): Promise<void> {
  // Cargar turno + paciente + organization + servicio
  const { data: turno, error } = await service
    .from("turno")
    .select("id, inicio, paciente_id, servicio_id, estado")
    .eq("id", job.turno_id)
    .maybeSingle();

  if (error) throw new Error(`turno fetch: ${error.message}`);
  if (!turno) throw new Error("turno no encontrado (borrado?)");
  if (job.tipo !== "POST_VISITA" && ["CANCELADO", "NO_ASISTIO", "CERRADO"].includes(turno.estado)) {
    // El turno fue cancelado/cerrado antes del recordatorio: marcar como enviado
    // (sin enviar) para no reintentar.
    await service
      .from("recordatorio_job")
      .update({ enviado_ts: new Date().toISOString(), error_msg: `skip: estado ${turno.estado}` })
      .eq("id", job.id);
    return;
  }

  // paciente → identidad_id → paciente_identidad. La tabla paciente_identidad
  // no tiene una FK directa a paciente.id (el split es 1:1 con la FK al revés:
  // paciente.identidad_id → paciente_identidad.id). Por eso necesitamos el
  // lookup en dos pasos. M20 renombró organization.direccion a
  // direccion_completa — usamos ese nombre.
  const [{ data: paciente }, { data: org }, { data: servicio }] = await Promise.all([
    service
      .from("paciente")
      .select("identidad_id")
      .eq("id", turno.paciente_id)
      .maybeSingle(),
    service
      .from("organization")
      .select("nombre, direccion_completa, ciudad, timezone, is_internal_account")
      .eq("id", job.organization_id)
      .maybeSingle(),
    service
      .from("servicio")
      .select("nombre")
      .eq("id", turno.servicio_id)
      .maybeSingle(),
  ]);

  if (!org) throw new Error("organization no encontrada");

  // Orgs internas/demo (M37): pacientes MOCK con contactos ficticios — nunca
  // enviar. Se marca enviado (sin enviar) ANTES de descifrar PII, mismo patrón
  // que el skip por estado del turno. Decisión pura testeable en
  // lib/db/recordatorios.ts (decideSkipRecordatorioOrgInterna).
  if (decideSkipRecordatorioOrgInterna(org.is_internal_account)) {
    await service
      .from("recordatorio_job")
      .update({ enviado_ts: new Date().toISOString(), error_msg: "skip: org interna" })
      .eq("id", job.id);
    return;
  }
  if (!paciente?.identidad_id) {
    throw new Error("paciente sin identidad (pseudonimizado?)");
  }

  const { data: ident } = await service
    .from("paciente_identidad")
    .select("nombre_cifrado, telefono_cifrado, email_cifrado")
    .eq("id", paciente.identidad_id)
    .maybeSingle();
  if (!ident) throw new Error("paciente_identidad no encontrada");

  // El nombre es imprescindible para cualquier canal; teléfono y email son
  // los canales en sí — un ciphertext corrupto en uno no debe hundir el job
  // si el otro sirve (tryDecrypt loguea el label, jamás el valor).
  const nombre = decryptColumn(ident.nombre_cifrado);
  if (!nombre) throw new Error("PII desencriptación falló (nombre)");
  const telefono = tryDecrypt(ident.telefono_cifrado, "recordatorio.telefono");
  const emailRaw = tryDecrypt(ident.email_cifrado, "recordatorio.email");
  const email = emailRaw && emailRaw.trim().includes("@") ? emailRaw.trim() : null;

  const inicio = new Date(turno.inicio);
  const tz = safeTimezone(org.timezone);
  const fmtFecha = inicio.toLocaleDateString("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: tz,
  });
  const fmtHora = inicio.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
  const direccion = [org.direccion_completa, org.ciudad].filter(Boolean).join(", ");

  // Memo del post-visita: lo necesitan ambos canales.
  let memo = "";
  if (job.tipo === "POST_VISITA") {
    const { data: post } = await service
      .from("post_visita")
      .select("memo_cifrado")
      .eq("turno_id", turno.id)
      .maybeSingle();
    memo = post ? decryptColumn(post.memo_cifrado) ?? "" : "";
  }

  const phoneE164 = toWhatsappE164(telefono);

  // Decisión de canal (pura, M67): WhatsApp primario; email de fallback.
  let canal = decideCanalRecordatorio({
    telefonoValido: phoneE164 !== null,
    emailPresente: email !== null,
  });
  let whatsappError: Error | null = null;

  if (canal === "whatsapp" && phoneE164 !== null) {
    try {
      if (job.tipo === "CONFIRMACION_24H") {
        await sendConfirmacion24h({
          to: phoneE164,
          pacienteNombre: nombre,
          fecha: fmtFecha,
          hora: fmtHora,
          consultorioNombre: org.nombre,
          direccion,
          servicio: servicio?.nombre ?? "Consulta",
        });
      } else if (job.tipo === "RECORDATORIO_2H") {
        await sendRecordatorio2h({
          to: phoneE164,
          pacienteNombre: nombre,
          hora: fmtHora,
          consultorioNombre: org.nombre,
        });
      } else if (job.tipo === "POST_VISITA") {
        await sendPostVisita({
          to: phoneE164,
          pacienteNombre: nombre,
          memoCorto: memo,
          profesionalNombre: org.nombre,
        });
      }

      await service
        .from("recordatorio_job")
        .update({ enviado_ts: new Date().toISOString(), error_msg: null, canal: "whatsapp" })
        .eq("id", job.id);
      return;
    } catch (e) {
      // WhatsApp falló → re-decidir con el resultado; si hay email, fallback.
      whatsappError = e instanceof Error ? e : new Error(String(e));
      canal = decideCanalRecordatorio({
        telefonoValido: true,
        emailPresente: email !== null,
        resultadoWhatsApp: "fallo",
      });
    }
  }

  if (canal === "email" && email !== null) {
    const { subject, html } =
      job.tipo === "CONFIRMACION_24H"
        ? buildConfirmacion24hEmail({
            pacienteNombre: nombre,
            consultorioNombre: org.nombre,
            servicioNombre: servicio?.nombre ?? "Consulta",
            fecha: fmtFecha,
            hora: fmtHora,
            direccion: direccion || null,
          })
        : job.tipo === "RECORDATORIO_2H"
          ? buildRecordatorio2hEmail({
              pacienteNombre: nombre,
              consultorioNombre: org.nombre,
              hora: fmtHora,
            })
          : buildPostVisitaEmail({
              pacienteNombre: nombre,
              profesionalNombre: org.nombre,
              memoCorto: memo,
            });

    // sendEmail es fail-safe (nunca lanza; sin RESEND_API_KEY simula). El job
    // queda enviado por email — mismo contrato best-effort que los emails de
    // booking.
    await sendEmail({ to: email, subject, html });

    await service
      .from("recordatorio_job")
      .update({ enviado_ts: new Date().toISOString(), error_msg: null, canal: "email" })
      .eq("id", job.id);
    return;
  }

  // canal === "ninguno": sin teléfono utilizable ni email. Registramos el
  // canal y lanzamos — el caller escribe error_msg y el presupuesto de
  // intentos se consume como cualquier falla (semántica intacta).
  await service.from("recordatorio_job").update({ canal: "ninguno" }).eq("id", job.id);
  throw new Error(
    whatsappError
      ? `sin canal de contacto — WhatsApp falló: ${whatsappError.message}`
      : "sin canal de contacto (teléfono no normalizable a E.164 AR, sin email)",
  );
}

const DEFAULT_TZ = "America/Argentina/Cordoba";

/** Valida la timezone de la org contra Intl; inválida/ausente → default AR. */
function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("es-AR", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}
