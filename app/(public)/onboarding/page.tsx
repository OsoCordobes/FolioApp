/**
 * Folio · /onboarding
 *
 * Wizard de 9 pasos. Step 1 → signUpEmail. Step 9 → completeOnboarding.
 * Persistencia entre pasos vía localStorage.
 *
 * `useSearchParams()` (en OnboardingApp) requiere Suspense en App Router.
 */

import { Suspense } from "react";

import { OnboardingApp } from "@/components/onboarding/onboarding-app";

export default function OnboardingPage() {
  return (
    <Suspense fallback={<OnboardingFallback />}>
      <OnboardingApp />
    </Suspense>
  );
}

function OnboardingFallback() {
  return (
    <div className="onb-app">
      <header className="onb-app-head">
        <div className="onb-app-brand">
          <span className="onb-brand-name">folio</span>
        </div>
        <span />
      </header>
      <main className="onb-app-main" />
    </div>
  );
}
