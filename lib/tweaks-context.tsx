"use client";

/**
 * Folio · tweaks (theme + accent + densidad + vista de demostración)
 *
 * Reemplaza el `window.useTweaks()` global del prototipo por un Context tipado.
 * Por ahora solo emite los valores: el panel visual (TweaksPanel) se mueve a
 * F11 (polish). En F1 mantenemos los defaults para que el render coincida
 * con el prototipo (`light`, accent brass, vista normal).
 *
 * Para evitar hydration mismatch con `data-theme` en `<html>`:
 *  - Default server-side = "light".
 *  - El cliente puede leer localStorage y mutar `dataset.theme` post-mount.
 *  - El root layout tiene `suppressHydrationWarning` en `<html>`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";
export type Density = "comfortable" | "compact";
export type DemoView = "normal" | "empty" | "cerrada";

export interface TweaksState {
  theme: Theme;
  density: Density;
  accent: string;
  demoView: DemoView;
}

export interface TweaksContextValue extends TweaksState {
  setTheme: (t: Theme) => void;
  setDensity: (d: Density) => void;
  setAccent: (hex: string) => void;
  setDemoView: (v: DemoView) => void;
}

const DEFAULT_STATE: TweaksState = {
  theme: "light",
  density: "comfortable",
  accent: "#8A6722",
  demoView: "normal",
};

const STORAGE_KEY = "folio.tweaks.v1";

const TweaksContext = createContext<TweaksContextValue | null>(null);

export function TweaksProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TweaksState>(DEFAULT_STATE);

  // Hidratación: post-mount, leemos localStorage para restaurar la preferencia
  // del usuario sin causar mismatch en el SSR.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<TweaksState>;
      setState((prev) => ({ ...prev, ...parsed }));
    } catch {
      // ignoramos lecturas corruptas
    }
  }, []);

  // Sincronizar `data-theme` en <html> + persistir en localStorage.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", state.theme);
    }
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // quota / privacy mode: ignoramos
      }
    }
  }, [state]);

  const setTheme = useCallback((theme: Theme) => setState((s) => ({ ...s, theme })), []);
  const setDensity = useCallback((density: Density) => setState((s) => ({ ...s, density })), []);
  const setAccent = useCallback((accent: string) => setState((s) => ({ ...s, accent })), []);
  const setDemoView = useCallback((demoView: DemoView) => setState((s) => ({ ...s, demoView })), []);

  const value = useMemo<TweaksContextValue>(
    () => ({ ...state, setTheme, setDensity, setAccent, setDemoView }),
    [state, setTheme, setDensity, setAccent, setDemoView],
  );

  return <TweaksContext.Provider value={value}>{children}</TweaksContext.Provider>;
}

export function useTweaks(): TweaksContextValue {
  const ctx = useContext(TweaksContext);
  if (!ctx) {
    throw new Error("useTweaks debe usarse dentro de <TweaksProvider>");
  }
  return ctx;
}
