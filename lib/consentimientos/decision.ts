import { z } from "zod";

export const DECISION_MODES = ["PENDIENTE", "AUTONOMO", "ASISTIDO", "REPRESENTADO"] as const;
export type DecisionMode = (typeof DECISION_MODES)[number];
export const decisionSchema = z.object({
  modo: z.enum(DECISION_MODES),
  fundamento: z.string().trim().min(20).max(2000),
  participacion: z.string().trim().min(10).max(2000),
  riesgo: z.enum(["EVALUADO", "REQUIERE_REVISION"]),
  tutorId: z.string().uuid().nullable(),
}).superRefine((value, ctx) => {
  if (value.modo !== "PENDIENTE" && value.riesgo !== "EVALUADO") ctx.addIssue({ code: "custom", message: "Revisá el acto y sus riesgos antes de atribuir una firma." });
  if (["ASISTIDO", "REPRESENTADO"].includes(value.modo) && !value.tutorId) ctx.addIssue({ code: "custom", message: "Elegí una representación verificada y vigente." });
  if (["AUTONOMO", "PENDIENTE"].includes(value.modo) && value.tutorId) ctx.addIssue({ code: "custom", message: "La decisión autónoma corresponde al paciente." });
});
export type DecisionInput = z.infer<typeof decisionSchema>;
export function validateDecision(input: unknown) {
  const result = decisionSchema.safeParse(input);
  return result.success ? { ok: true as const, data: result.data } : { ok: false as const, message: result.error.issues[0]?.message ?? "Revisá la evaluación del consentimiento." };
}
export function signatureParticipants(mode: DecisionMode): Array<"PACIENTE" | "REPRESENTANTE"> {
  return mode === "AUTONOMO" ? ["PACIENTE"] : mode === "ASISTIDO" ? ["PACIENTE", "REPRESENTANTE"] : mode === "REPRESENTADO" ? ["REPRESENTANTE"] : [];
}
export function representationAllows(value: {
  estado: string; vigenciaDesde: string | null; vigenciaHasta: string | null;
  revocadoEn: string | null; alcances: string[]; identidadVerificada: boolean; vinculoVerificado: boolean;
}, scope: string, today: string): boolean {
  return value.estado === "VERIFICADA" && !value.revocadoEn && value.identidadVerificada && value.vinculoVerificado
    && value.vigenciaDesde !== null && value.vigenciaDesde <= today
    && value.vigenciaHasta !== null && value.vigenciaHasta >= today
    && value.alcances.includes(scope) && ["CONSENTIMIENTO", "AGENDA", "ENTREGA_REVISADA"].includes(scope);
}
export function argentinaDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Cordoba", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
