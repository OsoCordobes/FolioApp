"use client";

/**
 * Folio · PostHog browser init.
 *
 * Carga el SDK posthog-js solo en el cliente. Privacy-first:
 *   - `mask_all_text_inputs` y `mask_all_element_attributes` evitan capturar
 *     contenido sensible (nombres, telefonos, notas clínicas).
 *   - Session recording está OFF por default; se puede activar feature-gated.
 *   - DNT (Do Not Track) del browser se respeta.
 */

import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useEffect } from "react";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let initialized = false;

export function FolioPostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!KEY) return;
    if (initialized) return;
    if (typeof window !== "undefined" && (navigator.doNotTrack === "1" || navigator.doNotTrack === "yes")) {
      return;
    }
    // Audit-prep Phase 6b: gate PostHog init on explicit cookie consent.
    // Banner stored in localStorage as 'folio.cookieConsent' = 'granted'|'denied'.
    // If neither was selected yet, PostHog stays uninitialized; the
    // CookieBanner re-renders the provider after the user accepts.
    if (typeof window !== "undefined" && window.localStorage.getItem("folio.cookieConsent") !== "granted") {
      return;
    }
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
    initialized = true;
  }, []);

  if (!KEY) return <>{children}</>;
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
