/**
 * Folio · Landing — datos de "Ficha clínica por especialidad".
 *
 * Fuente única de la sección `sections/especialidades-ficha.tsx` (patrón
 * faq-data.ts). Solo texto plano. TODO lo listado acá existe en el producto:
 * cada entrada espeja la herramienta real de lib/especialidades/<slug>/ —
 * no listar instrumentos que aún no estén construidos.
 */

export interface EspecialidadFichaItem {
  nombre: string;
  /** Qué registra la ficha de esa especialidad, en una línea. */
  desc: string;
  /** Instrumentos/escala concretos que la herramienta ya trae. */
  instrumentos: string[];
}

export const ESPECIALIDADES_FICHA: EspecialidadFichaItem[] = [
  {
    nombre: "Quiropraxia",
    desc: "Mapa vertebral interactivo con historial por segmento, radiografías adjuntas y SOAP guiado.",
    instrumentos: ["Mapa vertebral", "Radiografías", "SOAP guiado"],
  },
  {
    nombre: "Psicología",
    desc: "Escalas con puntaje automático, evaluación de riesgo y plan de seguridad, sesión a sesión.",
    instrumentos: ["PHQ-9", "GAD-7", "Riesgo + plan de seguridad"],
  },
  {
    nombre: "Cardiología",
    desc: "Panel cardiovascular con tensión y frecuencia, factores de riesgo, medicación y estudios.",
    instrumentos: ["TA · FC", "Factores de riesgo", "Estudios adjuntos"],
  },
  {
    nombre: "Kinesiología",
    desc: "Dolor e índices de outcome con curvas de evolución que muestran la mejora del paciente.",
    instrumentos: ["EVA", "NDI · ODI", "Borg"],
  },
  {
    nombre: "Nutrición",
    desc: "Antropometría longitudinal con IMC derivado, circunferencias y plan alimentario.",
    instrumentos: ["Peso · IMC", "Circunferencias", "Plan alimentario"],
  },
];
