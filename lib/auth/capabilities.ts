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

// ─── Matriz rol × capacidad (vista legible, X4) ─────────────────────────────

/**
 * Una columna de la matriz: un rol de la organización. DIRECTOR se desdobla en
 * dos columnas (colegiado / administrativo) porque `esColegiado` cambia su
 * acceso clínico — mostrar solo una escondería justo esa diferencia, que es lo
 * más importante de explicarle a quien dirige una clínica.
 */
export interface MatrixColumn {
  /** Clave estable (para React keys / tests). */
  key: string;
  role: Role;
  esColegiado: boolean;
  /** Encabezado corto de la columna (roleLabel). */
  label: string;
  /** Descripción de una línea del alcance del rol. */
  descripcion: string;
}

/**
 * Las columnas de la matriz, en orden jerárquico (mayor → menor alcance). Es la
 * misma jerarquía del docstring de `Role`, con DIRECTOR desdoblado.
 */
export const PERMISSION_MATRIX_COLUMNS: readonly MatrixColumn[] = [
  {
    key: "OWNER",
    role: "OWNER",
    esColegiado: true,
    label: roleLabel("OWNER", true),
    descripcion: "Titular de la cuenta — acceso total.",
  },
  {
    key: "DIRECTOR_colegiado",
    role: "DIRECTOR",
    esColegiado: true,
    label: roleLabel("DIRECTOR", true),
    descripcion: "Dirige y además atiende: gestión clínica y administrativa.",
  },
  {
    key: "DIRECTOR_admin",
    role: "DIRECTOR",
    esColegiado: false,
    label: roleLabel("DIRECTOR", false),
    descripcion: "Dirección administrativa: equipo y finanzas, sin datos clínicos.",
  },
  {
    key: "PROFESIONAL",
    role: "PROFESIONAL",
    esColegiado: true,
    label: roleLabel("PROFESIONAL", false),
    descripcion: "Su agenda, sus pacientes y sus finanzas.",
  },
  {
    key: "COORDINADOR",
    role: "COORDINADOR",
    esColegiado: false,
    label: roleLabel("COORDINADOR", false),
    descripcion: "Coordinación de agendas, sin datos clínicos ni finanzas.",
  },
  {
    key: "ASISTENTE",
    role: "ASISTENTE",
    esColegiado: false,
    label: roleLabel("ASISTENTE", false),
    descripcion: "Recepción: agenda, contacto del paciente y cobros.",
  },
] as const;

/**
 * Una fila de la matriz: una capacidad legible por humanos y el selector puro
 * que la lee de `Capabilities`. El `select` es la ÚNICA fuente de verdad de cada
 * celda — así la matriz nunca puede divergir de `capabilitiesFor` (ni de la RLS
 * que esta espeja). Las filas se agrupan por área para que se lea de un vistazo.
 */
export interface MatrixRow {
  key: keyof Capabilities;
  label: string;
  /** Aclaración corta de qué significa poder hacer esto. */
  detalle: string;
  select: (c: Capabilities) => boolean;
}

export interface MatrixGroup {
  titulo: string;
  filas: readonly MatrixRow[];
}

/**
 * Las capacidades agrupadas por área funcional, en el orden en que se muestran.
 * Se eligen las que le importan a quien compra/gestiona (qué ve y qué toca cada
 * rol); se omiten los flags derivados o puramente internos (`canSeeFinanzas` =
 * All||Own, `actsAcrossProfessionals`, `isReception`) que no aportan a la lectura.
 */
export const PERMISSION_MATRIX_GROUPS: readonly MatrixGroup[] = [
  {
    titulo: "Datos clínicos",
    filas: [
      {
        key: "canReadClinical",
        label: "Ver ficha clínica (PHI)",
        detalle: "Sesiones, diagnósticos e historia clínica del paciente.",
        select: (c) => c.canReadClinical,
      },
      {
        key: "canCreatePacienteClinical",
        label: "Crear ficha clínica",
        detalle: "Dar de alta un paciente con datos clínicos.",
        select: (c) => c.canCreatePacienteClinical,
      },
    ],
  },
  {
    titulo: "Pacientes y agenda",
    filas: [
      {
        key: "canReadAdmin",
        label: "Ver agenda y turnos",
        detalle: "Calendario, turnos y contacto administrativo.",
        select: (c) => c.canReadAdmin,
      },
      {
        key: "canManagePacienteContact",
        label: "Editar contacto del paciente",
        detalle: "Datos de contacto (nombre, teléfono) — PII.",
        select: (c) => c.canManagePacienteContact,
      },
    ],
  },
  {
    titulo: "Finanzas",
    filas: [
      {
        key: "canSeeFinanzasAll",
        label: "Ver finanzas de la organización",
        detalle: "Ingresos de todo el equipo.",
        select: (c) => c.canSeeFinanzasAll,
      },
      {
        key: "canSeeFinanzasOwn",
        label: "Ver finanzas propias",
        detalle: "Solo los ingresos generados por uno mismo.",
        select: (c) => c.canSeeFinanzasOwn,
      },
      {
        key: "canRegistrarCobro",
        label: "Registrar cobros",
        detalle: "Cobrar al cerrar un turno.",
        select: (c) => c.canRegistrarCobro,
      },
    ],
  },
  {
    titulo: "Administración",
    filas: [
      {
        key: "canManageTeam",
        label: "Gestionar el equipo",
        detalle: "Invitar, cambiar rol y dar de baja miembros.",
        select: (c) => c.canManageTeam,
      },
      {
        key: "canManageOrgSettings",
        label: "Editar la configuración",
        detalle: "Datos de la organización, identidad e integraciones.",
        select: (c) => c.canManageOrgSettings,
      },
      {
        key: "canSeeAudit",
        label: "Ver el registro de auditoría",
        detalle: "Bitácora de accesos y cambios (10 años).",
        select: (c) => c.canSeeAudit,
      },
    ],
  },
] as const;

/**
 * Resuelve una celda de la matriz (fila × columna) a un booleano, evaluando el
 * selector de la fila contra las capacidades reales de esa columna. Función pura
 * y testeable: es el puente entre la tabla de presentación y `capabilitiesFor`.
 */
export function matrixCell(row: MatrixRow, col: MatrixColumn): boolean {
  return row.select(capabilitiesFor(col.role, col.esColegiado));
}
