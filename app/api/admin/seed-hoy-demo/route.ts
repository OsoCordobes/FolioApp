/**
 * Folio · /api/admin/seed-hoy-demo
 *
 * Inserta data demo para la fecha "hoy" en la org del email indicado:
 *   - 3 pacientes (paciente_identidad + paciente).
 *   - 3 turnos a horas diferentes (uno cerrado, uno atendiendo, uno confirmado).
 *
 * Idempotente con guardas: si ya hay turnos del día para la org, NO inserta
 * nada (200 con `skipped: true`). Para forzar re-seed pasar `?force=1`.
 *
 * Auth: Bearer ${CRON_SECRET}.
 * Query: ?email=lautaro-folio-test@folio.app (default).
 *
 * ─── Audit 2026-05-23 finding C3 ──────────────────────────────────────────
 *
 * Este endpoint inyecta data fake. Aunque no es destructivo, ensucia la org
 * objetivo y NO debe existir en producción. Sprint 0 Task 0.5 lo gatea con
 * `mode: "prod-disabled"`: retorna 404 en `VERCEL_ENV === "production"`
 * incluso con Bearer válido. En preview y dev sigue funcionando (donde
 * realmente lo usamos para QA).
 *
 * Long-term: este endpoint debería removerse una vez que la UI de creación
 * manual de turnos (T-1.5 en /calendario) esté completa.
 */

import { NextResponse } from "next/server";

import { blindIndex, encryptColumn } from "@/lib/crypto";
import { checkAdminGate } from "@/lib/security/admin-gate";
import { verifyBearer } from "@/lib/security/verify-bearer";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DemoPaciente {
  nombre: string;
  apellido: string;
  telefono: string;
  motivoConsulta?: string;
  notasImportantes?: string;
  tags?: string[];
}

const DEMO_PACIENTES: DemoPaciente[] = [
  {
    nombre: "Carlos",
    apellido: "Vega",
    telefono: "+54 9 351 555 1842",
    motivoConsulta: "Dolor lumbar hace 3 meses, jornadas largas de escritorio.",
    tags: ["Dolor lumbar crónico"],
  },
  {
    nombre: "Diego",
    apellido: "Peralta",
    telefono: "+54 9 351 555 3315",
    motivoConsulta: "Hernia L4-L5 confirmada. Ciática bilateral.",
    notasImportantes: "Evitar manipulación L4-L5 forzada. Coordinar con Dr. Mendieta.",
    tags: ["Postoperatorio"],
  },
  {
    nombre: "Ana",
    apellido: "Romero",
    telefono: "+54 9 351 555 4408",
    motivoConsulta: "Migrañas 2-3 / semana. Sospecha origen cervical.",
    tags: ["Migrañas crónicas"],
  },
];

