/**
 * Folio · especialidades · contrato del slot clínico (Fase B).
 *
 * Cada especialidad aporta una herramienta (Tool) que se renderiza en el tab
 * "Plan" de la ficha del paciente. La interfaz está congelada desde Fase B
 * para que las herramientas de cardiología/psicología (Fase D) se construyan
 * contra el mismo contrato sin tocar el slot.
 *
 * `toolData` es opaco para el slot: cada especialidad lo valida con su schema
 * zod (ver lib/especialidades/meta.ts) y lo persiste cifrado app-side en
 * `sesion.tool_data_cifrado` (M50).
 */

/** Una entrada del historial clínico para la herramienta (sesión pasada). */
export interface ToolHistorialEntry {
  /** Fecha de la sesión (YYYY-MM-DD, derivada de sesion.created_at). */
  fecha: string;
  /** Payload de la herramienta de esa sesión (descifrado o fallback legacy). */
  toolData: unknown;
  /**
   * `sesion.tool_id` persistido (M50) — permite filtrar el historial por la
   * herramienta activa en fichas mixtas (M55, filtrarToolHistorial). Opcional
   * por compat: ausente/null = fila legacy pre-M50 (quiropraxia implícita).
   */
  toolId?: string | null;
}

/** Props que el slot clínico le pasa a la Tool de la especialidad activa. */
export interface SpecialtyToolProps {
  /** toolData actual (borrador de la sesión en curso) o null si no hay. */
  value: unknown;
  /** El Tool avisa cada cambio local con el toolData completo nuevo. */
  onChange(next: unknown): void;
  /** true = sesión bloqueada / sin permisos de edición. */
  readOnly?: boolean;
  /** Sesiones previas, ordenadas DESC por fecha (la más reciente primero). */
  historial: ToolHistorialEntry[];
  // ─── Campos OPCIONALES (Workstream 6) ────────────────────────────────────
  // Aditivos: las Tools de cardio/psico los ignoran. Los usa la Tool de
  // quiropraxia v2 (galería de radiografías + carry-forward gateado por turno).
  /** Id del paciente de la ficha — para adjuntar radiografías. */
  pacienteId?: string;
  /**
   * Turno en curso (subset de PlanData.turnoActivo): habilita el adjunto de
   * radiografías (necesitan una sesión guardada) y gatea el carry-forward.
   */
  turno?: { id: string; tieneSesionGuardada: boolean } | null;
  /** Galería de radiografías del paciente (signed URLs de vida corta). */
  radiografias?: ReadonlyArray<{
    id: string;
    fecha: string;
    descripcion: string | null;
    signedUrl: string;
    sesionId: string | null;
  }>;
  /**
   * Edad del paciente (años). La usa cardiología en el score de riesgo CV
   * (scoreRiesgoCV suma riesgo si edad ≥ 60); quiro/psico la ignoran.
   */
  edad?: number;
}

// ─── Intake avanzado por especialidad (Workstream 5) ──────────────────────────
//
// El alta de paciente tiene una sección "Información avanzada (opcional)" cuyos
// campos dependen de la especialidad (anamnesis del quiropráctico; sets de
// factores/antecedentes para cardio/psico). El form los renderiza dinámicamente
// desde `campos`; el writer (lib/db/paciente-intake.ts) valida los datos contra
// `schema` antes de cifrarlos en paciente_intake_avanzado.datos_cifrado (M60).
//
// Server-safe: este módulo no importa React. Cada config vive en
// lib/especialidades/<slug>/intake.ts y se enchufa en ESPECIALIDADES_META.

/** Tipo de control del form para un campo del intake avanzado. */
export type IntakeCampoTipo = "text" | "textarea" | "boolean" | "select";

/** Un campo del intake avanzado — describe el control y su label es-AR. */
export interface IntakeCampo {
  /** Clave del campo (== clave en el schema zod y en el JSON persistido). */
  key: string;
  /** Label es-AR para el form y la vista read-only de la ficha. */
  label: string;
  /** Tipo de control a renderizar. */
  tipo: IntakeCampoTipo;
  /** Opciones para `tipo: "select"` (ignorado en el resto). */
  opciones?: readonly string[];
}

/**
 * Config del intake avanzado de una especialidad.
 *
 * `schema` es un objeto zod de campos OPCIONALES (NO .strict — additive-friendly:
 * sumar un campo nuevo no invalida filas viejas, y claves desconocidas se
 * stripean en vez de rechazar). El writer valida `datos` contra este schema
 * server-side, sea cual sea el valor que mande el cliente.
 */
export interface IntakeAvanzadoConfig {
  /** Schema zod de campos opcionales (string/boolean) keyeado por campo.key. */
  schema: import("zod").ZodType;
  /** Campos a renderizar, en orden. */
  campos: readonly IntakeCampo[];
}

// ─── SOAP guiado por especialidad (C9) ────────────────────────────────────────
//
// Andamiaje VISUAL, opcional, sobre las 4 secciones del SOAP (Subjetivo /
// Objetivo / Análisis / Plan) de la ficha del paciente (SoapStacked en
// components/paciente/paciente-detalle.tsx). ADITIVO: el texto libre del SOAP no
// cambia — la guía solo agrega un prompt y/o un checklist de recordatorios
// arriba de cada textarea, adaptados a la práctica de la especialidad.
//
// No persiste nada: es metadata estática de la especialidad, no PHI ni parte del
// toolData. Cada especialidad completa las secciones que quiera (todas
// opcionales); las que omite quedan sin guía y muestran solo el textarea, igual
// que hoy.

/** Ids de las secciones del SOAP — deben coincidir con SOAP_SECTIONS de la ficha. */
export type SoapSeccionId = "subjetivo" | "objetivo" | "analisis" | "plan";

/** Guía de una sección del SOAP: un prompt y/o un checklist de recordatorios. */
export interface SoapSeccionGuia {
  /**
   * Frase orientadora es-AR, un renglón, que enmarca qué registrar en esta
   * sección para la especialidad (ej. "Motivo de consulta y síntomas
   * cardiovasculares actuales"). Se muestra debajo del hint genérico.
   */
  prompt?: string;
  /**
   * Recordatorios accionables (checklist visual, no interactivo) de qué no
   * olvidar en esta sección. Andamiaje: el profesional escribe libre igual.
   */
  checklist?: readonly string[];
}

/**
 * Guía SOAP de una especialidad: mapa parcial sección → guía. Todas las
 * secciones son opcionales; una especialidad puede guiar solo las que aporten
 * valor. Sin `soapGuia` en el meta, la ficha renderiza el SOAP como siempre.
 */
export type SoapGuia = Partial<Record<SoapSeccionId, SoapSeccionGuia>>;
