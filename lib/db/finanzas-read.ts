import { blindIndexCandidatos, decryptColumn } from "@/lib/crypto";
import { centsInteger, parseAmountCents } from "@/lib/format/financial-money";
import type { MovementCursor, MovementFilter, MovementPage } from "@/lib/finanzas/movements";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FinanzasTransaccion, MetodoPagoUI } from "./finanzas";
import { err, ok, type Result } from "./errors";

export interface FinanceBounds { organizationId: string; startUtc: string; endUtc: string }
export interface SummaryRow { id: string; nombre?: string; count: number; cents: string }
export interface FinanceSummary {
  paid_cents: string; pending_cents: string; previous_cents: string;
  pending_count: number; sessions: number;
  days: Array<{ bucket: string; cents: string }>;
  services: SummaryRow[]; professionals: SummaryRow[];
}

const METHODS: Record<string, MetodoPagoUI> = {
  EFECTIVO: "efectivo", TRANSFERENCIA: "transferencia", MERCADOPAGO: "mercadopago",
  TARJETA: "tarjeta", OBRA_SOCIAL: "obra_social", OTRO: "otro",
};
interface RawMovement {
  id: string; fecha: string; created_at: string; cents: string; metodo: string; estado: string;
  servicio: string; nombre_cifrado: string | null; apellido_cifrado: string | null;
}

export async function readFinanceSummary(bounds: FinanceBounds, previousStart: string, previousEnd: string): Promise<Result<FinanceSummary>> {
  try {
    const db = await createSupabaseServerClient();
    const { data, error } = await db.rpc("finanzas_summary", {
      p_organization: bounds.organizationId, p_start: bounds.startUtc, p_end: bounds.endUtc,
      p_previous_start: previousStart, p_previous_end: previousEnd,
    });
    if (error || !data) return err("db_error", "No se pudieron calcular los totales del período.");
    const result = data as FinanceSummary;
    for (const cents of [result.paid_cents, result.pending_cents, result.previous_cents,
      ...result.days.map((r) => r.cents), ...result.services.map((r) => r.cents), ...result.professionals.map((r) => r.cents)]) centsInteger(cents);
    if (![result.sessions, result.pending_count, ...result.services.map((r) => r.count), ...result.professionals.map((r) => r.count)]
      .every((n) => Number.isSafeInteger(n) && n >= 0)) throw new Error("finance_invalid_count");
    return ok(result);
  } catch {
    return err("db_error", "No se pudieron calcular los totales del período.");
  }
}

/** Scope is imposed again inside the INVOKER RPC; client-supplied member IDs cannot widen it. */
export async function readFinanceMovements(bounds: FinanceBounds, filter: MovementFilter,
  cursor: MovementCursor | null = null, checkRevision = false): Promise<Result<MovementPage>> {
  try {
    const query = filter.query.trim();
    const hashes = query ? [...new Set([...blindIndexCandidatos(query, bounds.organizationId), ...blindIndexCandidatos(query)])] : [];
    const db = await createSupabaseServerClient();
    const { data, error } = await db.rpc("finanzas_movements", {
      p_organization: bounds.organizationId, p_start: bounds.startUtc, p_end: bounds.endUtc,
      p_status: filter.status, p_query: query, p_hashes: hashes, p_amount_cents: parseAmountCents(query),
      p_before_created: cursor?.createdAt ?? null, p_before_id: cursor?.id ?? null,
      p_limit: checkRevision ? 100 : 50, p_check_revision: checkRevision,
    });
    if (error || !data || !Array.isArray(data.rows) || !Number.isSafeInteger(data.total_count)
      || data.total_count < data.rows.length || data.rows.length > (checkRevision ? 100 : 50)
      || typeof data.has_more !== "boolean" || (data.has_more && data.rows.length === 0)) {
      return err("db_error", "No se pudieron leer los movimientos del período.");
    }
    const raw = data.rows as RawMovement[];
    const rows: FinanzasTransaccion[] = raw.map((r) => {
      centsInteger(r.cents);
      const names = [r.nombre_cifrado, r.apellido_cifrado].map((value) => value ? decryptColumn(value) : "");
      return {
        id: r.id, fecha: r.fecha, paciente: names.filter(Boolean).join(" ") || "Paciente",
        servicio: r.servicio, monto: Number(r.cents) / 100, montoCents: r.cents,
        metodo: METHODS[r.metodo] ?? "otro", estado: r.estado === "PAGADO" ? "cobrado" : "pendiente",
      };
    });
    const last = raw.at(-1);
    return ok({ rows, totalCount: data.total_count, revision: data.revision,
      nextCursor: data.has_more && last ? { createdAt: last.created_at, id: last.id } : null });
  } catch {
    // Includes unreadable ciphertext: never silently export a replacement patient name.
    return err("db_error", "No se pudieron leer los movimientos del período.");
  }
}
