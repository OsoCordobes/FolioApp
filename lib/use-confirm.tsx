"use client";

/**
 * Folio · useConfirm · `window.confirm` con el diseño de la app (E1).
 *
 * `ConfirmDialog` existía desde C4 y estaba bien resuelto, pero solo lo usaba
 * /hoy. El resto de la app —desconectar Google Calendar, revocar una
 * invitación, dar de baja a un miembro del equipo, programar la eliminación de
 * la cuenta— seguía llamando al `window.confirm` nativo: un cuadro gris del
 * sistema operativo, en el medio de una pantalla brass/cream, sin el nombre de
 * lo que se está por hacer y sin distinguir una acción destructiva de una que
 * no lo es. En un producto que se cobra por mes, ese cuadro es el momento en
 * que el usuario duda de todo lo demás.
 *
 * Este hook existe porque varios de esos llamados están **en medio de una
 * función async** (`if (!window.confirm(…)) return;` y sigue), no en un
 * handler que pueda simplemente abrir un modal y terminar. Devolver una
 * promesa deja convertir esos sitios cambiando una línea:
 *
 *     if (!(await confirmar({ titulo: "…", variant: "danger" }))) return;
 *
 * Detalle de la promesa: ConfirmDialog llama `onConfirm()` y después
 * `onClose()`. La segunda resolución es un no-op —una promesa resuelve una
 * sola vez— así que confirmar gana sobre cerrar, y Escape o el backdrop, que
 * solo disparan `onClose`, resuelven `false`. Cerrar nunca ejecuta la acción.
 */

import { useCallback, useRef, useState, type ReactNode } from "react";

import { ConfirmDialog, type ConfirmDialogProps } from "@/components/ui/confirm-dialog";

type Opciones = Omit<ConfirmDialogProps, "onConfirm" | "onClose">;

export interface UseConfirm {
  /** Abre el diálogo y resuelve `true` solo si el usuario confirma. */
  confirmar: (opciones: Opciones) => Promise<boolean>;
  /** Render del diálogo. Hay que ponerlo en el árbol del componente. */
  dialogo: ReactNode;
}

export function useConfirm(): UseConfirm {
  const [opciones, setOpciones] = useState<Opciones | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirmar = useCallback((opts: Opciones) => {
    // Si ya había uno abierto (doble clic en dos botones distintos), el
    // anterior se resuelve en `false`: nunca queda una promesa colgada
    // esperando para siempre.
    resolverRef.current?.(false);
    setOpciones(opts);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const dialogo = opciones ? (
    <ConfirmDialog
      {...opciones}
      onConfirm={() => resolverRef.current?.(true)}
      onClose={() => {
        // Llega siempre: justo después de confirmar —donde la promesa ya
        // resolvió `true` y este `false` se descarta— o solo, al cancelar con
        // el botón, Escape o el backdrop.
        resolverRef.current?.(false);
        resolverRef.current = null;
        setOpciones(null);
      }}
    />
  ) : null;

  return { confirmar, dialogo };
}
