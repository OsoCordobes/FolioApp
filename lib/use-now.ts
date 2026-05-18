"use client";

/**
 * Folio · hook `useNow(initialIso, intervalMs)`.
 *
 * Devuelve un `Date` "ahora" hydration-safe: inicializa con `initialIso`
 * (típicamente el momento del fetch SSR) para evitar mismatch entre el
 * HTML server-rendered y el primer client render. Después se actualiza en
 * `intervalMs` (default 60s) para refrescar etiquetas relativas como
 * "en 22 min".
 */

import { useEffect, useState } from "react";

export function useNow(initialIso: string, intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date(initialIso));

  useEffect(() => {
    // Salto inmediato al "ahora" real apenas montamos (queremos divergir
    // de initialIso solo después de la hidratación).
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
