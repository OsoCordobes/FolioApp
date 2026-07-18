/**
 * Folio · theme-options — datos puros del control de apariencia (X5).
 *
 * Sin React ni DOM: la lista de temas seleccionables + helpers de validación.
 * El componente (components/theme-toggle.tsx) mapea cada value a su icono; esta
 * capa queda testeable desde node:test sin renderer.
 */

import type { Theme } from "@/lib/tweaks-context";

export interface ThemeOption {
  value: Theme;
  label: string;
}

/** Orden canónico de las opciones en el segmented control (claro → oscuro). */
export const THEME_OPTIONS: readonly ThemeOption[] = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
] as const;

const KNOWN: ReadonlySet<Theme> = new Set(THEME_OPTIONS.map((o) => o.value));

/** True si `v` es uno de los temas ofrecidos por el control. */
export function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && KNOWN.has(v as Theme);
}
