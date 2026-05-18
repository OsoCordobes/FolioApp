/**
 * Folio · mock data
 *
 * Port directo de folio/data.js del prototipo. Mantiene los mismos IDs y
 * cadenas para garantizar paridad visual pixel-perfect contra los baselines.
 *
 * Se reemplaza por datos reales (Supabase + Prisma) a partir de F4.
 */

import { migrateTurnoLegacy } from "./turno-states";
import type {
  Bloqueo,
  CargaDiaMes,
  CargaDiaSemana,
  ConsultorioInfo,
  Feriado,
  GoogleSyncInfo,
  HistorialSesiones,
  PacientesById,
  Pedido,
  Turno,
  TurnoSemana,
} from "./types";

// ─── Header / contexto del consultorio ──────────────────────────────────────

export const HOY = "2026-05-13";
export const FECHA_LARGA = "miércoles 13 de mayo";
export const FECHA_CORTA = "mié 13 may";
export const FECHA_ISO = "2026-05-13";

export const CONSULTORIO: ConsultorioInfo = {
  profesional: "Lorenzo Martínez",
  rubro: "Quiropraxia",
  matricula: "M.N. ACA 8942",
  ciudad: "Alta Gracia",
};

export const GOOGLE_SYNC: GoogleSyncInfo = {
  conectado: true,
  lastSync: "hace 2 min",
};

export const RESERVAS_PENDIENTES = 4;

// ─── Pacientes ──────────────────────────────────────────────────────────────

export const PACIENTES: PacientesById = {
  1: { nombre: "Carlos Vega",    tipo: "nuevo",      sesiones: 0, edad: 42, genero: "M",
       motivo: "Dolor lumbar hace 3 meses · jornadas largas en escritorio.", tags: ["Dolor lumbar crónico"],
       notasImportantes: "", telefono: "+54 9 351 555 1842" },
  2: { nombre: "María Sánchez",  tipo: "recurrente", sesiones: 4, edad: 38, genero: "F",
       motivo: "Cervicalgia crónica + contractura trapecio bilateral.",     tags: ["Migrañas crónicas"],
       notasImportantes: "Alergia a ibuprofeno — no recetar AINEs derivados.",
       telefono: "+54 9 351 555 2901" },
  3: { nombre: "Diego Peralta",  tipo: "recurrente", sesiones: 2, edad: 51, genero: "M",
       motivo: "Hernia L4-L5 confirmada. Ciática bilateral.",               tags: ["Postoperatorio"],
       notasImportantes: "Evitar manipulación L4-L5 forzada y tracción agresiva. Coordinar con Dr. Mendieta (cirujano).",
       telefono: "+54 9 351 555 3315" },
  4: { nombre: "Ana Romero",     tipo: "nuevo",      sesiones: 0, edad: 29, genero: "F",
       motivo: "Migrañas 2-3 / semana. Sospecha origen cervical.",          tags: ["Migrañas crónicas"],
       notasImportantes: "", telefono: "+54 9 351 555 4408" },
  5: { nombre: "Roberto Flores", tipo: "recurrente", sesiones: 8, edad: 47, genero: "M",
       motivo: "Postura · escritorio. Hiperlordosis + escoliosis leve.",    tags: ["Postura · escritorio"],
       notasImportantes: "", telefono: "+54 9 351 555 5512" },
  6: { nombre: "Valentina Cruz", tipo: "recurrente", sesiones: 3, edad: 33, genero: "F",
       motivo: "Lumbalgia deportiva. Trail runner competitiva.",            tags: ["Deportista"],
       notasImportantes: "", telefono: "+54 9 351 555 6620" },
  7: { nombre: "Martín López",   tipo: "nuevo",      sesiones: 0, edad: 35, genero: "M",
       motivo: "Contractura cervical tras accidente leve hace 2 semanas.",  tags: ["Postoperatorio"],
       notasImportantes: "Maniobras cervicales rápidas: contraindicadas hasta evaluación radiológica completa.",
       telefono: "+54 9 351 555 7733" },
};

