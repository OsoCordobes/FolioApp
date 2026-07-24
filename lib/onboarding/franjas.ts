/**
 * Folio · Onboarding · validación de franjas horarias (Step 5).
 *
 * Pura y compartida entre el cliente (errores inline + nextDisabled en
 * Step5Horarios) y el server (updateOnboardingStep case 5, ANTES del
 * DELETE de disponibilidad_profesional). Sin esta validación server-side,
 * una franja invertida pasaba el DELETE y el INSERT fallaba contra el
 * CHECK disp_orden (M02) → el usuario quedaba con CERO disponibilidad y
 * un error crudo de Postgres.
 *
 * Las horas son strings "HH:MM" 24h (mismo formato que el CHECK
 * disp_hora_format) — comparan bien lexicográficamente.
 */

export type Franja = [string, string];

export interface FranjasValidation {
  ok: boolean;
  /** Error general (lista vacía). */
  error?: string;
  /** Error por índice de franja; undefined = franja válida. */
  porFranja: Array<string | undefined>;
}

const HORA_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function validateFranjas(franjas: Franja[]): FranjasValidation {
  if (!Array.isArray(franjas) || franjas.length === 0) {
    return { ok: false, error: "Agregá al menos una franja horaria.", porFranja: [] };
  }

  const porFranja: Array<string | undefined> = new Array(franjas.length).fill(undefined);

  for (let i = 0; i < franjas.length; i++) {
    const [inicio, fin] = franjas[i] ?? ["", ""];
    if (!inicio || !fin) {
      porFranja[i] = "Completá inicio y fin.";
      continue;
    }
    if (!HORA_RE.test(inicio) || !HORA_RE.test(fin)) {
      porFranja[i] = "Usá el formato HH:MM.";
      continue;
    }
    if (fin <= inicio) {
      porFranja[i] = "El fin tiene que ser después del inicio.";
    }
  }

  // No-solape: solo entre franjas individualmente válidas (las inválidas ya
  // tienen su propio error). Dos franjas [a,b) y [c,d) se solapan si a<d && c<b.
  for (let i = 0; i < franjas.length; i++) {
    if (porFranja[i]) continue;
    for (let j = 0; j < i; j++) {
      if (porFranja[j]) continue;
      const [a, b] = franjas[i];
      const [c, d] = franjas[j];
      if (a < d && c < b) {
        porFranja[i] = "Se solapa con otra franja.";
        break;
      }
    }
  }

  const firstError = porFranja.find(Boolean);
  return { ok: !firstError, error: firstError, porFranja };
}
