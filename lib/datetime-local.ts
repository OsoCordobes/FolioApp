/**
 * Folio · helpers para <input type="datetime-local">.
 *
 * Extraídos de TurnoCreateModal (components/hoy/turno-create-modal.tsx) para
 * reusarlos también en TurnoReagendarModal. Misma semántica que el inline
 * original:
 *
 * HTML <input type="datetime-local"> usa "YYYY-MM-DDTHH:mm" sin TZ. Tratamos
 * ese valor como hora local del browser del usuario y serializamos a ISO con
 * offset para la server action. El browser resuelve la timezone local al
 * construir el Date.
 */

/**
 * ISO (o "ahora" si falta) → "YYYY-MM-DDTHH:mm" local, redondeado al próximo
 * múltiplo de 5 minutos (default más prolijo para el picker).
 *
 * Fix al extraer: el inline original hacía `Math.round(min / 5) * 5` sobre el
 * minuto ya formateado — con minuto 58/59 daba "60" y producía un value
 * inválido ("T10:60") que el input rechazaba. Acá el redondeo pasa por
 * setMinutes(), que normaliza el overflow de hora/día.
 */
export function isoToLocalDatetime(iso?: string): string {
  const base = iso ? new Date(iso) : new Date();
  // Round to next 5 min for nicer default.
  const next = new Date(base.getTime() + 5 * 60 * 1000);
  next.setSeconds(0, 0);
  next.setMinutes(Math.round(next.getMinutes() / 5) * 5);
  const yyyy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  const hh = String(next.getHours()).padStart(2, "0");
  const mi = String(next.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/** "YYYY-MM-DDTHH:mm" local → ISO 8601 UTC ("...Z", offset válido para zod). */
export function localDatetimeToIso(local: string): string {
  // Date constructor treats "YYYY-MM-DDTHH:mm" as local time; toISOString()
  // produces UTC with Z suffix which is a valid ISO 8601 with offset.
  return new Date(local).toISOString();
}
