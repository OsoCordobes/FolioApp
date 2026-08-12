/**
 * Folio · /onboarding (Server Component)
 *
 * Wizard de 8 pasos premium con resume state.
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
import { MotionProvider } from "@/components/motion/motion-provider";
import { getActiveContext } from "@/lib/db/active-context";
import { getOnboardingResumeState } from "@/lib/db/onboarding-resume";
// Server-only (resuelve MP_PLAN_PRICE_CENTS de env). Se baja como prop para
// que el wizard (client) muestre el MISMO precio que el cobro real — antes
// estaba hardcodeado en Step 1/8 y podía driftear del env de prod.
import { MP_PLAN_PRICE_CENTS } from "@/lib/mercadopago/client";
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
  // Email del user autenticado. Si está set, /onboarding sabe que NO tiene
  // que mostrar el form de email+password de Step 1 — basta con consent +
  // bootstrap (los users de Google OAuth no tienen password de Supabase).
  let authedEmail: string | undefined;
  // Estado real de la integración Google Calendar (Step 7: "Conectado ✓").
  let googleConnected = false;

  if (user) {
    authedEmail = user.email ?? undefined;
    const result = await getOnboardingResumeState(user.id, user.email ?? "");
    if (result.ok) {
      if (!result.data.shouldShowOnboarding) {
        // Onboarding ya completado → no debería estar acá. Pero antes de
        // mandarlo a /hoy hay que confirmar que /hoy lo va a poder recibir:
        // getOnboardingResumeState usa un service client y ve cosas que el
        // usuario NO puede leer bajo RLS. Cuando decía "completo" y el layout
        // de (app) resolvía `not_found` con el client del usuario, ese layout
        // devolvía a /onboarding, que volvía a decir "completo": el usuario
        // quedaba rebotando entre dos pantallas para siempre, sin ningún
        // mensaje.
        //
        // El chequeo va acá y no en el layout porque acá todavía hay a dónde
        // mandarlo. redirect() lanza NEXT_REDIRECT, así que NO puede ir dentro
        // de un try/catch — por eso se resuelve el contexto primero y se
        // redirige después, fuera de cualquier captura.
        const ctx = await getActiveContext();
        if (!ctx.ok) {
          console.error(
            `[onboarding] resume dice completo pero getActiveContext falló para user ${user.id}: ${ctx.error.code} ${ctx.error.message}`,
          );
          redirect("/cuenta-error");
        }
        redirect("/hoy");
      }
      initialStep = result.data.initialStep;
      initialData = result.data.initialData as Record<string, unknown>;
      organizationId = result.data.organizationId ?? undefined;
      initialSlug = result.data.slug ?? undefined;
      googleConnected = result.data.googleConnected;
    } else {
      // No silenciar errores de DB: si no podemos leer el estado del wizard,
      // mandamos al user a /hoy con su sesión activa. El layout (app) tiene
      // su propio getActiveContext que decidirá si redirigir de vuelta a
      // onboarding o tirar error boundary. Loguear para investigar.
      console.error(
        `[onboarding] getOnboardingResumeState falló para user ${user.id}: ${result.error.message}`,
      );
      redirect("/hoy");
    }
  }

  return (
    <MotionProvider>
      <Suspense fallback={<OnboardingFallback />}>
        <OnboardingApp
          initialStep={initialStep}
          initialData={initialData}
          organizationId={organizationId}
          initialSlug={initialSlug}
          authedEmail={authedEmail}
          planPriceCents={MP_PLAN_PRICE_CENTS}
          googleConnected={googleConnected}
        />
      </Suspense>
    </MotionProvider>
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
