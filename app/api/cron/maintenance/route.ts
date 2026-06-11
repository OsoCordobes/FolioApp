/**
 * Folio · /api/cron/maintenance
 *
 * Disparado por Vercel Cron mensualmente (ver vercel.json). Invoca
 * `audit_log_run_maintenance(6)` que crea las próximas 7 particiones mensuales
 * de `audit_log` con IF NOT EXISTS y reporta orphans en la partición DEFAULT.
 *
 * Crítico: sin esta corrida, M12 audit_log se queda sin particiones a los
 * ~12 meses post-deploy y la app se brickea (cada INSERT a tablas auditadas
 * — paciente, sesion, turno, etc. — falla porque el trigger SECURITY DEFINER
 * no encuentra partición). M28 añade un DEFAULT partition como red, pero
 * orphans > 0 indica que el cron lageó y necesitamos backfill.
 *
 * Seguridad:
 *   - Authorization: Bearer ${CRON_SECRET} (mismo patrón que dispatch-recordatorios).
 *   - service_role: la función plpgsql es SECURITY DEFINER restringida a service_role.
 *
 * Observabilidad:
 *   - Sentry warning si `default_partition_orphans > 0`
 *   - Sentry error si `failure_count > 0` o si la RPC falla
 *   - JSON response refleja stats para verificación manual
 */

import { NextRequest, NextResponse } from "next/server";
import { captureException, captureMessage } from "@sentry/nextjs";

import { verifyBearer } from "@/lib/security/verify-bearer";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface MaintenanceResult {
  months_ahead: number;
  partitions_before: number;
  partitions_after: number;
  created: number;
  failures: Array<{ partition: string; sqlstate: string; message: string }>;
  failure_count: number;
  default_partition_orphans: number;
  ts: string;
}

function authorize(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET no configurado" },
      { status: 500 },
    );
  }
  if (!verifyBearer(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

async function runMaintenance(): Promise<NextResponse> {
  try {
    const service = createSupabaseServiceClient();
    const { data, error } = await service.rpc("audit_log_run_maintenance", {
      p_months_ahead: 6,
    });

    if (error) {
      captureException(error, {
        tags: { cron: "maintenance" },
        extra: { rpc: "audit_log_run_maintenance" },
      });
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    const result = data as MaintenanceResult;

    if (result.failure_count > 0) {
      captureMessage(
        `audit_log maintenance had ${result.failure_count} partition failures`,
        {
          level: "error",
          tags: { cron: "maintenance" },
          extra: { failures: result.failures },
        },
      );
    }

    if (result.default_partition_orphans > 0) {
      captureMessage(
        `audit_log default partition has ${result.default_partition_orphans} orphan rows — cron lagged previously, backfill needed`,
        {
          level: "warning",
          tags: { cron: "maintenance" },
          extra: { orphans: result.default_partition_orphans },
        },
      );
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    captureException(err, { tags: { cron: "maintenance" } });
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  return runMaintenance();
}

export async function POST(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;
  return runMaintenance();
}
