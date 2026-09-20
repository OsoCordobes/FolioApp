import type { PublicLandingViewData } from "@/components/book-landing/book-landing-view";
import type { OnboardingDataState } from "@/components/onboarding/steps";

/** Draft-only adapter to the same composition used by /book. Never claims a
 * clinic owner or an invitation is a visible, accepted professional. */
export function toOnboardingLandingPreview(
  data: OnboardingDataState,
  slug?: string,
): PublicLandingViewData | undefined {
  if (!data.tipo) return undefined;
  const fullName = [data.nombre, data.apellido].filter(Boolean).join(" ").trim();
  return {
    org: {
      tipo: data.tipo,
      nombre: data.consultorioNombre.trim() || (data.tipo === "CLINICA" ? "Tu clínica" : "Tu consultorio"),
      slug,
      ciudad: data.ciudad || null,
      provincia: data.provincia || null,
      rubro: data.rubro || null,
      especialidad: data.especialidad || null,
      acentoHex: data.acento,
      logoUrl: data.logoUrl,
      cardMood: data.cardMood,
      bio: data.bio || null,
      telefonoPublico: data.telefonoPublico || null,
      direccionCompleta: data.direccion || null,
      instagramHandle: data.instagram || null,
    },
    profesional: data.tipo === "INDEPENDIENTE" && data.ownerTratante === true && fullName
      ? { id: "draft-owner", displayName: fullName, matricula: data.matricula || null }
      : null,
    profesionales: [],
    servicios: data.servicios.filter((s) => s.nombre.trim() && s.dur > 0).map((s) => ({
      id: String(s.id), nombre: s.nombre, duracion_min: s.dur,
      precio_cents: Math.round(s.precio * 100), tipo_canonico: s.tipoCanonico || null,
    })),
  };
}
