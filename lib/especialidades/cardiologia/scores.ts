/**
 * Folio · especialidades · cardiología · scores clínicos validados (puros).
 *
 * Tres calculadoras cardiológicas de uso corriente, como funciones PURAS,
 * server-safe, sin DB ni React, testeables día uno (cutoffs fijados en
 * tests/unit/cardiologia-scores.test.ts):
 *
 *   - `scoreCHA2DS2VASc(input)` — riesgo tromboembólico en fibrilación
 *     auricular no valvular. Puntaje aditivo 0–9.
 *   - `scoreHASBLED(input)` — riesgo hemorrágico bajo anticoagulación.
 *     Puntaje aditivo 0–9.
 *   - `bandaSCORE2(input)` — clasificación por categorías (baja-moderada / alta
 *     / muy alta) del riesgo cardiovascular a 10 años SCORE2/SCORE2-OP (ESC
 *     2021), usando los cortes por franja etaria publicados. El PORCENTAJE de
 *     riesgo lo aporta el profesional (chart/calculadora oficial); esta función
 *     sólo aplica la banda etaria validada — NO recalcula los coeficientes
 *     región-específicos del modelo.
 *
 * ORIENTATIVO, NO diagnóstico: todas estas escalas asisten la decisión clínica
 * y nunca la reemplazan. Cada resultado lo marca en su interpretación es-AR.
 * Contrato LAXO (aceptan `unknown` / campos parciales) para no romper ante
 * inputs incompletos: devuelven `null` cuando falta lo mínimo indispensable.
 * PHI: este módulo nunca loguea contenido clínico.
 *
 * Referencias:
 *   - CHA₂DS₂-VASc: Lip GYH et al., Chest 2010;137(2):263–272.
 *   - HAS-BLED: Pisters R et al., Chest 2010;138(5):1093–1100.
 *   - SCORE2 / SCORE2-OP y categorías de riesgo por edad: 2021 ESC Guidelines
 *     on cardiovascular disease prevention in clinical practice,
 *     Eur Heart J 2021;42(34):3227–3337 (cortes <50, 50–69, ≥70 años).
 */

// ─── Nivel de riesgo compartido ──────────────────────────────────────────────

/** Banda cualitativa común a las tres escalas (para el chip de color de la UI). */
export type NivelRiesgo = "bajo" | "moderado" | "alto" | "muy_alto";

/** Resultado uniforme de un score cardiológico. */
export interface ScoreCardio {
  /** Puntaje numérico (puntos aditivos) o el % de riesgo, según la escala. */
  total: number;
  /** Banda cualitativa (para el color del chip). */
  nivel: NivelRiesgo;
  /** Etiqueta corta es-AR ("2 puntos", "riesgo alto"). */
  etiqueta: string;
  /** Interpretación es-AR — siempre marca que es orientativa, no diagnóstica. */
  interpretacion: string;
}

const NIVEL_LABEL: Record<NivelRiesgo, string> = {
  bajo: "bajo",
  moderado: "moderado",
  alto: "alto",
  muy_alto: "muy alto",
};

// ─── Helpers laxos ───────────────────────────────────────────────────────────

/** `true` sólo si el valor es exactamente booleano `true`. */
function esTrue(v: unknown): boolean {
  return v === true;
}

/** Entero finito no negativo, o `null` (edad, presión, etc.). */
function edadValida(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 130) return null;
  return Math.floor(v);
}

/** Porcentaje de riesgo válido [0, 100], o `null`. */
function pctValido(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) return null;
  return v;
}

// ─── CHA₂DS₂-VASc ────────────────────────────────────────────────────────────

/**
 * Entradas del CHA₂DS₂-VASc. La edad y el sexo se derivan de la ficha (edad del
 * paciente + sexo); el resto son antecedentes booleanos que marca el profesional.
 *
 * Puntos:
 *   C  Insuficiencia cardíaca / disfunción del VI ............ 1
 *   H  Hipertensión .......................................... 1
 *   A₂ Edad ≥ 75 ............................................. 2
 *   D  Diabetes .............................................. 1
 *   S₂ ACV / AIT / tromboembolismo previo ................... 2
 *   V  Enfermedad vascular (IAM, EAP, placa aórtica) ......... 1
 *   A  Edad 65–74 ........................................... 1
 *   Sc Sexo femenino ......................................... 1
 * Total 0–9.
 */
