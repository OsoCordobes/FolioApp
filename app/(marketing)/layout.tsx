import type { Metadata } from "next";

import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";
import { getBaseUrl } from "@/lib/base-url";

/**
 * Folio · Layout del grupo (marketing) — landing pública.
 *
 * Header sticky + footer envuelven el contenido. SEO completo (Fase C):
 * metadataBase + canonical + OpenGraph/Twitter. La imagen OG la emite
 * `opengraph-image.tsx` del mismo segmento — Next la inyecta solo, no se
 * declara acá. El JSON-LD vive en `page.tsx`.
 */

const TITLE = "Folio — Agenda, historia clínica y cobros para profesionales de la salud";
const DESCRIPTION =
  "El día de tu consultorio, armado solo: turnos, reservas online, recordatorios por WhatsApp e historias clínicas cifradas. Para profesionales de la salud en Argentina.";

export const metadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  // `absolute` opta fuera del template "%s · Folio" del root layout — el
  // título del landing ya lleva la marca adelante.
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  keywords: [
    "turnos médicos",
    "agenda médica",
    "historia clínica electrónica",
    "software para consultorio",
    "gestión de consultorio",
    "reservas online de turnos",
    "software médico argentina",
  ],
  openGraph: {
    type: "website",
    locale: "es_AR",
    siteName: "Folio",
    url: "/",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="fl-root">
      <LandingHeader />
      {children}
      <LandingFooter />
    </div>
  );
}
