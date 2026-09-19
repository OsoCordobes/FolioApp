import { z } from "zod";

export const movementRequestSchema = z.object({
  periodo: z.enum(["hoy", "semana", "mes", "6m", "anio"]),
  status: z.enum(["todos", "cobrados", "pendientes"]).default("todos"),
  query: z.string().trim().max(120).default(""),
  startUtc: z.string().datetime({ offset: true }),
  endUtc: z.string().datetime({ offset: true }),
  cursor: z.object({ createdAt: z.string().datetime({ offset: true }), id: z.string().uuid() }).nullable().default(null),
}).refine((r) => Date.parse(r.endUtc) > Date.parse(r.startUtc)
  && Date.parse(r.endUtc) - Date.parse(r.startUtc) <= 367 * 86400000);
