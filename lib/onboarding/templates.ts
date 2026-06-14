/**
 * Folio · smart defaults del onboarding por rubro profesional.
 *
 * Cuando el user elige rubro en Step 3, pre-llenamos:
 *   - 3 servicios típicos del rubro (con precio sugerido en ARS)
 *   - bio template ("{rubro_humano} en {ciudad}. Atención personalizada...")
 *   - horarios sugeridos del rubro (kinesiología más tarde, psicología distribuido)
 *
 * El user puede editar/borrar libremente — los defaults son punto de partida.
 *
 * Para rubros desconocidos (no listados acá), devolvemos defaults vacíos.
 *
 * Fase C: además de los rubros (display), las ESPECIALIDADES (M50 —
 * arquitecturales, deciden la herramienta clínica) tienen su propio set de
 * servicios template. Step 6 precarga según `organization.especialidad`.
 */

import type { EspecialidadSlug } from "@/lib/especialidades/meta";

export type RubroId =
  | "quiropraxia"
  | "cardiologia"
  | "kinesiologia"
  | "psicologia"
  | "nutricion"
  | "podologia"
  | "fonoaudiologia"
  | "terapia-ocupacional"
  | "osteopatia"
  | "masoterapia"
  | "acupuntura"
  | "otro";

export interface ServicioTemplate {
  nombre: string;
  dur: number;            // duración en minutos
  precioCents: number;    // centavos ARS
  tipoCanonico: string;
}

export interface HorarioTemplate {
  diasActivos: string[];  // ["lun", "mar", "mie", "jue", "vie"]
  franjas: [string, string][]; // [["09:00", "12:00"], ["15:00", "18:00"]]
  slotMin: number;        // duración default de slot
}

export interface RubroTemplate {
  label: string;
  servicios: ServicioTemplate[];
  bioTemplate: (ciudad: string) => string;
  horarios: HorarioTemplate;
}

// ─── Templates por rubro ──────────────────────────────────────────────────

const STANDARD_AM_PM: HorarioTemplate = {
  diasActivos: ["lun", "mar", "mie", "jue", "vie"],
  franjas: [["09:00", "12:00"], ["15:00", "18:00"]],
  slotMin: 30,
};

const STANDARD_AFTERNOON: HorarioTemplate = {
  diasActivos: ["lun", "mar", "mie", "jue", "vie"],
  franjas: [["14:00", "20:00"]],
  slotMin: 45,
};

const STANDARD_FULL_DAY: HorarioTemplate = {
  diasActivos: ["lun", "mar", "mie", "jue", "vie", "sab"],
  franjas: [["08:00", "13:00"], ["14:00", "19:00"]],
  slotMin: 30,
};

