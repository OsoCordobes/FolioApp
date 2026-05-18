/**
 * Folio · /onboarding
 *
 * Wizard de 9 pasos que arranca después del signup. Port del prototipo
 * (`Folio · Onboarding.html` + `folio/onboarding.jsx` + steps).
 *
 * En F1 solo Step1 (Registro) está implementado para validar el baseline
 * pixel-perfect. Los pasos 2-9 se agregan en F3 cuando auth + tenancy
 * entran y necesitan el flow completo (matrícula, consultorio, horarios,
 * servicios, Google Calendar, Mercado Pago, listo).
 */

import { OnboardingApp } from "@/components/onboarding/onboarding-app";

export default function OnboardingPage() {
  return <OnboardingApp />;
}
