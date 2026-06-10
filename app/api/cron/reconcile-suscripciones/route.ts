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
 */

import { NextRequest, NextResponse } from "next/server";

import {
  applySubscriptionUpdate,
  RECONCILABLE_ESTADOS,
  syncSubscriptionAmount,
} from "@/lib/db/suscripcion";
import { getPaymentProvider } from "@/lib/payments";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 50;

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
      }
    } catch (e) {
      // MP API caída / 404 de preapproval → no cortamos el batch; queda para
      // la próxima corrida.
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[reconcile-sus] error sus=${sus.id} preapproval=${sus.mp_preapproval_id}: ${msg}`);
    }
  }

  const summary = { ok: true, picked: picked.length, updated, unchanged, failed, montoSynced };
  console.log(`[reconcile-sus] ${JSON.stringify(summary)}`);
  return NextResponse.json(summary);
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
  return runReconcile();
}

export async function POST(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  return runReconcile();
}
