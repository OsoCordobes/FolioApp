"use client";

/**
 * Folio · Supabase Realtime helpers.
 *
 * Wrapper sobre `supabase.channel()` que tipa las suscripciones a tablas
 * críticas (turno, pedido, sesion).
 *
 * Las suscripciones se filtran por `organization_id` para que cada cliente
 * solo reciba eventos de su tenant. Esto es CRÍTICO — RLS no aplica a
 * Realtime broadcasts en Supabase free tier; el filtro del client es la
 * primera línea de defensa.
 *
 * En F11 habilitar Realtime Authorization en Supabase para enforcement
 * server-side.
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
