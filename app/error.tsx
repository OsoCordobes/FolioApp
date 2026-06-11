"use client";

/**
 * Folio · Error boundary global del App Router.
 *
 * Captura uncaught exceptions de Server Components y Client Components
 * dentro del layout principal. La versión raíz de un layout error (que
 * no puede manejar este boundary) se cubre en app/global-error.tsx.
 *
 * Comportamiento:
 *   - Sentry captura automáticamente vía useEffect.
 *   - El user ve mensaje accionable en español con dos opciones:
 *       "Reintentar" → reset() (Next reintenta render).
 *       "Volver al inicio" → /hoy.
 *   - El error técnico nunca se muestra al user (PII potencial).
 *
 * Diseño: idéntico a app/not-found.tsx para consistencia visual.
 */

import { captureException } from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

import { SUPPORT_EMAIL } from "@/lib/support";

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    captureException(error, {
      tags: { boundary: "app/error.tsx" },
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        background: "var(--bg)",
        color: "var(--ink)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <p
          style={{
            margin: 0,
            color: "var(--accent-warm)",
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontSize: 13,
          }}
        >
          Error inesperado
        </p>
        <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.2 }}>
          Algo se rompió
        </h1>
        <p style={{ margin: 0, color: "var(--ink-2)", lineHeight: 1.6 }}>
          Ya estamos avisados — Sentry capturó el error y lo estamos viendo.
          Podés reintentar o volver al inicio. Si sigue fallando, escribinos a{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "var(--accent)" }}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
        {error.digest ? (
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: "var(--ink-3)",
              fontFamily: "var(--font-mono)",
            }}
          >
            ID del error: {error.digest}
          </p>
        ) : null}
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
            marginTop: 8,
          }}
        >
          <button type="button" className="fi-btn fi-btn-primary" onClick={() => reset()}>
            Reintentar
          </button>
          <Link href="/hoy" className="fi-btn fi-btn-ghost">
            Volver al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}
