"use client";

import { StepShell } from "@/components/onboarding/step-shell";
import { formatArsFromCents } from "@/lib/format/currency";
import type { OnboardingDataState } from "./steps";

export function Step1Choice({ data, set, onContinue, soloPriceCents, clinicPriceCents, clinicSeatPriceCents }: {
  data: OnboardingDataState;
  set: (patch: Partial<OnboardingDataState>) => void;
  onContinue: () => void;
  soloPriceCents: number;
  clinicPriceCents: number;
  clinicSeatPriceCents: number;
}) {
  const ready = data.tipo === "INDEPENDIENTE" || (data.tipo === "CLINICA" && data.ownerTratante !== null);
  return <StepShell stepIdx={1} headline="¿Cómo vas a usar Folio?" sub="Elegí antes de crear tu cuenta. La modalidad y el rol del titular definen qué vas a configurar." next={onContinue} nextDisabled={!ready} canSkip={false} nextLabel="Seguir con esta opción">
    <fieldset className="onb-choice-group">
      <legend className="onb-choice-label">Modalidad</legend>
      <label className={`onb-choice ${data.tipo === "INDEPENDIENTE" ? "is-selected" : ""}`}>
        <input type="radio" name="onboarding-tipo" checked={data.tipo === "INDEPENDIENTE"} onChange={() => set({ tipo: "INDEPENDIENTE", ownerTratante: true })} />
        <span><strong>Profesional independiente</strong><small>Tu consultorio, servicios y agenda personal.</small><em>{formatArsFromCents(soloPriceCents)} / mes después de la prueba</em></span>
      </label>
      <label className={`onb-choice ${data.tipo === "CLINICA" ? "is-selected" : ""}`}>
        <input type="radio" name="onboarding-tipo" checked={data.tipo === "CLINICA"} onChange={() => set({ tipo: "CLINICA", ownerTratante: null })} />
        <span><strong>Clínica</strong><small>Una organización para invitar profesionales y equipo.</small><em>Base {formatArsFromCents(clinicPriceCents)} / mes + {formatArsFromCents(clinicSeatPriceCents)} por miembro adicional</em></span>
      </label>
    </fieldset>
    {data.tipo === "CLINICA" ? <fieldset className="onb-choice-group onb-choice-followup">
      <legend className="onb-choice-label">¿Vos también vas a atender pacientes?</legend>
      <label className="onb-choice-compact"><input type="radio" name="owner-tratante" checked={data.ownerTratante === true} onChange={() => set({ ownerTratante: true })} /> Sí, atiendo en la clínica</label>
      <label className="onb-choice-compact"><input type="radio" name="owner-tratante" checked={data.ownerTratante === false} onChange={() => set({ ownerTratante: false })} /> No, administro la clínica</label>
      <p className="onb-hint">Si no atendés, no te pediremos matrícula, horarios ni Google Calendar personal. Podrás invitar a quienes atienden después.</p>
    </fieldset> : null}
    <p className="onb-choice-note">30 días de prueba sin tarjeta. Las invitaciones pendientes no cuentan como profesionales disponibles.</p>
  </StepShell>;
}
