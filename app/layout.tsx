import type { Metadata } from "next";

import { TweaksProvider } from "@/lib/tweaks-context";

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
 *
 * `data-theme="light"` se setea en SSR para evitar FOUC; TweaksProvider
 * (en el cliente) puede sobreescribirlo post-hydration leyendo localStorage.
 * `suppressHydrationWarning` protege contra el diff esperado de ese cambio.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" data-theme="light" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/folio.css" />
      </head>
      <body>
        <TweaksProvider>{children}</TweaksProvider>
      </body>
    </html>
  );
}
