import type { HorariosSnapshot } from "@/lib/db/configuracion";
/** The setup editor supports a single set of intervals across its active days. */
export function uniformSetupHours(snapshot: HorariosSnapshot): { diasActivos: string[]; franjas: [string,string][] } | null {
  if (snapshot.context.protectedDates) return null;
  const active = Object.entries(snapshot.dias).filter(([,day]) => day.on);
  if (!active.length) return { diasActivos: [], franjas: [] };
  const canonical = (franjas: [string,string][]) => [...franjas].sort((a,b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const first = canonical(active[0][1].franjas);
  if (active.some(([,day]) => JSON.stringify(canonical(day.franjas)) !== JSON.stringify(first))) return null;
  return { diasActivos: active.map(([day]) => day), franjas: first };
}
export function setupHoursWeek(diasActivos: string[], franjas: [string,string][]): HorariosSnapshot["dias"] {
  return Object.fromEntries(["dom","lun","mar","mie","jue","vie","sab"].map(day => [day,{on:diasActivos.includes(day),franjas:diasActivos.includes(day)?structuredClone(franjas):[]}])) as HorariosSnapshot["dias"];
}
