import type { Cobro, Turno } from "@/lib/types";
import type { CloseStatus, PersistedPayment } from "@/lib/turnos/close-contract";

export function paymentToCobro(payment: PersistedPayment | null): Cobro {
  return payment ? { id: payment.id, estado: payment.estado === "PAGADO" ? "pagado" : "pendiente",
    montoCents: payment.montoCents, ts: payment.pagadoTs, updatedAt: payment.updatedAt, metodo: payment.metodo }
    : { estado: "pendiente", ts: null, montoCents: null };
}
export function withCloseStatus(turno: Turno, status: CloseStatus): Turno {
  return { ...turno, estado: status.estado.toLowerCase() as Turno["estado"], cobro: paymentToCobro(status.pago),
    cierreClasificacion: status.clasificacion ?? undefined, cobroPorRevisar: false };
}
export function samePayment(a?: Cobro, b?: Cobro): boolean {
  return a?.id === b?.id && a?.updatedAt === b?.updatedAt && a?.montoCents === b?.montoCents
    && a?.estado === b?.estado && a?.ts === b?.ts && a?.metodo === b?.metodo;
}
/** Shared by ACK and equal-state SSR. Timestamps are evidence, not commit revisions.
 * An authorized read started after the last observation can settle an ambiguity. */
export function mergeFinancialTurno(current: Turno, incoming: Turno, authorizedRead = false): Turno {
  if (authorizedRead) return { ...incoming, cobroPorRevisar: false };
  const result = { ...incoming, cierreClasificacion: incoming.cierreClasificacion ?? current.cierreClasificacion };
  const old = current.cobro, next = incoming.cobro;
  if (samePayment(old, next)) return { ...result, cobroPorRevisar: current.cobroPorRevisar || incoming.cobroPorRevisar };
  if (old?.montoCents == null) return result;
  if (next?.montoCents == null) return { ...result, cobro: old, cobroPorRevisar: true };
  const oldTime = Date.parse(old.updatedAt ?? ""), nextTime = Date.parse(next.updatedAt ?? "");
  const sameValues = old.id && old.id === next.id && old.montoCents === next.montoCents && old.estado === next.estado && old.ts === next.ts && old.metodo === next.metodo;
  if (sameValues && Number.isFinite(oldTime) && Number.isFinite(nextTime)) return { ...result,
    cobro: nextTime > oldTime ? next : old, cobroPorRevisar: current.cobroPorRevisar || incoming.cobroPorRevisar };
  return { ...result, cobro: old, cobroPorRevisar: true };
}
export function closeDuration(turno: Turno, now = Date.now()): number {
  return turno.atendiendoDesde ? Math.round((now - Date.parse(turno.atendiendoDesde)) / 60000) : turno.duracionMin ?? 45;
}
