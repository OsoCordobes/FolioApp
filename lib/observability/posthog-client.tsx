"use client";

/**
 * Folio · PostHog browser init.
 *
 * Carga el SDK posthog-js solo en el cliente. Privacy-first:
 *   - `mask_all_text_inputs` y `mask_all_element_attributes` evitan capturar
 *     contenido sensible (nombres, telefonos, notas clínicas).
 *   - Session recording está OFF por default; se puede activar feature-gated.
 *   - DNT (Do Not Track) del browser se respeta.
 *
 * Perf (R4): posthog-js (~40-50 KB gz) NO entra al bundle inicial.
 *   - El SDK se carga con `import("posthog-js")` dinámico DENTRO del flujo
 *     post-consent: sin consent (o sin key / con DNT) el chunk ni se pide.
 *   - El provider/hook viene de `posthog-js/react/slim`, que —a diferencia de
 *     `posthog-js/react`— no importa posthog-js por valor (solo tipos): los
 *     consumidores (usePostHog) tampoco arrastran el SDK.
 *   - Montamos SIEMPRE el mismo <PostHogContext.Provider> (con client
 *     undefined hasta el init) para que el árbol de React no se desmonte
 *     cuando llega la instancia. Los consumidores ya toleran la ausencia:
 *     chequean `ph && ph.__loaded` antes de capturar (landing-analytics.tsx).
 */

import { PostHogContext } from "posthog-js/react/slim";
import { useEffect, useMemo, useState } from "react";

import { CONSENT_EVENT } from "@/components/cookie-banner";

import type { PostHog } from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let initialized = false;

export function FolioPostHogProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<PostHog | undefined>(undefined);

  useEffect(() => {
    if (!KEY) return;
    let cancelled = false;

    // Audit-prep Phase 6b: gate PostHog init on explicit cookie consent.
    // Banner stored in localStorage as 'folio.cookieConsent' = 'granted'|'denied'.
    // Si todavía no hay consent, PostHog queda sin inicializar y esperamos el
    // evento `folio:cookie-consent` del CookieBanner (aceptar ya NO recarga la
    // página — un paciente a mitad del wizard de booking perdía su progreso).
    const tryInit = () => {
      if (initialized) return;
      if (navigator.doNotTrack === "1" || navigator.doNotTrack === "yes") return;
      let granted = false;
      try {
        granted = window.localStorage.getItem("folio.cookieConsent") === "granted";
      } catch { /* private mode: sin storage no hay consent persistido */ }
      if (!granted) return;
      initialized = true;
      // Dynamic import: el SDK entra en un chunk async que solo se descarga
      // acá (post-consent). Si falla (offline/adblock), queda todo no-op.
      void import("posthog-js")
        .then(({ default: posthog }) => {
          posthog.init(KEY, {
            api_host: HOST,
            capture_pageview: true,
            capture_pageleave: true,
            autocapture: false,                               // explicit captures only
            persistence: "localStorage+cookie",
            mask_all_text: false,                             // permitimos texto general pero...
            mask_personal_data_properties: true,
            session_recording: { maskAllInputs: true, maskTextSelector: "[data-sensitive]" },
            disable_session_recording: true,                  // OFF por default; toggleable luego
          });
          if (!cancelled) setClient(posthog);
        })
        .catch(() => {
          initialized = false; // permite reintentar en un próximo mount/consent
        });
    };

    tryInit();
    // El banner dispara este evento al aceptar/rechazar; "storage" cubre el
    // caso de otro tab del mismo origen resolviendo el consent.
    window.addEventListener(CONSENT_EVENT, tryInit);
    window.addEventListener("storage", tryInit);
    return () => {
      cancelled = true;
      window.removeEventListener(CONSENT_EVENT, tryInit);
      window.removeEventListener("storage", tryInit);
    };
  }, []);

  // El tipo del context declara `client: PostHog`, pero su default REAL en
  // runtime es undefined (slim no setea instancia por defecto) — el cast
  // refleja ese contrato efectivo. Consumidores chequean `__loaded` igual.
  const value = useMemo(
    () => ({ client: client as PostHog }),
    [client],
  );

  if (!KEY) return <>{children}</>;
  return <PostHogContext.Provider value={value}>{children}</PostHogContext.Provider>;
}
