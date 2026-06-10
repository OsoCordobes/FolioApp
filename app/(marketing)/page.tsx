/**
 * Folio · Landing de marketing — página raíz pública (/).
 *
 * Narrativa: hero → confianza → features → showcase → seguridad legal →
 * precios → FAQ → CTA final. Server components salvo dos islands:
 * ProductShowcase (framer-motion, mount diferido) y LandingAnalytics
 * (PostHog, no-op sin cookie consent). Anclas estables para el header:
 * #producto, #seguridad, #precios, #faq.
 *
 * JSON-LD (Fase C · SEO): un solo script con `@graph` —
 * SoftwareApplication (precios derivados de las MISMAS fuentes que la
 * sección Pricing: MP_PLAN_PRICE_CENTS + resolveClinicBasePriceCents) y
 * FAQPage desde FAQ_ITEMS, la misma data que renderiza <Faq />.
 */

import { FAQ_ITEMS } from "@/components/landing/faq-data";
import { LandingAnalytics } from "@/components/landing/landing-analytics";
import { ProductShowcase } from "@/components/landing/product-showcase";
import { Faq } from "@/components/landing/sections/faq";
import { Features } from "@/components/landing/sections/features";
import { FinalCta } from "@/components/landing/sections/final-cta";
import { Hero } from "@/components/landing/sections/hero";
import { Pricing } from "@/components/landing/sections/pricing";
import { Security } from "@/components/landing/sections/security";
import { getBaseUrl } from "@/lib/base-url";
import { resolveClinicBasePriceCents } from "@/lib/billing/pricing";
import { MP_PLAN_PRICE_CENTS } from "@/lib/mercadopago/client";

const BASE_URL = getBaseUrl();

function buildJsonLd(): string {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "Folio",
        applicationCategory: "Medical",
        operatingSystem: "Web",
        inLanguage: "es-AR",
        url: BASE_URL,
        description:
          "Agenda de turnos con reservas online, historia clínica digital y cobros con Mercado Pago para profesionales de la salud en Argentina.",
        offers: [
          {
            "@type": "Offer",
            name: "Plan Solo",
            price: Math.round(MP_PLAN_PRICE_CENTS / 100),
            priceCurrency: "ARS",
          },
          {
            "@type": "Offer",
            name: "Plan Clínica",
            price: Math.round(resolveClinicBasePriceCents() / 100),
            priceCurrency: "ARS",
          },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ_ITEMS.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };
  // `<` escapado para que ningún texto pueda cerrar el <script> (XSS hygiene).
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}

export default function LandingPage() {
  return (
    <main id="contenido" className="fl-main">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: buildJsonLd() }}
      />
      <Hero />
      <Features />
      <ProductShowcase />
      <Security />
      <Pricing />
      <Faq />
      <FinalCta />
      <LandingAnalytics />
    </main>
  );
}
