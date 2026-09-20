"use client";

import { BookLandingView, type PublicLandingViewData } from "@/components/book-landing/book-landing-view";

/** Inert draft preview: same public composition, no booking action or network call. */
export function BookLandingPreview({ data }: { data: PublicLandingViewData }) {
  return (
    <BookLandingView
      data={data}
      mode="preview"
      booking={(
        <div className="bl-preview-booking">
          <p>Los pacientes podrán elegir servicio y horario acá cuando publiques tu página.</p>
        </div>
      )}
    />
  );
}
