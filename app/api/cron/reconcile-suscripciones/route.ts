/**
 * Folio · /api/cron/reconcile-suscripciones
 *
 * A2 (docs/AUDIT.md): el estado local de `suscripcion` se actualiza SOLO por
 * webhook de MP. Si un webhook se pierde (red, downtime nuestro durante los 3
 * reintentos de MP), el estado local diverge del real para siempre — p. ej.
 * MP cobra una suscripción ACTIVA mientras acá sigue PENDIENTE_ACTIVACION y
 * el access-gate bloquea a un cliente que está pagando.
 *
 * Este cron es la red de seguridad: para cada suscripción en estado no
 * terminal (RECONCILABLE_ESTADOS) hace GET /preapproval/{id} con nuestro
 * token y aplica el estado real vía `applySubscriptionUpdate`, que ya es
 * idempotente y descarta datos más viejos que `mp_last_modified` (no pisa
 * webhooks que sí llegaron).
 *
 * Seguridad: Authorization: Bearer ${CRON_SECRET} (mismo patrón que
 * dispatch-recordatorios). Vercel Cron lo invoca diario (vercel.json) —
 * ventana máxima de divergencia ~24 h; si el plan de Vercel lo permite,
 * subir a cada 12 h.
 *
 * Performance: batch de 50 por corrida, ordenado por updated_at ASC (las más
 * "viejas" primero). Una falla con una suscripción no corta el batch.
 *
 * Fase E (E2): para cada suscripción del batch también corre
 * `syncSubscriptionAmount` — si una org CLINICA cambió de seats y el sync
 * fire-and-forget del hook falló (MP caído, lambda congelada), este cron
 * repara el monto del preapproval. Para INDEPENDIENTE es un no-op por diseño.
 *
 * PR 1.2 — fase LIFECYCLE (después del loop de reconcile):
 *   - trial_por_vencer: orgs sin suscripción activa con 3 o 1 días de grace
 *     restantes (decideLifecycleEmails, lib/billing/lifecycle.ts).
 *   - suscripcion_suspendida: gate bloqueado por morosidad agotada
 *     (subscription_morosa_expired), dedupe por episodio (morosa_desde).
 *   Los picks SQL excluyen is_internal_account EN LA QUERY (defensa en
 *   profundidad — notify* re-chequea contra DB) y están acotados
 *   (LIFECYCLE_BATCH). Los notify* son fail-safe: un email jamás rompe el cron.
 *   Sin escalation MOROSA→CANCELADA acá: MP cancela solo y llega por webhook.
 *
 * PR 1.2 — observabilidad de recordatorio_job (dead jobs): cuenta jobs
 * muertos (sin enviar con intentos agotados, o vencidos hace > 6 h) y lo
 * reporta en la respuesta + captureMessage warning si > 0. SOLO lectura.
 */

import { NextRequest, NextResponse } from "next/server";
import { captureException, captureMessage } from "@sentry/nextjs";

import { decideLifecycleEmails } from "@/lib/billing/lifecycle";
import { computeMonthlyPriceCents, type OrganizacionTipo } from "@/lib/billing/pricing";
import {
  applySubscriptionUpdate,
  computeAccessGate,
  GRACE_PERIOD_DAYS,
  RECONCILABLE_ESTADOS,
  syncSubscriptionAmount,
  type EstadoSuscripcion,
} from "@/lib/db/suscripcion";
import { notifySuscripcionSuspendida, notifyTrialPorVencer } from "@/lib/email/notify";
import { getPaymentProvider } from "@/lib/payments";
import { verifyBearer } from "@/lib/security/verify-bearer";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 50;

