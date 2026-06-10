/**
 * Folio · Landing de marketing — página raíz pública (/).
 *
 * Narrativa: hero (08:00, el día arranca) → timeline del día (#dia) →
 * bóveda de seguridad (#seguridad) → bento de producto (#producto) →
 * precios (#precios) → FAQ (#faq) → CTA de cierre. Server components
 * en su totalidad — la timeline y las demos del bento animan con CSS puro
 * (animation-timeline: view()); los únicos islands client son el toggle de
 * nav mobile y LandingAnalytics (PostHog, no-op sin cookie consent).
 * Anclas estables para el header: #dia, #seguridad, #producto, #precios, #faq.
 *
 * JSON-LD (Fase C · SEO): un solo script con `@graph` —
 * SoftwareApplication (precios derivados de las MISMAS fuentes que la
 * sección Pricing: MP_PLAN_PRICE_CENTS + resolveClinicBasePriceCents) y
 * FAQPage desde FAQ_ITEMS, la misma data que renderiza <Faq />.
 */

import { FAQ_ITEMS } from "@/components/landing/faq-data";
import { LandingAnalytics } from "@/components/landing/landing-analytics";
import { Bento } from "@/components/landing/sections/bento";
import { DayTimeline } from "@/components/landing/sections/day-timeline";
import { Faq } from "@/components/landing/sections/faq";
import { FinalCta } from "@/components/landing/sections/final-cta";
import { Hero } from "@/components/landing/sections/hero";
import { Pricing } from "@/components/landing/sections/pricing";
import { Vault } from "@/components/landing/sections/vault";
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
          "El día de tu consultorio, armado solo: turnos, reservas online, recordatorios por WhatsApp y notas clínicas cifradas con AES-256-GCM. Para profesionales de la salud en Argentina.",
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
      <DayTimeline />
      <Vault />
      <Bento />
      <Pricing />
      <Faq />
      <FinalCta />
      <LandingAnalytics />
    </main>
  );
}
