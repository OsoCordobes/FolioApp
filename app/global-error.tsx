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
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 24px",
          background: "#faf8f3",
          color: "#1a1a1a",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 480, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>Algo se rompió</h1>
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            La app no pudo iniciar correctamente. Reintentá; si sigue fallando,
            escribinos a <a href="mailto:soporte@folio.app">soporte@folio.app</a>.
          </p>
          {error.digest ? (
            <p style={{ margin: 0, fontSize: 12, fontFamily: "monospace", opacity: 0.6 }}>
              ID del error: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              alignSelf: "center",
              marginTop: 8,
              padding: "10px 20px",
              borderRadius: 999,
              border: "none",
              background: "#1a1a1a",
              color: "#faf8f3",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
