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
 */

export type RubroId =
  | "quiropraxia"
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
      { nombre: "Sesión inicial", dur: 60, precioCents: 1500000, tipoCanonico: "consulta" },
      { nombre: "Ajuste de seguimiento", dur: 30, precioCents: 1000000, tipoCanonico: "consulta" },
      { nombre: "Plan mensual (4 sesiones)", dur: 30, precioCents: 3500000, tipoCanonico: "paquete" },
    ],
    bioTemplate: (ciudad) =>
      `Quiropráctica y bienestar postural en ${ciudad}. Atención personalizada para mejorar tu calidad de vida.`,
    horarios: STANDARD_AM_PM,
  },
  "kinesiologia": {
    label: "Kinesiología",
    servicios: [
      { nombre: "Evaluación kinésica", dur: 45, precioCents: 1200000, tipoCanonico: "consulta" },
      { nombre: "Sesión de rehabilitación", dur: 45, precioCents: 900000, tipoCanonico: "consulta" },
      { nombre: "Bono 10 sesiones", dur: 45, precioCents: 7500000, tipoCanonico: "paquete" },
    ],
    bioTemplate: (ciudad) =>
      `Kinesiología y rehabilitación física en ${ciudad}. Recuperación y bienestar adaptados a vos.`,
    horarios: STANDARD_AFTERNOON,
  },
  "psicologia": {
    label: "Psicología",
    servicios: [
      { nombre: "Primera consulta", dur: 60, precioCents: 1800000, tipoCanonico: "consulta" },
      { nombre: "Sesión de seguimiento", dur: 50, precioCents: 1500000, tipoCanonico: "consulta" },
      { nombre: "Terapia online", dur: 50, precioCents: 1500000, tipoCanonico: "consulta" },
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
      { nombre: "Primera consulta nutricional", dur: 60, precioCents: 1600000, tipoCanonico: "consulta" },
      { nombre: "Consulta de seguimiento", dur: 30, precioCents: 900000, tipoCanonico: "consulta" },
      { nombre: "Plan trimestral", dur: 30, precioCents: 6000000, tipoCanonico: "paquete" },
    ],
    bioTemplate: (ciudad) =>
      `Nutrición personalizada en ${ciudad}. Plan alimentario adaptado a tu vida y objetivos.`,
    horarios: STANDARD_AM_PM,
  },
  "podologia": {
    label: "Podología",
    servicios: [
      { nombre: "Consulta podológica", dur: 45, precioCents: 1100000, tipoCanonico: "consulta" },
      { nombre: "Tratamiento ortopédico", dur: 60, precioCents: 1500000, tipoCanonico: "consulta" },
      { nombre: "Plantillas a medida", dur: 30, precioCents: 4500000, tipoCanonico: "consulta" },
    ],
    bioTemplate: (ciudad) =>
      `Podología clínica y estética en ${ciudad}. Cuidamos cada paso que das.`,
    horarios: STANDARD_FULL_DAY,
  },
  "fonoaudiologia": {
    label: "Fonoaudiología",
    servicios: [
      { nombre: "Evaluación fonoaudiológica", dur: 60, precioCents: 1300000, tipoCanonico: "consulta" },
      { nombre: "Sesión de terapia", dur: 45, precioCents: 1000000, tipoCanonico: "consulta" },
      { nombre: "Bono 8 sesiones", dur: 45, precioCents: 7000000, tipoCanonico: "paquete" },
    ],
    bioTemplate: (ciudad) =>
      `Fonoaudiología en ${ciudad}. Acompañamiento profesional en comunicación, lenguaje y audición.`,
    horarios: STANDARD_AM_PM,
  },
  "terapia-ocupacional": {
    label: "Terapia ocupacional",
    servicios: [
      { nombre: "Evaluación inicial", dur: 60, precioCents: 1300000, tipoCanonico: "consulta" },
      { nombre: "Sesión de terapia", dur: 45, precioCents: 1000000, tipoCanonico: "consulta" },
      { nombre: "Bono 6 sesiones", dur: 45, precioCents: 5400000, tipoCanonico: "paquete" },
    ],
    bioTemplate: (ciudad) =>
      `Terapia ocupacional en ${ciudad}. Acompañamos a recuperar autonomía en cada etapa.`,
    horarios: STANDARD_AM_PM,
  },
  "osteopatia": {
    label: "Osteopatía",
    servicios: [
      { nombre: "Primera consulta osteopática", dur: 75, precioCents: 1800000, tipoCanonico: "consulta" },
      { nombre: "Sesión de seguimiento", dur: 45, precioCents: 1300000, tipoCanonico: "consulta" },
      { nombre: "Plan mensual", dur: 45, precioCents: 4500000, tipoCanonico: "paquete" },
    ],
    bioTemplate: (ciudad) =>
      `Osteopatía manual en ${ciudad}. Abordaje integral del cuerpo, sin medicación.`,
    horarios: STANDARD_AM_PM,
  },
  "masoterapia": {
    label: "Masoterapia",
    servicios: [
      { nombre: "Masaje descontracturante", dur: 60, precioCents: 1200000, tipoCanonico: "consulta" },
      { nombre: "Masaje relajante", dur: 60, precioCents: 1000000, tipoCanonico: "consulta" },
      { nombre: "Bono 5 sesiones", dur: 60, precioCents: 5000000, tipoCanonico: "paquete" },
    ],
    bioTemplate: (ciudad) =>
      `Masoterapia profesional en ${ciudad}. Descontracturas, drenaje y bienestar.`,
    horarios: STANDARD_AFTERNOON,
  },
  "acupuntura": {
    label: "Acupuntura",
    servicios: [
      { nombre: "Consulta inicial", dur: 75, precioCents: 1600000, tipoCanonico: "consulta" },
      { nombre: "Sesión de acupuntura", dur: 45, precioCents: 1100000, tipoCanonico: "consulta" },
      { nombre: "Tratamiento 4 sesiones", dur: 45, precioCents: 4000000, tipoCanonico: "paquete" },
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
