"use client";

/**
 * Folio · Supabase Realtime helpers.
 *
 * Wrapper sobre `supabase.channel()` que tipa las suscripciones a tablas
 * críticas (turno, pedido, sesion). Usa `postgres_changes` (eventos de DB),
 * NO `broadcast` ni `presence`.
 *
 * Seguridad multi-tenant (verificado 2026-05-23):
 *   - postgres_changes en Supabase v2 enforza RLS SERVER-SIDE: si la RLS
 *     SELECT de la tabla deniega la row, el client NO recibe el evento,
 *     independientemente del filtro client-side.
 *   - Las tablas que suscribimos (turno, pedido, sesion) tienen
 *     `ALTER TABLE ... FORCE ROW LEVEL SECURITY` en sus migrations
 *     respectivas (M03, M09, M10). RLS NO bypaseable.
 *   - El filter `organization_id=eq.${organizationId}` es una OPTIMIZACIÓN
 *     (reduce el volumen que el server evalúa contra RLS) — NO es la
 *     línea de defensa. La línea de defensa es la RLS policy.
 *
 * Por qué la auditoría 2026-05-23 confundió esto:
 *   El doc histórico decía "RLS no aplica a Realtime broadcasts". Eso es
 *   parcialmente cierto para `broadcast` y `presence` (que sí necesitan
 *   policies sobre `realtime.messages`), pero falso para `postgres_changes`,
 *   que es lo único que usamos.
 *
 * Si en el futuro agregamos broadcast (ej. presence indicator del calendario
 * compartido), levantar migration con policies en realtime.messages topic
 * "org:{uuid}:{channel}".
 */

import { useEffect } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type PostgresEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

interface ChangeHandler<T = Record<string, unknown>> {
  (payload: {
    eventType: PostgresEvent;
    new: T | null;
    old: T | null;
  }): void;
}

export function useRealtimeTable<T = Record<string, unknown>>(
  table: string,
  organizationId: string | null,
  onChange: ChangeHandler<T>,
) {
  useEffect(() => {
    if (!organizationId) return;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`realtime:${table}:${organizationId}`)
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table,
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload: {
          eventType: PostgresEvent;
          new: Record<string, unknown> | null;
          old: Record<string, unknown> | null;
        }) => {
          onChange({
            eventType: payload.eventType,
            new: (payload.new as T) ?? null,
            old: (payload.old as T) ?? null,
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, organizationId, onChange]);
}
