/**
 * Folio · Landing de marketing — página raíz pública (/).
 *
 * Clínica clara: agenda → recorrido del producto → día de atención →
 * especialidades → conexiones → privacidad → precios → FAQ y cierre.
 * Renderizado en servidor; recorrido por pestañas y navegación son islas
 * interactivas. LandingAnalytics respeta el consentimiento de cookies.
 * Anclas estables para el header: #dia, #seguridad, #producto, #precios, #faq.
 *
 * JSON-LD (Fase C · SEO): un solo script con `@graph` —
 * SoftwareApplication (precios derivados de las MISMAS fuentes que la
 * sección Pricing: MP_PLAN_PRICE_CENTS + resolveClinicBasePriceCents) y
 * FAQPage desde FAQ_ITEMS, la misma data que renderiza <Faq />.
 */

import { FolioExperience } from "@/components/landing/experience";
import { FAQ_ITEMS } from "@/components/landing/faq-data";
import { LandingAnalytics } from "@/components/landing/landing-analytics";
import { AuthRetornoAviso } from "@/components/landing/auth-retorno-aviso";
import { getAppUrl } from "@/lib/config/app-url";
import { resolveClinicBasePriceCents } from "@/lib/billing/pricing";
import { MP_PLAN_PRICE_CENTS } from "@/lib/mercadopago/client";

const BASE_URL = getAppUrl();

function buildJsonLd(): string {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${BASE_URL}#org`,
        name: "Folio",
        url: BASE_URL,
        areaServed: "AR",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${BASE_URL}#software`,
        name: "Folio",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        inLanguage: "es-AR",
        url: BASE_URL,
        publisher: { "@id": `${BASE_URL}#org` },
        description:
          "Agenda, historia clínica y cobros para organizar el trabajo de profesionales y equipos de salud en Argentina.",
        offers: [
          {
            "@type": "Offer",
            name: "Plan Solo",
            price: Math.round(MP_PLAN_PRICE_CENTS / 100),
            priceCurrency: "ARS",
            url: `${BASE_URL}/onboarding`,
            availability: "https://schema.org/InStock",
          },
          {
            "@type": "Offer",
            name: "Plan Clínica",
            price: Math.round(resolveClinicBasePriceCents() / 100),
            priceCurrency: "ARS",
            url: `${BASE_URL}/onboarding`,
            availability: "https://schema.org/InStock",
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
      {/* Un retorno de OAuth que no llegó al callback termina depositado acá
          por GoTrue (Site URL). Sin esto, la landing lo ignora y el usuario ve
          "toqué Continuar con Google y volví al inicio", sin explicación y sin
          que quede registro en ningún lado. Rinde null en el 99.9% de las
          visitas, que no traen nada en la URL. */}
      <AuthRetornoAviso />
      <FolioExperience />
      <LandingAnalytics />

    </main>
  );
}