// ─── Turnos del día (estados iniciales) ─────────────────────────────────────
// Pre-pago implícito: todos los turnos en agenda ya están cobrados.
// El monto suma a KPIs cuando el turno pasa a 'cerrado'.

const TURNOS_HOY_RAW: Turno[] = [
  { id: 1, hora: "09:00", pacienteId: 1, servicio: "Consulta inicial", precio: 35000,
    estado: "cerrado", duracionMin: 58,
    postVisita: { guardada: true, enviadaWhatsApp: true, ts: "2026-05-13T10:05:00",
                  memo: "Carlos, gracias por venir. Reposo relativo esta tarde, mañana actividad normal. Te dejé en WhatsApp el video del ejercicio que hablamos." },
    gcal: true },

  { id: 2, hora: "10:00", pacienteId: 2, servicio: "Seguimiento", precio: 22000,
    estado: "cerrado", duracionMin: 42,
    postVisita: { guardada: true, enviadaWhatsApp: true, ts: "2026-05-13T10:50:00",
                  memo: "María, sesión muy productiva. Seguí con el estiramiento de trapecios 2 veces al día. Nos vemos en 2 semanas." },
    gcal: true },

  { id: 3, hora: "11:00", pacienteId: 3, servicio: "Seguimiento", precio: 22000,
    estado: "atendiendo", duracionMin: null, atendiendoDesde: null,
    postVisita: { guardada: false }, gcal: true },

  { id: 4, hora: "12:00", pacienteId: 4, servicio: "Consulta inicial", precio: 35000,
    estado: "confirmado", duracionMin: null,
    postVisita: { guardada: false }, gcal: true },

  { id: 5, hora: "15:00", pacienteId: 5, servicio: "Seguimiento", precio: 22000,
    estado: "confirmado", duracionMin: null,
    postVisita: { guardada: false }, gcal: true },

  { id: 6, hora: "16:00", pacienteId: 6, servicio: "Seguimiento", precio: 22000,
    estado: "agendado", duracionMin: null,
    postVisita: { guardada: false }, gcal: false },

  { id: 7, hora: "17:00", pacienteId: 7, servicio: "Consulta inicial", precio: 35000,
    estado: "agendado", duracionMin: null,
    postVisita: { guardada: false }, gcal: true },
];

/**
 * Inicializa atendiendoDesde a ~38 minutos atrás para que el cronómetro tenga
 * un valor realista al renderizar (no arranca en 00:00). Coincide con el
 * boot del prototipo, pero parametrizable para SSR estable.
 */
export function bootAtendiendoDesde(turnos: Turno[], now: Date = new Date()): Turno[] {
  return turnos.map((t) => {
    if (t.estado !== "atendiendo" || t.atendiendoDesde) return t;
    const since = new Date(now);
    since.setMinutes(since.getMinutes() - 38);
    since.setSeconds(since.getSeconds() - 14);
    return { ...t, atendiendoDesde: since.toISOString() };
  });
}

/** Versión normalizada (post-migration) de los turnos de hoy. */
export const TURNOS_HOY: Turno[] = TURNOS_HOY_RAW.map(migrateTurnoLegacy);

// ─── Carga semanal (header strip · sparkline opcional) ──────────────────────

export const CARGA_SEMANAL: CargaDiaSemana[] = [
  { dia: "L", pct: 100, esHoy: false },
  { dia: "M", pct:  87, esHoy: false },
  { dia: "M", pct:  87, esHoy: true  },
  { dia: "J", pct:  62, esHoy: false },
  { dia: "V", pct:  75, esHoy: false },
  { dia: "S", pct:   0, esHoy: false, cerrado: true },
  { dia: "D", pct:   0, esHoy: false, cerrado: true },
];

// ─── Turnos de la semana actual (11–17 may) ─────────────────────────────────
// origen: 'google' = sync desde Google Calendar (booking via web del profesional);
// ausente = turno creado manualmente en Folio (paciente que llamó / mensaje directo).