// ─── Fase lifecycle (PR 1.2): límites de las queries ─────────────────────────
// Batch chico y fijo: el cron corre diario; lo que no entra hoy entra mañana
// (el dedupe de M65 garantiza que nada se manda dos veces).
const LIFECYCLE_BATCH = 200;
// Ventana del pick de trial: solo orgs creadas dentro del grace (7d) + 1 día
// de margen. Mantiene el pick acotado aunque `organization` crezca sin límite.
const TRIAL_PICK_WINDOW_DAYS = GRACE_PERIOD_DAYS + 1;
// Dead jobs de recordatorio_job: sin enviar con intentos agotados (el
// dispatcher pickea intentos < 5, M11) o vencidos hace más de 6 h.
const DEAD_REMINDER_MAX_INTENTOS = 5;
const DEAD_REMINDER_STALE_HOURS = 6;

interface SuscripcionPick {
  id: string;
  organization_id: string;
  mp_preapproval_id: string;
  estado: string;
}

async function runReconcile(): Promise<NextResponse> {
  const service = createSupabaseServiceClient();

  const { data: rows, error: pickErr } = await service
    .from("suscripcion")
    .select("id, organization_id, mp_preapproval_id, estado")
    .not("mp_preapproval_id", "is", null)
    .in("estado", [...RECONCILABLE_ESTADOS])
    .order("updated_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (pickErr) {
    console.error(`[reconcile-sus] error listando suscripciones: ${pickErr.message}`);
    captureException(new Error(`reconcile pick falló: ${pickErr.message}`), {
      tags: { component: "reconcile", op: "pick" },
    });
    return NextResponse.json({ ok: false, error: "pick-failed" }, { status: 500 });
  }

  const picked = (rows ?? []) as unknown as SuscripcionPick[];
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let montoSynced = 0;

  const provider = getPaymentProvider();
  for (const sus of picked) {
    try {
      const subscription = await provider.fetchSubscription(sus.mp_preapproval_id);
      const res = await applySubscriptionUpdate(subscription);
      if (!res.ok) {
        failed++;
        console.warn(
          `[reconcile-sus] apply falló sus=${sus.id} preapproval=${sus.mp_preapproval_id}: ${res.error.message}`,
        );
        captureException(new Error(`reconcile apply falló: ${res.error.detail ?? res.error.message}`), {
          tags: { component: "reconcile", op: "apply" },
          extra: { suscripcionId: sus.id },
        });
        continue;
      }
      // ok(null) = sin fila o evento no más nuevo (estado ya consistente).
      if (res.data && res.data.estado !== sus.estado) {
        updated++;
        console.log(
          `[reconcile-sus] sus=${sus.id} org=${sus.organization_id}: ${sus.estado} → ${res.data.estado} (webhook perdido reconciliado).`,
        );
      } else {
        unchanged++;
      }

      // Fase E (E2): además del estado, reconciliamos el MONTO por seats de
      // las orgs CLINICA — red de seguridad si el sync fire-and-forget de un
      // hook de seats falló. La decisión interna saltea INDEPENDIENTE,
      // estados no elegibles y montos ya iguales sin tocar MP (idempotente).
      const sync = await syncSubscriptionAmount(sus.organization_id);
      if (sync.ok && sync.data.synced) {
        montoSynced++;
        console.log(
          `[reconcile-sus] monto sync org=${sus.organization_id}: ${sync.data.fromCents} → ${sync.data.toCents} (drift de seats reconciliado).`,
        );
      } else if (!sync.ok) {
        // No cuenta como `failed` del batch de estados: queda logueado y se
        // reintenta en la próxima corrida.
        console.warn(
          `[reconcile-sus] monto sync falló org=${sus.organization_id}: ${sync.error.message}`,
        );
        captureException(new Error(`reconcile monto sync falló: ${sync.error.detail ?? sync.error.message}`), {
          tags: { component: "reconcile", op: "monto-sync" },
          extra: { organizationId: sus.organization_id },
        });
      }
    } catch (e) {
      // MP API caída / 404 de preapproval → no cortamos el batch; queda para
      // la próxima corrida.
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[reconcile-sus] error sus=${sus.id} preapproval=${sus.mp_preapproval_id}: ${msg}`);
      captureException(e, {
        tags: { component: "reconcile", op: "reconcile-item" },
        extra: { suscripcionId: sus.id },
      });
    }
  }

  // ─── Fase lifecycle (PR 1.2) — corre SIEMPRE, aún con fallas en el loop ────
  const lifecycleEmails = await runLifecyclePhase(service);
  const deadReminders = await countDeadReminderJobs(service);

  const summary = {
    ok: true,
    picked: picked.length,
    updated,
    unchanged,
    failed,
    montoSynced,
    lifecycleEmails,
    deadReminders,
  };
  console.log(`[reconcile-sus] ${JSON.stringify(summary)}`);
  return NextResponse.json(summary);
}

// ═════════════════════════════════════════════════════════════════════════════
// Fase lifecycle (PR 1.2)
// ═════════════════════════════════════════════════════════════════════════════

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

interface LifecycleCounters {
  /** Emails de trial_por_vencer despachados (el dedupe M65 puede skipear). */
  trial: number;
  /** Emails de suscripcion_suspendida despachados (ídem dedupe). */
  suspendida: number;
}

/**
 * Orquesta las dos ramas de lifecycle. Cada rama va en su propio try/catch:
 * una falla se reporta a Sentry y NO tira abajo el resto del cron (el summary
 * sale igual, con los contadores que se alcanzaron a computar).
 */
async function runLifecyclePhase(service: ServiceClient): Promise<LifecycleCounters> {
  const counters: LifecycleCounters = { trial: 0, suspendida: 0 };
  const now = new Date();

  try {
    await runTrialAvisos(service, now, counters);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[reconcile-sus] fase lifecycle (trial) falló: ${msg}`);
    captureException(e, { tags: { component: "reconcile", op: "lifecycle-trial" } });
  }

  try {
    await runSuspendidaAvisos(service, now, counters);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[reconcile-sus] fase lifecycle (suspendida) falló: ${msg}`);
    captureException(e, { tags: { component: "reconcile", op: "lifecycle-suspendida" } });
  }

  return counters;
}

/**
 * Rama (a): trial_por_vencer en los umbrales 3 y 1 del grace period.
 *
 * Pick acotado: solo orgs creadas dentro de la ventana del grace (las únicas
 * que pueden tener graceDaysLeft ∈ {3,1}), no internas, no eliminadas —
 * TODO en la query. Destinatario: payer_email si dejó una suscripción a
 * medio activar; si no, el email del OWNER (member → profile, mismo patrón
 * que notifyPedidoNuevo).
 */
async function runTrialAvisos(
  service: ServiceClient,
  now: Date,
  counters: LifecycleCounters,
): Promise<void> {
  const createdCutoff = new Date(
    now.getTime() - TRIAL_PICK_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: orgRows, error: orgErr } = await service
    .from("organization")
    .select("id, created_at, tipo")
    .eq("is_internal_account", false)
    .is("deleted_at", null)
    .gte("created_at", createdCutoff)
    .order("created_at", { ascending: true })
    .limit(LIFECYCLE_BATCH);
  if (orgErr) throw new Error(`pick orgs trial: ${orgErr.message}`);

  const orgs = (orgRows ?? []) as Array<{ id: string; created_at: string; tipo: OrganizacionTipo }>;
  if (orgs.length === 0) return;
  const orgIds = orgs.map((o) => o.id);

  const { data: subRows, error: subErr } = await service
    .from("suscripcion")
    .select("organization_id, estado, proxima_cobro, morosa_desde, payer_email")
    .in("organization_id", orgIds);
  if (subErr) throw new Error(`suscripciones de orgs trial: ${subErr.message}`);
  const subByOrg = new Map(
    ((subRows ?? []) as Array<{
      organization_id: string;
      estado: EstadoSuscripcion;
      proxima_cobro: string | null;
      morosa_desde: string | null;
      payer_email: string;
    }>).map((s) => [s.organization_id, s]),
  );

  // Una sola query de members: seats por org (pricing CLINICA) + OWNER
  // (destinatario cuando no hay suscripción con payer_email).
  const { data: memberRows, error: memErr } = await service
    .from("member")
    .select("organization_id, profile_id, role")
    .in("organization_id", orgIds)
    .is("deleted_at", null)
    .limit(1000);
  if (memErr) throw new Error(`members de orgs trial: ${memErr.message}`);
  const seatsByOrg = new Map<string, number>();
  const ownerProfileByOrg = new Map<string, string>();
  for (const m of (memberRows ?? []) as Array<{
    organization_id: string;
    profile_id: string;
    role: string;
  }>) {
    seatsByOrg.set(m.organization_id, (seatsByOrg.get(m.organization_id) ?? 0) + 1);
    if (m.role === "OWNER" && !ownerProfileByOrg.has(m.organization_id)) {
      ownerProfileByOrg.set(m.organization_id, m.profile_id);
    }
  }

  const profileIds = [...new Set(ownerProfileByOrg.values())];
  const emailByProfile = new Map<string, string>();
  if (profileIds.length > 0) {
    const { data: profileRows, error: profErr } = await service
      .from("profile")
      .select("id, email")
      .in("id", profileIds);
    if (profErr) throw new Error(`profiles de owners trial: ${profErr.message}`);
    for (const p of (profileRows ?? []) as Array<{ id: string; email: string | null }>) {
      if (p.email) emailByProfile.set(p.id, p.email);
    }
  }

  for (const org of orgs) {
    const sub = subByOrg.get(org.id) ?? null;
    const gate = computeAccessGate(
      org.created_at,
      sub ? { estado: sub.estado, proximaCobro: sub.proxima_cobro } : null,
      now,
    );
    const decisiones = decideLifecycleEmails({
      organizationId: org.id,
      isInternalAccount: false, // excluidas en la query; notify* re-chequea
      gate,
      estadoSuscripcion: sub?.estado ?? null,
      morosaDesdeIso: sub?.morosa_desde ?? null,
      corteFallbackIso: null, // solo aplica a la rama suspendida
    });

    for (const decision of decisiones) {
      if (decision.tipo !== "trial_por_vencer") continue;
      const ownerProfileId = ownerProfileByOrg.get(org.id);
      const destinatario =
        sub?.payer_email ?? (ownerProfileId ? emailByProfile.get(ownerProfileId) : undefined);
      if (!destinatario) {
        console.warn(`[reconcile-sus] trial org=${org.id}: sin email de OWNER resoluble, skip.`);
        continue;
      }
      await notifyTrialPorVencer({
        organizationId: org.id,
        destinatario,
        diasRestantes: decision.diasRestantes,
        montoMensualCents: computeMonthlyPriceCents(org.tipo, seatsByOrg.get(org.id) ?? 1),
      });
      counters.trial++;
    }
  }
}

/**
 * Rama (b): suscripcion_suspendida cuando la morosidad agotó el gate.
 *
 * Pick acotado: solo filas MOROSA (única combinación que produce
 * subscription_morosa_expired en computeAccessGate). Las orgs internas /
 * eliminadas se excluyen EN LA QUERY del batch de organization: una fila
 * MOROSA cuya org no vuelve en ese SELECT se saltea.
 */
async function runSuspendidaAvisos(
  service: ServiceClient,
  now: Date,
  counters: LifecycleCounters,
): Promise<void> {
  const { data: subRows, error: subErr } = await service
    .from("suscripcion")
    .select("organization_id, morosa_desde, proxima_cobro, payer_email, monto_cents")
    .eq("estado", "MOROSA")
    .order("updated_at", { ascending: true })
    .limit(LIFECYCLE_BATCH);
  if (subErr) throw new Error(`pick suscripciones MOROSA: ${subErr.message}`);

  const subs = (subRows ?? []) as Array<{
    organization_id: string;
    morosa_desde: string | null;
    proxima_cobro: string | null;
    payer_email: string;
    monto_cents: number | null;
  }>;
  if (subs.length === 0) return;

  const { data: orgRows, error: orgErr } = await service
    .from("organization")
    .select("id, created_at")
    .in("id", subs.map((s) => s.organization_id))
    .eq("is_internal_account", false)
    .is("deleted_at", null);
  if (orgErr) throw new Error(`orgs de suscripciones MOROSA: ${orgErr.message}`);
  const orgById = new Map(
    ((orgRows ?? []) as Array<{ id: string; created_at: string }>).map((o) => [o.id, o]),
  );

  for (const sub of subs) {
    const org = orgById.get(sub.organization_id);
    if (!org) continue; // interna o eliminada (excluida en la query)

    const gate = computeAccessGate(
      org.created_at,
      { estado: "MOROSA", proximaCobro: sub.proxima_cobro },
      now,
    );
    // Fallback de discriminador para episodios pre-M65 (fila MOROSA sin
    // morosa_desde): la fecha de corte del gate — proxima_cobro vencida o el
    // fin del grace. Ambas son estables entre corridas → dedupe correcto.
    const graceEndIso = new Date(
      new Date(org.created_at).getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const decisiones = decideLifecycleEmails({
      organizationId: sub.organization_id,
      isInternalAccount: false, // excluidas en la query; notify* re-chequea
      gate,
      estadoSuscripcion: "MOROSA",
      morosaDesdeIso: sub.morosa_desde,
      corteFallbackIso: sub.proxima_cobro ?? graceEndIso,
    });

    for (const decision of decisiones) {
      if (decision.tipo !== "suscripcion_suspendida") continue;
      await notifySuscripcionSuspendida({
        organizationId: sub.organization_id,
        destinatario: sub.payer_email,
        episodioIso: decision.episodioIso,
        montoMensualCents: sub.monto_cents ?? computeMonthlyPriceCents("INDEPENDIENTE", 1),
      });
      counters.suspendida++;
    }
  }
}

/**
 * Observabilidad de recordatorio_job (PR 1.2): cuenta jobs muertos — sin
 * enviar y con intentos agotados (>= 5, el dispatcher pickea intentos < 5) o
 * vencidos hace más de DEAD_REMINDER_STALE_HOURS. SOLO lectura (head count):
 * no toca los jobs ni al dispatcher. null si el count falló.
 */
async function countDeadReminderJobs(service: ServiceClient): Promise<number | null> {
  const staleCutoff = new Date(
    Date.now() - DEAD_REMINDER_STALE_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const { count, error } = await service
    .from("recordatorio_job")
    .select("id", { count: "exact", head: true })
    .is("enviado_ts", null)
    .or(`intentos.gte.${DEAD_REMINDER_MAX_INTENTOS},scheduled_ts.lt.${staleCutoff}`);

  if (error) {
    console.warn(`[reconcile-sus] count de dead reminders falló: ${error.message}`);
    captureException(new Error(`count dead reminders falló: ${error.message}`), {
      tags: { component: "reconcile", op: "dead-reminders" },
    });
    return null;
  }

  const dead = count ?? 0;
  if (dead > 0) {
    console.warn(
      `[reconcile-sus] ${dead} recordatorio_job muertos (enviado_ts null + intentos >= ${DEAD_REMINDER_MAX_INTENTOS} o scheduled_ts < now - ${DEAD_REMINDER_STALE_HOURS}h).`,
    );
    captureMessage(`[reconcile] ${dead} recordatorio_job muertos`, {
      level: "warning",
      tags: { component: "reconcile", op: "dead-reminders" },
      extra: { dead },
    });
  }
  return dead;
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
  return runReconcile();
}

export async function POST(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  return runReconcile();
}
