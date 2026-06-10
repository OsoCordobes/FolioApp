import type { Metadata } from "next";

import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";

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
  "Agenda de turnos con reservas online, historia clínica digital y cobros con Mercado Pago. Tu consultorio en orden, hecho para profesionales de la salud en Argentina.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://folio-app-ten.vercel.app"),
  title: TITLE,
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
