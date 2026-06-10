/**
 * Folio · Landing de marketing — página raíz pública (/).
 *
 * Narrativa: hero → confianza → features → showcase → seguridad legal →
 * precios → FAQ → CTA final. Server components salvo dos islands:
 * ProductShowcase (framer-motion, mount diferido) y LandingAnalytics
 * (PostHog, no-op sin cookie consent). Anclas estables para el header:
 * #producto, #seguridad, #precios, #faq.
 */

import { LandingAnalytics } from "@/components/landing/landing-analytics";
import { ProductShowcase } from "@/components/landing/product-showcase";
import { Faq } from "@/components/landing/sections/faq";
import { Features } from "@/components/landing/sections/features";
import { FinalCta } from "@/components/landing/sections/final-cta";
import { Hero } from "@/components/landing/sections/hero";
import { Pricing } from "@/components/landing/sections/pricing";
import { Security } from "@/components/landing/sections/security";
import { TrustStrip } from "@/components/landing/sections/trust-strip";

export default function LandingPage() {
  return (
    <main id="contenido" className="fl-main">
      <Hero />
      <TrustStrip />
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
