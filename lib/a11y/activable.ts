/**
 * Folio · props de un elemento clickeable que NO es un <button> (E2).
 *
 * En /hoy, la fila del turno y la fila del turno cerrado abren la ficha con un
 * `onClick` sobre un `<div>`: no tienen `role`, no tienen `tabIndex` y no
 * responden al teclado, así que con Tab no se llega y con Enter no pasa nada.
 * Las cabeceras plegables de "Cerrados" y "Cancelados" están peor: tienen
 * `role="button"` y `tabIndex={0}` pero ningún handler de teclado, o sea que
 * se enfocan —el usuario ve el anillo de foco, cree que llegó— y apretar Enter
 * no hace absolutamente nada. Eso es peor que no ser focusable: promete y no
 * cumple.
 *
 * Estas filas son la pantalla principal de la app. Alguien que trabaja con
 * teclado, o con un lector de pantalla, no podía abrir una ficha.
 *
 * Lo correcto sería un `<button>`, pero estas filas contienen sus propios
 * botones (Cobrar, Cancelar) y un botón adentro de otro es HTML inválido. El
 * patrón WAI-ARIA para ese caso es exactamente esto: `role="button"` +
 * `tabIndex` + Enter/Space.
 *
 * Testeado en tests/unit/activable.test.ts.
 */

import type { KeyboardEvent } from "react";

export interface ActivableProps {
  role: "button";
  tabIndex: number;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
}

/**
 * Props para spreadear en el elemento. `onActivate` corre con click, con Enter
 * y con Space, que es lo que un usuario de teclado espera de algo que dice ser
 * un botón.
 */
export function activable(onActivate: () => void): ActivableProps {
  return {
    role: "button",
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e) => {
      // Solo la tecla que se apretó sobre ESTE elemento. Sin el check de
      // target, un Enter en un botón de adentro (Cobrar, Cancelar) burbujea
      // hasta acá y abre la ficha además de ejecutar la acción.
      if (e.target !== e.currentTarget) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      // Space scrollea la página si no se lo frena; Enter dispara el submit
      // del form contenedor si hay uno.
      e.preventDefault();
      onActivate();
    },
  };
}