export const TURNOS_SEMANA: TurnoSemana[] = [
  // Lun 11 — cerrado / completados
  { id: 101, fecha: "2026-05-11", hora: "09:00", dur: 45, pacienteId: 1, servicio: "Consulta inicial", estado: "cerrado", origen: "google" },
  { id: 102, fecha: "2026-05-11", hora: "10:00", dur: 45, pacienteId: 2, servicio: "Seguimiento",      estado: "cerrado" },
  { id: 103, fecha: "2026-05-11", hora: "11:00", dur: 45, pacienteId: 5, servicio: "Seguimiento",      estado: "cerrado" },
  { id: 104, fecha: "2026-05-11", hora: "15:00", dur: 45, pacienteId: 6, servicio: "Deportiva",        estado: "cerrado" },
  { id: 105, fecha: "2026-05-11", hora: "16:00", dur: 45, pacienteId: 3, servicio: "Seguimiento",      estado: "cerrado" },
  { id: 106, fecha: "2026-05-11", hora: "17:00", dur: 45, pacienteId: 4, servicio: "Consulta inicial", estado: "cerrado", origen: "google" },
  { id: 107, fecha: "2026-05-11", hora: "18:00", dur: 45, pacienteId: 7, servicio: "Seguimiento",      estado: "cerrado", origen: "google" },

  // Mar 12
  { id: 111, fecha: "2026-05-12", hora: "09:00", dur: 45, pacienteId: 5, servicio: "Seguimiento",      estado: "cerrado" },
  { id: 112, fecha: "2026-05-12", hora: "10:00", dur: 45, pacienteId: 1, servicio: "Seguimiento",      estado: "cerrado", origen: "google" },
  { id: 113, fecha: "2026-05-12", hora: "11:00", dur: 45, pacienteId: 6, servicio: "Deportiva",        estado: "cerrado" },
  { id: 114, fecha: "2026-05-12", hora: "15:00", dur: 45, pacienteId: 3, servicio: "Seguimiento",      estado: "cerrado" },
  { id: 115, fecha: "2026-05-12", hora: "16:00", dur: 45, pacienteId: 2, servicio: "Seguimiento",      estado: "cerrado" },
  { id: 116, fecha: "2026-05-12", hora: "17:00", dur: 45, pacienteId: 4, servicio: "Consulta inicial", estado: "no_asistio", origen: "google" },

  // Mié 13 — HOY (mirror de turnos actuales)
  { id: 201, fecha: "2026-05-13", hora: "09:00", dur: 45, pacienteId: 1, servicio: "Consulta inicial", estado: "cerrado",    origen: "google" },
  { id: 202, fecha: "2026-05-13", hora: "10:00", dur: 45, pacienteId: 2, servicio: "Seguimiento",      estado: "cerrado" },
  { id: 203, fecha: "2026-05-13", hora: "11:00", dur: 45, pacienteId: 3, servicio: "Seguimiento",      estado: "atendiendo" },
  { id: 204, fecha: "2026-05-13", hora: "12:00", dur: 45, pacienteId: 4, servicio: "Consulta inicial", estado: "confirmado", origen: "google" },
  { id: 205, fecha: "2026-05-13", hora: "15:00", dur: 45, pacienteId: 5, servicio: "Seguimiento",      estado: "confirmado" },
  { id: 206, fecha: "2026-05-13", hora: "16:00", dur: 45, pacienteId: 6, servicio: "Seguimiento",      estado: "agendado" },
  { id: 207, fecha: "2026-05-13", hora: "17:00", dur: 45, pacienteId: 7, servicio: "Consulta inicial", estado: "agendado",   origen: "google" },

  // Jue 14
  { id: 301, fecha: "2026-05-14", hora: "09:30", dur: 45, pacienteId: 2, servicio: "Seguimiento",      estado: "confirmado" },
  { id: 302, fecha: "2026-05-14", hora: "10:30", dur: 45, pacienteId: 5, servicio: "Seguimiento",      estado: "confirmado" },
  { id: 303, fecha: "2026-05-14", hora: "11:30", dur: 45, pacienteId: 3, servicio: "Seguimiento",      estado: "confirmado" },
  { id: 304, fecha: "2026-05-14", hora: "15:00", dur: 45, pacienteId: 4, servicio: "Consulta inicial", estado: "agendado",   origen: "google" },
  { id: 305, fecha: "2026-05-14", hora: "17:00", dur: 45, pacienteId: 6, servicio: "Deportiva",        estado: "agendado" },

  // Vie 15
  { id: 401, fecha: "2026-05-15", hora: "09:00", dur: 45, pacienteId: 1, servicio: "Seguimiento",      estado: "confirmado", origen: "google" },
  { id: 402, fecha: "2026-05-15", hora: "10:00", dur: 45, pacienteId: 7, servicio: "Consulta inicial", estado: "confirmado", origen: "google" },
  { id: 403, fecha: "2026-05-15", hora: "11:30", dur: 45, pacienteId: 6, servicio: "Deportiva",        estado: "agendado" },
  { id: 404, fecha: "2026-05-15", hora: "15:30", dur: 45, pacienteId: 3, servicio: "Seguimiento",      estado: "agendado" },
  { id: 405, fecha: "2026-05-15", hora: "16:30", dur: 45, pacienteId: 2, servicio: "Seguimiento",      estado: "confirmado" },
  // Sáb 16, Dom 17 — cerrado (sin turnos)
];

