"use client";

/**
 * Folio · Onboarding · shell con header global + main.
 *
 * Port simplificado de OnboardingApp en folio/onboarding.jsx (130-251).
 * En F1 solo Step1 (Registro) está implementado. Los pasos 2-8 + 9 (listo)
 * + PostOnboardingPanel se materializan en F3 cuando auth real entre.
 *
 * No depende de tweaks-panel (esa UI viene en F11).
 */

import { useState } from "react";

import { FolioMark } from "@/components/folio-mark";
import { Step1Registro } from "@/components/onboarding/step1-registro";

interface OnboardingData {
  email: string;
  password: string;
}

const INITIAL_DATA: OnboardingData = {
  email: "",
  password: "",
};

export function OnboardingApp() {
  const [stepIdx, setStepIdx] = useState(1);
  const [data, setData] = useState<OnboardingData>(INITIAL_DATA);

  const set = (patch: Partial<OnboardingData>) => setData((prev) => ({ ...prev, ...patch }));
  const next = () => setStepIdx((n) => Math.min(9, n + 1));

  return (
    <div className="onb-app">
      <header className="onb-app-head">
        <div className="onb-app-brand">
          <FolioMark size={24} />
          <span className="onb-brand-name">folio</span>
        </div>
        {stepIdx > 1 && stepIdx < 9 ? (
          <button type="button" className="onb-skip-to-panel">
            Ir al panel ahora →
          </button>
        ) : (
          <span />
        )}
      </header>

      <main className="onb-app-main">
        {stepIdx === 1 ? <Step1Registro data={data} set={set} next={next} /> : null}
        {/* Steps 2-9 se implementan en F3 (auth + multi-tenancy + onboarding flow completo) */}
      </main>
    </div>
  );
}
