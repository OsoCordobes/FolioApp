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
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import * as I from "@/components/icons";

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

interface ToastContextValue {
  show: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Auto-dismiss: 4 s (suficiente para leer "Turno creado · 10:30 · Ana López"). */
const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    ({ titulo, tono = "ok" }: ToastInput) => {
      const id = nextIdRef.current++;
      setToasts((prev) => [...prev, { id, titulo, tono }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
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
