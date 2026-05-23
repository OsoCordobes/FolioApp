/**
 * Folio · /api/cron/dispatch-recordatorios
 *
 * Disparado por Vercel Cron cada 15min (ver vercel.json). Procesa la cola
 * `recordatorio_job`:
 *
 *   - Filtra: enviado_ts IS NULL AND scheduled_ts <= now() AND intentos < 5
 *     AND scheduled_ts > now() - 6h (no enviamos recordatorios viejos
 *     que el cron no procesó por downtime — alerta al user en su lugar)
 *   - Para cada job: hidrata turno + paciente (PII descifrada) + organization
 *     + servicio. Envia template WhatsApp.
 *   - Éxito: enviado_ts = now()
 *   - Falla: intentos += 1, error_msg = mensaje (5 intentos máx)
 *
 * Seguridad:
 *   - Authorization: Bearer ${CRON_SECRET} requerido.
 *   - Idempotente: si corre dos veces seguidas, el segundo no envía porque
 *     enviado_ts ya está set.
 *
 * Performance:
 *   - Batch de 25 jobs por invocación (cap para mantener latencia <30s
 *     en función Vercel Hobby).
 *   - F11: alerta Sentry si batch_size > 80% durante 3 corridas seguidas
 *     (señal de saturación; subir frecuencia o paralelizar).
 */

import { NextRequest, NextResponse } from "next/server";

import { decryptColumn } from "@/lib/crypto";
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
    errors: [] as string[],
  };

  for (const job of jobs as RecordatorioRow[]) {
    results.processed += 1;
    try {
      await processJob(service, job);
      results.succeeded += 1;
    } catch (e) {
      results.failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      results.errors.push(`${job.id}: ${msg}`);
      await service
        .from("recordatorio_job")
        .update({ intentos: job.intentos + 1, error_msg: msg.slice(0, 500) })
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
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
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
      .select("nombre, direccion_completa, ciudad")
      .eq("id", job.organization_id)
      .maybeSingle(),
    service
      .from("servicio")
      .select("nombre")
      .eq("id", turno.servicio_id)
      .maybeSingle(),
  ]);

  if (!org) throw new Error("organization no encontrada");
  if (!paciente?.identidad_id) {
    throw new Error("paciente sin identidad (pseudonimizado?)");
  }

  const { data: ident } = await service
    .from("paciente_identidad")
    .select("nombre_cifrado, telefono_cifrado")
    .eq("id", paciente.identidad_id)
    .maybeSingle();
  if (!ident) throw new Error("paciente_identidad no encontrada");

  const nombre = decryptColumn(ident.nombre_cifrado);
  const telefono = decryptColumn(ident.telefono_cifrado);
  if (!nombre || !telefono) throw new Error("PII desencriptación falló");

  const inicio = new Date(turno.inicio);
  const fmtFecha = inicio.toLocaleDateString("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "America/Argentina/Cordoba",
  });
  const fmtHora = inicio.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Cordoba",
  });
  const direccion = [org.direccion_completa, org.ciudad].filter(Boolean).join(", ");

  const phoneE164 = normalizeArPhone(telefono);

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
    const { data: post } = await service
      .from("post_visita")
      .select("memo_cifrado")
      .eq("turno_id", turno.id)
      .maybeSingle();
    const memo = post ? decryptColumn(post.memo_cifrado) ?? "" : "";
    await sendPostVisita({
      to: phoneE164,
      pacienteNombre: nombre,
      memoCorto: memo,
      profesionalNombre: org.nombre,
    });
  }

  await service
    .from("recordatorio_job")
    .update({ enviado_ts: new Date().toISOString(), error_msg: null })
    .eq("id", job.id);
}

/** Normaliza teléfono AR a E.164 sin '+': "54 9 351 555 1234" -> "5493515551234". */
function normalizeArPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("54")) return digits;
  if (digits.startsWith("0")) return "54" + digits.slice(1);
  if (digits.startsWith("9")) return "54" + digits;
  return "549" + digits;
}