const TEMPLATES: Record<RubroId, RubroTemplate> = {
  "quiropraxia": {
    label: "Quiropraxia",
    servicios: [
      { nombre: "Sesión inicial", dur: 60, precioCents: 1500000, tipoCanonico: "CONSULTA_INICIAL" },
      { nombre: "Ajuste de seguimiento", dur: 30, precioCents: 1000000, tipoCanonico: "SEGUIMIENTO_ESTANDAR" },
      { nombre: "Plan mensual (4 sesiones)", dur: 30, precioCents: 3500000, tipoCanonico: "PACK_SESIONES" },
    ],
    bioTemplate: (ciudad) =>
      `Quiropráctica y bienestar postural en ${ciudad}. Atención personalizada para mejorar tu calidad de vida.`,
    horarios: STANDARD_AM_PM,
  },
  "cardiologia": {
    label: "Cardiología",
    servicios: [
      { nombre: "Consulta cardiológica inicial", dur: 40, precioCents: 1800000, tipoCanonico: "CONSULTA_INICIAL" },
      { nombre: "Control cardiológico", dur: 30, precioCents: 1200000, tipoCanonico: "SEGUIMIENTO_ESTANDAR" },
      { nombre: "Electrocardiograma", dur: 20, precioCents: 1000000, tipoCanonico: "SERVICIO_ESPECIALIZADO" },
      { nombre: "Ergometría", dur: 45, precioCents: 2500000, tipoCanonico: "SERVICIO_ESPECIALIZADO" },
    ],
    bioTemplate: (ciudad) =>
      `Cardiología clínica en ${ciudad}. Prevención, diagnóstico y seguimiento cardiovascular.`,
    horarios: STANDARD_AM_PM,
  },
  "kinesiologia": {
    label: "Kinesiología",
    servicios: [
      { nombre: "Evaluación kinésica", dur: 45, precioCents: 1200000, tipoCanonico: "CONSULTA_INICIAL" },
      { nombre: "Sesión de rehabilitación", dur: 45, precioCents: 900000, tipoCanonico: "SEGUIMIENTO_ESTANDAR" },
      { nombre: "Bono 10 sesiones", dur: 45, precioCents: 7500000, tipoCanonico: "PACK_SESIONES" },
    ],
    bioTemplate: (ciudad) =>
      `Kinesiología y rehabilitación física en ${ciudad}. Recuperación y bienestar adaptados a vos.`,
    horarios: STANDARD_AFTERNOON,
  },
  "psicologia": {
    label: "Psicología",
    servicios: [
      { nombre: "Primera consulta", dur: 60, precioCents: 1800000, tipoCanonico: "CONSULTA_INICIAL" },
      { nombre: "Sesión de seguimiento", dur: 50, precioCents: 1500000, tipoCanonico: "SEGUIMIENTO_ESTANDAR" },
      { nombre: "Terapia online", dur: 50, precioCents: 1500000, tipoCanonico: "SEGUIMIENTO_ESTANDAR" },
    ],
    bioTemplate: (ciudad) =>
      `Psicología clínica en ${ciudad}. Espacio terapéutico confidencial, presencial y online.`,
    horarios: {
      diasActivos: ["lun", "mar", "mie", "jue", "vie"],
      franjas: [["10:00", "13:00"], ["16:00", "20:00"]],
      slotMin: 50,
    },
  },
  "nutricion": {
    label: "Nutrición",
    servicios: [
      { nombre: "Primera consulta nutricional", dur: 60, precioCents: 1600000, tipoCanonico: "CONSULTA_INICIAL" },
      { nombre: "Consulta de seguimiento", dur: 30, precioCents: 900000, tipoCanonico: "SEGUIMIENTO_ESTANDAR" },
      { nombre: "Plan trimestral", dur: 30, precioCents: 6000000, tipoCanonico: "PACK_SESIONES" },
    ],
    bioTemplate: (ciudad) =>
      `Nutrición personalizada en ${ciudad}. Plan alimentario adaptado a tu vida y objetivos.`,
    horarios: STANDARD_AM_PM,
  },
  "podologia": {
    label: "Podología",
    servicios: [
      { nombre: "Consulta podológica", dur: 45, precioCents: 1100000, tipoCanonico: "CONSULTA_INICIAL" },
      { nombre: "Tratamiento ortopédico", dur: 60, precioCents: 1500000, tipoCanonico: "SERVICIO_ESPECIALIZADO" },
      { nombre: "Plantillas a medida", dur: 30, precioCents: 4500000, tipoCanonico: "SERVICIO_ESPECIALIZADO" },
    ],
    bioTemplate: (ciudad) =>
      `Podología clínica y estética en ${ciudad}. Cuidamos cada paso que das.`,
    horarios: STANDARD_FULL_DAY,
  },
  "fonoaudiologia": {
    label: "Fonoaudiología",
    servicios: [
      { nombre: "Evaluación fonoaudiológica", dur: 60, precioCents: 1300000, tipoCanonico: "CONSULTA_INICIAL" },
      { nombre: "Sesión de terapia", dur: 45, precioCents: 1000000, tipoCanonico: "SEGUIMIENTO_ESTANDAR" },
      { nombre: "Bono 8 sesiones", dur: 45, precioCents: 7000000, tipoCanonico: "PACK_SESIONES" },
    ],
    bioTemplate: (ciudad) =>
      `Fonoaudiología en ${ciudad}. Acompañamiento profesional en comunicación, lenguaje y audición.`,
    horarios: STANDARD_AM_PM,
  },
  "terapia-ocupacional": {
    label: "Terapia ocupacional",
    servicios: [
      { nombre: "Evaluación inicial", dur: 60, precioCents: 1300000, tipoCanonico: "CONSULTA_INICIAL" },
      { nombre: "Sesión de terapia", dur: 45, precioCents: 1000000, tipoCanonico: "SEGUIMIENTO_ESTANDAR" },
      { nombre: "Bono 6 sesiones", dur: 45, precioCents: 5400000, tipoCanonico: "PACK_SESIONES" },
    ],
    bioTemplate: (ciudad) =>
      `Terapia ocupacional en ${ciudad}. Acompañamos a recuperar autonomía en cada etapa.`,
    horarios: STANDARD_AM_PM,
  },
  "osteopatia": {
    label: "Osteopatía",
    servicios: [
      { nombre: "Primera consulta osteopática", dur: 75, precioCents: 1800000, tipoCanonico: "CONSULTA_INICIAL" },
      { nombre: "Sesión de seguimiento", dur: 45, precioCents: 1300000, tipoCanonico: "SEGUIMIENTO_ESTANDAR" },
      { nombre: "Plan mensual", dur: 45, precioCents: 4500000, tipoCanonico: "PACK_SESIONES" },
    ],
    bioTemplate: (ciudad) =>
      `Osteopatía manual en ${ciudad}. Abordaje integral del cuerpo, sin medicación.`,
    horarios: STANDARD_AM_PM,
  },
  "masoterapia": {
    label: "Masoterapia",
    servicios: [
      { nombre: "Masaje descontracturante", dur: 60, precioCents: 1200000, tipoCanonico: "SERVICIO_ESPECIALIZADO" },
      { nombre: "Masaje relajante", dur: 60, precioCents: 1000000, tipoCanonico: "SERVICIO_ESPECIALIZADO" },
      { nombre: "Bono 5 sesiones", dur: 60, precioCents: 5000000, tipoCanonico: "PACK_SESIONES" },
    ],
    bioTemplate: (ciudad) =>
      `Masoterapia profesional en ${ciudad}. Descontracturas, drenaje y bienestar.`,
    horarios: STANDARD_AFTERNOON,
  },
  "acupuntura": {
    label: "Acupuntura",
    servicios: [
      { nombre: "Consulta inicial", dur: 75, precioCents: 1600000, tipoCanonico: "CONSULTA_INICIAL" },
      { nombre: "Sesión de acupuntura", dur: 45, precioCents: 1100000, tipoCanonico: "SEGUIMIENTO_ESTANDAR" },
      { nombre: "Tratamiento 4 sesiones", dur: 45, precioCents: 4000000, tipoCanonico: "PACK_SESIONES" },
    ],
    bioTemplate: (ciudad) =>
      `Acupuntura terapéutica en ${ciudad}. Medicina tradicional china con visión integrativa.`,
    horarios: STANDARD_AM_PM,
  },
  "otro": {
    label: "Otro",
    servicios: [],
    bioTemplate: (ciudad) => `Consultorio profesional en ${ciudad}.`,
    horarios: STANDARD_AM_PM,
  },
};

