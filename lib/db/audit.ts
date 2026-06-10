/**
 * Folio · query del audit_log para el dashboard de cumplimiento.
 *
 * Solo OWNER puede ver el audit (RLS lo restringe en M12). El UI vive en
 * /admin/audit y permite filtrar por fecha, actor, resource_type, y acción.
 *
 * Retención: 10 años por Ley 26.529 art. 18. Particionado mensual permite
 * archive a Storage cuando excede ese plazo (F12).
 */

import { headers } from "next/headers";
import { z } from "zod";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

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
  if (session.data.role !== "OWNER" && session.data.role !== "DIRECTOR") {
    return err("forbidden", "Solo OWNER o DIRECTOR puede ver el audit log.");
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
  if (session.data.role !== "OWNER" && session.data.role !== "DIRECTOR") {
    return err("forbidden", "Solo OWNER o DIRECTOR puede ver el audit log.");
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

// ─── Escritura app-side del audit_log ────────────────────────────────────────

export interface WriteAuditEntryInput {
  organizationId: string;
  /** profile.id del actor (auth.uid()). null en flujos sin sesión clara. */
  actorId: string | null;
  /** Rol del actor al momento del evento (snapshot). null si no se conoce. */
  actorRole?: string | null;
  /** Ej.: 'member_invitation.create'. Formato `recurso.accion`. */
  action: string;
  /** Ej.: 'member_invitation', 'member'. */
  resourceType: string;
  /** PK del recurso afectado, como text. */
  resourceId: string;
  /**
   * Contexto de red del actor (Ley 26.529 art. 18: el rastro de auditoría debe
   * registrar desde DÓNDE se hizo la acción). La columna `audit_log.ip` es
   * `inet` y `user_agent` es `text` (M12). Si el caller no los pasa,
   * `writeAuditEntry` los lee de los headers de la request entrante
   * (best-effort). Pasalos explícitamente cuando ya los tengas a mano
   * (ej.: el flujo de invitación los computa para rate-limit/consentimiento).
   */
  ip?: string | null;
  userAgent?: string | null;
  /**
   * Metadata estructurada del evento. SE GUARDA SIN CIFRAR — el audit_log es
   * metadata de cumplimiento, no PHI: solo lo leen OWNER/DIRECTOR de la org
   * (RLS de M12/M34) y la inserción la hace el service client. El email del
   * invitado es PII pero (a) ya vive en texto plano en member_invitation
   * (es la clave de lookup, no un dato cifrado), (b) ya se expone en el
   * export ARCO (/api/me/export), y (c) sin él el rastro de auditoría no
   * cumpliría su función (Ley 26.529 art. 18: registrar QUIÉN hizo QUÉ sobre
   * QUIÉN). Alineado con cómo el trigger M12 vuelca to_jsonb(NEW) al payload.
   * No incluir NUNCA el token crudo ni el token_hash.
   */
  payload?: Record<string, unknown>;
}

/** Fila tal como se inserta en `audit_log`. Tipado explícito para fijar el
 *  contrato del builder puro (incluye ip/user_agent). */
export interface AuditInsertRow {
  organization_id: string;
  actor_id: string | null;
  actor_role: string | null;
  ip: string | null;
  user_agent: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  payload: Record<string, unknown> | null;
}

/**
 * Normaliza el `x-forwarded-for` (lista separada por comas: el primer hop es el
 * cliente) o un IP suelto a una dirección que Postgres acepte como `inet`.
 * String vacío → null (un INSERT de '' en `inet` falla con 22P02).
 */
export function normalizeAuditIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const first = ip.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/**
 * Construye la fila de audit_log a partir del input. PURA y testeable: fija las
 * invariantes de la columna de red (ip normalizado, user_agent recortado/null)
 * sin tocar Supabase ni headers. Si alguien vuelve a olvidar ip/user_agent,
 * el test de esta función lo marca.
 */
export function buildAuditInsertRow(
  input: WriteAuditEntryInput,
  netCtx: { ip: string | null; userAgent: string | null } = { ip: null, userAgent: null },
): AuditInsertRow {
  const ip = normalizeAuditIp(input.ip ?? netCtx.ip);
  const uaRaw = input.userAgent ?? netCtx.userAgent ?? null;
  const userAgent = uaRaw && uaRaw.trim().length > 0 ? uaRaw : null;
  return {
    organization_id: input.organizationId,
    actor_id: input.actorId,
    actor_role: input.actorRole ?? null,
    ip,
    user_agent: userAgent,
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId,
    payload: input.payload ?? null,
  };
}

/**
 * Lee ip + user_agent de los headers de la request entrante. Best-effort:
 * `headers()` arroja fuera de un scope de request (ej.: un cron sin request),
 * así que cualquier excepción degrada a `{ null, null }` y el audit igual se
 * escribe (sin contexto de red, mejor que no escribir).
 */
async function readRequestNetworkContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? null;
    return { ip, userAgent: h.get("user-agent") ?? null };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * Inserta una fila en audit_log usando el service client (la RLS de M12
 * bloquea INSERT directo: `audit_log_no_direct_insert WITH CHECK (false)` —
 * el único camino es BYPASSRLS, como en /api/me/export).
 *
 * Contexto de red (Ley 26.529 art. 18): `ip`/`user_agent` se toman del input
 * si el caller los pasó; si no, se leen de los headers de la request. Así toda
 * escritura de auditoría queda con el QUIÉN + DESDE DÓNDE, sin obligar a cada
 * caller a cablear los headers.
 *
 * Best-effort y fail-safe: el audit es complementario a la operación de
 * negocio que ya ocurrió. Si la escritura falla, NO revertimos la operación
 * (sería peor dejar al usuario sin poder invitar/revocar por un hiccup del
 * log); en su lugar logueamos el fallo app-side para que sea visible en los
 * logs de la función serverless. Devuelve un Result para los callers que
 * quieran reaccionar, pero ninguno debería romper su flujo por un err.
 */
export async function writeAuditEntry(
  input: WriteAuditEntryInput,
): Promise<Result<void>> {
  try {
    // Solo leemos headers si el caller no aportó AMBOS valores (evita el await
    // innecesario y el log de excepción cuando ya vienen explícitos).
    const netCtx =
      input.ip !== undefined && input.userAgent !== undefined
        ? { ip: input.ip, userAgent: input.userAgent }
        : await readRequestNetworkContext();
    const service = createSupabaseServiceClient();
    const { error } = await service
      .from("audit_log")
      .insert(buildAuditInsertRow(input, netCtx));
    if (error) {
      console.warn(
        `[audit] no se pudo registrar ${input.action} (${input.resourceType}:${input.resourceId}): ${error.message}`,
      );
      return err("db_error", "No se pudo registrar el evento de auditoría.", error.message);
    }
    return ok(undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[audit] excepción registrando ${input.action}: ${msg}`);
    return err("db_error", "No se pudo registrar el evento de auditoría.", msg);
  }
}
