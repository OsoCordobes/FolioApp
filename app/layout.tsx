import type { Metadata } from "next";

import { CookieBanner } from "@/components/cookie-banner";
import { FolioPostHogProvider } from "@/lib/observability/posthog-client";
import { QueryProvider } from "@/lib/query-client";
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
 * Fonts: Geist + Geist Mono + Fraunces (display variable, opsz 9..144 +
 * weights 400/500/600) via Google Fonts CDN. Fraunces se usa en
 * <PublicCard> hero, Step 9 reveal y mood "editorial" / "boutique";
 * Geist body y Geist Mono data permanecen. Las tres familias viajan en
 * un único <link> stylesheet (un solo HTTP, un solo cache entry).
 * Self-hosting evaluado en F11 si Lighthouse lo demanda — para entonces
 * las tres se mueven juntas a /public/fonts.
 *
 * `data-theme="light"` se setea en SSR para evitar FOUC; TweaksProvider
 * (en el cliente) puede sobreescribirlo post-hydration leyendo localStorage.
 * `suppressHydrationWarning` protege contra el diff esperado de ese cambio.
 *
 * CookieBanner (Phase 6b) renders fixed-bottom on first visit; the user's
 * choice ('granted' | 'denied') persists in localStorage and gates the
 * PostHog SDK init inside FolioPostHogProvider.
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
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/folio.css" />
      </head>
      <body>
        <FolioPostHogProvider>
          <QueryProvider>
            <TweaksProvider>{children}</TweaksProvider>
          </QueryProvider>
        </FolioPostHogProvider>
        <CookieBanner />
      </body>
    </html>
  );
}
