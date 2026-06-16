import { notFound } from "next/navigation";

import { BookLanding } from "@/components/book-landing/book-landing";

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

export const dynamic = "force-static";
export const metadata = { title: "/book preview (dev)" };

export default function BookPreviewDevPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <BookLanding
      org={{
        slug: "lorenzo-martinez",
        nombre: "Atelier Kinesiología",
        ciudad: "Córdoba",
        provincia: "Córdoba",
        rubro: "Kinesiología deportiva",
        especialidad: null,
        acentoHex: "#8A6722",
        logoUrl: null,
        cardMood: "editorial",
        bio: "Atiendo lesiones complejas y consulta tras la primera sesión. Acompaño hasta la vuelta total.",
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
      profesionales={[
        {
          id: "p1",
          displayName: "Lic. Lorenzo Martínez",
          fotoUrl: null,
          bioPublica: "Kinesiólogo deportivo. 12 años acompañando la vuelta a la actividad.",
          matricula: "12.345",
        },
        {
          id: "p2",
          displayName: "Lic. Sofía Núñez",
          fotoUrl: null,
          bioPublica: "Especialista en rehabilitación post-quirúrgica y RPG.",
          matricula: "18.902",
        },
      ]}
    />
  );
}
