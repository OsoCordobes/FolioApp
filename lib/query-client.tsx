"use client";

/**
 * Folio · TanStack Query provider.
 *
 * Configurado para Server Components + Hydration:
 *   - staleTime: 30s (las queries no se re-fetchean mientras estén "fresh")
 *   - gcTime: 5min (cache mantiene data 5min en memoria post-unmount)
 *   - refetchOnWindowFocus: true (pestaña vuelve al foco → re-fetch)
 *   - refetchOnReconnect: true
 *
 * Las claves de query siguen el patrón `[tipo, scope]`:
 *   ['turnos', { fecha: '2026-05-13' }]
 *   ['paciente', pacienteId]
 *   ['servicios']
 *
 * En F4 setup. Los hooks específicos viven en `lib/queries/*.ts`.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, type ReactNode } from "react";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          // No reintentar errores de auth o RLS
          const msg = (error as Error)?.message ?? "";
          if (msg.includes("JWT") || msg.includes("RLS") || msg.includes("403")) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        retry: 0, // mutations no se reintentan automáticamente
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: nueva instancia por request
    return makeQueryClient();
  }
  // Browser: singleton
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => getQueryClient());
  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NODE_ENV === "development" ? (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      ) : null}
    </QueryClientProvider>
  );
}