// ─── Bloqueos (de Google Calendar) ──────────────────────────────────────────

export const BLOQUEOS: Bloqueo[] = [
  { fecha: "2026-05-14", hora: "12:00", dur: 60, titulo: "Reunión con contador", origen: "google" },
  { fecha: "2026-05-15", hora: "17:30", dur: 30, titulo: "Llamada con Daisy",    origen: "google" },
];

// ─── Pedidos entrantes (Inbox unificado con Calendario) ─────────────────────

export const PEDIDOS: Pedido[] = [
  {
    id: "p1", canal: "web", estado: "pendiente",
    nombre: "Lucía Fernández", tel: "+54 9 351 488-2211", email: "luciafer@gmail.com",
    nuevo: true,
    fecha: "2026-05-14", hora: "15:30", dur: 60,
    servicio: "Consulta inicial", precio: 35000,
    motivo: "Dolor cervical persistente desde hace 2 meses, peor por la mañana. Trabajo todo el día frente a la computadora.",
    recibidoHace: "hace 2 días",
  },
  {
    id: "p2", canal: "web", estado: "pendiente",
    nombre: "Mateo Aguirre", tel: "+54 9 351 422-7733", email: "mateoagui@hotmail.com",
    nuevo: true,
    fecha: "2026-05-15", hora: "14:30", dur: 60,
    servicio: "Consulta inicial", precio: 35000,
    motivo: "Lumbalgia tras levantar mucho peso en el gimnasio. Sensación de bloqueo al inclinarse.",
    recibidoHace: "hace 1 día",
  },
  {
    id: "p3", canal: "whatsapp", estado: "pendiente",
    nombre: "María Sánchez", tel: "+54 9 351 488-7711",
    nuevo: false, pacienteId: 2,
    fecha: "2026-05-13", hora: "14:00", dur: 45,
    servicio: "Seguimiento", precio: 22000,
    motivo: "María quiere mover el seguimiento del 20 al 22. Vía WA.",
    recibidoHace: "hace 4 horas",
  },
  {
    id: "p4", canal: "instagram", estado: "pendiente",
    nombre: "Tomás Acuña", tel: "+54 9 351 466-3399",
    nuevo: true,
    fecha: null, hora: null, dur: 60,
    servicio: "Consulta inicial", precio: 35000,
    motivo: "\"Hola Lorenzo, vi tu instagram. ¿Tenés algún turno la semana que viene? Tengo dolor cervical desde hace un mes.\"",
    recibidoHace: "hace 1 hora",
  },
  {
    id: "p5", canal: "web", estado: "confirmado",
    nombre: "Javier Romero", tel: "+54 9 351 477-2255", email: "jromero@gmail.com",
    nuevo: true,
    fecha: "2026-05-18", hora: "16:00", dur: 60,
    servicio: "Consulta inicial", precio: 35000,
    motivo: "Migrañas recurrentes. Quisiera evaluar origen cervical.",
    recibidoHace: "hace 3 días",
    confirmadoEn: "2026-05-13T09:14:00",
  },
  {
    id: "p6", canal: "whatsapp", estado: "reagendado",
    nombre: "Sebastián Carrizo", tel: "+54 9 351 411-9988",
    nuevo: false, pacienteId: 3,
    fecha: "2026-05-15", hora: "09:00", dur: 45,
    propuesta: { fecha: "2026-05-16", hora: "11:00" },
    servicio: "Seguimiento", precio: 22000,
    motivo: "No tenía espacio el 15. Propuesta para el 16 a las 11.",
    recibidoHace: "hace 1 día",
  },
  {
    id: "p7", canal: "instagram", estado: "rechazado",
    nombre: "Anónimo", tel: "+54 9 ???",
    nuevo: true,
    fecha: null, hora: null,
    dur: 0,
    servicio: "Consulta inicial", precio: 35000,
    motivo: "Spam. Promocionaba un producto.",
    recibidoHace: "hace 3 días",
  },
];

