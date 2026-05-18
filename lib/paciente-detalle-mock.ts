/**
 * Folio · /pacientes/[id] · mock data y constantes para la ficha.
 *
 * Port de los datos inline en folio/paciente.jsx (PACIENTE=María Sánchez,
 * PLAN, SPINE_VERTEBRAS, ESTADO_VERT). En F4 cada uno viene de Supabase:
 *  - PACIENTE → Paciente + PacienteIdentidad join
 *  - PLAN → Sesion[] agregadas + tabla PlanTratamiento (modelo en F2)
 *  - SPINE_VERTEBRAS → constante de UI (no es data, es presentación)
 */

export type EstadoVertebra = "normal" | "leve" | "moderado" | "severo" | "ajustada";

export interface SpineVertebra {
  id: string;
  region: "cervical" | "dorsal" | "lumbar";
  x: number;
  y: number;
  w: number;
  h: number;
  tilt: number;
}

export interface SesionPlan {
  fecha: string;
  servicio: string;
  dur: number;
  cambio: string;
  vertebras: string[];
}

export interface PlanData {
  total: number;
  completadas: number;
  frecuencia: string;
  inicio: string;
  proximoControl: string;
  precio: number;
  diagnostico: string;
  vertebrasEstado: Record<string, EstadoVertebra>;
  ultimoAjuste: Record<string, string>;
  soap: { subjetivo: string; objetivo: string; analisis: string; plan: string };
  sesiones: SesionPlan[];
}

interface PacienteDetalle {
  id: number;
  nombre: string;
  tipo: "nuevo" | "recurrente";
  sesiones: number;
  edad: number;
  genero: "F" | "M";
  motivo: string;
  tags: string[];
  notasImportantes: string;
  telefono: string;
  tel: string;
  email: string;
}

export const PACIENTE_DETALLE: PacienteDetalle = {
  id: 2,
  nombre: "María Sánchez",
  tipo: "recurrente",
  sesiones: 4,
  edad: 38,
  genero: "F",
  motivo: "Cervicalgia crónica + contractura trapecio bilateral.",
  tags: ["Migrañas crónicas"],
  notasImportantes: "Alergia a ibuprofeno — no recetar AINEs derivados.",
  telefono: "+54 9 351 555 2901",
  tel: "+54 9 351 488-7711",
  email: "mariasanchez@hotmail.com",
};

export const TURNO_HOY_HORA = "10:00";

export const PLAN: PlanData = {
  total: 12,
  completadas: 4,
  frecuencia: "Semanal",
  inicio: "2026-04-01",
  proximoControl: "2026-05-20",
  precio: 22000,
  diagnostico: "Cervicalgia crónica + contractura trapecio bilateral",
  vertebrasEstado: {
    C3: "leve", C4: "leve", C5: "ajustada",
    T1: "leve", T2: "leve",
  },
  ultimoAjuste: {
    C3: "2026-04-08", C4: "2026-04-22", C5: "2026-05-06",
    T1: "2026-04-22", T2: "2026-04-22",
  },
  soap: {
    subjetivo: "Mejoría sostenida. Dolor 2/10. Refiere mejor sueño y menos rigidez matinal. Continúa con almohada cervical baja indicada en la primera consulta.",
    objetivo:  "Rango cervical 90% normal. Persistencia leve tensión en trapecio derecho. Postura cefálica mejorada respecto a la sesión inicial — comparada con foto del 1 abril, alineación auricular-hombro corregida ~6º.",
    analisis:  "Excelente evolución. Cervicalgia crónica en remisión clínica. La contractura residual en trapecio derecho es la última manifestación y responde bien al ajuste específico de T1-T2.",
    plan:      "Ajuste C3-C5 y T1 esta sesión. Pasaje a mantenimiento mensual a partir de junio. Continuar estiramientos cervicales matutinos. Re-evaluar en 4 semanas (20 may).",
  },
  sesiones: [
    { fecha: "2026-05-06", servicio: "Seguimiento",      dur: 42, cambio: "Dolor 3/10 → 2/10 · C5 ajustada",   vertebras: ["C5"] },
    { fecha: "2026-04-22", servicio: "Seguimiento",      dur: 45, cambio: "C4 + T1-T2 ajustadas · -1 EVA",    vertebras: ["C4", "T1", "T2"] },
    { fecha: "2026-04-08", servicio: "Seguimiento",      dur: 44, cambio: "C3 ajustada · rango cervical 80%", vertebras: ["C3"] },
    { fecha: "2026-04-01", servicio: "Consulta inicial", dur: 60, cambio: "Evaluación inicial · EVA 7/10",    vertebras: [] },
  ],
};

