import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Folio",
  description: "Gestión de turnos, agenda clínica y finanzas para profesionales de la salud.",
};

/**
 * folio.css se sirve como static asset desde /public/ para garantizar
 * fidelidad 100% byte-perfect con el prototipo Claude Design (12,199 líneas
 * intactas, sin pasar por ningún bundler/postprocessor). Igual que en el
 * prototipo original, se carga vía <link rel="stylesheet">.
 *
 * Fonts: Geist + Geist Mono via Google Fonts CDN, idéntico al prototipo.
 * Self-hosting evaluado en F11 si Lighthouse lo demanda.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/folio.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