// ─── Feriados ──────────────────────────────────────────────────────────────

export const FERIADOS: Feriado[] = [
  { fecha: "2026-05-25", nombre: "Día de la Revolución", tipo: "nacional" },
];

// ─── Carga del mes (mayo 2026) — pct ocupación por día ──────────────────────

function buildCargaMes(): CargaDiaMes[] {
  const arr: CargaDiaMes[] = [];
  for (let d = 1; d <= 31; d++) {
    const date = new Date(2026, 4, d); // mayo = 4
    const dow = date.getDay();
    const fecha = `2026-05-${String(d).padStart(2, "0")}`;
    let pct = 0;
    let count = 0;
    let estado: CargaDiaMes["estado"] = "normal";
    if (dow === 0 || dow === 6) {
      estado = "cerrado";
    } else if (d === 25) {
      estado = "feriado";
    } else {
      const seed = (d * 17 + 3) % 100;
      pct = 50 + (seed % 51);
      count = Math.round(pct / 14);
    }
    if (d === 13) { pct = 87;  count = 7; estado = "hoy"; }
    if (d === 11) { pct = 100; count = 8; }
    if (d === 12) { pct = 87;  count = 7; }
    if (d === 14) { pct = 62;  count = 5; }
    if (d === 15) { pct = 75;  count = 6; }
    arr.push({ d, fecha, dow, pct, count, estado });
  }
  return arr;
}

export const CARGA_MES: CargaDiaMes[] = buildCargaMes();

// ─── Historial clínico de sesiones pasadas ─────────────────────────────────
// Por pacienteId, ordenado de más reciente a más antigua.

