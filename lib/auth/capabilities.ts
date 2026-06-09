/**
 * Folio · capability model (M49 / clinic mode)
 *
 * Fuente de verdad ÚNICA para el gating de UI por rol: qué ve cada persona en
 * el sidebar, qué rutas puede abrir, qué acciones muestra cada pantalla. Es un
 * espejo legible de los helpers SQL de RLS (`can_read_clinical`,
 * `can_read_admin`, `user_role_in`, policies de `paciente` / `pago` / `member`),
 * NO un sustituto: la RLS de Postgres sigue siendo el gate real e infranqueable.
 * Si esta tabla y la RLS divergen, gana la RLS — acá solo decidimos qué pintar.
 *
 * Roles (jerárquico, mayor → menor), ver M02:
 *   OWNER       dueño de la cuenta — ve TODO.
 *   DIRECTOR    dirección/administración — admin + finanzas; clínica si es_colegiado.
 *   PROFESIONAL médico/a — su agenda, sus pacientes, sus finanzas.
 *   COORDINADOR coordinación de agendas — sin datos clínicos.
 *   ASISTENTE   secretaría/recepción — agenda + contacto (PII) + cobros, sin clínica.
 *
 * Función pura y testeable (`tests/unit/capabilities.test.ts`).
 */

export type Role = "OWNER" | "DIRECTOR" | "PROFESIONAL" | "COORDINADOR" | "ASISTENTE";

export interface Capabilities {
  /** Lee datos clínicos/PHI (sesiones, diagnósticos, ficha clínica del paciente). */
  canReadClinical: boolean;
  /** Lee datos administrativos (agenda, turnos, contacto del paciente). */
  canReadAdmin: boolean;
  /** Crea/edita el contacto del paciente (PII: nombre, teléfono). Recepción incluida. */
  canManagePacienteContact: boolean;
  /** Crea la ficha clínica del paciente (PHI). Solo roles clínicos. */
  canCreatePacienteClinical: boolean;
  /** Invita y gestiona miembros del equipo (alta, rol, alcance, baja). */
  canManageTeam: boolean;
  /** Edita la configuración de la organización (datos, identidad, integraciones). */
  canManageOrgSettings: boolean;
  /** Ve el registro de auditoría (M34: OWNER + DIRECTOR). */
  canSeeAudit: boolean;
  /** Ve finanzas de TODA la organización (Director/dueño). */
  canSeeFinanzasAll: boolean;
  /** Ve finanzas SOLO de lo propio (cada médico/a lo suyo). */
  canSeeFinanzasOwn: boolean;
  /** ¿Mostrar la sección Finanzas en absoluto? (oculta para recepción). */
  canSeeFinanzas: boolean;
  /** Registra cobros en el cierre de turno (recepción y roles admin/clínicos). */
  canRegistrarCobro: boolean;
  /** Recepción/coordinación: rol sin acceso clínico, centrado en agenda. */
  isReception: boolean;
  /**
   * Actúa sobre la agenda/pacientes de varios profesionales (Director, recepción,
   * coordinación) → la UI ofrece un selector de profesional. Un PROFESIONAL queda
   * acotado a sí mismo y no necesita selector. (En orgs INDEPENDIENTE el caller
   * igual lo oculta porque hay un solo profesional.)
   */
  actsAcrossProfessionals: boolean;
}

/**
 * Capacidades de un rol. `esColegiado` solo cambia el caso DIRECTOR: un Director
 * colegiado (médico que además dirige) ve datos clínicos; un Director puramente
 * administrativo no.
 */
export function capabilitiesFor(role: Role, esColegiado: boolean): Capabilities {
  const isOwner = role === "OWNER";
  const isDirector = role === "DIRECTOR";
  const isProfesional = role === "PROFESIONAL";
  const isCoordinador = role === "COORDINADOR";
  const isAsistente = role === "ASISTENTE";

  // Espejo de can_read_clinical(): OWNER, PROFESIONAL, o DIRECTOR colegiado.
  const canReadClinical = isOwner || isProfesional || (isDirector && esColegiado);

  // Espejo de can_read_admin(): OWNER, DIRECTOR, PROFESIONAL, ASISTENTE.
  // (COORDINADOR no está en can_read_admin; ve agenda vía scope, no el panel admin.)
  const canReadAdmin = isOwner || isDirector || isProfesional || isAsistente;

  const canManageTeam = isOwner || isDirector;
  const canSeeFinanzasAll = isOwner || isDirector;
  const canSeeFinanzasOwn = isProfesional;
  const isReception = isAsistente || isCoordinador;

  return {
    canReadClinical,
    canReadAdmin,
    // paciente_identidad INSERT (M03): todos los roles activos.
    canManagePacienteContact: true,
    // paciente (PHI) INSERT (M03): OWNER, PROFESIONAL, DIRECTOR.
    canCreatePacienteClinical: isOwner || isProfesional || isDirector,
    canManageTeam,
    canManageOrgSettings: isOwner || isDirector,
    canSeeAudit: isOwner || isDirector,
    canSeeFinanzasAll,
    canSeeFinanzasOwn,
    canSeeFinanzas: canSeeFinanzasAll || canSeeFinanzasOwn,
    canRegistrarCobro: canReadAdmin,
    isReception,
    actsAcrossProfessionals: !isProfesional,
  };
}

/**
 * Etiqueta en español del rol para la UI. DIRECTOR cambia según `esColegiado`:
 * un director colegiado es parte del cuerpo médico ("Dirección médica"); uno
 * administrativo es "Administración".
 */
export function roleLabel(role: Role, esColegiado: boolean): string {
  switch (role) {
    case "OWNER":
      return "Dirección";
    case "DIRECTOR":
      return esColegiado ? "Dirección médica" : "Administración";
    case "PROFESIONAL":
      return "Médico/a";
    case "COORDINADOR":
      return "Coordinación";
    case "ASISTENTE":
      return "Secretaría";
  }
}
