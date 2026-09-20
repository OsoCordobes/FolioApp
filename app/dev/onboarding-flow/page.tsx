import { notFound } from "next/navigation";
import { Suspense } from "react";

import { OnboardingFlowFixture } from "./preview";

export const dynamic = "force-dynamic";
export const metadata = { title: "Folio · Alta sintética", robots: { index: false, follow: false } };

/** Local browser fixture. It cannot resolve an account or write provider data. */
export default function OnboardingFlowFixturePage() {
  if (process.env.NODE_ENV === "production" || process.env.FOLIO_TEST_ISOLATED !== "1") notFound();
  return <Suspense fallback={null}><OnboardingFlowFixture /></Suspense>;
}