export const HISTORIAL_SESIONES: HistorialSesiones = {
  1: [],

  2: [
    { id: "h2-4", fecha: "2026-04-30", hora: "10:00", dur: 42, servicio: "Seguimiento",
      vertebras: [{ id: "C4", estado: "ajustada" }, { id: "C5", estado: "ajustada" }, { id: "T1", estado: "leve" }],
      evaAntes: 4, evaDespues: 3,
      soap: {
        s: "Refiere mejora sostenida. Migraña 1 episodio leve la última semana (vs 3 hace un mes). Duerme mejor.",
        o: "Trapecio bilateral con tensión leve. Movilidad cervical completa, sin dolor a la palpación profunda en C4-C5.",
        a: "Buena respuesta al plan. Se mantiene tendencia descendente de EVA y frecuencia migrañosa.",
        p: "Espaciar a 3 semanas. Mantener ejercicios de movilidad escapular en casa."
      },
      notas: "Trajo registro de migrañas del mes — se lo pego en ficha.",
      postVisita: { guardada: true, memo: "Excelente progreso María. Vemos para mantención en 3 semanas. Seguí con los estiramientos de la mañana.", enviadaWhatsApp: true, ts: "2026-04-30T10:48:00" } },

    { id: "h2-3", fecha: "2026-04-16", hora: "10:00", dur: 45, servicio: "Seguimiento",
      vertebras: [{ id: "C4", estado: "ajustada" }, { id: "C5", estado: "ajustada" }, { id: "C6", estado: "leve" }],
      evaAntes: 5, evaDespues: 4,
      soap: {
        s: "Mejor que la semana pasada. Tuvo una migraña fuerte el sábado, posible asociación a estrés laboral.",
        o: "C4-C5 con menor restricción. Trapecio derecho con punto gatillo activo.",
        a: "Evolución positiva. Punto gatillo trapecio derecho como foco residual.",
        p: "Trabajo miofascial sobre trapecio. Próxima sesión seguimiento en 2 semanas."
      },
      notas: "",
      postVisita: { guardada: false, memo: "", enviadaWhatsApp: false, ts: null } },

    { id: "h2-2", fecha: "2026-03-26", hora: "10:00", dur: 50, servicio: "Seguimiento",
      vertebras: [{ id: "C4", estado: "ajustada" }, { id: "C5", estado: "ajustada" }, { id: "C6", estado: "moderado" }],
      evaAntes: 7, evaDespues: 5,
      soap: {
        s: "Cervicalgia persiste pero menos intensa. Despierta sin dolor 3 de 7 días.",
        o: "C5 con leve disminución de la restricción respecto a sesión 1. Trapecio bilateral hipertónico.",
        a: "Respuesta clínica esperada para sesión 2. Trapecio sigue siendo el principal generador.",
        p: "Continuar plan. Sumar técnica de inhibición de trapecios."
      },
      notas: "",
      postVisita: { guardada: true, memo: "Bien María. La rutina de respiración antes de dormir te va a ayudar con el trapecio. Nos vemos en 3 semanas.", enviadaWhatsApp: true, ts: "2026-03-26T11:05:00" } },

    { id: "h2-1", fecha: "2026-03-12", hora: "10:00", dur: 58, servicio: "Consulta inicial",
      vertebras: [{ id: "C5", estado: "severo" }, { id: "C6", estado: "severo" }, { id: "C4", estado: "moderado" }, { id: "T1", estado: "moderado" }],
      evaAntes: 8, evaDespues: 7,
      soap: {
        s: "Cervicalgia hace más de 2 años. Migrañas 2-3 por semana, peor con stress. Trabajo de oficina full-time.",
        o: "Restricción severa C5-C6. Trapecio bilateral muy hipertónico. Postura adelantada de cabeza.",
        a: "Cuadro de cervicalgia crónica con componente postural marcado. Migrañas probablemente cervicogénicas.",
        p: "Plan inicial de 4 sesiones quincenales. Reevaluar."
      },
      notas: "Primera visita. Trajo RMN de 2024 — sin hallazgos quirúrgicos.",
      postVisita: { guardada: false, memo: "", enviadaWhatsApp: false, ts: null } },
  ],

  3: [
    { id: "h3-2", fecha: "2026-04-29", hora: "11:00", dur: 48, servicio: "Seguimiento",
      vertebras: [{ id: "L4", estado: "severo" }, { id: "L5", estado: "moderado" }, { id: "L3", estado: "leve" }],
      evaAntes: 7, evaDespues: 6,
      soap: {
        s: "Ciática derecha sigue presente pero menos intensa. Camina sin claudicar tramos cortos.",
        o: "L4-L5 restricción severa. Test de elevación de pierna recta positivo a 45° (vs 30° hace 2 semanas).",
        a: "Progresión lenta pero positiva. Estabilidad del cuadro radicular.",
        p: "Continuar manejo conservador. Sumar trabajo de core específico."
      },
      notas: "Cirujano confirma seguir conservador 6 semanas más antes de reevaluar quirófano.",
      postVisita: { guardada: true, memo: "Diego, vamos bien. Los ejercicios de gato-camello todos los días. Cualquier dolor agudo me escribís.", enviadaWhatsApp: true, ts: "2026-04-29T11:55:00" } },

    { id: "h3-1", fecha: "2026-04-15", hora: "11:00", dur: 55, servicio: "Consulta inicial",
      vertebras: [{ id: "L4", estado: "severo" }, { id: "L5", estado: "severo" }, { id: "L3", estado: "moderado" }],
      evaAntes: 9, evaDespues: 7,
      soap: {
        s: "Hernia L4-L5 confirmada por RMN hace 6 meses. Ciática bilateral, peor en pierna derecha. No quiere quirófano todavía.",
        o: "Restricción muy importante en L4-L5. Lasègue + bilateral. Hipotrofia del cuádriceps derecho.",
        a: "Cuadro radicular establecido sobre base degenerativa. Indicación conservadora vigente.",
        p: "Plan de 6 sesiones quincenales. Coordinar con cirujano para evaluación conjunta."
      },
      notas: "Postoperatorio descartado por ahora — coordinar con Dr. Mendieta.",
      postVisita: { guardada: false, memo: "", enviadaWhatsApp: false, ts: null } },
  ],

  4: [],

  5: [
    { id: "h5-8", fecha: "2026-04-23", hora: "15:00", dur: 38, servicio: "Seguimiento",
      vertebras: [{ id: "L2", estado: "ajustada" }, { id: "L3", estado: "ajustada" }, { id: "T8", estado: "leve" }],
      evaAntes: 3, evaDespues: 2,
      soap: {
        s: "Sin episodios agudos. Mantiene rutina diaria en casa.",
        o: "Curvas mantenidas. Tono paravertebral simétrico.",
        a: "Mantención adecuada. Paciente adherente al plan.",
        p: "Espaciar a 4 semanas."
      },
      notas: "",
      postVisita: { guardada: true, memo: "Vamos cada mes Roberto. Seguí firme con la silla nueva.", enviadaWhatsApp: true, ts: "2026-04-23T15:42:00" } },

    { id: "h5-7", fecha: "2026-04-02", hora: "15:00", dur: 40, servicio: "Seguimiento",
      vertebras: [{ id: "L2", estado: "leve" }, { id: "L3", estado: "leve" }, { id: "T8", estado: "moderado" }],
      evaAntes: 4, evaDespues: 3,
      soap: { s: "Bien en general. Una semana con dolor dorsal medio tras cambio de silla.", o: "T8-T9 con leve hipersensibilidad. Lumbar estable.", a: "Episodio dorsal autolimitado.", p: "Mantener plan." },
      notas: "", postVisita: { guardada: false, memo: "", enviadaWhatsApp: false, ts: null } },

    { id: "h5-6", fecha: "2026-03-12", hora: "15:00", dur: 42, servicio: "Seguimiento",
      vertebras: [{ id: "L2", estado: "moderado" }, { id: "L3", estado: "leve" }],
      evaAntes: 4, evaDespues: 3,
      soap: { s: "Sin novedades.", o: "Estable.", a: "Mantención.", p: "Seguir cada 3 semanas." },
      notas: "", postVisita: { guardada: true, memo: "Todo en orden Rober.", enviadaWhatsApp: true, ts: "2026-03-12T15:48:00" } },

    { id: "h5-5", fecha: "2026-02-19", hora: "15:00", dur: 44, servicio: "Seguimiento",
      vertebras: [{ id: "L2", estado: "moderado" }, { id: "L3", estado: "moderado" }, { id: "T8", estado: "leve" }],
      evaAntes: 5, evaDespues: 3,
      soap: { s: "Recaída leve por viaje en auto largo.", o: "Lumbar reactiva.", a: "Esperable.", p: "Reforzar ejercicios." },
      notas: "", postVisita: { guardada: false, memo: "", enviadaWhatsApp: false, ts: null } },

    { id: "h5-4", fecha: "2026-01-29", hora: "15:00", dur: 40, servicio: "Seguimiento",
      vertebras: [{ id: "L2", estado: "leve" }, { id: "L3", estado: "leve" }],
      evaAntes: 3, evaDespues: 2,
      soap: { s: "Bien.", o: "Buen tono.", a: "Mantención.", p: "Cada 3 semanas." },
      notas: "", postVisita: { guardada: false, memo: "", enviadaWhatsApp: false, ts: null } },

    { id: "h5-3", fecha: "2026-01-08", hora: "15:00", dur: 45, servicio: "Seguimiento",
      vertebras: [{ id: "L2", estado: "moderado" }, { id: "L3", estado: "moderado" }],
      evaAntes: 5, evaDespues: 3,
      soap: { s: "Vuelta al trabajo, leve aumento de dolor.", o: "Tensión paravertebral lumbar.", a: "Ajuste necesario tras vacaciones.", p: "Retomar frecuencia." },
      notas: "", postVisita: { guardada: false, memo: "", enviadaWhatsApp: false, ts: null } },

    { id: "h5-2", fecha: "2025-12-04", hora: "15:00", dur: 42, servicio: "Seguimiento",
      vertebras: [{ id: "L2", estado: "leve" }, { id: "L3", estado: "leve" }],
      evaAntes: 3, evaDespues: 2,
      soap: { s: "Estable.", o: "Bien.", a: "Mantención.", p: "Continuar." },
      notas: "", postVisita: { guardada: false, memo: "", enviadaWhatsApp: false, ts: null } },

    { id: "h5-1", fecha: "2025-11-13", hora: "15:00", dur: 55, servicio: "Consulta inicial",
      vertebras: [{ id: "L2", estado: "severo" }, { id: "L3", estado: "severo" }, { id: "T8", estado: "moderado" }, { id: "L1", estado: "moderado" }],
      evaAntes: 7, evaDespues: 5,
      soap: {
        s: "Dolor lumbar crónico por postura de escritorio. 10 años en el mismo puesto.",
        o: "Hiperlordosis evidente, escoliosis funcional dextroconvexa leve. L2-L3 muy restringidas.",
        a: "Cuadro mecánico postural compensable.",
        p: "Plan de 6 sesiones quincenales + cambio de silla + pausas activas."
      },
      notas: "Recomendar silla ergonómica.",
      postVisita: { guardada: true, memo: "Roberto, dejé el resumen con los ejercicios en tu WhatsApp. La silla nueva es clave.", enviadaWhatsApp: true, ts: "2025-11-13T16:01:00" } },
  ],

  6: [
    { id: "h6-3", fecha: "2026-04-22", hora: "16:00", dur: 45, servicio: "Seguimiento",
      vertebras: [{ id: "L4", estado: "ajustada" }, { id: "L5", estado: "ajustada" }, { id: "T12", estado: "leve" }],
      evaAntes: 3, evaDespues: 2,
      soap: { s: "Carrera 21k el domingo pasado sin dolor.", o: "Lumbar libre. Excelente movilidad.", a: "Recuperación completa para competencia.", p: "Mantención mensual." },
      notas: "Sub-2h en el 21k — nuevo récord personal.",
      postVisita: { guardada: true, memo: "¡Felicitaciones Valen! Te mandé el video del calentamiento dinámico que hablamos.", enviadaWhatsApp: true, ts: "2026-04-22T16:50:00" } },

    { id: "h6-2", fecha: "2026-04-01", hora: "16:00", dur: 50, servicio: "Seguimiento",
      vertebras: [{ id: "L4", estado: "leve" }, { id: "L5", estado: "moderado" }],
      evaAntes: 5, evaDespues: 3,
      soap: { s: "Mejor que la semana anterior. Carga de entrenamiento controlada.", o: "L5 con leve restricción residual.", a: "Recuperación encaminada.", p: "Próximo control pre-competencia." },
      notas: "", postVisita: { guardada: false, memo: "", enviadaWhatsApp: false, ts: null } },

    { id: "h6-1", fecha: "2026-03-18", hora: "16:00", dur: 60, servicio: "Consulta inicial",
      vertebras: [{ id: "L5", estado: "severo" }, { id: "L4", estado: "moderado" }, { id: "T12", estado: "moderado" }],
      evaAntes: 7, evaDespues: 5,
      soap: {
        s: "Lumbalgia post-entrenamiento de trail largo (35k) hace 2 semanas. Compite en 6 semanas.",
        o: "L5 muy restringida. Hipertonía del cuadrado lumbar derecho. Sacroiliaca derecha sensible.",
        a: "Sobrecarga deportiva sobre base mecánica. Sin alarmas radiculares.",
        p: "Plan de 3 sesiones + ajuste de carga con su entrenador."
      },
      notas: "Coordinar con su entrenador (Pablo).",
      postVisita: { guardada: false, memo: "", enviadaWhatsApp: false, ts: null } },
  ],

  7: [],
};
