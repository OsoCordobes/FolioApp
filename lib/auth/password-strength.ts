/**
 * Folio · Auth · fuerza de contraseña (heurística compartida).
 *
 * Extraída del Signup de components/auth/login-form.tsx para que el Step 1
 * de /onboarding muestre el MISMO medidor (mismo score, mismos labels).
 * La UI vive en components/auth/password-strength-meter.tsx.
 */

export const PASSWORD_STRENGTH_LABELS = [
  "Muy débil",
  "Débil",
  "Aceptable",
  "Buena",
  "Excelente",
] as const;

/** Score 0-4. 0 = vacía o muy débil, 4 = excelente. */
export function passwordStrength(password: string): number {
  if (!password) return 0;
  let s = 0;
  if (password.length >= 8) s++;
  if (password.length >= 12) s++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++;
  if (/\d/.test(password)) s++;
  if (/[^a-zA-Z0-9]/.test(password)) s++;
  return Math.min(s, 4);
}
