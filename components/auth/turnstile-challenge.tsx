"use client";

import { useEffect, useRef, useState } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const SCRIPT_ID = "folio-turnstile-api";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const LOAD_TIMEOUT_MS = 10000;

type Failure = { stage: "script" | "render" | "challenge" | "expired"; code?: string };

// Only Cloudflare's numeric diagnostic code is displayed. Never retain tokens,
// email addresses, URLs, or the visitor's browser details in diagnostics.
export function turnstileDiagnostic(code: unknown): string | undefined {
  return typeof code === "string" && /^\d{6}$/.test(code) ? code : undefined;
}

export function turnstileFailureMessage(failure: Failure): string {
  if (failure.stage === "script") return "No pudimos cargar la verificación de seguridad. Revisá tu conexión o las extensiones del navegador y reintentá.";
  if (failure.stage === "expired") return "La verificación venció. Reintentá para continuar.";
  if (failure.code === "110200") return "Este sitio no está autorizado para la verificación de seguridad. Avisanos con el código 110200.";
  if (failure.code === "200500") return "No se pudo conectar con la verificación de seguridad. Revisá tu conexión o las extensiones del navegador y reintentá. Código 200500.";
  return `No se pudo completar la verificación de seguridad. Reintentá${failure.code ? ` (código ${failure.code})` : ""}.`;
}

interface TurnstileChallengeProps {
  onTokenChange: (token: string | null) => void;
  resetKey?: number;
}

export function TurnstileChallenge({ onTokenChange, resetKey = 0 }: TurnstileChallengeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tokenCallbackRef = useRef(onTokenChange);
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);
  tokenCallbackRef.current = onTokenChange;

  useEffect(() => {
    if (!SITE_KEY || !containerRef.current) return;
    let active = true;
    let widgetId: string | null = null;
    let failed = false;
    let ownedScript: HTMLScriptElement | null = null;
    const report = (next: Failure) => {
      if (!active) return;
      failed = true;
      tokenCallbackRef.current(null);
      setFailure(next);
    };
    tokenCallbackRef.current(null);
    setFailure(null);

    // Keep one API script across form remounts. A failed script is removed so
    // the visitor's explicit retry can make a fresh request without reloading
    // the form and losing its values.
    if (!window.turnstile && !document.getElementById(SCRIPT_ID)) {
      const script = document.createElement("script");
      ownedScript = script;
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.onerror = () => {
        script.remove();
        report({ stage: "script" });
      };
      document.head.appendChild(script);
    }

    const poll = window.setInterval(() => {
      if (!active || !window.turnstile || widgetId || !containerRef.current) return;
      try {
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          theme: "auto",
          size: "flexible",
          callback: (token) => {
            if (!active) return;
            setFailure(null);
            tokenCallbackRef.current(token);
          },
          "error-callback": (errorCode) => {
            report({ stage: "challenge", code: turnstileDiagnostic(errorCode) });
            return true;
          },
          "expired-callback": () => report({ stage: "expired" }),
          "timeout-callback": () => report({ stage: "expired" }),
        });
        window.clearInterval(poll);
      } catch {
        report({ stage: "render" });
        window.clearInterval(poll);
      }
    }, 100);
    const timeout = window.setTimeout(() => {
      window.clearInterval(poll);
      if (!widgetId && !failed) {
        if (ownedScript && document.getElementById(SCRIPT_ID) === ownedScript) ownedScript.remove();
        report({ stage: "script" });
      }
    }, LOAD_TIMEOUT_MS);

    return () => {
      active = false;
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [attempt, resetKey]);

  if (!SITE_KEY) return null;

  return (
    <div>
      <div ref={containerRef} />
      {failure ? (
        <div role="alert" className="onb-err">
          <p>{turnstileFailureMessage(failure)}</p>
          <button type="button" className="au-link" onClick={() => {
            if (failure.stage === "script" && !window.turnstile) document.getElementById(SCRIPT_ID)?.remove();
            setAttempt((value) => value + 1);
          }}>
            Reintentar verificación
          </button>
        </div>
      ) : null}
    </div>
  );
}
