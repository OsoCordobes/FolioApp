import { notFound } from "next/navigation";
import { Suspense } from "react";

import { OnboardingFlowFixture } from "./preview";
import { computeMonthlyPriceCents, resolveClinicSeatPriceCents } from "@/lib/billing/pricing";

export const dynamic = "force-dynamic";
export const metadata = { title: "Folio · Alta sintética", robots: { index: false, follow: false } };

/** Local browser fixture. It cannot resolve an account or write provider data. */
export default function OnboardingFlowFixturePage() {
  if (process.env.NODE_ENV === "production" || process.env.FOLIO_TEST_ISOLATED !== "1") notFound();
  return <Suspense fallback={null}><OnboardingFlowFixture
    soloPriceCents={computeMonthlyPriceCents("INDEPENDIENTE", 1)}
    clinicPriceCents={computeMonthlyPriceCents("CLINICA", 1)}
    clinicSeatPriceCents={resolveClinicSeatPriceCents()}
  /></Suspense>;
}
