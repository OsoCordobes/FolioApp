"use client";

/**
 * Folio · Dashboard · cronómetro vivo para la sesión activa.
 *
 * Port de `useLiveTimer` en folio/dashboard.jsx. Tickea cada 1s desde
 * `sinceISO`. Si `sinceISO` es null, devuelve "00:00" sin tickeo.
 *
 * En tests visuales, `page.clock.install` + `runFor(N)` controla el
 * progreso del timer de forma determinística.
 */

import { useEffect, useState } from "react";

export function useLiveTimer(sinceISO: string | null | undefined): string {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!sinceISO) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [sinceISO]);

  if (!sinceISO) return "00:00";

  const e = Math.max(0, Math.floor((Date.now() - new Date(sinceISO).getTime()) / 1000));
  const h = Math.floor(e / 3600);
  const m = Math.floor((e % 3600) / 60);
  const s = e % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
