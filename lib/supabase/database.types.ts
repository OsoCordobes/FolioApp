/**
 * Folio · tipos de la DB.
 *
 * STUB DE F3: tipos manuales mínimos de las tablas más usadas. El archivo
 * completo se regenera cuando levantemos Supabase local:
 *
 *   pnpm exec supabase gen types typescript --local > lib/supabase/database.types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Role = "OWNER" | "DIRECTOR" | "PROFESIONAL" | "COORDINADOR" | "ASISTENTE";
type Alcance = "TODOS" | "EQUIPO" | "LISTA_PROFESIONALES";
type CondicionIva = "MONOTRIBUTO" | "RESPONSABLE_INSCRIPTO" | "EXENTO";
type TipoPaciente = "NUEVO" | "RECURRENTE";
type EstadoTurno =
  | "AGENDADO" | "CONFIRMADO" | "EN_SALA" | "ATENDIENDO"
  | "CERRADO" | "NO_ASISTIO" | "CANCELADO" | "REAGENDADO";
type OrigenTurno = "MANUAL" | "BOOKING" | "WALK_IN" | "GOOGLE" | "WHATSAPP";
type TipoServicioCanonico =
  | "CONSULTA_INICIAL" | "SEGUIMIENTO_ESTANDAR" | "SEGUIMIENTO_EXTENDIDO"
  | "PACK_SESIONES" | "SERVICIO_ESPECIALIZADO";

// ─── Row types (planos, sin auto-referencia) ───────────────────────────────

interface OrganizationRow {
  id: string;
  slug: string;
  nombre: string;
  rubro: string | null;
  ciudad: string | null;
  provincia: string | null;
  timezone: string;
  moneda: string;
  acento_hex: string;
  tema: string;
  cuit: string | null;
  razon_social: string | null;
  condicion_iva: CondicionIva;
  punto_venta_afip: number | null;
  certificado_arca_cifrado: Buffer | null;
  opt_out_analytics: boolean;
  opt_out_public_listing: boolean;
  // M20 · public-card fields + onboarding tracking
  telefono_publico: string | null;
  direccion_completa: string | null;
  instagram_handle: string | null;
  bio: string | null;
  onboarding_completed: boolean;
  onboarding_step_max: number;
  // M21 · card personalization
  logo_url: string | null;
  card_mood: "calido" | "clinico" | "editorial" | "boutique";
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ProfileRow {
  id: string;
  email: string;
  nombre_cifrado: Buffer;
  apellido_cifrado: Buffer;
  matricula: string | null;
  // M23 · Ley 25.326 art. 14 explicit consent at signup
  consent_pii_signed_at: string;       // timestamptz NOT NULL via CHECK
  consent_pii_text_version: string;    // NOT NULL via CHECK
  consent_pii_ip: string | null;       // inet
  consent_pii_user_agent: string | null;
  avatar_url: string | null;
  two_factor_enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface MemberRow {
  id: string;
  organization_id: string;
  profile_id: string;
  role: Role;
  alcance: Alcance;
  profesionales_gestionados: string[];
  equipo_id: string | null;
  es_colegiado: boolean;
  invited_by_id: string | null;
  accepted_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ServicioRow {
  id: string;
  organization_id: string;
  nombre: string;
  tipo_canonico: TipoServicioCanonico;
  duracion_min: number;
  precio_cents: number;
  color: string | null;
  para_nuevos: boolean;
  es_paquete: boolean;
  sesiones_paquete: number | null;
  activo: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DisponibilidadRow {
  id: string;
  organization_id: string;
  member_id: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
  activa: boolean;
  vigencia_desde: string;
  vigencia_hasta: string | null;
  created_at: string;
}

interface PacienteRow {
  id: string;
  organization_id: string;
  identidad_id: string | null;
  motivo_consulta_cifrado: Buffer | null;
  notas_importantes_cifrado: Buffer | null;
  tipo: TipoPaciente;
  tags: string[];
  profesional_principal_id: string | null;
  caja_fuerte_profesional: string | null;
  deleted_at: string | null;
  deleted_by_id: string | null;
  deleted_reason: string | null;
  pseudonimizado_en: string | null;
  created_at: string;
  updated_at: string;
}

interface TurnoRow {
  id: string;
  organization_id: string;
  paciente_id: string;
  servicio_id: string;
  profesional_id: string;
  inicio: string;
  duracion_min: number;
  estado: EstadoTurno;
  origen: OrigenTurno;
  precio_cents: number;
  gcal_event_id: string | null;
  atendiendo_desde: string | null;
  duracion_real_min: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Database shape ────────────────────────────────────────────────────────

export interface Database {
  public: {
    Tables: {
      organization: {
        Row: OrganizationRow;
        Insert: Pick<OrganizationRow, "slug" | "nombre"> & Partial<Omit<OrganizationRow, "slug" | "nombre">>;
        Update: Partial<OrganizationRow>;
      };
      profile: {
        Row: ProfileRow;
        Insert: Pick<ProfileRow, "id" | "email" | "nombre_cifrado" | "apellido_cifrado"> &
          Partial<Omit<ProfileRow, "id" | "email" | "nombre_cifrado" | "apellido_cifrado">>;
        Update: Partial<ProfileRow>;
      };
      member: {
        Row: MemberRow;
        Insert: Pick<MemberRow, "organization_id" | "profile_id"> &
          Partial<Omit<MemberRow, "organization_id" | "profile_id">>;
        Update: Partial<MemberRow>;
      };
      servicio: {
        Row: ServicioRow;
        Insert: Pick<ServicioRow, "organization_id" | "nombre" | "tipo_canonico" | "duracion_min" | "precio_cents"> &
          Partial<Omit<ServicioRow, "organization_id" | "nombre" | "tipo_canonico" | "duracion_min" | "precio_cents">>;
        Update: Partial<ServicioRow>;
      };
      disponibilidad_profesional: {
        Row: DisponibilidadRow;
        Insert: Pick<DisponibilidadRow, "organization_id" | "member_id" | "dia_semana" | "hora_inicio" | "hora_fin"> &
          Partial<Omit<DisponibilidadRow, "organization_id" | "member_id" | "dia_semana" | "hora_inicio" | "hora_fin">>;
        Update: Partial<DisponibilidadRow>;
      };
      paciente: {
        Row: PacienteRow;
        Insert: Pick<PacienteRow, "organization_id"> & Partial<Omit<PacienteRow, "organization_id">>;
        Update: Partial<PacienteRow>;
      };
      turno: {
        Row: TurnoRow;
        Insert: Pick<TurnoRow, "organization_id" | "paciente_id" | "servicio_id" | "profesional_id" | "inicio" | "duracion_min" | "precio_cents"> &
          Partial<Omit<TurnoRow, "organization_id" | "paciente_id" | "servicio_id" | "profesional_id" | "inicio" | "duracion_min" | "precio_cents">>;
        Update: Partial<TurnoRow>;
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      pseudonimizar_paciente: {
        Args: { p_paciente_id: string; p_motivo: string; p_dry_run?: boolean };
        Returns: Json;
      };
      soft_delete_paciente: {
        Args: { p_paciente_id: string; p_motivo: string };
        Returns: void;
      };
      restore_paciente: {
        Args: { p_paciente_id: string };
        Returns: void;
      };
    };
    Enums: {
      role: Role;
      alcance: Alcance;
      condicion_iva: CondicionIva;
      tipo_paciente: TipoPaciente;
      estado_turno: EstadoTurno;
      origen_turno: OrigenTurno;
      tipo_servicio_canonico: TipoServicioCanonico;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
