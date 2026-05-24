import Link from "next/link";

/**
 * Folio · 404 global.
 *
 * Captura cualquier ruta inválida fuera de áreas con su propio not-found.
 * Las rutas públicas con copy específico (ej: /book/[slug]) tienen su
 * propio archivo not-found.tsx en su segmento.
 *
 * Diseño: alineado a folio.css (variables --surface, --ink, --accent-warm).
 * Responsive: layout funciona en 1440×900 y mobile 390×844.
 */

export const metadata = {
  title: "Página no encontrada · Folio",
};

export default function NotFound() {
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
          404
        </p>
        <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.2 }}>
          Esta página no existe
        </h1>
        <p style={{ margin: 0, color: "var(--ink-2)", lineHeight: 1.6 }}>
          La ruta que pediste no está en Folio o fue movida. Si llegaste por un
          link, contanos para que la actualicemos.
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
            marginTop: 8,
          }}
        >
          <Link href="/hoy" className="fi-btn fi-btn-primary">
            Volver al inicio
          </Link>
          <a
            href="mailto:soporte@folio.app?subject=Folio%20%E2%80%94%20p%C3%A1gina%20no%20encontrada"
            className="fi-btn fi-btn-ghost"
          >
            Escribir a soporte
          </a>
        </div>
      </div>
    </main>
  );
}