export const ESTADO_VERT: Record<EstadoVertebra, { lbl: string; color: string; ring: string }> = {
  normal:   { lbl: "Normal",         color: "var(--ink-4)", ring: "var(--line)" },
  leve:     { lbl: "Dolor leve",     color: "var(--amber)", ring: "var(--amber)" },
  moderado: { lbl: "Dolor moderado", color: "#8C5A14",      ring: "#8C5A14" },
  severo:   { lbl: "Dolor severo",   color: "var(--red)",   ring: "var(--red)" },
  ajustada: { lbl: "Ajustada",       color: "var(--green)", ring: "var(--green)" },
};

export const SPINE_VERTEBRAS: SpineVertebra[] = [
  { id: "C1", region: "cervical", x: 122, y:  60, w: 26, h: 8,  tilt: -4 },
  { id: "C2", region: "cervical", x: 128, y:  78, w: 28, h: 8,  tilt: -2 },
  { id: "C3", region: "cervical", x: 132, y:  96, w: 30, h: 8,  tilt:  0 },
  { id: "C4", region: "cervical", x: 134, y: 114, w: 30, h: 8,  tilt:  2 },
  { id: "C5", region: "cervical", x: 132, y: 132, w: 30, h: 9,  tilt:  3 },
  { id: "C6", region: "cervical", x: 128, y: 150, w: 32, h: 9,  tilt:  4 },
  { id: "C7", region: "cervical", x: 122, y: 170, w: 34, h: 10, tilt:  5 },
  { id: "T1",  region: "dorsal", x: 114, y: 195, w: 38, h: 11, tilt:  4 },
  { id: "T2",  region: "dorsal", x: 106, y: 220, w: 40, h: 11, tilt:  3 },
  { id: "T3",  region: "dorsal", x:  98, y: 246, w: 42, h: 12, tilt:  2 },
  { id: "T4",  region: "dorsal", x:  92, y: 273, w: 44, h: 12, tilt:  0 },
  { id: "T5",  region: "dorsal", x:  88, y: 300, w: 44, h: 13, tilt: -1 },
  { id: "T6",  region: "dorsal", x:  88, y: 327, w: 46, h: 13, tilt: -2 },
  { id: "T7",  region: "dorsal", x:  92, y: 354, w: 46, h: 14, tilt: -3 },
  { id: "T8",  region: "dorsal", x:  98, y: 380, w: 48, h: 14, tilt: -3 },
  { id: "T9",  region: "dorsal", x: 106, y: 405, w: 50, h: 14, tilt: -3 },
  { id: "T10", region: "dorsal", x: 114, y: 430, w: 52, h: 15, tilt: -3 },
  { id: "T11", region: "dorsal", x: 122, y: 454, w: 54, h: 15, tilt: -2 },
  { id: "T12", region: "dorsal", x: 130, y: 478, w: 56, h: 16, tilt: -1 },
  { id: "L1", region: "lumbar",  x: 138, y: 502, w: 60, h: 17, tilt:  0 },
  { id: "L2", region: "lumbar",  x: 144, y: 524, w: 62, h: 18, tilt:  2 },
  { id: "L3", region: "lumbar",  x: 146, y: 546, w: 64, h: 18, tilt:  3 },
  { id: "L4", region: "lumbar",  x: 142, y: 568, w: 64, h: 19, tilt:  4 },
  { id: "L5", region: "lumbar",  x: 134, y: 588, w: 62, h: 19, tilt:  5 },
];

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const fmtFecha = (iso: string): string => {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
};

export const iniciales = (nombre: string): string =>
  nombre.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
