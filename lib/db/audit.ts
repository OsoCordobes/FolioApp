/**
 * Folio · query del audit_log para el dashboard de cumplimiento.
 *
 * Solo OWNER puede ver el audit (RLS lo restringe en M12). El UI vive en
 * /admin/audit y permite filtrar por fecha, actor, resource_type, y acción.
 *
 * Retención: 10 años por Ley 26.529 art. 18. Particionado mensual permite
 * archive a Storage cuando excede ese plazo (F12).
 */

import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { err, mapSupabaseError, ok, type Result } from "./errors";
import { getActiveSession } from "./session";

export interface AuditEntry {
  id: number;
  ts: string;
  actor_id: string | null;
  actor_role: string | null;
  ip: string | null;
  user_agent: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  payload: unknown;
}

const querySchema = z.object({
  fechaDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fechaHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  actorId: z.string().uuid().optional(),
  resourceType: z.string().max(64).optional(),
  resourceId: z.string().max(64).optional(),
  action: z.string().max(64).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export type AuditQueryInput = z.infer<typeof querySchema>;

export async function listAuditEntries(input: AuditQueryInput): Promise<Result<AuditEntry[]>> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "Filtros de audit inválidos.", parsed.error.message);
  }
  const session = await getActiveSession();
  if (!session.ok) return session;
  if (session.data.role !== "OWNER") {
    return err("forbidden", "Solo OWNER puede ver el audit log.");
  }

  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("audit_log")
    .select("id, ts, actor_id, actor_role, ip, user_agent, action, resource_type, resource_id, payload")
    .eq("organization_id", session.data.organizationId)
    .order("ts", { ascending: false })
    .range(parsed.data.offset, parsed.data.offset + parsed.data.limit - 1);

  if (parsed.data.fechaDesde) query = query.gte("ts", `${parsed.data.fechaDesde}T00:00:00Z`);
  if (parsed.data.fechaHasta) query = query.lte("ts", `${parsed.data.fechaHasta}T23:59:59Z`);
  if (parsed.data.actorId) query = query.eq("actor_id", parsed.data.actorId);
  if (parsed.data.resourceType) query = query.eq("resource_type", parsed.data.resourceType);
  if (parsed.data.resourceId) query = query.eq("resource_id", parsed.data.resourceId);
  if (parsed.data.action) query = query.eq("action", parsed.data.action);

  const { data, error } = await query;
  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);

  return ok((data ?? []) as AuditEntry[]);
}

/**
 * Stats agregados del audit para el header del dashboard:
 * total eventos, actores únicos, recursos únicos en los últimos 30 días.
 */
export async function getAuditStats(): Promise<
  Result<{ total: number; actores: number; recursos: number; periodo: string }>
> {
  const session = await getActiveSession();
  if (!session.ok) return session;
  if (session.data.role !== "OWNER") {
    return err("forbidden", "Solo OWNER puede ver el audit log.");
  }

  const supabase = await createSupabaseServerClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();

  const { data, error } = await supabase
    .from("audit_log")
    .select("actor_id, resource_type")
    .eq("organization_id", session.data.organizationId)
    .gte("ts", thirtyDaysAgo);

  if (error) return err(mapSupabaseError(error).code, mapSupabaseError(error).message, error.message);

  const rows = (data ?? []) as Array<{ actor_id: string | null; resource_type: string }>;
  const actores = new Set(rows.map((r) => r.actor_id).filter(Boolean) as string[]);
  const recursos = new Set(rows.map((r) => r.resource_type));

  return ok({
    total: rows.length,
    actores: actores.size,
    recursos: recursos.size,
    periodo: "últimos 30 días",
  });
}
