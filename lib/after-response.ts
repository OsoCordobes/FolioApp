/**
 * Folio · side-effects post-respuesta (after() de next/server).
 *
 * `after()` difiere el callback hasta DESPUÉS de enviar la respuesta al
 * cliente: el paciente/profesional no espera los round-trips de side-effects
 * (push a Google Calendar, emails de notificación, programar recordatorios)
 * y, en Vercel, la function se mantiene viva hasta que el callback resuelve —
 * a diferencia del patrón `void promesa` que podía morir cortado por el
 * freeze de la lambda apenas se enviaba la respuesta.
 *
 * Fallback documentado: fuera de request scope (unit tests con node:test,
 * scripts CLI) `after()` lanza "after was called outside a request scope".
 * En ese caso ejecutamos la tarea inline, replicando el patrón fire-and-forget
 * previo. El `.catch` + `captureException` de cada tarea vive DENTRO del
 * callback, así los errores se reportan igual en ambos modos.
 */

import { after } from "next/server";

export function runAfterResponse(task: () => void | Promise<unknown>): void {
  try {
    after(task);
  } catch {
    // Sin request scope (tests/scripts): correr inline, fire-and-forget.
    void task();
  }
}
