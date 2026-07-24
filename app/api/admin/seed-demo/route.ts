/**
 * Folio · /api/admin/seed-demo
 *
 * Crea/actualiza los CONSULTORIOS DEMO por especialidad para la cuenta de
 * soporte/demo del founder: una organización interna por especialidad
 * (demo-quiropraxia, demo-cardiologia, …) con member OWNER para el email
 * indicado, servicios template, disponibilidad L-V y pacientes MOCK con
 * historia clínica (turnos pasados cerrados + sesiones con tool_data válido +
 * pagos), agenda del día (incluye un turno EN_SALA para mostrar transiciones)
 * y turnos futuros.
 *
 * A diferencia de seed-hoy-demo (prod-disabled: data fake en orgs reales),
 * este endpoint SÍ está pensado para producción — las orgs que toca son
 * exclusivamente `demo-*` + is_internal_account=true, creadas por él mismo,
 * con datos marcados MOCK. Doble factor del patrón admin-gate:
 *   1. Authorization: Bearer ${CRON_SECRET}
 *   2. En producción, env ALLOW_DEMO_SEED=yes-demo-2026 (setear en Vercel solo
 *      durante la ventana de seed, después quitarla — mismo protocolo que
 *      ALLOW_PROD_RESET en /api/admin/migrate).
 *
 * Query:
 *   ?especialidad=all | quiropraxia | cardiologia | psicologia | kinesiologia | nutricion
 *   &email=<owner de las orgs demo>   (default amiunelautaro@gmail.com)
 *   &force=1    borra los pacientes MOCK existentes y re-siembra
 *   &cleanup=1  solo borra los pacientes MOCK (las orgs quedan)
 *
 * Idempotente: sin force, una org demo que ya tiene pacientes MOCK se saltea
 * (skipped). Re-ejecutar con force deja la agenda "del día" fresca — útil
 * antes de cada llamada de venta.
 */

import { NextResponse } from "next/server";

import { blindIndex, blindIndexPhone, encryptColumn } from "@/lib/crypto";
import { computeScoreSnapshot } from "@/lib/db/instrumentos";
import {
  buildDemoToolData,
  demoOrgNombre,
  demoOrgSlug,
  PACIENTES_DEMO,
  SOAP_DEMO,
} from "@/lib/demo/seed-especialidades";
import {
  ESPECIALIDAD_SLUGS,
  isEspecialidadSlug,
  type EspecialidadSlug,
} from "@/lib/especialidades/meta";
import { getEspecialidadServicios } from "@/lib/onboarding/templates";
import { checkAdminGate } from "@/lib/security/admin-gate";
import { verifyBearer } from "@/lib/security/verify-bearer";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 300s: ?especialidad=all son 5 orgs × ~150 inserts REST (cifrado incluido).
// La invocación recomendada igual es POR especialidad (5 curls) — acota el
// blast radius si una falla a mitad — pero el techo alto cubre el peor caso.
export const maxDuration = 300;

const DEFAULT_EMAIL = "amiunelautaro@gmail.com";
const TZ_DEFAULT = "America/Argentina/Cordoba";

