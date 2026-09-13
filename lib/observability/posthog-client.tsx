"use client";

/** Marketing-only analytics, gated by current consent and DNT on every event.
 * No clinical initialization, replay, page URLs, profiles, flags or persisted IDs.
 * The SDK is loaded after consent; every payload is rebuilt from an allowlist.
 */

import { sanitizeBrowserAnalyticsEvent } from "./privacy";

import { PostHogContext } from "posthog-js/react/slim";
import { useEffect, useMemo, useState } from "react";

import { CONSENT_EVENT } from "@/components/cookie-banner";

import type { PostHog } from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let initialized = false;
function mayCaptureMarketing(): boolean {
  try { return window.location.pathname === "/" && navigator.doNotTrack !== "1" && navigator.doNotTrack !== "yes" && window.localStorage.getItem("folio.cookieConsent") === "granted"; }
  catch { return false; }
}

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
      // Marketing only: no SDK initialization on clinical, portal or token routes.
      if (!mayCaptureMarketing()) return;
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
          if (cancelled || !mayCaptureMarketing()) { initialized = false; return; }
          posthog.init(KEY, {
            api_host: HOST,
            capture_pageview: false,
            capture_pageleave: false,
            autocapture: false,                               // explicit captures only
            persistence: "memory",
            disable_persistence: true,
            person_profiles: "never",
            advanced_disable_flags: true,
            advanced_disable_feature_flags: true,
            disable_external_dependency_loading: true,
            disable_surveys: true,
            disable_conversations: true,
            disable_product_tours: true,
            save_campaign_params: false,
            save_referrer: false,
            capture_performance: false,
            before_send: (event) => {
              if (!mayCaptureMarketing()) return null;
              const safe = sanitizeBrowserAnalyticsEvent(event);
              // Public ingestion key comes from configured SDK routing, never event input.
              if (safe) safe.properties.token = KEY;
              return safe;
            },
            mask_all_text: true,                             // permitimos texto general pero...
            mask_personal_data_properties: true,
            session_recording: { maskAllInputs: true, maskTextSelector: "*" },
            disable_session_recording: true,                  // Global privacy boundary.
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
