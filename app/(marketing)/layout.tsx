import type { Metadata } from "next";

/**
 * Folio · Layout del grupo (marketing) — landing pública.
 *
 * Fase A (fundación): estructura mínima. El header de navegación y el
 * footer de marketing llegan en Fase B. El SEO completo (OpenGraph,
 * JSON-LD, canonical) llega en Fase C — acá queda solo el metadata base.
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
  // Header/footer de marketing se agregan en Fase B.
  return <div className="fl-root">{children}</div>;
}