// ─── Templates por ESPECIALIDAD (M50 · Fase C) ─────────────────────────────
//
// A diferencia del rubro (texto display de la card pública), la especialidad
// es arquitectural: decide la herramienta clínica de la ficha. Step 6 del
// onboarding precarga estos servicios según la especialidad elegida en Step 3.
// Los tipoCanonico van en el enum real de DB (tipo_servicio_canonico, M09).

/** Valores válidos del enum tipo_servicio_canonico (M09). */
export const TIPOS_CANONICOS_VALIDOS = [
  "CONSULTA_INICIAL",
  "SEGUIMIENTO_ESTANDAR",
  "SEGUIMIENTO_EXTENDIDO",
  "PACK_SESIONES",
  "SERVICIO_ESPECIALIZADO",
] as const;

const ESPECIALIDAD_SERVICIOS: Record<EspecialidadSlug, ServicioTemplate[]> = {
  // Quiropraxia y cardiología comparten el set del rubro homónimo (M59:
  // especialidad y rubro quedan 1:1 con el selector único del onboarding).
  quiropraxia: TEMPLATES.quiropraxia.servicios,
  cardiologia: TEMPLATES.cardiologia.servicios,
  psicologia: [
    { nombre: "Primera entrevista", dur: 50, precioCents: 1800000, tipoCanonico: "CONSULTA_INICIAL" },
    { nombre: "Sesión de psicoterapia", dur: 50, precioCents: 1500000, tipoCanonico: "SEGUIMIENTO_ESTANDAR" },
    { nombre: "Sesión de pareja", dur: 80, precioCents: 2200000, tipoCanonico: "SEGUIMIENTO_EXTENDIDO" },
  ],
};

/**
 * Servicios template para una especialidad (M50). Fallback a quiropraxia para
 * slugs desconocidos — mismo criterio que normalizeEspecialidadSlug.
 */
export function getEspecialidadServicios(slug: string | null | undefined): ServicioTemplate[] {
  if (slug && Object.prototype.hasOwnProperty.call(ESPECIALIDAD_SERVICIOS, slug)) {
    return ESPECIALIDAD_SERVICIOS[slug as EspecialidadSlug];
  }
  return ESPECIALIDAD_SERVICIOS.quiropraxia;
}

/**
 * Firmas (nombres joineados con "|") de todos los sets de servicios template
 * conocidos (rubros + especialidades). El wizard las usa para decidir si el
 * user "no tocó" sus servicios y por lo tanto es seguro pisarlos con un
 * template nuevo al cambiar de rubro/especialidad.
 */
export function getKnownTemplateServiceSignatures(): Set<string> {
  const sigs = new Set<string>();
  for (const tpl of Object.values(TEMPLATES)) {
    if (tpl.servicios.length > 0) {
      sigs.add(tpl.servicios.map((s) => s.nombre).join("|"));
    }
  }
  for (const servicios of Object.values(ESPECIALIDAD_SERVICIOS)) {
    sigs.add(servicios.map((s) => s.nombre).join("|"));
  }
  return sigs;
}

// ─── API pública ──────────────────────────────────────────────────────────

/**
 * Devuelve el template para un rubro. Si el rubro no está listado, devuelve
 * el de "otro" (vacío) en lugar de tirar error — el onboarding tiene que
 * seguir funcionando aunque el user elija "Otro".
 */
export function getRubroTemplate(rubroId: string | undefined | null): RubroTemplate {
  if (!rubroId) return TEMPLATES.otro;
  return TEMPLATES[rubroId as RubroId] ?? TEMPLATES.otro;
}

/**
 * Lista de todos los rubros disponibles para el dropdown del Step 3.
 */
export function listRubros(): Array<{ id: RubroId; label: string }> {
  return Object.entries(TEMPLATES).map(([id, t]) => ({
    id: id as RubroId,
    label: t.label,
  }));
}
