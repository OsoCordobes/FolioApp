/**
 * Folio · Pacientes (directorio) · mock data.
 *
 * Port del array `PACIENTES_DIR` en folio/pacientes-dir.jsx (10-46).
 * Es un set ampliado de lo que vive en `lib/mock-data.ts` para mostrar
 * la tabla del directorio (estados activo/inactivo/pausa/alta, sesiones,
 * próximo turno, etiquetas).
 *
 * En F4 se reemplaza por una query a `Paciente` + join con `Turno` para
 * derivar próxima fecha y última visita.
 */

export type EstadoPacienteDir = "activo" | "inactivo" | "pausa" | "alta";

export interface PacienteDir {
  id: number;
  nombre: string;
  tel: string;
  email: string;
  tipo: "nuevo" | "recurrente";
  sesiones: number;
  ultima: string | null; // YYYY-MM-DD
  proximo: string | null;
  tags: string[];
  estado: EstadoPacienteDir;
  motivoCorto: string;
}

export const PACIENTES_DIR: PacienteDir[] = [
  { id: 1, nombre: "Carlos Vega",       tel: "+54 9 351 411-2233", email: "cvega@gmail.com",
    tipo: "nuevo",      sesiones: 1,  ultima: "2026-05-13", proximo: "2026-05-20",
    tags: ["Dolor lumbar crónico"], estado: "activo",  motivoCorto: "Dolor lumbar 3 meses" },
  { id: 2, nombre: "María Sánchez",     tel: "+54 9 351 488-7711", email: "mariasanchez@hotmail.com",
    tipo: "recurrente", sesiones: 4,  ultima: "2026-05-13", proximo: "2026-05-20",
    tags: ["Migrañas crónicas", "VIP"], estado: "activo", motivoCorto: "Cervicalgia crónica" },
  { id: 3, nombre: "Diego Peralta",     tel: "+54 9 351 422-9900", email: "diegoperalta@gmail.com",
    tipo: "recurrente", sesiones: 3,  ultima: "2026-05-13", proximo: "2026-05-20",
    tags: ["Postoperatorio"], estado: "activo", motivoCorto: "Hernia L4-L5 + ciática" },
  { id: 4, nombre: "Ana Romero",        tel: "+54 9 351 455-3344", email: "aromero@yahoo.com.ar",
    tipo: "nuevo",      sesiones: 0,  ultima: null,         proximo: "2026-05-13",
    tags: ["Migrañas crónicas"], estado: "activo", motivoCorto: "Migrañas 2-3/sem · origen cervical" },
  { id: 5, nombre: "Roberto Flores",    tel: "+54 9 351 477-6622", email: "rflores@empresa.com",
    tipo: "recurrente", sesiones: 8,  ultima: "2026-04-29", proximo: null,
    tags: ["Postura · escritorio", "Obra social"], estado: "alta", motivoCorto: "Tratamiento completado · alta" },
  { id: 6, nombre: "Valentina Cruz",    tel: "+54 9 351 433-1100", email: "vcruz@fitness.com",
    tipo: "recurrente", sesiones: 3,  ultima: "2026-05-06", proximo: "2026-05-16",
    tags: ["Deportista", "VIP"], estado: "activo", motivoCorto: "Lumbalgia deportiva" },
  { id: 7, nombre: "Martín López",      tel: "+54 9 351 466-8833", email: "mlopez@gmail.com",
    tipo: "nuevo",      sesiones: 0,  ultima: null,         proximo: "2026-05-13",
    tags: ["Postoperatorio"], estado: "activo", motivoCorto: "Contractura tras accidente" },
  { id: 8, nombre: "Florencia Aguirre", tel: "+54 9 351 477-2255", email: "fagui@gmail.com",
    tipo: "recurrente", sesiones: 3,  ultima: "2026-02-12", proximo: null,
    tags: ["VIP"], estado: "inactivo", motivoCorto: "Cervical recurrente · sin contacto desde feb" },
  { id: 9, nombre: "Andrés Pérez",      tel: "+54 9 351 422-4477", email: "aperez@empresa.com",
    tipo: "recurrente", sesiones: 6,  ultima: "2026-03-15", proximo: null,
    tags: ["Dolor lumbar crónico", "Postura · escritorio"], estado: "inactivo", motivoCorto: "Sedentarismo · sin contacto desde mar" },
  { id: 10, nombre: "Lucía Ibáñez",     tel: "+54 9 351 411-9988", email: "libanez@gmail.com",
    tipo: "recurrente", sesiones: 4,  ultima: "2026-03-22", proximo: null,
    tags: ["Migrañas crónicas", "Embarazada"], estado: "pausa", motivoCorto: "Embarazada · en pausa" },
  { id: 11, nombre: "Pablo Quiroga",    tel: "+54 9 351 488-1100", email: "pquiroga@gmail.com",
    tipo: "recurrente", sesiones: 2,  ultima: "2026-04-12", proximo: null,
    tags: ["Postoperatorio"], estado: "activo", motivoCorto: "Post-cirugía rodilla" },
  { id: 12, nombre: "Sofía Morales",    tel: "+54 9 351 422-5577", email: "smorales@gmail.com",
    tipo: "recurrente", sesiones: 5,  ultima: "2026-04-22", proximo: "2026-05-22",
    tags: ["Deportista"], estado: "activo", motivoCorto: "Cervicalgia + tensión trapecio" },
];

// ─── Helpers para presentación ────────────────────────────────────────────

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export const fmtFechaCorta = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
};

export const iniciales = (n: string): string =>
  n
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const HOY_ISO = "2026-05-13";

export const diasDesde = (iso: string | null): number | null => {
  if (!iso) return null;
  return Math.floor((new Date(HOY_ISO).getTime() - new Date(iso + "T00:00:00").getTime()) / 86400000);
};

export const ESTADO_VIS: Record<EstadoPacienteDir, { lbl: string; color: string }> = {
  activo:   { lbl: "Activo",   color: "var(--green)" },
  inactivo: { lbl: "Inactivo", color: "var(--ink-3)" },
  pausa:    { lbl: "En pausa", color: "var(--amber)" },
  alta:     { lbl: "Alta",     color: "var(--slate)" },
};