/** ISO UTC del wall-clock HH:MM en la tz, con offset de días desde hoy. */
function isoWallClock(timezone: string, dayOffset: number, hourMinute: string): string {
  const tz = timezone || TZ_DEFAULT;
  const [h, m] = hourMinute.split(":").map(Number);
  const base = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(base);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const mo = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
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

interface SeedResult {
  especialidad: EspecialidadSlug;
  slug: string;
  orgId: string | null;
  orgCreated: boolean;
  memberCreated: boolean;
  serviciosCreados: number;
  pacientes: number;
  turnos: number;
  pagos: number;
  sesiones: number;
  /** Filas de instrumento_respuesta (PHQ-9/GAD-7, solo psicología). */
  instrumentos: number;
  skipped: boolean;
  cleaned: number;
  error: string | null;
}

type Service = ReturnType<typeof createSupabaseServiceClient>;

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!verifyBearer(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Segundo factor en producción: env explícita por la ventana del seed.
  const gated = checkAdminGate({
    mode: "prod-escape-hatch",
    escapeHatch: { envVar: "ALLOW_DEMO_SEED", expected: "yes-demo-2026" },
  });
  if (gated) return gated;

  const url = new URL(req.url);
  const espParam = url.searchParams.get("especialidad") ?? "all";
  const email = url.searchParams.get("email") ?? DEFAULT_EMAIL;
  const force = url.searchParams.get("force") === "1";
  const cleanup = url.searchParams.get("cleanup") === "1";

  const targets: EspecialidadSlug[] =
    espParam === "all"
      ? [...ESPECIALIDAD_SLUGS]
      : isEspecialidadSlug(espParam)
        ? [espParam]
        : [];
  if (targets.length === 0) {
    return NextResponse.json(
      { ok: false, error: `especialidad inválida: ${espParam} (all | ${ESPECIALIDAD_SLUGS.join(" | ")})` },
      { status: 400 },
    );
  }

  const supabase = createSupabaseServiceClient();

  const { data: prof, error: profErr } = await supabase
    .from("profile")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (profErr) {
    return NextResponse.json({ ok: false, error: `profile lookup: ${profErr.message}` }, { status: 500 });
  }
  if (!prof) {
    return NextResponse.json(
      { ok: false, error: `profile ${email} no existe — el usuario tiene que haberse registrado antes` },
      { status: 404 },
    );
  }

  const results: SeedResult[] = [];
  for (const esp of targets) {
    results.push(await seedEspecialidad(supabase, esp, prof.id as string, { force, cleanup }));
  }

  const anyError = results.some((r) => r.error !== null);
  return NextResponse.json({ ok: !anyError, email, results }, { status: anyError ? 500 : 200 });
}

async function seedEspecialidad(
  supabase: Service,
  esp: EspecialidadSlug,
  profileId: string,
  opts: { force: boolean; cleanup: boolean },
): Promise<SeedResult> {
  const slug = demoOrgSlug(esp);
  const res: SeedResult = {
    especialidad: esp,
    slug,
    orgId: null,
    orgCreated: false,
    memberCreated: false,
    serviciosCreados: 0,
    pacientes: 0,
    turnos: 0,
    pagos: 0,
    sesiones: 0,
    instrumentos: 0,
    skipped: false,
    cleaned: 0,
    error: null,
  };
  const fail = (step: string, message: string | undefined): SeedResult => {
    res.error = `${step}: ${message ?? "error desconocido"}`;
    return res;
  };

  // ── 1. Organización demo ──────────────────────────────────────────────────
  const { data: existingOrg, error: orgSelErr } = await supabase
    .from("organization")
    .select("id, timezone, is_internal_account, especialidad")
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
  if (orgSelErr) return fail("org select", orgSelErr.message);

  let orgId: string;
  let tz = TZ_DEFAULT;
  if (existingOrg) {
    orgId = existingOrg.id as string;
    tz = (existingOrg.timezone as string) || TZ_DEFAULT;
  } else {
    const { data: created, error: orgInsErr } = await supabase
      .from("organization")
      .insert({
        slug,
        nombre: demoOrgNombre(esp),
        rubro: esp,
        ciudad: "Córdoba",
        provincia: "Córdoba",
        especialidad: esp,
        tipo: "INDEPENDIENTE",
        onboarding_completed: true,
        // Las demo no ensucian analytics ni aparecen en el directorio público
        // (listar_en_directorio ya defaultea false — opt-in M64). El booking
        // por link directo /book/<slug> queda habilitado a propósito para
        // mostrar la reserva en vivo.
        opt_out_analytics: true,
      })
      .select("id, timezone")
      .single();
    if (orgInsErr || !created) return fail("org insert", orgInsErr?.message);
    orgId = created.id as string;
    tz = (created.timezone as string) || TZ_DEFAULT;
    res.orgCreated = true;
  }
  res.orgId = orgId;

  // Guard anti-secuestro: si el slug demo-* ya existe pero NO es interna, es
  // una org real homónima — ABORTAR en vez de flipearle el flag y sembrarle
  // data MOCK. (No debería pasar: el formato demo-<especialidad> no colisiona
  // con slugs de onboarding, pero el costo de chequear es cero.)
  if (existingOrg && existingOrg.is_internal_account !== true) {
    return fail(
      "org guard",
      `la org ${slug} existe y NO es interna — no se toca una org real; revisala a mano`,
    );
  }
  // is_internal_account vía UPDATE (no en el INSERT): el trigger de audit M37
  // es AFTER UPDATE OF — así el flip queda registrado en audit_log.
  if (!existingOrg) {
    const { error: flagErr } = await supabase
      .from("organization")
      .update({ is_internal_account: true })
      .eq("id", orgId);
    if (flagErr) return fail("org internal flag", flagErr.message);
  }
  // Especialidad corregida si la org existía con otra (no debería pasar).
  if (existingOrg && existingOrg.especialidad !== esp) {
    const { error: espErr } = await supabase
      .from("organization")
      .update({ especialidad: esp })
      .eq("id", orgId);
    if (espErr) return fail("org especialidad", espErr.message);
  }

  // ── 2. Member OWNER ───────────────────────────────────────────────────────
  const { data: existingMember, error: memSelErr } = await supabase
    .from("member")
    .select("id")
    .eq("organization_id", orgId)
    .eq("profile_id", profileId)
    .is("deleted_at", null)
    .maybeSingle();
  if (memSelErr) return fail("member select", memSelErr.message);

  let memberId: string;
  if (existingMember) {
    memberId = existingMember.id as string;
  } else {
    const { data: mem, error: memInsErr } = await supabase
      .from("member")
      .insert({
        organization_id: orgId,
        profile_id: profileId,
        role: "OWNER",
        es_colegiado: true,
        accepted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (memInsErr || !mem) return fail("member insert", memInsErr?.message);
    memberId = mem.id as string;
    res.memberCreated = true;
  }

  // ── 3. Servicios template de la especialidad ──────────────────────────────
  const { data: servicios, error: servSelErr } = await supabase
    .from("servicio")
    .select("id, nombre, duracion_min, precio_cents")
    .eq("organization_id", orgId)
    .eq("activo", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (servSelErr) return fail("servicio select", servSelErr.message);

  let servRows = servicios ?? [];
  if (servRows.length === 0) {
    const templates = getEspecialidadServicios(esp);
    const { data: inserted, error: servInsErr } = await supabase
      .from("servicio")
      .insert(
        templates.map((t) => ({
          organization_id: orgId,
          nombre: t.nombre,
          tipo_canonico: t.tipoCanonico,
          duracion_min: t.dur,
          precio_cents: t.precioCents,
          para_nuevos: t.tipoCanonico === "CONSULTA_INICIAL",
        })),
      )
      .select("id, nombre, duracion_min, precio_cents");
    if (servInsErr || !inserted || inserted.length === 0) {
      return fail("servicio insert", servInsErr?.message);
    }
    servRows = inserted;
    res.serviciosCreados = inserted.length;
  }
  const servAt = (n: number) =>
    servRows[n % servRows.length] as { id: string; duracion_min: number; precio_cents: number };

  // ── 4. Disponibilidad L-V (para que /book/<slug> ofrezca slots) ───────────
  const { data: disp, error: dispSelErr } = await supabase
    .from("disponibilidad_profesional")
    .select("id")
    .eq("organization_id", orgId)
    .eq("member_id", memberId)
    .limit(1);
  if (dispSelErr) return fail("disponibilidad select", dispSelErr.message);
  if (!disp || disp.length === 0) {
    const { error: dispInsErr } = await supabase.from("disponibilidad_profesional").insert(
      [1, 2, 3, 4, 5].map((dia) => ({
        organization_id: orgId,
        member_id: memberId,
        dia_semana: dia,
        hora_inicio: "09:00",
        hora_fin: "18:00",
      })),
    );
    if (dispInsErr) return fail("disponibilidad insert", dispInsErr.message);
  }

  // ── 5. Pacientes MOCK: idempotencia / cleanup ─────────────────────────────
  const { data: mocks, error: mockSelErr } = await supabase
    .from("paciente")
    .select("id, identidad_id")
    .eq("organization_id", orgId)
    .contains("tags", ["MOCK"]);
  if (mockSelErr) return fail("mock select", mockSelErr.message);

  if (mocks && mocks.length > 0) {
    if (!opts.force && !opts.cleanup) {
      res.skipped = true;
      return res;
    }
    const pacIds = mocks.map((m) => m.id as string);
    const identIds = mocks.map((m) => m.identidad_id as string).filter(Boolean);

    const { data: turnoRows, error: tSelErr } = await supabase
      .from("turno").select("id").in("paciente_id", pacIds);
    if (tSelErr) return fail("cleanup turno select", tSelErr.message);
    const turnoIds = (turnoRows ?? []).map((t) => t.id as string);

    const { error: dInstErr } = await supabase
      .from("instrumento_respuesta").delete().in("paciente_id", pacIds);
    if (dInstErr) return fail("cleanup instrumentos", dInstErr.message);
    const { error: dSesErr } = await supabase.from("sesion").delete().in("paciente_id", pacIds);
    if (dSesErr) return fail("cleanup sesion", dSesErr.message);
    if (turnoIds.length > 0) {
      const { error: dPagoErr } = await supabase.from("pago").delete().in("turno_id", turnoIds);
      if (dPagoErr) return fail("cleanup pago", dPagoErr.message);
      const { error: dTurnoErr } = await supabase.from("turno").delete().in("id", turnoIds);
      if (dTurnoErr) return fail("cleanup turno", dTurnoErr.message);
    }
    const { error: dPacErr } = await supabase.from("paciente").delete().in("id", pacIds);
    if (dPacErr) return fail("cleanup paciente", dPacErr.message);
    if (identIds.length > 0) {
      const { error: dIdErr } = await supabase.from("paciente_identidad").delete().in("id", identIds);
      if (dIdErr) return fail("cleanup identidad", dIdErr.message);
    }
    res.cleaned = pacIds.length;
  }

  // Defensa en profundidad: purgar recordatorios PENDIENTES de la org demo.
  // El seed no encola (INSERTs directos, nunca createTurno/transitionTurno) y
  // el dispatcher skipea orgs internas, pero acciones EN VIVO durante la demo
  // (booking del ensayo, cerrar el turno EN_SALA) sí encolan — esta purga
  // garantiza que un reset entre llamadas también limpie esa cola.
  const { error: purgeErr } = await supabase
    .from("recordatorio_job")
    .delete()
    .eq("organization_id", orgId)
    .is("enviado_ts", null);
  if (purgeErr) return fail("purge recordatorios", purgeErr.message);

  if (opts.cleanup) return res;

  // ── 6. Insertar pacientes (batch: identidades → pacientes) ────────────────
  const seeds = PACIENTES_DEMO[esp];
  const { data: idents, error: idInsErr } = await supabase
    .from("paciente_identidad")
    .insert(
      seeds.map((p) => ({
        organization_id: orgId,
        nombre_cifrado: encryptColumn(p.nombre),
        apellido_cifrado: encryptColumn(p.apellido),
        numero_doc_cifrado: encryptColumn(p.dni),
        email_cifrado: encryptColumn(p.email),
        telefono_cifrado: encryptColumn(p.tel),
        tipo_doc: "DNI",
        fecha_nacimiento: p.nac,
        sexo_biologico: p.sexo,
        domicilio_ciudad: p.ciudad,
        domicilio_provincia: p.prov,
        nombre_hash: blindIndex(`${p.nombre} ${p.apellido}`, orgId),
        dni_hash: blindIndex(p.dni, orgId),
        telefono_hash: blindIndexPhone(p.tel, orgId),
      })),
    )
    .select("id");
  if (idInsErr || !idents || idents.length !== seeds.length) {
    return fail("identidad insert", idInsErr?.message ?? "count mismatch");
  }

  const { data: pacientes, error: pacInsErr } = await supabase
    .from("paciente")
    .insert(
      seeds.map((p, i) => ({
        organization_id: orgId,
        identidad_id: idents[i].id,
        motivo_consulta_cifrado: encryptColumn(p.motivo),
        notas_importantes_cifrado: encryptColumn(p.notas),
        tipo: p.tipo,
        tags: ["MOCK", p.cond],
        profesional_principal_id: memberId,
      })),
    )
    .select("id");
  if (pacInsErr || !pacientes || pacientes.length !== seeds.length) {
    return fail("paciente insert", pacInsErr?.message ?? "count mismatch");
  }
  res.pacientes = pacientes.length;

  // ── 7. Turnos: pasados cerrados + agenda de hoy + futuros ─────────────────
  // Pasados/futuros: un turno por DÍA distinto → sin riesgo de solape.
  // HOY: agenda con cursor secuencial (próximo inicio = fin del anterior +
  // 15 min de buffer) — inmune a servicios largos (psicología atiende 50-90
  // min: con horas fijas cada 60 min el INSERT violaba el EXCLUDE
  // turno_no_overlap_excl y la org quedaba a medio sembrar).
  type EstadoDemo = "CERRADO" | "EN_SALA" | "CONFIRMADO" | "AGENDADO";
  interface TurnoPlan {
    pacienteIdx: number;
    inicio: string;
    estado: EstadoDemo;
    conPago: boolean;
    conSesion: boolean;
    serv: { id: string; duracion_min: number; precio_cents: number };
  }
  const HOY_ESTADOS: Array<{
    estado: EstadoDemo;
    conPago: boolean;
    conSesion: boolean;
    bloque: "maniana" | "tarde";
  }> = [
    { estado: "CERRADO", conPago: true, conSesion: true, bloque: "maniana" },
    { estado: "EN_SALA", conPago: false, conSesion: false, bloque: "maniana" },
    { estado: "CONFIRMADO", conPago: false, conSesion: false, bloque: "tarde" },
    { estado: "AGENDADO", conPago: false, conSesion: false, bloque: "tarde" },
    { estado: "AGENDADO", conPago: false, conSesion: false, bloque: "tarde" },
    { estado: "AGENDADO", conPago: false, conSesion: false, bloque: "tarde" },
  ];
  const hhmm = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

  const plan: TurnoPlan[] = [];
  let nServ = 0;
  for (let i = 0; i < seeds.length; i++) {
    plan.push(
      { pacienteIdx: i, inicio: isoWallClock(tz, -(7 + i), "09:00"), estado: "CERRADO", conPago: true, conSesion: true, serv: servAt(nServ++) },
      { pacienteIdx: i, inicio: isoWallClock(tz, -(14 + i), "11:00"), estado: "CERRADO", conPago: true, conSesion: true, serv: servAt(nServ++) },
      { pacienteIdx: i, inicio: isoWallClock(tz, 1 + i, "10:00"), estado: "AGENDADO", conPago: false, conSesion: false, serv: servAt(nServ++) },
    );
  }
  let cursorManiana = 9 * 60; // 09:00
  let cursorTarde = 15 * 60; // 15:00
  for (let i = 0; i < seeds.length; i++) {
    const spec = HOY_ESTADOS[i % HOY_ESTADOS.length];
    const serv = servAt(nServ++);
    const inicioMin = spec.bloque === "maniana" ? cursorManiana : cursorTarde;
    if (spec.bloque === "maniana") cursorManiana = inicioMin + serv.duracion_min + 15;
    else cursorTarde = inicioMin + serv.duracion_min + 15;
    plan.push({
      pacienteIdx: i,
      inicio: isoWallClock(tz, 0, hhmm(inicioMin)),
      estado: spec.estado,
      conPago: spec.conPago,
      conSesion: spec.conSesion,
      serv,
    });
  }

  const { data: turnos, error: turnoInsErr } = await supabase
    .from("turno")
    .insert(
      plan.map((t) => ({
        organization_id: orgId,
        paciente_id: pacientes[t.pacienteIdx].id,
        servicio_id: t.serv.id,
        profesional_id: memberId,
        inicio: t.inicio,
        duracion_min: t.serv.duracion_min,
        precio_cents: t.serv.precio_cents,
        estado: t.estado,
        origen: "MANUAL",
        duracion_real_min: t.estado === "CERRADO" ? t.serv.duracion_min : null,
      })),
    )
    .select("id, precio_cents, inicio, paciente_id");
  if (turnoInsErr || !turnos || turnos.length !== plan.length) {
    return fail("turno insert", turnoInsErr?.message ?? "count mismatch");
  }
  res.turnos = turnos.length;

  // ── 8. Pagos y sesiones de los turnos cerrados ────────────────────────────
  const cerradosIdx = plan
    .map((t, n) => ({ ...t, n }))
    .filter((t) => t.estado === "CERRADO");

  const METODOS = ["EFECTIVO", "TRANSFERENCIA", "MERCADOPAGO", "TARJETA"] as const;
  const { error: pagoInsErr } = await supabase.from("pago").insert(
    cerradosIdx
      .filter((t) => t.conPago)
      .map((t, k) => ({
        turno_id: turnos[t.n].id,
        monto_cents: turnos[t.n].precio_cents,
        metodo: METODOS[k % METODOS.length],
        estado: "PAGADO",
        pagado_ts: turnos[t.n].inicio,
        notas: "Pago de muestra (MOCK).",
      })),
  );
  if (pagoInsErr) return fail("pago insert", pagoInsErr.message);
  res.pagos = cerradosIdx.filter((t) => t.conPago).length;

  const soap = SOAP_DEMO[esp];
  const { error: sesInsErr } = await supabase.from("sesion").insert(
    cerradosIdx
      .filter((t) => t.conSesion)
      .map((t, k) => {
        const tool = buildDemoToolData(esp, t.pacienteIdx + k);
        return {
          organization_id: orgId,
          turno_id: turnos[t.n].id,
          paciente_id: turnos[t.n].paciente_id,
          soap_s_cifrado: encryptColumn(soap.s),
          soap_o_cifrado: encryptColumn(soap.o),
          soap_a_cifrado: encryptColumn(soap.a),
          soap_p_cifrado: encryptColumn(soap.p),
          eva_antes: 6 - (t.pacienteIdx % 3),
          eva_despues: 2 + (t.pacienteIdx % 2),
          tool_id: tool.toolId,
          tool_data_cifrado: encryptColumn(JSON.stringify(tool.data)),
          vertebras_json: [],
        };
      }),
  );
  if (sesInsErr) return fail("sesion insert", sesInsErr.message);
  res.sesiones = cerradosIdx.filter((t) => t.conSesion).length;

  // ── 9. Instrumentos (solo psicología): serie PHQ-9/GAD-7 con mejoría ──────
  // 3 aplicaciones escalonadas por paciente (3 pacientes) para que el panel
  // "Evolución de resultados" de la ficha psico no abra vacío en la demo.
  // score_total/banda se computan con la def canónica del registry
  // (computeScoreSnapshot — el mismo camino que saveRespuesta); las respuestas
  // crudas van cifradas. PHQ-9 ítem 9 (ideación) SIEMPRE 0: un valor > 0
  // dispararía el workflow de riesgo (C7) en plena llamada de venta.
  if (esp === "psicologia") {
    const APLICACIONES = [
      // [díasAtrás, phq9 (8 ítems — el 9no se appendea en 0), gad7]
      { dias: 21, phq9: [2, 2, 2, 1, 2, 2, 1, 1], gad7: [2, 2, 2, 1, 2, 1, 1] },
      { dias: 10, phq9: [2, 1, 1, 1, 2, 1, 1, 0], gad7: [2, 1, 1, 1, 1, 1, 0] },
      { dias: 2, phq9: [1, 1, 1, 0, 1, 1, 0, 0], gad7: [1, 1, 0, 0, 1, 0, 0] },
    ];
    const filas: Array<Record<string, unknown>> = [];
    for (let p = 0; p < Math.min(3, pacientes.length); p++) {
      for (const ap of APLICACIONES) {
        // Leve variación por paciente, clampeada a 0-3.
        const vary = (arr: number[]) => arr.map((n) => Math.min(3, Math.max(0, n + (p % 2))));
        const phq9 = [...vary(ap.phq9), 0]; // ítem 9 = 0 SIEMPRE
        const gad7 = vary(ap.gad7);
        for (const [instrumentoId, respuestas] of [
          ["phq9.v1", phq9],
          ["gad7.v1", gad7],
        ] as const) {
          const scored = computeScoreSnapshot(instrumentoId, respuestas);
          if (!scored.ok) return fail("instrumento score", `${instrumentoId}: ${scored.message}`);
          filas.push({
            organization_id: orgId,
            paciente_id: pacientes[p].id,
            sesion_id: null,
            instrumento_id: instrumentoId,
            instrumento_version: scored.version,
            respuestas_cifrado: encryptColumn(JSON.stringify(respuestas)),
            score_total: scored.snapshot.scoreTotal,
            banda: scored.snapshot.banda,
            completado_por: "profesional",
            created_at: isoWallClock(tz, -ap.dias, "10:30"),
          });
        }
      }
    }
    const { error: instErr } = await supabase.from("instrumento_respuesta").insert(filas);
    if (instErr) return fail("instrumento insert", instErr.message);
    res.instrumentos = filas.length;
  }

  return res;
}
