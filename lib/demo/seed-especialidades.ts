/**
 * Folio · datos DEMO por especialidad (server-safe, sin React, sin DB).
 *
 * Fuente de los datos que siembra /api/admin/seed-demo: pacientes ficticios
 * coherentes con cada especialidad + payloads de tool_data válidos para la
 * herramienta clínica de cada una. Separado del route handler para que los
 * payloads se puedan validar en tests/unit contra los schemas zod reales
 * (un tool_data inválido en prod = ficha que no renderiza en plena demo).
 *
 * Convenciones:
 *   - Todos los pacientes llevan el tag "MOCK" → borrables en bloque
 *     (mismo mecanismo que scripts/seed-mock-org.mjs).
 *   - Los datos son FICTICIOS: nombres inventados, DNIs fuera de rango real
 *     bajo, teléfonos 351 555-xxxx, emails @example.com. Nunca PHI real.
 *   - quiropraxia escribe el shape v2 vigente; cardiología y psicología usan
 *     los shapes v1 LEGACY (el registry los sigue leyendo vía toolIds — mismo
 *     criterio probado de scripts/seed-mock-org.mjs); kinesiología y
 *     nutrición usan sus v1 vigentes validados acá contra el schema real.
 */

import {
  kinesiologiaToolDataSchema,
} from "@/lib/especialidades/kinesiologia/schema";
import { nutricionToolDataSchema } from "@/lib/especialidades/nutricion/schema";
import { quiropraxiaToolDataV2Schema } from "@/lib/especialidades/quiropraxia/schema";
import type { EspecialidadSlug } from "@/lib/especialidades/meta";

export const DEMO_ORG_SLUG_PREFIX = "demo-";

export function demoOrgSlug(especialidad: EspecialidadSlug): string {
  return `${DEMO_ORG_SLUG_PREFIX}${especialidad}`;
}

const NOMBRES_ORG: Record<EspecialidadSlug, string> = {
  quiropraxia: "Demo · Consultorio de Quiropraxia",
  cardiologia: "Demo · Consultorio de Cardiología",
  psicologia: "Demo · Consultorio de Psicología",
  kinesiologia: "Demo · Consultorio de Kinesiología",
  nutricion: "Demo · Consultorio de Nutrición",
};

export function demoOrgNombre(especialidad: EspecialidadSlug): string {
  return NOMBRES_ORG[especialidad];
}

export interface DemoPacienteSeed {
  nombre: string;
  apellido: string;
  dni: string;
  tel: string;
  email: string;
  nac: string; // YYYY-MM-DD
  sexo: "F" | "M";
  ciudad: string;
  prov: string;
  tipo: "NUEVO" | "RECURRENTE";
  motivo: string;
  notas: string;
  cond: string; // tag de condición (además de MOCK)
}

/** SOAP por especialidad — el mismo texto para todas las sesiones de la org. */
export const SOAP_DEMO: Record<
  EspecialidadSlug,
  { s: string; o: string; a: string; p: string }
> = {
  quiropraxia: {
    s: "Refiere disminución del dolor cervical desde el último ajuste; molestia residual al final del día laboral.",
    o: "Hipertonía paravertebral cervical baja. Restricción leve en rotación derecha.",
    a: "Evolución favorable del cuadro cervical mecánico.",
    p: "Continuar ajustes semanales; pausas activas cada 2 h de escritorio.",
  },
  cardiologia: {
    s: "Asintomático desde el último control. Adhiere a la medicación.",
    o: "TA en consultorio dentro de objetivo. Auscultación sin soplos.",
    a: "HTA controlada, riesgo cardiovascular moderado en descenso.",
    p: "Mantener esquema actual; laboratorio de control en 3 meses.",
  },
  psicologia: {
    s: "Relata mejor manejo de situaciones de estrés laboral esta semana.",
    o: "Discurso organizado, ánimo eutímico, sin ideación de riesgo.",
    a: "Buena respuesta a las estrategias de regulación trabajadas.",
    p: "Continuar frecuencia semanal; registro de pensamientos entre sesiones.",
  },
  kinesiologia: {
    s: "Refiere menor dolor al subir escaleras; rigidez matinal más corta.",
    o: "ROM en progreso respecto de la evaluación inicial. Buena tolerancia a la carga.",
    a: "Evolución esperable del cuadro; sin signos de alarma.",
    p: "Progresar fortalecimiento; ejercicios domiciliarios 3×/semana.",
  },
  nutricion: {
    s: "Buena adherencia al plan; refiere menos picoteo nocturno.",
    o: "Descenso sostenido de peso y perímetro de cintura desde el inicio.",
    a: "Progreso adecuado hacia el objetivo antropométrico.",
    p: "Ajustar colaciones; control en 3 semanas.",
  },
};

