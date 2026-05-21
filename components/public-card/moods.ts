import type { CardMood } from "./public-card";

/**
 * Folio · mood catalogue + acento blend helper.
 *
 * The 4 moods are CSS-variable overrides applied via [data-card-mood="<id>"]
 * on <PublicCard>. This module owns:
 *   - The canonical id order (used by the picker and the side-by-side
 *     dev preview at /dev/card-moods).
 *   - Spanish labels + taglines (consumed by the picker UI).
 *   - applyAcentoBlend(): the Clínico-mood-only colour rule that blends
 *     the pro's chosen acento 60/40 toward Folio's ink-blue clinical
 *     accent to preserve the surgical register. Other moods pass-through
 *     the user-supplied hex verbatim.
 */

export const MOOD_IDS = ["calido", "clinico", "editorial", "boutique"] as const;

export const MOOD_LABELS: Record<CardMood, string> = {
  calido:    "Cálido",
  clinico:   "Clínico",
  editorial: "Editorial",
  boutique:  "Boutique",
};

export const MOOD_TAGLINES: Record<CardMood, string> = {
  calido:    "Cercano y humano",
  clinico:   "Preciso y profesional",
  editorial: "Refinado y selecto",
  boutique:  "Personal y curado",
};

const INK_BLUE = { r: 42, g: 67, b: 101 } as const; // #2A4365

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const v = m[1];
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

function rgbToHex(c: { r: number; g: number; b: number }): string {
  const part = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${part(c.r)}${part(c.g)}${part(c.b)}`;
}

/**
 * For Clínico mood, the pro-chosen acento blends 60% user + 40% ink-blue
 * (#2A4365). All other moods leave the acento untouched. Invalid hex
 * inputs pass through unchanged so callers don't crash on malformed data.
 */
export function applyAcentoBlend(mood: CardMood, hex: string): string {
  if (mood !== "clinico") return hex;
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex({
    r: rgb.r * 0.6 + INK_BLUE.r * 0.4,
    g: rgb.g * 0.6 + INK_BLUE.g * 0.4,
    b: rgb.b * 0.6 + INK_BLUE.b * 0.4,
  });
}
