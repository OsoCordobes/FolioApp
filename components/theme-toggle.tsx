"use client";

/**
 * Folio · ThemeToggle — control de apariencia (claro / oscuro).
 *
 * Los tokens `[data-theme="dark"]` y el plumbing (persistencia en localStorage,
 * `data-theme` en `<html>`) ya viven en lib/tweaks-context.tsx; este componente
 * es solo el control: consume useTweaks().theme + setTheme.
 *
 * Segmented control reusando el patrón cfg-radio-group/cfg-radio-btn (mismos
 * tokens brass/cream, sin hex nuevo). Se expone como radiogroup accesible:
 * cada opción es un role="radio" con aria-checked, navegable por teclado.
 * La lista de opciones (pura) vive en lib/ui/theme-options.ts.
 */

import type { ComponentType } from "react";

import * as I from "@/components/icons";
import { THEME_OPTIONS } from "@/lib/ui/theme-options";
import { useTweaks, type Theme } from "@/lib/tweaks-context";

const ICONS: Record<Theme, ComponentType<{ size?: number }>> = {
  light: I.Sun,
  dark: I.Moon,
};

export function ThemeToggle() {
  const { theme, setTheme } = useTweaks();

  return (
    <div className="cfg-radio-group" role="radiogroup" aria-label="Apariencia">
      {THEME_OPTIONS.map(({ value, label }) => {
        const on = theme === value;
        const Icon = ICONS[value];
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            className={"cfg-radio-btn cfg-theme-opt " + (on ? "is-on" : "")}
            onClick={() => setTheme(value)}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