export interface CHA2DS2VAScInput {
  /** Edad del paciente (años). Aporta 1 punto (65–74) o 2 (≥75). */
  edad?: number;
  /** Sexo femenino → 1 punto (categoría Sc). */
  sexoFemenino?: boolean;
  /** Insuficiencia cardíaca congestiva / disfunción del ventrículo izquierdo. */
  insuficienciaCardiaca?: boolean;
  /** Hipertensión arterial. */
  hipertension?: boolean;
  /** Diabetes mellitus. */
  diabetes?: boolean;
  /** ACV, AIT o tromboembolismo previo (2 puntos). */
  acvAitTromboembolismo?: boolean;
  /** Enfermedad vascular (IAM previo, arteriopatía periférica, placa aórtica). */
  enfermedadVascular?: boolean;
}

/**
 * Puntúa el CHA₂DS₂-VASc (riesgo tromboembólico en FA no valvular). Requiere la
 * edad para poder puntuar (los antecedentes ausentes cuentan como 0). Devuelve
 * `null` si no hay una edad válida. Banda por riesgo anual de ACV:
 *   0 → bajo · 1 → moderado · ≥2 → alto.
 * ORIENTATIVO: guía la decisión de anticoagulación, no la reemplaza.
 */
export function scoreCHA2DS2VASc(input: unknown): ScoreCardio | null {
  if (input === null || typeof input !== "object") return null;
  const i = input as CHA2DS2VAScInput;
  const edad = edadValida(i.edad);
  if (edad === null) return null;

  let total = 0;
  if (esTrue(i.insuficienciaCardiaca)) total += 1;
  if (esTrue(i.hipertension)) total += 1;
  if (edad >= 75) total += 2;
  else if (edad >= 65) total += 1;
  if (esTrue(i.diabetes)) total += 1;
  if (esTrue(i.acvAitTromboembolismo)) total += 2;
  if (esTrue(i.enfermedadVascular)) total += 1;
  if (esTrue(i.sexoFemenino)) total += 1;

  const nivel: NivelRiesgo = total === 0 ? "bajo" : total === 1 ? "moderado" : "alto";
  const etiqueta = `${total} ${total === 1 ? "punto" : "puntos"}`;
  const interpretacion =
    `CHA₂DS₂-VASc ${total}/9 — riesgo tromboembólico ${NIVEL_LABEL[nivel]} (orientativo). ` +
    "Guía la decisión de anticoagulación; no reemplaza el criterio clínico.";
  return { total, nivel, etiqueta, interpretacion };
}

// ─── HAS-BLED ────────────────────────────────────────────────────────────────

/**
 * Entradas del HAS-BLED (riesgo hemorrágico bajo anticoagulación). Un punto por
 * cada categoría presente; total 0–9:
 *   H  Hipertensión no controlada (TAS > 160 mmHg) ........... 1
 *   A  Función renal alterada ................................ 1
 *   A  Función hepática alterada ............................. 1
 *   S  ACV previo ............................................ 1
 *   B  Sangrado previo o predisposición ..................... 1
 *   L  INR lábil ............................................. 1
 *   E  Edad > 65 (elderly) ................................... 1
 *   D  Fármacos que predisponen a sangrado ................... 1
 *   D  Alcohol (consumo elevado) ............................. 1
 */
export interface HASBLEDInput {
  /** Edad del paciente (años). > 65 → 1 punto. */
  edad?: number;
  /** Hipertensión no controlada (TAS > 160 mmHg). */
  hipertensionNoControlada?: boolean;
  /** Función renal alterada (diálisis, trasplante, creatinina ≥ 2,26 mg/dL). */
  funcionRenalAlterada?: boolean;
  /** Función hepática alterada (cirrosis, bilirrubina/transaminasas elevadas). */
  funcionHepaticaAlterada?: boolean;
  /** ACV previo. */
  acvPrevio?: boolean;
  /** Sangrado mayor previo o predisposición (anemia, diátesis). */
  sangradoPrevio?: boolean;
  /** INR lábil (tiempo en rango terapéutico bajo). */
  inrLabil?: boolean;
  /** Fármacos que predisponen a sangrado (antiplaquetarios, AINEs). */
  farmacosPredisponentes?: boolean;
  /** Consumo elevado de alcohol (≥ 8 unidades/semana). */
  alcohol?: boolean;
}

/**
 * Puntúa el HAS-BLED. Requiere la edad para poder puntuar. Devuelve `null` si no
 * hay una edad válida. Banda por riesgo hemorrágico:
 *   0–1 → bajo · 2 → moderado · ≥3 → alto (revisar factores modificables).
 * ORIENTATIVO: no contraindica anticoagular por sí solo — señala qué corregir.
 */
