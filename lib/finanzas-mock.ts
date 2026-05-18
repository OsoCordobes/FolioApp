/**
 * Folio · /finanzas · mock data.
 *
 * Port de las constantes de folio/finanzas.jsx. En F4 vienen de queries
 * agregadas sobre `Pago` y `Turno` (con RLS por organización).
 */

export const INGRESOS_DIA: [number, number][] = [
  [1, 35000], [2, 57000], [3, 0],     [4, 0],
  [5, 81000], [6, 96000], [7, 74000], [8, 92000], [9, 0], [10, 0],
  [11, 134000], [12, 122000], [13, 57000],
];

export interface ServicioBreakdown {
  id: string;
  nombre: string;
  count: number;
  monto: number;
  color: string;
}

export const SERVICIOS_BREAKDOWN: ServicioBreakdown[] = [
  { id: "inicial", nombre: "Consulta inicial", count:  7, monto: 245000, color: "var(--accent)" },
  { id: "segui",   nombre: "Seguimiento",      count: 15, monto: 330000, color: "var(--green)"  },
  { id: "pack",    nombre: "Pack 5 sesiones",  count:  1, monto:  95000, color: "var(--slate)"  },
  { id: "deport",  nombre: "Deportiva",        count:  3, monto:  78000, color: "var(--amber)"  },
];

export type MetodoPago = "mercadopago" | "transferencia" | "efectivo" | "pendiente";

export interface Transaccion {
  id: number;
  fecha: string;
  paciente: string;
  servicio: string;
  monto: number;
  metodo: MetodoPago;
  estado: "cobrado" | "pendiente";
}

export const TRANSACCIONES: Transaccion[] = [
  { id: 1,  fecha: "2026-05-13T10:50:00", paciente: "María Sánchez",   servicio: "Seguimiento",      monto: 22000, metodo: "mercadopago",   estado: "cobrado" },
  { id: 2,  fecha: "2026-05-13T10:00:00", paciente: "Carlos Vega",     servicio: "Consulta inicial", monto: 35000, metodo: "transferencia", estado: "cobrado" },
  { id: 3,  fecha: "2026-05-12T17:30:00", paciente: "Roberto Flores",  servicio: "Seguimiento",      monto: 22000, metodo: "efectivo",      estado: "cobrado" },
  { id: 4,  fecha: "2026-05-12T16:00:00", paciente: "María Sánchez",   servicio: "Seguimiento",      monto: 22000, metodo: "mercadopago",   estado: "cobrado" },
  { id: 5,  fecha: "2026-05-12T15:00:00", paciente: "Diego Peralta",   servicio: "Seguimiento",      monto: 22000, metodo: "transferencia", estado: "cobrado" },
  { id: 6,  fecha: "2026-05-12T11:00:00", paciente: "Valentina Cruz",  servicio: "Deportiva",        monto: 26000, metodo: "mercadopago",   estado: "cobrado" },
  { id: 7,  fecha: "2026-05-12T10:00:00", paciente: "Carlos Vega",     servicio: "Seguimiento",      monto: 22000, metodo: "mercadopago",   estado: "cobrado" },
  { id: 8,  fecha: "2026-05-11T17:00:00", paciente: "Ana Romero",      servicio: "Consulta inicial", monto: 35000, metodo: "transferencia", estado: "cobrado" },
  { id: 9,  fecha: "2026-05-11T16:00:00", paciente: "Diego Peralta",   servicio: "Seguimiento",      monto: 22000, metodo: "efectivo",      estado: "cobrado" },
  { id: 10, fecha: "2026-05-11T15:00:00", paciente: "Valentina Cruz",  servicio: "Deportiva",        monto: 26000, metodo: "mercadopago",   estado: "cobrado" },
  { id: 11, fecha: "2026-05-10T11:00:00", paciente: "Martín López",    servicio: "Consulta inicial", monto: 35000, metodo: "pendiente",     estado: "pendiente" },
];

export const METODO_LBL: Record<MetodoPago, { lbl: string; color: string }> = {
  mercadopago:   { lbl: "MercadoPago",   color: "var(--slate)" },
  transferencia: { lbl: "Transferencia", color: "var(--ink-2)" },
  efectivo:      { lbl: "Efectivo",      color: "var(--ink-2)" },
  pendiente:     { lbl: "Pendiente",     color: "var(--amber)" },
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const fmtMoney = (n: number | null | undefined): string =>
  "$ " + (n ?? 0).toLocaleString("es-AR");

export const fmtMonth = (n: number): string => {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(".0", "") + "M";
  if (n >= 1000) return Math.round(n / 1000) + "k";
  return n.toString();
};

export const fmtFechaHora = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getDate()} ${MESES[d.getMonth()]} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
