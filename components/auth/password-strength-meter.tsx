"use client";

/**
 * Folio · Auth · medidor visual de fuerza de contraseña.
 *
 * Compartido entre el Signup de /login y el Step 1 de /onboarding —
 * mismas barras `.au-pw-*` (folio.css) y misma heurística
 * (lib/auth/password-strength.ts). Con password vacía no renderiza nada.
 */

import {
  PASSWORD_STRENGTH_LABELS,
  passwordStrength,
} from "@/lib/auth/password-strength";

export function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const strength = passwordStrength(password);
  return (
    <div className="au-pw-meter">
      <div className="au-pw-meter-bars">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={i < strength ? `au-pw-bar is-on s-${strength}` : "au-pw-bar"}
          />
        ))}
      </div>
      <span className="au-pw-label">{PASSWORD_STRENGTH_LABELS[strength]}</span>
    </div>
  );
}