function isoDayWallClockInTz(timezone: string, hourMinute: string): string {
  const tz = timezone || "America/Argentina/Cordoba";
  const [h, m] = hourMinute.split(":").map(Number);
  // Calculamos las partes "hoy" en la TZ con Intl, luego construimos el ISO UTC.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const mo = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  // wall-clock → UTC vía Intl offset (corrige DST)
  const tentative = Date.UTC(y, mo - 1, d, h, m, 0);
  const probe = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(tentative));
  const get = (t: string) => Number(probe.find((p) => p.type === t)?.value ?? 0);
  const asTz = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offset = asTz - tentative;
  return new Date(tentative - offset).toISOString();
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!verifyBearer(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Audit C3 gate: este endpoint nunca debe correr en producción.
  const gated = checkAdminGate({ mode: "prod-disabled" });
  if (gated) return gated;

  const url = new URL(req.url);
  const email = url.searchParams.get("email") ?? "lautaro-folio-test@folio.app";
  const force = url.searchParams.get("force") === "1";

  const supabase = createSupabaseServiceClient();

  // 1. Resolver org del user via profile → member (primer match).
  const { data: prof } = await supabase
    .from("profile").select("id").eq("email", email).maybeSingle();
  if (!prof) return NextResponse.json({ ok: false, error: `profile ${email} no existe` }, { status: 404 });

  const { data: member } = await supabase
    .from("member")
    .select("id, organization_id")
    .eq("profile_id", prof.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: "member no existe" }, { status: 404 });

  const { data: org } = await supabase
    .from("organization")
    .select("id, timezone")
    .eq("id", member.organization_id)
    .maybeSingle();
  if (!org) return NextResponse.json({ ok: false, error: "organization no existe" }, { status: 404 });

  const orgId = org.id as string;
  const tz = (org.timezone as string) || "America/Argentina/Cordoba";

  // 2. Servicios disponibles (usamos el primero como precio/duración default).
  const { data: servicios } = await supabase
    .from("servicio")
    .select("id, nombre, duracion_min, precio_cents")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true })
    .limit(2);
  if (!servicios || servicios.length === 0) {
    return NextResponse.json(
      { ok: false, error: "la org no tiene servicios configurados (creá uno en onboarding o /configuracion)" },
      { status: 400 },
    );
  }
  const servicioDefault = servicios[0] as { id: string; nombre: string; duracion_min: number; precio_cents: number };
  const servicioFollow = (servicios[1] ?? servicios[0]) as typeof servicioDefault;

  // 3. Idempotencia: si ya hay turnos hoy y no `force`, skip.
  const startUtc = isoDayWallClockInTz(tz, "00:00");
  const endUtcRaw = isoDayWallClockInTz(tz, "23:59");
  const { data: existing } = await supabase
    .from("turno")
    .select("id")
    .eq("organization_id", orgId)
    .gte("inicio", startUtc)
    .lte("inicio", endUtcRaw);
  if (existing && existing.length > 0 && !force) {
    return NextResponse.json(
      { ok: true, skipped: true, message: `ya hay ${existing.length} turno(s) hoy; usar ?force=1 para re-seedear` },
      { status: 200 },
    );
  }

  // 4. Insertar pacientes (paciente_identidad + paciente).
  const pacienteIds: string[] = [];
  for (const dp of DEMO_PACIENTES) {
    const nombreCif = encryptColumn(dp.nombre)!;
    const apellidoCif = encryptColumn(dp.apellido)!;
    const telCif = encryptColumn(dp.telefono)!;
    const fullName = `${dp.nombre} ${dp.apellido}`.toLowerCase();
    // Per-tenant salt (Sprint 1 T1.5.3 / audit A2)
    const nombreHash = blindIndex(fullName, orgId);

    const { data: ident, error: ie } = await supabase
      .from("paciente_identidad")
      .insert({
        organization_id: orgId,
        nombre_cifrado: nombreCif,
        apellido_cifrado: apellidoCif,
        telefono_cifrado: telCif,
        tipo_doc: "DNI",
        nombre_hash: nombreHash,
      })
      .select("id")
      .single();
    if (ie || !ident) {
      return NextResponse.json({ ok: false, error: `paciente_identidad insert: ${ie?.message}` }, { status: 500 });
    }

    const { data: pac, error: pe } = await supabase
      .from("paciente")
      .insert({
        organization_id: orgId,
        identidad_id: ident.id,
        motivo_consulta_cifrado: dp.motivoConsulta ? encryptColumn(dp.motivoConsulta) : null,
        notas_importantes_cifrado: dp.notasImportantes ? encryptColumn(dp.notasImportantes) : null,
        tipo: "NUEVO",
        tags: dp.tags ?? [],
        profesional_principal_id: member.id,
      })
      .select("id")
      .single();
    if (pe || !pac) {
      return NextResponse.json({ ok: false, error: `paciente insert: ${pe?.message}` }, { status: 500 });
    }
    pacienteIds.push(pac.id);
  }

  // 5. Insertar 3 turnos del día.
  const horasDelDia = ["09:00", "11:00", "15:00"];
  const estados: Array<"CERRADO" | "ATENDIENDO" | "CONFIRMADO"> = ["CERRADO", "ATENDIENDO", "CONFIRMADO"];
  const turnosInsertados: string[] = [];

  for (let i = 0; i < 3; i++) {
    const inicio = isoDayWallClockInTz(tz, horasDelDia[i]);
    const estado = estados[i];
    const servicio = i === 0 ? servicioDefault : servicioFollow;
    const payload: Record<string, unknown> = {
      organization_id: orgId,
      paciente_id: pacienteIds[i],
      servicio_id: servicio.id,
      profesional_id: member.id,
      inicio,
      duracion_min: servicio.duracion_min,
      precio_cents: servicio.precio_cents,
      estado,
      origen: "MANUAL",
    };
    if (estado === "ATENDIENDO") {
      // 38 min atrás
      payload.atendiendo_desde = new Date(Date.now() - 38 * 60_000).toISOString();
    }
    if (estado === "CERRADO") {
      payload.duracion_real_min = servicio.duracion_min;
    }
    const { data: t, error: te } = await supabase.from("turno").insert(payload).select("id").single();
    if (te || !t) {
      return NextResponse.json({ ok: false, error: `turno ${i} insert: ${te?.message}` }, { status: 500 });
    }
    turnosInsertados.push(t.id);
  }

  return NextResponse.json(
    {
      ok: true,
      orgId,
      timezone: tz,
      pacientes: pacienteIds.length,
      turnos: turnosInsertados,
      message: "demo data sembrada — recargar /hoy",
    },
    { status: 200 },
  );
}
