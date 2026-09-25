"use client";

import { BookLandingView, type PublicLandingLayout, type PublicLandingViewData } from "@/components/book-landing/book-landing-view";

/** Inert draft preview: same public composition, no booking action or network call. */
export function BookLandingPreview({ data, layout }: { data: PublicLandingViewData; layout?: PublicLandingLayout }) {
  const sinEquipoClinico = data.org.tipo === "CLINICA" && data.profesionales.length === 0;
  return (
    <BookLandingView
      data={data}
      mode="preview"
      layout={layout}
      booking={(
        <div className="bl-preview-booking">
          <p>{sinEquipoClinico
            ? "Cuando incorpores profesionales que atienden en el consultorio, podrás habilitar la reserva online."
            : "Los pacientes podrán elegir servicio y horario acá cuando habilites las reservas."}</p>
        </div>
      )}
    />
  );
}
