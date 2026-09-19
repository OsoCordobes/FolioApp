import { z } from "zod";

export const paymentMethodSchema = z.enum(["EFECTIVO", "TRANSFERENCIA", "MERCADOPAGO", "TARJETA", "OBRA_SOCIAL", "OTRO"]);
const cents = z.number().int().min(0).max(2147483647);
const timestamp = z.string().datetime({ offset: true });
const uuid = z.string().uuid().transform(value => value.toLowerCase());
// Accept the old dialog's zero-shaped input, but bind only the exact SQL decision.
export const closeDecisionSchema = z.union([
  z.object({ montoCents: z.literal(0), metodo: paymentMethodSchema.optional(), pagado: z.boolean().optional() }).strict()
    .transform(() => ({ montoCents: 0 as const })),
  z.object({ montoCents: cents.min(1), metodo: paymentMethodSchema, pagado: z.boolean() }).strict(),
]);
export type CloseDecision = z.output<typeof closeDecisionSchema>;
export const closeRequestSchema = z.object({
  turnoId: uuid, operacionId: uuid,
  duracionRealMin: z.number().int().min(0).max(480).optional(),
  cobro: closeDecisionSchema.optional(),
}).strict();
export const resolveCloseRequestSchema = closeRequestSchema.omit({ duracionRealMin: true }).extend({ cobro: closeDecisionSchema });
export const closeReceiptRequestSchema = z.discriminatedUnion("action", [
  closeRequestSchema.extend({ action: z.literal("CLOSE") }),
  resolveCloseRequestSchema.extend({ action: z.literal("RESOLVE") }),
]);
export type CloseRequest = z.input<typeof closeRequestSchema>;
export type ResolveCloseRequest = z.input<typeof resolveCloseRequestSchema>;
export type CloseReceiptRequest = z.input<typeof closeReceiptRequestSchema>;

export const persistedPaymentSchema = z.object({
  id: uuid, montoCents: cents, metodo: paymentMethodSchema,
  estado: z.enum(["PAGADO", "PENDIENTE", "PARCIAL"]), pagadoTs: timestamp.nullable(),
  // Real pago.updated_at; transaction-start time, not a commit-order revision.
  updatedAt: timestamp,
}).strict().refine(p => (p.estado === "PAGADO") === (p.pagadoTs !== null));
export type PersistedPayment = z.infer<typeof persistedPaymentSchema>;
export const closeStatusSchema = z.object({
  turnoId: uuid,
  estado: z.enum(["AGENDADO", "CONFIRMADO", "EN_SALA", "ATENDIENDO", "CERRADO", "CANCELADO", "REAGENDADO", "NO_ASISTIO"]),
  closedAt: timestamp.nullable(), origen: z.enum(["AGENDA", "CLINICAL", "LEGACY", "HISTORICO"]).nullable(),
  clasificacion: z.enum(["REQUIERE_REGISTRO", "SIN_CARGO", "REGISTRADO"]).nullable(),
  pago: persistedPaymentSchema.nullable(), puedeRegistrar: z.boolean(),
}).strict();
export type CloseStatus = z.infer<typeof closeStatusSchema>;
export const closeReceiptSchema = closeStatusSchema.extend({
  operationId: uuid, pagoOrigen: z.enum(["CREADO", "EXISTENTE", "SIN_CARGO", "SIN_DECISION"]),
});
export type CloseReceipt = z.infer<typeof closeReceiptSchema>;
export const settlementReceiptSchema = z.object({ turnoId: uuid, alreadyPaid: z.boolean(), pago: persistedPaymentSchema }).strict()
  .refine(r => r.pago.estado === "PAGADO");
export type SettlementReceipt = z.infer<typeof settlementReceiptSchema>;

/** Validate relationships, including the SQL's deliberate coordinator redaction. */
export function validCloseStatus(value: CloseStatus): boolean {
  if (value.estado === "CERRADO") {
    if (!value.origen || !value.clasificacion) return false;
    if ((value.origen === "HISTORICO") !== (value.closedAt === null)) return false;
  } else if (value.origen !== null || value.closedAt !== null || ![null, "REGISTRADO"].includes(value.clasificacion)) return false;
  if (value.pago && (value.clasificacion !== "REGISTRADO" || !value.puedeRegistrar)) return false;
  if (value.clasificacion === "REGISTRADO" && !value.pago && value.puedeRegistrar) return false;
  return true;
}

export function validCloseReceipt(value: CloseReceipt, request: CloseReceiptRequest): boolean {
  if (!validCloseStatus(value) || value.estado !== "CERRADO" || value.turnoId !== request.turnoId || value.operationId !== request.operacionId) return false;
  if (request.action === "CLOSE" && value.origen !== "AGENDA") return false;
  const decision = request.cobro;
  if (decision?.montoCents === 0) return value.puedeRegistrar && value.pagoOrigen === "SIN_CARGO" && value.clasificacion === "SIN_CARGO" && value.pago === null;
  if (decision && decision.montoCents > 0) return ["CREADO", "EXISTENTE"].includes(value.pagoOrigen)
    && value.pago?.montoCents === decision.montoCents && value.pago.metodo === decision.metodo
    && value.pago.estado === (decision.pagado ? "PAGADO" : "PENDIENTE");
  if (value.pagoOrigen === "EXISTENTE") return value.clasificacion === "REGISTRADO";
  return value.pagoOrigen === "SIN_DECISION" && value.clasificacion === "REQUIERE_REGISTRO" && value.pago === null;
}
