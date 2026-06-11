"use client";

/**
 * Folio · hook `useAgendaAutoRefresh(organizationId)`.
 *
 * Live update de la agenda (/hoy y /calendario): si entra un booking público
 * (u otro cambio de turno hecho desde otra pestaña/dispositivo) mientras el
 * médico tiene la agenda abierta, la vista se refresca sola via
 * `router.refresh()` (re-fetch del Server Component, preserva client state).
 *
 * Estrategia en dos niveles:
 *
 *  1. POLLING (siempre activo — camino seguro): cada 25s, refresh SOLO si la
 *     pestaña está visible (`document.visibilityState === "visible"`). No
 *     requiere config server-side y no gasta requests con la pestaña en
 *     background.
 *
 *  2. REALTIME (detrás de flag): el wiring a Supabase Realtime
 *     (`useRealtimeTable` de lib/db/realtime.ts, postgres_changes sobre
 *     `turno` org-scoped, RLS server-side) queda preparado pero apagado por
 *     default. La publication `supabase_realtime` de Postgres NO está
 *     garantizada para la tabla `turno` en prod (no es verificable desde el
 *     repo), y un canal que se suscribe a una publication inexistente falla
 *     en silencio — el polling es la fuente de verdad. Para activarlo:
 *     setear `NEXT_PUBLIC_AGENDA_REALTIME=1` DESPUÉS de agregar `turno` a la
 *     publication (`alter publication supabase_realtime add table turno;`).
 *     Los eventos llegan con debounce de 2.5s para colapsar ráfagas.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { useRealtimeTable } from "@/lib/db/realtime";

const POLL_MS = 25_000;
const REALTIME_DEBOUNCE_MS = 2_500;
const REALTIME_ENABLED = process.env.NEXT_PUBLIC_AGENDA_REALTIME === "1";

export function useAgendaAutoRefresh(organizationId: string | null) {
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Nivel 1: polling con guard de visibilidad ──
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [router]);

  // ── Nivel 2: realtime (flag) — INSERT/UPDATE de turno → refresh debounced ──
  const onRealtimeChange = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      router.refresh();
    }, REALTIME_DEBOUNCE_MS);
  }, [router]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // useRealtimeTable ya no-opea con organizationId null; con el flag apagado
  // pasamos null para que ni siquiera abra el canal.
  useRealtimeTable("turno", REALTIME_ENABLED ? organizationId : null, onRealtimeChange);
}
