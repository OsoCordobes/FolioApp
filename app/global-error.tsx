"use client";

/**
 * Folio · Global error boundary del App Router (Next 15).
 *
 * Se dispara cuando un error ocurre en el layout raíz mismo o en lugares
 * donde app/error.tsx no puede atrapar (ej. RootLayout crashea durante
 * renderizado). Debe declarar su propio <html>/<body> porque el layout
 * raíz no se montó.
 *
 * Sentry capture vía useEffect (mismo patrón que app/error.tsx). El
 * styling es mínimo y NO depende de folio.css (que se carga en RootLayout
 * y puede no estar disponible acá).
 */

import { captureException } from "@sentry/nextjs";
import { useEffect } from "react";

import { SUPPORT_EMAIL } from "@/lib/support";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    captureException(error, {
      tags: { boundary: "app/global-error.tsx" },
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <html lang="es-AR">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Folio — no se pudo iniciar</title>
      </head>
      <body
        style={{
          margin: 0,
          boxSizing: "border-box",
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 24px",
          background: "#F5F5FA",
          color: "#292641",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
        }}
      >
        <style>{`button:focus-visible, a:focus-visible { outline: 3px solid #6255C5; outline-offset: 4px; }`}</style>
        <main style={{ boxSizing: "border-box", maxWidth: 480, width: "100%", display: "flex", flexDirection: "column", gap: 20, padding: "32px 24px", background: "#FFFFFF", border: "1px solid #DAD9E7", borderRadius: 16 }}>
          <p style={{ margin: 0, color: "#6255C5", fontWeight: 600, fontSize: 13 }}>Folio</p>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>No pudimos iniciar Folio</h1>
          <p style={{ margin: 0, lineHeight: 1.6, color: "#4B485F" }}>
            Volvé a intentarlo. Si el problema continúa,
            escribinos a <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "#6255C5", overflowWrap: "anywhere" }}>{SUPPORT_EMAIL}</a>.
          </p>
          {error.digest ? (
            <p style={{ margin: 0, fontSize: 12, fontFamily: "monospace", color: "#69657D", overflowWrap: "anywhere" }}>
              Referencia para soporte: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              alignSelf: "center",
              marginTop: 8,
              padding: "10px 20px",
              minHeight: 44,
              borderRadius: 9,
              border: "none",
              background: "#6255C5",
              color: "#FFFFFF",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
