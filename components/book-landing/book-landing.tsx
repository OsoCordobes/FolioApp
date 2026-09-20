/** Published composition of the public profile and the real booking flow. */

import { BookLandingView, type PublicLandingOrg, type PublicLandingService } from "@/components/book-landing/book-landing-view";
import { BookingEntryProvider, ServiceReserveLink } from "@/components/book-landing/booking-entry";
import { BookingWizard } from "@/components/booking/booking-wizard";
import type { fetchSlotsPublico } from "@/app/(public)/book/[slug]/actions";
import type { ProfesionalPerfilPublico } from "@/lib/db/members";

export interface BookLandingOrg extends PublicLandingOrg {
  slug: string;
  ciudad: string | null;
  provincia: string | null;
  rubro: string | null;
  especialidad: string | null;
  acentoHex: string;
  logoUrl: string | null;
  cardMood: "calido" | "clinico" | "editorial" | "boutique";
  bio: string | null;
  telefonoPublico: string | null;
  direccionCompleta: string | null;
  instagramHandle: string | null;
  autoConfirmar: boolean;
}

export interface BookLandingService extends PublicLandingService {
  tipo_canonico: string;
  color: string | null;
}

export function BookLanding({
  org,
  servicios,
  profesionales = [],
  fetchSlotsAction,
}: {
  org: BookLandingOrg;
  servicios: BookLandingService[];
  profesionales?: ProfesionalPerfilPublico[];
  /** Used only by the local development preview to exercise a populated calendar. */
  fetchSlotsAction?: typeof fetchSlotsPublico;
}) {
  const solo = org.tipo === "INDEPENDIENTE" && profesionales.length === 1
    ? profesionales[0]
    : null;
  const profesional = solo?.displayName?.trim() && solo.displayName !== "Profesional" ? solo : null;
  const profesionalesLite = profesionales.map((p) => ({ id: p.id, displayName: p.displayName }));
  const sinEquipoClinico = org.tipo === "CLINICA" && profesionales.length === 0;

  return (
    <BookingEntryProvider>
      <BookLandingView
        data={{ org, profesional, profesionales, servicios }}
        mode="published"
        serviceAction={(service) => <ServiceReserveLink serviceId={service.id} serviceName={service.nombre} />}
        booking={sinEquipoClinico ? (
          <div className="bl-preview-booking">
            <p>El consultorio todavía no tiene profesionales disponibles para recibir reservas online.</p>
          </div>
        ) : (
          <BookingWizard
          org={{
            slug: org.slug,
            nombre: org.nombre,
            ciudad: org.ciudad,
            provincia: org.provincia,
            rubro: org.rubro,
            acentoHex: org.acentoHex,
            logoUrl: org.logoUrl,
            cardMood: org.cardMood,
            bio: org.bio,
            telefonoPublico: org.telefonoPublico,
            direccionCompleta: org.direccionCompleta,
            instagramHandle: org.instagramHandle,
          }}
          servicios={servicios}
          profesionales={profesionalesLite}
          fetchSlotsAction={fetchSlotsAction}
          serviceCatalogOutside
          />
        )}
      />
    </BookingEntryProvider>
  );
}
