"use client";

/**
 * Folio · sistema de toasts del shell autenticado (C4 · feedback).
 *
 * Hasta este PR ninguna mutación daba feedback de éxito: crear/reagendar/
 * cancelar un turno cerraba el modal en silencio. Este provider monta un
 * stack de toasts apilables (esquina inferior derecha en desktop, arriba de
 * la bottom-nav en mobile — ver sección C1+C4 al final de folio.css).
 *
 * Diseño:
 *  - `useToast().show({ titulo, tono })` — tono "ok" (default, check verde)
 *    o "error" (alerta roja). Auto-dismiss a los 4 s + botón de cierre.
 *  - El contenedor vive SIEMPRE montado con aria-live="polite": los lectores
 *    de pantalla anuncian cada toast nuevo sin robar el foco (WCAG 4.1.3).
 *  - `useToast` fuera del provider devuelve un no-op: los componentes
 *    compartidos (modales de turno) no explotan si algún caller futuro los
 *    monta fuera del shell.
 *
 * Tokens: --surface / --line / --green / --red / --r-md / --shadow-2 vía las
 * clases .fi-toast* (append-only en folio.css). Sin hex nuevos.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import * as I from "@/components/icons";
import "@/styles/states-experience.css";

export type ToastTono = "ok" | "error";

export interface ToastInput {
  titulo: string;
  tono?: ToastTono;
}

interface ToastItem {
  id: number;
  titulo: string;
  tono: ToastTono;
}

type PauseSource = "pointer" | "focus";
interface ToastTimer {
  remaining: number;
  startedAt: number;
  timeout: number | null;
  pausedBy: Set<PauseSource>;
}

interface ToastContextValue {
  show: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Four seconds of unpaused reading time; focus and pointer keep the notice open. */
const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef(new Map<number, ToastTimer>());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        if (timer.timeout !== null) window.clearTimeout(timer.timeout);
      }
      timers.clear();
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer?.timeout != null) window.clearTimeout(timer.timeout);
    timersRef.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pause = useCallback((id: number, source: PauseSource) => {
    const timer = timersRef.current.get(id);
    if (!timer || timer.pausedBy.has(source)) return;
    timer.pausedBy.add(source);
    if (timer.timeout !== null) {
      timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
      window.clearTimeout(timer.timeout);
      timer.timeout = null;
    }
  }, []);

  const resume = useCallback((id: number, source: PauseSource) => {
    const timer = timersRef.current.get(id);
    if (!timer || !timer.pausedBy.delete(source) || timer.pausedBy.size > 0) return;
    timer.startedAt = Date.now();
    timer.timeout = window.setTimeout(() => dismiss(id), timer.remaining);
  }, [dismiss]);

  const show = useCallback(
    ({ titulo, tono = "ok" }: ToastInput) => {
      const id = nextIdRef.current++;
      setToasts((prev) => [...prev, { id, titulo, tono }]);
      timersRef.current.set(id, {
        remaining: AUTO_DISMISS_MS,
        startedAt: Date.now(),
        timeout: window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
        pausedBy: new Set(),
      });
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Contenedor SIEMPRE montado: aria-live solo anuncia nodos agregados
          a una región ya existente en el árbol de accesibilidad. */}
      <div className="fi-toasts" aria-live="polite">
        {toasts.map((t) => (
          // Sin role="status" por item: una live-region anidada en el
          // contenedor aria-live duplica anuncios en NVDA/VoiceOver.
          <div
            key={t.id}
            className={"fi-toast" + (t.tono === "error" ? " fi-toast--error" : "")}
            onPointerEnter={() => pause(t.id, "pointer")}
            onPointerLeave={() => resume(t.id, "pointer")}
            onFocusCapture={() => pause(t.id, "focus")}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) resume(t.id, "focus");
            }}
          >
            <span className="fi-toast-ico" aria-hidden>
              {t.tono === "error" ? <I.Alert size={14} /> : <I.Check size={14} />}
            </span>
            <span className="fi-toast-txt">{t.titulo}</span>
            <button
              type="button"
              className="fi-toast-close"
              aria-label="Cerrar aviso"
              onClick={() => dismiss(t.id)}
            >
              <I.X size={12} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const NOOP_TOAST: ToastContextValue = { show: () => undefined };

/**
 * Hook de consumo. Fuera del provider degrada a no-op (en vez de throw):
 * los modales de turno se montan también desde rutas que podrían no tener
 * el provider — el feedback se pierde, la mutación no.
 */
export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? NOOP_TOAST;
}
