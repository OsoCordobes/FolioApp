import { z } from "zod";
import type { HorariosSnapshot } from "@/lib/db/configuracion";
const days = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"] as const;
const schema = z.object({ revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), protectedDates: z.boolean(),
  franjas: z.array(z.object({ dia_semana: z.number().int().min(0).max(6), hora_inicio: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/), hora_fin: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/) })) });
export function decodeAvailabilitySnapshot(raw: unknown, expected: { organizationId: string; memberId: string }): HorariosSnapshot | null {
  const parsed = schema.safeParse(raw); if (!parsed.success) return null;
  const dias = Object.fromEntries(days.map((d) => [d, { on: false, franjas: [] }])) as unknown as HorariosSnapshot["dias"];
  for (const row of parsed.data.franjas) { const day = dias[days[row.dia_semana]]; day.on = true; day.franjas.push([row.hora_inicio.slice(0, 5), row.hora_fin.slice(0, 5)]); }
  return { context: { ...expected, revision: parsed.data.revision, protectedDates: parsed.data.protectedDates }, dias };
}