export function scoreHASBLED(input: unknown): ScoreCardio | null {
  if (input === null || typeof input !== "object") return null;
  const i = input as HASBLEDInput;
  const edad = edadValida(i.edad);
  if (edad === null) return null;

  let total = 0;
  if (esTrue(i.hipertensionNoControlada)) total += 1;
  if (esTrue(i.funcionRenalAlterada)) total += 1;
  if (esTrue(i.funcionHepaticaAlterada)) total += 1;
  if (esTrue(i.acvPrevio)) total += 1;
  if (esTrue(i.sangradoPrevio)) total += 1;
  if (esTrue(i.inrLabil)) total += 1;
  if (edad > 65) total += 1;
  if (esTrue(i.farmacosPredisponentes)) total += 1;
  if (esTrue(i.alcohol)) total += 1;

  const nivel: NivelRiesgo = total <= 1 ? "bajo" : total === 2 ? "moderado" : "alto";
  const etiqueta = `${total} ${total === 1 ? "punto" : "puntos"}`;
  const interpretacion =
    `HAS-BLED ${total}/9 — riesgo hemorrágico ${NIVEL_LABEL[nivel]} (orientativo). ` +
    "Señala factores de sangrado a corregir; no contraindica anticoagular por sí solo.";
  return { total, nivel, etiqueta, interpretacion };
}

// ─── SCORE2 / SCORE2-OP — banda por franja etaria (ESC 2021) ─────────────────

/**
 * Cortes de categoría de riesgo del SCORE2/SCORE2-OP publicados por la ESC 2021,
 * dependientes de la edad (para no infratratar a los jóvenes ni sobretratar a
 * los mayores). Cada franja define el techo (exclusivo) de "baja-moderada" y de
 * "alta"; por encima del segundo es "muy alta".
 *
 *   < 50 años:   baja-moderada < 2,5 % · alta 2,5–< 7,5 % · muy alta ≥ 7,5 %
 *   50–69 años:  baja-moderada < 5 %   · alta 5–< 10 %    · muy alta ≥ 10 %
 *   ≥ 70 años:   baja-moderada < 7,5 % · alta 7,5–< 15 %  · muy alta ≥ 15 %
 */
export const SCORE2_CORTES = {
  menor50: { altaDesde: 2.5, muyAltaDesde: 7.5 },
  medio: { altaDesde: 5, muyAltaDesde: 10 },
  mayor70: { altaDesde: 7.5, muyAltaDesde: 15 },
} as const;

export interface SCORE2Input {
  /** Edad del paciente (años) — selecciona la franja de cortes. */
  edad?: number;
  /**
   * Riesgo a 10 años (%) estimado con la tabla/calculadora oficial SCORE2 (< 70)
   * o SCORE2-OP (≥ 70). Folio NO recalcula los coeficientes región-específicos:
   * el % lo aporta el profesional; esta función sólo aplica la banda etaria.
   */
  riesgoPct?: number;
}

/**
 * Clasifica un % de riesgo SCORE2/SCORE2-OP en su categoría ESC 2021 según la
 * franja etaria. Requiere edad y % válidos; devuelve `null` si falta alguno.
 * `total` = el % ingresado (para persistir/serie). Banda:
 *   baja-moderada → "moderado" · alta → "alto" · muy alta → "muy_alto".
 * ORIENTATIVO: la categoría guía la intensidad del tratamiento preventivo; el %
 * proviene del modelo oficial, no de un cálculo propio de Folio.
 */
export function bandaSCORE2(input: unknown): ScoreCardio | null {
  if (input === null || typeof input !== "object") return null;
  const i = input as SCORE2Input;
  const edad = edadValida(i.edad);
  const pct = pctValido(i.riesgoPct);
  if (edad === null || pct === null) return null;

  const cortes =
    edad < 50 ? SCORE2_CORTES.menor50 : edad < 70 ? SCORE2_CORTES.medio : SCORE2_CORTES.mayor70;

  let nivel: NivelRiesgo;
  if (pct >= cortes.muyAltaDesde) nivel = "muy_alto";
  else if (pct >= cortes.altaDesde) nivel = "alto";
  else nivel = "moderado";

  const modelo = edad >= 70 ? "SCORE2-OP" : "SCORE2";
  const pctTxt = pct.toLocaleString("es-AR", { maximumFractionDigits: 1 });
  const etiqueta = `${pctTxt} % — riesgo ${NIVEL_LABEL[nivel]}`;
  const interpretacion =
    `${modelo} ${pctTxt} % a 10 años — categoría de riesgo ${NIVEL_LABEL[nivel]} para la franja etaria (orientativo, ESC 2021). ` +
    "Guía la intensidad del tratamiento preventivo; no reemplaza el criterio clínico.";
  return { total: pct, nivel, etiqueta, interpretacion };
}
