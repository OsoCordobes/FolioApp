/**
 * Folio · /focus/[turnoId]
 *
 * Pantalla "modo concentración" durante una sesión activa. Cronómetro XL,
 * mapa anatómico, SOAP editor con tabs y atajos de teclado para pausa /
 * cerrar y cobrar / guardar / salir.
 *
 * En F4 el `[turnoId]` resuelve a un turno real con `estado = atendiendo`,
 * y "Cerrar y cobrar" dispara una Server Action que transiciona el turno
 * a cerrado + emite el evento de pago.
 *
 * Hasta que llegue F4 la pantalla es demo-only (datos mock, sin persistencia),
 * así que en producción devuelve 404 — mismo criterio que /dev/*.
 */

import { notFound } from "next/navigation";

import { FocusApp } from "@/components/focus/focus-app";

export default function FocusPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <FocusApp />;
}
