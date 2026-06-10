import type { Metadata } from "next";

import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingHeader } from "@/components/landing/landing-header";

/**
 * Folio · Layout del grupo (marketing) — landing pública.
 *
 * Header sticky + footer envuelven el contenido. El SEO completo
 * (OpenGraph, JSON-LD, canonical) llega en Fase C — acá queda solo el
 * metadata base.
 */

export const metadata: Metadata = {
  title: "Folio — Agenda, historia clínica y cobros para profesionales de la salud",
  description:
    "Agenda de turnos con reservas online, historia clínica digital y cobros con Mercado Pago. Tu consultorio en orden, hecho para profesionales de la salud en Argentina.",
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
