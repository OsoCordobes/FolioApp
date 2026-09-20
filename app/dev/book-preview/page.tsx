import { notFound } from "next/navigation";

import { BookLanding } from "@/components/book-landing/book-landing";
import { BookLandingPreview } from "@/components/book-landing/book-landing-preview";

/**
 * Folio · /dev/book-preview · dev-only preview of /book/[slug].
 *
 * Mounts <BookLanding> with deterministic mock org + servicios so Playwright +
 * the F7 visual gate can verify the doctor-first landing (hero, reserva
 * enfocada, powered-by) without needing a seeded DB. The production route
 * /book/[slug] fetches the same data shape from Supabase.
 *
 * 404 in production via notFound().
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "/book preview (dev)" };

const PORTRAIT = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="680" height="800" viewBox="0 0 680 800"><rect width="680" height="800" fill="#d8ccba"/><circle cx="340" cy="290" r="142" fill="#bd927c"/><path d="M190 260q0-185 150-185t150 185q-55-90-150-90t-150 90" fill="#302925"/><path d="M91 800q9-290 249-290t249 290" fill="#f5f2eb"/><path d="M290 500h100v80q-50 60-100 0" fill="#bd927c"/><path d="M270 320h18m104 0h18" stroke="#302925" stroke-width="13" stroke-linecap="round"/><path d="M306 404q34 24 68 0" stroke="#8f6555" stroke-width="9" fill="none" stroke-linecap="round"/></svg>`)}`;

export default async function BookPreviewDevPage({ searchParams }: { searchParams: Promise<{ variant?: string }> }) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const variant = (await searchParams).variant;
  if (variant === "draft-preview") {
    return <BookLandingPreview data={{
      org: {
        tipo: "INDEPENDIENTE", nombre: "Consultorio en preparación", rubro: "Kinesiología",
        ciudad: "Córdoba", provincia: "Córdoba", acentoHex: "#8A6722",
        logoUrl: null, bio: "Atención personalizada en Córdoba.", autoConfirmar: null,
      },
      profesional: null,
      profesionales: [],
      servicios: [{ id: "draft-1", nombre: "Consulta inicial", duracion_min: 60, precio_cents: 3500000 }],
    }} />;
  }
  const solo = variant === "solo" || variant === "solo-empty" || variant === "solo-unnamed";
  const clinicOne = variant === "clinic-one";
  const clinicEmpty = variant === "clinic-empty";

  return (
    <BookLanding
      org={{
        slug: "lorenzo-martinez",
        tipo: solo ? "INDEPENDIENTE" : "CLINICA",
        nombre: solo ? "Consultorio Martínez" : "Atelier Kinesiología",
        ciudad: "Córdoba",
        provincia: "Córdoba",
        rubro: "Kinesiología deportiva",
        especialidad: null,
        acentoHex: "#8A6722",
        logoUrl: null,
        cardMood: "editorial",
        bio: solo ? null : "Atención en kinesiología en Córdoba.",
        telefonoPublico: "+54 9 351 411-2233",
        direccionCompleta: "Av. Colón 1234 · Nueva Córdoba",
        instagramHandle: "loremartinez.kine",
        autoConfirmar: true,
      }}
      servicios={[
        {
          id: "1",
          nombre: "Consulta inicial",
          duracion_min: 60,
          precio_cents: 3500000,
          tipo_canonico: "CONSULTA_INICIAL",
          color: null,
        },
        {
          id: "2",
          nombre: "Seguimiento",
          duracion_min: 45,
          precio_cents: 2200000,
          tipo_canonico: "SEGUIMIENTO_ESTANDAR",
          color: null,
        },
        {
          id: "3",
          nombre: "Pack 5 sesiones",
          duracion_min: 45,
          precio_cents: 9500000,
          tipo_canonico: "PACK_SESIONES",
          color: null,
        },
      ]}
      profesionales={clinicEmpty ? [] : [
        {
          id: "p1",
          displayName: variant === "solo-unnamed" ? "Profesional" : "Lic. Lorenzo Martínez",
          fotoUrl: variant === "solo-empty" ? null : solo ? PORTRAIT : null,
          bioPublica: variant === "solo-empty" ? null : "Kinesiólogo deportivo. Acompaño procesos de recuperación con una atención cercana y horarios claros.",
          matricula: "12.345",
        },
        ...(!solo && !clinicOne ? [{
          id: "p2",
          displayName: "Lic. Sofía Núñez",
          fotoUrl: null,
          bioPublica: "Especialista en rehabilitación post-quirúrgica y RPG.",
          matricula: "18.902",
        }] : []),
      ]}
    />
  );
}