/**
 * 6 pacientes ficticios por especialidad, con motivo/condición coherentes.
 * DNIs y teléfonos claramente de fantasía; emails @example.com.
 */
export const PACIENTES_DEMO: Record<EspecialidadSlug, DemoPacienteSeed[]> = {
  quiropraxia: [
    { nombre: "María Laura", apellido: "Gómez", dni: "28456789", tel: "+54 9 351 555 2233", email: "marialaura.gomez@example.com", nac: "1986-03-12", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Cervicalgia y cefaleas tensionales.", notas: "Trabaja muchas horas frente a la computadora.", cond: "Cervicalgia" },
    { nombre: "Jorge", apellido: "Fernández", dni: "20567891", tel: "+54 9 351 555 3344", email: "jorge.fernandez@example.com", nac: "1972-07-25", sexo: "M", ciudad: "Villa Carlos Paz", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Lumbalgia mecánica crónica.", notas: "Antecedente de hernia L4-L5.", cond: "Lumbalgia" },
    { nombre: "Carolina", apellido: "López", dni: "31234987", tel: "+54 9 351 555 6677", email: "carolina.lopez@example.com", nac: "1988-09-09", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Dorsalgia y mala postura.", notas: "Practica running.", cond: "Dorsalgia" },
    { nombre: "Pablo", apellido: "Torres", dni: "25896374", tel: "+54 9 351 555 9900", email: "pablo.torres@example.com", nac: "1979-08-14", sexo: "M", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Ciática derecha.", notas: "Mejora con tracción.", cond: "Ciática" },
    { nombre: "Federico", apellido: "Herrera", dni: "30985217", tel: "+54 9 351 555 1122", email: "federico.herrera@example.com", nac: "1985-10-02", sexo: "M", ciudad: "Alta Gracia", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Contracturas dorsales recurrentes.", notas: "Bruxismo nocturno.", cond: "Contracturas" },
    { nombre: "Julieta", apellido: "Paz", dni: "38765432", tel: "+54 9 351 555 8811", email: "julieta.paz@example.com", nac: "1994-01-30", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "NUEVO", motivo: "Dolor cervical post siniestro vial leve.", notas: "Primera consulta quiropráctica.", cond: "Latigazo" },
  ],
  cardiologia: [
    { nombre: "Diego", apellido: "Romero", dni: "33778452", tel: "+54 9 351 555 5566", email: "diego.romero@example.com", nac: "1990-01-18", sexo: "M", ciudad: "Río Cuarto", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Control de hipertensión arterial.", notas: "Padre con cardiopatía isquémica.", cond: "HTA" },
    { nombre: "Martín", apellido: "Díaz", dni: "27654321", tel: "+54 9 351 555 7788", email: "martin.diaz@example.com", nac: "1983-05-30", sexo: "M", ciudad: "Alta Gracia", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Palpitaciones, descartar arritmia.", notas: "Consumo de café elevado.", cond: "Palpitaciones" },
    { nombre: "Lucía", apellido: "Ramírez", dni: "34567812", tel: "+54 9 351 555 0011", email: "lucia.ramirez@example.com", nac: "1992-04-07", sexo: "F", ciudad: "Jesús María", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Seguimiento de perfil lipídico.", notas: "Dislipemia en tratamiento.", cond: "Dislipemia" },
    { nombre: "Ricardo", apellido: "Aguirre", dni: "16345678", tel: "+54 9 351 555 4321", email: "ricardo.aguirre@example.com", nac: "1963-11-22", sexo: "M", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Control post angioplastia (2024).", notas: "Doble antiagregación hasta 2025; hoy AAS.", cond: "Post-ATC" },
    { nombre: "Norma", apellido: "Benítez", dni: "14789456", tel: "+54 9 351 555 8765", email: "norma.benitez@example.com", nac: "1958-06-15", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Insuficiencia cardíaca en seguimiento.", notas: "Clase funcional II. Control de peso diario.", cond: "ICC" },
    { nombre: "Sebastián", apellido: "Molina", dni: "36912845", tel: "+54 9 351 555 3690", email: "sebastian.molina@example.com", nac: "1993-02-11", sexo: "M", ciudad: "Villa Allende", prov: "Córdoba", tipo: "NUEVO", motivo: "Apto físico deportivo de alta exigencia.", notas: "Corre maratones. Sin antecedentes.", cond: "Apto físico" },
  ],
  psicologia: [
    { nombre: "Sofía", apellido: "Martínez", dni: "39456123", tel: "+54 9 351 555 4455", email: "sofia.martinez@example.com", nac: "1996-11-03", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "NUEVO", motivo: "Estrés y trastornos del sueño.", notas: "Derivada por su médica clínica.", cond: "Ansiedad" },
    { nombre: "Valentina", apellido: "Sánchez", dni: "40123567", tel: "+54 9 351 555 8899", email: "valentina.sanchez@example.com", nac: "1999-12-21", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Cuadro ansioso-depresivo leve.", notas: "Primer tratamiento psicológico.", cond: "Ánimo" },
    { nombre: "Gastón", apellido: "Ibarra", dni: "32654789", tel: "+54 9 351 555 7412", email: "gaston.ibarra@example.com", nac: "1987-04-19", sexo: "M", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Dificultades vinculares y laborales.", notas: "Buen insight; trabaja en turnos rotativos.", cond: "Vincular" },
    { nombre: "Camila", apellido: "Funes", dni: "41258963", tel: "+54 9 351 555 9632", email: "camila.funes@example.com", nac: "2001-08-27", sexo: "F", ciudad: "Río Ceballos", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Ansiedad ante exámenes universitarios.", notas: "Estudiante de abogacía.", cond: "Ansiedad" },
    { nombre: "Hernán", apellido: "Quiroga", dni: "29873456", tel: "+54 9 351 555 1596", email: "hernan.quiroga@example.com", nac: "1982-12-05", sexo: "M", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Duelo reciente.", notas: "Red de apoyo familiar presente.", cond: "Duelo" },
    { nombre: "Paula", apellido: "Vera", dni: "37789123", tel: "+54 9 351 555 7531", email: "paula.vera@example.com", nac: "1995-03-14", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "NUEVO", motivo: "Orientación por cambio de carrera.", notas: "Sin tratamiento previo.", cond: "Orientación" },
  ],
  kinesiologia: [
    { nombre: "Andrés", apellido: "Ludueña", dni: "31478529", tel: "+54 9 351 555 2580", email: "andres.luduena@example.com", nac: "1989-07-08", sexo: "M", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Rehabilitación post reconstrucción de LCA.", notas: "Cirugía hace 4 meses. Fase de fortalecimiento.", cond: "Post-LCA" },
    { nombre: "Marina", apellido: "Cabrera", dni: "35896321", tel: "+54 9 351 555 3691", email: "marina.cabrera@example.com", nac: "1991-10-25", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Cervicalgia con limitación de movilidad.", notas: "Teletrabajo; ergonomía deficiente.", cond: "Cervicalgia" },
    { nombre: "Osvaldo", apellido: "Ferreyra", dni: "17456123", tel: "+54 9 351 555 4682", email: "osvaldo.ferreyra@example.com", nac: "1965-02-17", sexo: "M", ciudad: "Unquillo", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Lumbalgia crónica con episodios agudos.", notas: "ODI inicial moderado; evolución favorable.", cond: "Lumbalgia" },
    { nombre: "Agustina", apellido: "Ríos", dni: "42159753", tel: "+54 9 351 555 5793", email: "agustina.rios@example.com", nac: "2000-05-06", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Esguince de tobillo grado II (vóley).", notas: "Jugadora federada; objetivo: volver a competir.", cond: "Esguince" },
    { nombre: "Rubén", apellido: "Sosa", dni: "22345987", tel: "+54 9 351 555 6804", email: "ruben.sosa@example.com", nac: "1974-09-29", sexo: "M", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Hombro doloroso, síndrome subacromial.", notas: "Trabajo con carga por encima de la cabeza.", cond: "Hombro" },
    { nombre: "Bianca", apellido: "Moreno", dni: "43876542", tel: "+54 9 351 555 7915", email: "bianca.moreno@example.com", nac: "2003-01-12", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "NUEVO", motivo: "Dolor patelofemoral al correr.", notas: "Aumentó volumen de entrenamiento rápido.", cond: "Rodilla" },
  ],
  nutricion: [
    { nombre: "Graciela", apellido: "Peralta", dni: "18654321", tel: "+54 9 351 555 8026", email: "graciela.peralta@example.com", nac: "1967-03-23", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Descenso de peso con diabetes tipo 2.", notas: "HbA1c en descenso. Camina 40 min/día.", cond: "DBT2" },
    { nombre: "Maximiliano", apellido: "Bustos", dni: "33951753", tel: "+54 9 351 555 9137", email: "maximiliano.bustos@example.com", nac: "1990-06-11", sexo: "M", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Recomposición corporal (entrena 4×/semana).", notas: "Objetivo: subir masa magra.", cond: "Recomposición" },
    { nombre: "Elena", apellido: "Villalba", dni: "26789432", tel: "+54 9 351 555 0248", email: "elena.villalba@example.com", nac: "1980-11-02", sexo: "F", ciudad: "Villa Carlos Paz", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Hipotiroidismo y sobrepeso.", notas: "TSH compensada; plan hipocalórico moderado.", cond: "Hipotiroidismo" },
    { nombre: "Franco", apellido: "Giordano", dni: "38246813", tel: "+54 9 351 555 1359", email: "franco.giordano@example.com", nac: "1996-08-19", sexo: "M", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Colesterol elevado, cambio de hábitos.", notas: "Antecedente familiar de dislipemia.", cond: "Dislipemia" },
    { nombre: "Rosario", apellido: "Alem", dni: "40852963", tel: "+54 9 351 555 2460", email: "rosario.alem@example.com", nac: "1998-04-04", sexo: "F", ciudad: "Córdoba", prov: "Córdoba", tipo: "RECURRENTE", motivo: "Alimentación vegetariana equilibrada.", notas: "Controlar B12 y hierro anual.", cond: "Vegetariana" },
    { nombre: "Héctor", apellido: "Nievas", dni: "20987654", tel: "+54 9 351 555 3571", email: "hector.nievas@example.com", nac: "1971-12-28", sexo: "M", ciudad: "Córdoba", prov: "Córdoba", tipo: "NUEVO", motivo: "Descenso de peso indicado por cardiología.", notas: "Derivado; HTA en tratamiento.", cond: "Descenso" },
  ],
};

// ─── tool_data por especialidad ─────────────────────────────────────────────
//
// quiropraxia v2 / kinesiología v1 / nutrición v1 se validan contra el schema
// zod real (throw temprano si el shape driftea). cardiología/psicología van en
// shape v1 LEGACY (leído vía toolIds del registry) — mismos payloads probados
// del script seed-mock-org.mjs.

export interface DemoSesionPayload {
  toolId: string;
  data: Record<string, unknown>;
}

function quiroToolData(i: number): DemoSesionPayload {
  const data = {
    v: 2 as const,
    vista: "posterior",
    vertebras: [
      { id: "C2", tecnicaAjuste: "Toggle recoil" },
      { id: "T6", listado: "PR" },
      { id: "L4", tecnicaAjuste: "Drop", listado: "PLI" },
    ].slice(0, 1 + (i % 3)),
    palpacionEstatica: "Hipertonía paravertebral cervical baja y dorsal alta.",
    palpacionDinamica: "Restricción de movilidad en flexión L4-L5.",
    legCheck: {
      modo: "prono_extension",
      pronoExtensionNota: "Pierna corta funcional derecha ~5 mm.",
    },
    notasLibres: "Mejoría progresiva del dolor entre sesiones.",
  };
  return { toolId: "quiropraxia.ficha.v2", data: quiropraxiaToolDataV2Schema.parse(data) as Record<string, unknown> };
}

function cardioToolData(i: number): DemoSesionPayload {
  return {
    toolId: "cardiologia.cv.v1",
    data: {
      v: 1,
      panel: {
        taSistolica: 128 + (i % 5) * 4,
        taDiastolica: 78 + (i % 4) * 3,
        fc: 68 + (i % 6) * 3,
        factores: {
          hta: i % 2 === 0,
          dislipemia: i % 3 === 0,
          sedentarismo: true,
          tabaquismo: i % 4 === 0,
        },
      },
      estudios: [
        { tipo: "ECG", fecha: "2026-06-20", hallazgos: "Ritmo sinusal, sin alteraciones agudas del ST-T.", conclusion: "normal" },
        { tipo: "Laboratorio", fecha: "2026-06-18", hallazgos: "LDL 145 mg/dl, HDL 38 mg/dl, glucemia 98.", conclusion: "requiere_seguimiento" },
      ],
    },
  };
}

function psicoToolData(i: number): DemoSesionPayload {
  return {
    toolId: "psicologia.escalas.v1",
    data: {
      v: 1,
      phq9: [1, 2, 1, 0, 2, 1, 1, 0, 1].map((n) => (n + (i % 2)) % 4),
      gad7: [2, 1, 1, 0, 1, 1, 0].map((n) => (n + (i % 2)) % 4),
      registro: {
        apariencia: "cuidada",
        animo: "ansioso",
        afecto: "congruente",
        pensamiento: "lineal",
        riesgo: "sin_riesgo",
      },
      objetivos: [
        { texto: "Reducir sintomatología ansiosa", estado: "en_curso" },
        { texto: "Mejorar higiene del sueño", estado: "en_curso" },
      ],
    },
  };
}

function kinesioToolData(i: number): DemoSesionPayload {
  const data = {
    v: 1 as const,
    motivo: "Control evolutivo del cuadro en tratamiento.",
    rom: [
      { region: "cervical" as const, grados: 40 + (i % 4) * 5, nota: "Rotación derecha, leve dolor al final del rango." },
      { region: "hombro" as const, grados: 150 + (i % 3) * 10 },
    ],
    tests: [
      { nombre: "Neer", resultado: (i % 2 === 0 ? "negativo" : "dudoso") as "negativo" | "dudoso" },
      { nombre: "Lasègue", resultado: "negativo" as const },
    ],
    objetivos: [
      { texto: "Recuperar rango completo sin dolor", estado: "en_curso" as const },
      { texto: "Volver a la actividad deportiva", estado: "en_curso" as const },
    ],
    dolorEva: 6 - (i % 4),
    ndi: [2, 1, 2, 1, 1, 2, 1, 0, 1, 1].map((n) => (n + i) % 5),
    borg: 11 + (i % 5),
  };
  return { toolId: "kinesiologia.ficha.v1", data: kinesiologiaToolDataSchema.parse(data) as Record<string, unknown> };
}

function nutricionToolData(i: number): DemoSesionPayload {
  const data = {
    v: 1 as const,
    peso: 82.4 - i * 0.6,
    talla: 168,
    circunferencias: [
      { sitio: "cintura" as const, cm: 96 - i * 0.5 },
      { sitio: "cadera" as const, cm: 104 - i * 0.3 },
    ],
    pliegues: [
      { sitio: "tricipital" as const, mm: 18 - (i % 4) },
      { sitio: "abdominal" as const, mm: 24 - (i % 5) },
    ],
    planAlimentario: "Plan hipocalórico moderado 1800 kcal, 4 comidas + 1 colación. Prioridad: proteína en desayuno, verduras en almuerzo y cena.",
    observaciones: "Buena adherencia general; reforzar hidratación.",
    objetivos: [
      { texto: "Descenso de 4 kg en 8 semanas", estado: "en_curso" as const },
      { texto: "Incorporar 2 porciones de verdura por día", estado: "en_curso" as const },
    ],
  };
  return { toolId: "nutricion.ficha.v1", data: nutricionToolDataSchema.parse(data) as Record<string, unknown> };
}

/**
 * Payload de sesión clínica para la especialidad, variado por índice.
 * Lanza si el shape no valida contra el schema vigente (quiro/kinesio/nutri) —
 * preferimos fallar el seed a sembrar una ficha que no renderiza.
 */
export function buildDemoToolData(
  especialidad: EspecialidadSlug,
  i: number,
): DemoSesionPayload {
  switch (especialidad) {
    case "quiropraxia":
      return quiroToolData(i);
    case "cardiologia":
      return cardioToolData(i);
    case "psicologia":
      return psicoToolData(i);
    case "kinesiologia":
      return kinesioToolData(i);
    case "nutricion":
      return nutricionToolData(i);
  }
}
