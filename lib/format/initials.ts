/**
 * Folio · helper puro para iniciales de un nombre completo.
 *
 * Reglas:
 *   - 1 palabra → primera letra. "Lorenzo" → "L"
 *   - 2 palabras → primera + primera. "Lorenzo Martínez" → "LM"
 *   - 3+ palabras → primera + última (ignora medios). "Juan Carlos Pérez García" → "JG"
 *   - Símbolos, números → se ignoran.
 *   - Diacríticos → se preservan (Á, Ñ, etc.). UTF-8 safe.
 *   - String vacío o null → "?"
 *   - Max 2 chars siempre.
 */

export function getInitials(fullName: string | null | undefined): string {
  if (!fullName) return "?";
  const cleaned = fullName.trim();
  if (!cleaned) return "?";

  // Tokenizar por espacios; filtrar tokens que no empiecen con letra.
  const tokens = cleaned
    .split(/\s+/)
    .map((t) => {
      // Primera "letter" del token (unicode-aware: Á, Ñ, é, etc.)
      const match = t.match(/^[\p{L}]/u);
      return match ? match[0].toUpperCase() : null;
    })
    .filter((t): t is string => t !== null);

  if (tokens.length === 0) return "?";
  if (tokens.length === 1) return tokens[0];
  // 2+ tokens: primera + última (esto cubre "Juan Carlos Pérez García" → "JG").
  return tokens[0] + tokens[tokens.length - 1];
}

/**
 * Calcula color de texto (#fff o #000) que cumple contraste WCAG AA (4.5:1)
 * sobre un background dado. Útil para AvatarIniciales cuando el acento_hex
 * del user es muy claro o muy oscuro.
 *
 * Implementación: convierte hex a luminancia relativa (WCAG fórmula) y compara
 * contra ambos extremos.
 */
export function contrastingTextColor(bgHex: string): "#ffffff" | "#0a0a0a" {
  const hex = bgHex.replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "#0a0a0a";

  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  // sRGB → luminancia lineal (WCAG)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

  // Punto de quiebre 0.179 da contraste razonable en la mayoría de hex.
  return L > 0.179 ? "#0a0a0a" : "#ffffff";
}

/**
 * Aclara o oscurece un hex en un porcentaje. Usado para generar el gradient
 * del avatar (acento → acento aclarado 20%).
 */
export function adjustHexLightness(hex: string, percent: number): string {
  const cleaned = hex.replace("#", "").trim();
  if (!/^[0-9a-f]{6}$/i.test(cleaned)) return hex;

  const num = parseInt(cleaned, 16);
  const amt = Math.round(2.55 * percent);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + amt));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amt));

  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}
