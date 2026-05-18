/**
 * Folio · types del dominio
 *
 * Shapes derivados del prototipo (folio/data.js + folio/turno-states.js).
 * En F2 se conectan con el schema Prisma; por ahora se usan con mock data.
 */

// ─── Turnos ──────────────────────────────────────────────────────────────────

export type EstadoTurno =
  | "agendado"
  | "confirmado"
  | "en_sala"
  | "atendiendo"
  | "cerrado"
  | "no_asistio"
  | "cancelado"
  | "reagendado";

export type OrigenTurno = "google" | "manual" | "whatsapp" | "instagram" | "web" | "walk_in";

export type ActorTurno = "lorenzo" | "sistema" | "profesional";
export type TriggerTurno = "manual" | "auto" | "webhook";

export interface TransicionTurno {
  from: EstadoTurno;
  to: EstadoTurno;
  ts: string; // ISO
  actor: ActorTurno;
  trigger: TriggerTurno;
}

export interface PostVisita {
  guardada: boolean;
  enviadaWhatsApp?: boolean;
  ts?: string | null;
  memo?: string;
  via?: "audio" | "texto";
}

export interface Cobro {
  estado: "pendiente" | "pagado";
  ts: string | null;
}

/**
 * Turno (vista de cliente). Los IDs son strings (UUIDs cuando viene de DB,
 * literales "1"..."N" en mock data legacy). El fetcher server-side traduce
 * `turno_extendido` (M14) a este shape antes de mandarlo al cliente.
 */
export interface Turno {
  id: string;
  hora: string;
  pacienteId: string;
  servicio: string;
  precio: number;
  estado: EstadoTurno;
  duracionMin: number | null;
  duracionRealMin?: number | null;
  atendiendoDesde?: string | null;
  postVisita: PostVisita;
  gcal?: boolean;
  origen?: OrigenTurno;
  transiciones?: TransicionTurno[];
  cobro?: Cobro;
}

/** Turno de la semana / mes (compacto, para grilla de calendario) */
export interface TurnoSemana {
  id: string;
  fecha: string; // YYYY-MM-DD
  hora: string;
  dur: number;
  pacienteId: string;
  servicio: string;
  estado: EstadoTurno;
  origen?: OrigenTurno;
}

// ─── Pacientes ──────────────────────────────────────────────────────────────

export type TipoPaciente = "nuevo" | "recurrente";

export interface Paciente {
  nombre: string;
  tipo: TipoPaciente;
  sesiones: number;
  edad: number;
  genero: "M" | "F";
  motivo: string;
  tags: string[];
  notasImportantes: string;
  telefono: string;
}

export type PacientesById = Record<string, Paciente>;

// ─── Pedidos (Inbox unificado) ──────────────────────────────────────────────

export type CanalPedido = "web" | "whatsapp" | "instagram" | "telefono";
export type EstadoPedido = "pendiente" | "confirmado" | "reagendado" | "rechazado";

export interface Pedido {
  id: string;
  canal: CanalPedido;
  estado: EstadoPedido;
  nombre: string;
  tel: string;
  email?: string;
  nuevo: boolean;
  pacienteId?: string;
  fecha: string | null;
  hora: string | null;
  dur: number;
  servicio: string;
  precio: number;
  motivo: string;
  recibidoHace: string;
  propuesta?: { fecha: string; hora: string };
  confirmadoEn?: string;
}

// ─── Bloqueos (de Google Calendar) ──────────────────────────────────────────

export interface Bloqueo {
  fecha: string;
  hora: string;
  dur: number;
  titulo: string;
  origen: OrigenTurno;
}

// ─── Carga semanal/mensual (sparkline + heatmap) ────────────────────────────

export interface CargaDiaSemana {
  dia: string;
  pct: number;
  esHoy: boolean;
  cerrado?: boolean;
}

export type EstadoDia = "normal" | "cerrado" | "feriado" | "hoy";

export interface CargaDiaMes {
  d: number;
  fecha: string;
  dow: number;
  pct: number;
  count: number;
  estado: EstadoDia;
}

// ─── Historial clínico (sesiones SOAP) ──────────────────────────────────────

export type EstadoVertebra = "ajustada" | "leve" | "moderado" | "severo";

export interface VertebraAjuste {
  id: string; // "C4", "L4", "T8"
  estado: EstadoVertebra;
}

export interface SoapNote {
  s: string;
  o: string;
  a: string;
  p: string;
}

export interface SesionHistorial {
  id: string;
  fecha: string;
  hora: string;
  dur: number;
  servicio: string;
  vertebras: VertebraAjuste[];
  evaAntes: number | null;
  evaDespues: number | null;
  soap: SoapNote;
  notas: string;
  postVisita: PostVisita;
}

export type HistorialSesiones = Record<string, SesionHistorial[]>;

// ─── Misc ───────────────────────────────────────────────────────────────────

export interface ConsultorioInfo {
  profesional: string;
  rubro: string;
  matricula: string;
  ciudad: string;
}

export interface GoogleSyncInfo {
  conectado: boolean;
  lastSync: string;
}

export interface Feriado {
  fecha: string;
  nombre: string;
  tipo: "nacional" | "provincial" | "local";
}

// ─── State machine config (display) ─────────────────────────────────────────

export interface EstadoTurnoConfig {
  label: string;
  dot: string;
  tip: string;
  pulse?: boolean;
}
