"use client";

/**
 * Folio · useModalA11y · a11y compartida para modales (WCAG 2.4.3 / 2.1.2).
 *
 * Patrón WAI-ARIA dialog aplicado a los modales hand-rolled de la app
 * (turno-create, pedido, paciente-create). El markup sigue siendo del
 * caller (role="dialog" + aria-modal + aria-labelledby van en el JSX);
 * este hook aporta el comportamiento:
 *
 *   1. Foco inicial: si ningún elemento del modal tiene foco al montar
 *      (p.ej. un autoFocus ya lo tomó), enfoca el primer focusable; si no
 *      hay ninguno (estado loading), el contenedor (tabIndex={-1} en el
 *      caller + clase .a11y-modal-root para suprimir el outline).
 *   2. Trap de Tab / Shift+Tab dentro del contenedor (wrap circular).
 *   3. Escape cierra — salvo closeDisabled (submit en vuelo). El handler
 *      solo actúa si el evento pertenece a este modal (no pisa otros
 *      overlays que puedan convivir).
 *   4. Restore focus: al desmontar devuelve el foco al elemento que abrió
 *      el modal.
 *
 * Cero cambios visuales: solo manejo de foco y teclado.
 */

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export interface UseModalA11yOptions {
  /** Cierra el modal (mismo callback que el click en backdrop / Cancelar). */
  onClose: () => void;
  /** true mientras hay un submit en vuelo — Escape no interrumpe. */
  closeDisabled?: boolean;
}

export function useModalA11y(
  containerRef: React.RefObject<HTMLElement | null>,
  { onClose, closeDisabled = false }: UseModalA11yOptions,
): void {
  // Refs "vivas" para que el listener (suscripto una sola vez) lea siempre
  // el último valor sin re-suscribirse en cada render.
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const opener =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        // offsetParent === null → display:none (no enfocable de verdad).
        (el) => el.offsetParent !== null,
      );

    // Foco inicial — solo si nada del modal lo tiene ya (autoFocus, etc.).
    if (!container.contains(document.activeElement)) {
      const first = focusables()[0];
      if (first) first.focus();
      else container.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Solo actuamos sobre eventos de ESTE modal: target adentro, o foco
      // huérfano en <body> (p.ej. tras remover un elemento enfocado).
      const target = e.target;
      const owns =
        (target instanceof Node && container.contains(target)) ||
        document.activeElement === document.body;
      if (!owns) return;

      if (e.key === "Escape") {
        if (!closeDisabledRef.current) {
          e.preventDefault();
          e.stopPropagation();
          onCloseRef.current();
        }
        return;
      }

      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Foco en el contenedor mismo (fallback inicial): Tab → primer item,
      // Shift+Tab → último. Sin esto, Shift+Tab escaparía del trap.
      if (active === container) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    // Capture: interceptamos Tab antes de que el browser mueva el foco
    // fuera del modal; la guard de pertenencia evita pisar otros overlays.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Restore focus al elemento que abrió el modal (si sigue en el DOM).
      if (opener && opener.isConnected) opener.focus();
    };
    // Mount-only: containerRef es estable; onClose/closeDisabled van por refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
