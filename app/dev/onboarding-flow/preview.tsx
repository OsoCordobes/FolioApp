"use client";

import { useSearchParams } from "next/navigation";

import { OnboardingApp } from "@/components/onboarding/onboarding-app";
import { ONBOARDING_INITIAL, type OnboardingDataState } from "@/components/onboarding/steps";
import { MotionProvider } from "@/components/motion/motion-provider";

type Mode = "solo" | "clinic-treating" | "clinic-admin";
const ORG_ID = "12600000-0000-4000-8000-000000000126";

export function OnboardingFlowFixture() {
  const params = useSearchParams();
  const candidate = params.get("mode");
  const mode: Mode = candidate === "clinic-treating" || candidate === "clinic-admin" ? candidate : "solo";
  const step = Math.min(8, Math.max(2, Number(params.get("step")) || 2));
  const tipo = mode === "solo" ? "INDEPENDIENTE" : "CLINICA";
  const ownerTratante = mode !== "clinic-admin";
  const completedFields = step > 2;
  const fixture: OnboardingDataState = {
    ...ONBOARDING_INITIAL,
    tipo,
    ownerTratante,
    email: "titular@example.test",
    nombre: completedFields ? "Valentina" : "",
    apellido: completedFields ? "Costa" : "",
    consultorioNombre: completedFields ? (tipo === "CLINICA" ? "Clínica Ficticia" : "Consultorio Ficticio") : "",
    rubro: completedFields ? "cardiologia" : "",
    especialidad: completedFields ? "cardiologia" : "",
    ciudad: completedFields ? "Córdoba" : "",
    provincia: completedFields ? "Córdoba" : "",
    servicios: completedFields && ownerTratante ? [{ id: 1, nombre: "Consulta sintética", dur: 45, precio: 10000 }] : [],
  };
  return <MotionProvider><OnboardingApp
    key={`${mode}-${step}`}
    initialStep={step}
    initialData={{ ...fixture }}
    organizationId={ORG_ID}
    initialSlug="folio-test-onboarding-flow"
    authedEmail="titular@example.test"
    soloPriceCents={3000000}
    clinicPriceCents={6000000}
    clinicSeatPriceCents={1500000}
    syntheticFixture
  /></MotionProvider>;
}
