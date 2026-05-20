/**
 * Folio · /onboarding (Server Component)
 *
 * Wizard de 9 pasos premium con resume state.
 *
 * Si el user llega ya logueado (auth.user existe), leemos su estado de DB:
 *   - Si onboarding_completed=true → redirect /hoy (no debería estar acá).
 *   - Si tiene org en progreso → pasamos initialStep + initialData para resumir.
 *
 * Si el user llega sin sesión, arrancamos en step 1 (signup). El cliente maneja
 * la creación de cuenta y a partir del step 2 ya hay sesión.
 *
 * `useSearchParams()` (en OnboardingApp) requiere Suspense en App Router.
 */

import { redirect } from "next/navigation";
import { Suspense } from "react";

import { OnboardingApp } from "@/components/onboarding/onboarding-app";
import { getOnboardingResumeState } from "@/lib/db/onboarding-resume";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Si hay sesión, intentar resume state.
  let initialStep: number | undefined;
  let initialData: Record<string, unknown> | undefined;
  let organizationId: string | undefined;
  let initialSlug: string | undefined;

  if (user) {
    const result = await getOnboardingResumeState(user.id, user.email ?? "");
    if (result.ok) {
      if (!result.data.shouldShowOnboarding) {
        // Onboarding ya completado → no debería estar acá. Mandar a /hoy.
        redirect("/hoy");
      }
      initialStep = result.data.initialStep;
      initialData = result.data.initialData as Record<string, unknown>;
      organizationId = result.data.organizationId ?? undefined;
      initialSlug = result.data.slug ?? undefined;
    }
    // Si falla el lookup, dejamos initial* en undefined → cliente arranca de cero.
  }

  return (
    <Suspense fallback={<OnboardingFallback />}>
      <OnboardingApp
        initialStep={initialStep}
        initialData={initialData}
        organizationId={organizationId}
        initialSlug={initialSlug}
      />
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
