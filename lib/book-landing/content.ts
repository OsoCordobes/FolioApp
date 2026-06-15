/**
 * Folio · contenido adaptado para la landing pública /book/[slug].
 * SERVER-SAFE (sin React). Solo aplica copy específico de especialidad cuando
 * organization.especialidad es uno de los slugs conocidos (quiropraxia /
 * cardiologia / psicologia). Para cualquier otra org (especialidad NULL, que
 * es la mayoría hoy) cae a un contenido NEUTRAL derivado del rubro real — así
 * nunca le ponemos "Quiropraxia" a un kinesiólogo.
 */

import { isEspecialidadSlug, type EspecialidadSlug } from "@/lib/especialidades/meta";
import { formatRubro } from "@/lib/format/identity";

/** Motivo gráfico del acento; "none" = sin motivo (fallback neutral). */
export type BookLandingMotif = "spine" | "heart" | "mind" | "none";

export interface BookLandingContent {
  /** Eyebrow del hero (sobre el nombre). */
  heroEyebrow: string;
  /** Frase de valor bajo el nombre. */
  heroValueLine: string;
  /** Label del CTA primario ("Reservar consulta" / "Reservar sesión" / ...). */
  reservarCtaLabel: string;
  /** Encuadre de la futura sección de confianza/seguridad (Slice 2). */
  trustFraming: string;
  /** Motivo gráfico que acompaña el eyebrow. */
  motif: BookLandingMotif;
}

const ESP_CONTENT: Record<EspecialidadSlug, BookLandingContent> = {
  quiropraxia: {
    heroEyebrow: "Quiropraxia",
    heroValueLine: "Tratamiento y seguimiento de tu columna, turno a turno.",
    reservarCtaLabel: "Reservar sesión",
    trustFraming: "Tu historial de ajustes, privado y siempre a mano.",
    motif: "spine",
  },
  cardiologia: {
    heroEyebrow: "Cardiología",
    heroValueLine: "Control cardiológico con seguimiento clínico continuo.",
    reservarCtaLabel: "Reservar consulta",
    trustFraming: "Tu seguimiento cardiovascular, cifrado y conservado con vos.",
    motif: "heart",
  },
  psicologia: {
    heroEyebrow: "Psicología",
    heroValueLine: "Un espacio de escucha, en tus horarios.",
    reservarCtaLabel: "Reservar sesión",
    trustFraming: "Lo que hablás queda entre vos y tu profesional. Cifrado de punta a punta.",
    motif: "mind",
  },
};

export function resolveBookLandingContent(
  especialidad: string | null | undefined,
  rubro: string | null | undefined,
): BookLandingContent {
  if (especialidad && isEspecialidadSlug(especialidad)) {
    return ESP_CONTENT[especialidad];
  }
  const rubroLabel = formatRubro(rubro);
  return {
    heroEyebrow: rubroLabel || "Turnos online",
    heroValueLine: "Reservá tu turno online en menos de un minuto.",
    reservarCtaLabel: "Reservar turno",
    trustFraming: "Tus datos, protegidos y siempre a mano.",
    motif: "none",
  };
}
