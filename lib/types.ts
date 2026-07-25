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

/**
 * M72 · modalidad del turno. `presencial` es el default histórico (todo turno
 * previo a telemedicina es presencial). `telemedicina` habilita la sala de
 * videollamada (campos sala_* en turno, poblados por el proveedor en T2).
 */
export type ModalidadTurno = "presencial" | "telemedicina";

/**
 * M72 · normaliza turno.modalidad (lowercase en DB: 'presencial' |
 * 'telemedicina') al tipo UI. Cualquier valor ausente/inesperado cae a
 * 'presencial' (el default histórico) en vez de romper el render. Vive en
 * types.ts (módulo puro, sin imports runtime) para ser testeable sin arrastrar
 * el server client / crypto de los fetchers que la usan.
 */
export function normalizeModalidad(value: string | null | undefined): ModalidadTurno {
  return value === "telemedicina" ? "telemedicina" : "presencial";
}

/**
 * M90 · origen de la transición a CONFIRMADO: 'manual' (staff desde la app) |
 * 'paciente' (1-click desde el email de recordatorio). Las filas previas a
 * M90 quedan NULL en DB (= desconocido) y acá viajan como null/undefined.
 */
export type ConfirmadoVia = "manual" | "paciente";

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
  /**
   * M72 · modalidad del turno (presencial | telemedicina). Default
   * `presencial` cuando la vista no la trae (turnos previos a telemedicina),
   * preservando el comportamiento histórico.
   */
  modalidad?: ModalidadTurno;
  /**
   * M90 · quién confirmó el turno ('manual' staff | 'paciente' 1-click).
   * null/undefined = sin confirmar o fila pre-M90. Alimenta el chip
   * "Confirmó el paciente" en /hoy y el detalle del turno.
   */
  confirmadoVia?: ConfirmadoVia | null;
  transiciones?: TransicionTurno[];
  cobro?: Cobro;
  /** member.id del profesional asignado (turno.profesional_id, vista M14). */
  profesionalId?: string | null;
  /**
   * Display name del profesional — solo viene seteado cuando la vista activa
   * es "Todos" en una org con >1 colegiado (atribución visual). En orgs Solo
   * o con filtro de profesional activo queda null y la card no cambia.
   */
  profesionalNombre?: string | null;
  /**
   * M56 · motivo/aclaraciones del booking público (turno.nota_reserva_cifrado),
   * ya DESENCRIPTADO server-side. Es PHI: el fetcher lo setea SOLO para roles
   * con acceso clínico (canReadClinical); para el resto queda null/undefined y
   * el cliente nunca ve el texto ni el ciphertext.
   */
  notaReserva?: string | null;
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
  /** M72 · modalidad (presencial | telemedicina). Default presencial. */
  modalidad?: ModalidadTurno;
  /** M90 · quién confirmó ('manual' | 'paciente'); null = sin dato (ver Turno). */
  confirmadoVia?: ConfirmadoVia | null;
  /** member.id del profesional asignado (turno.profesional_id, vista M14). */
  profesionalId?: string | null;
  /** Display name — solo seteado en vista "Todos" con >1 colegiado (ver Turno). */
  profesionalNombre?: string | null;
  /**
   * M56 · motivo del booking público (turno.nota_reserva_cifrado) ya
   * DESENCRIPTADO server-side. PHI: el fetcher lo setea SOLO para roles con
   * acceso clínico; para el resto queda null y el cliente nunca lo recibe.
   */
  notaReserva?: string | null;
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
  /**
   * member.id del profesional pedido en el booking (pedido.profesional_id,
   * M43). null/undefined = sin asignar — el PedidoModal exige elegir uno
   * antes de aceptar (CLINICA-3).
   */
  profesionalId?: string | null;
  /**
   * servicio.id del pedido (pedido.servicio_id). null/undefined = sin
   * servicio (WhatsApp/teléfono) — "aceptar con otro horario" exige elegir
   * uno en el picker del PedidoModal.
   */
  servicioId?: string | null;
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
