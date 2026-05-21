import { notFound } from "next/navigation";

import {
  PublicCard,
  type PublicCardData,
} from "@/components/public-card/public-card";

/**
 * Folio · /dev/card · dev-only preview.
 *
 * Renders <PublicCard> in all three variants side-by-side using a single
 * sample dataset. Used for the F4 visual gate + Playwright assertions in
 * tests/e2e/public-card.spec.ts. 404 in production via notFound().
 */

export const dynamic = "force-static";
export const metadata = { title: "Folio · PublicCard (dev)" };

const SAMPLE: PublicCardData = {
  nombre: "Lorenzo Martínez",
  consultorioNombre: "Atelier Kinesiología",
  rubro: "Kinesiología deportiva",
  ciudad: "Córdoba",
  provincia: "Córdoba",
  bio: "Atiendo lesiones complejas y consulta tras la primera sesión. Acompaño hasta la vuelta total.",
  telefonoPublico: "+54 9 351 411-2233",
  instagramHandle: "loremartinez.kine",
  direccionCompleta: "Av. Colón 1234 · Nueva Córdoba",
  acentoHex: "#8A6722",
  cardMood: "editorial",
  slug: "lorenzo-martinez",
  servicios: [
    { nombre: "Consulta inicial",       dur: 60, precioCents: 3500000 },
    { nombre: "Seguimiento",            dur: 45, precioCents: 2200000 },
    { nombre: "Pack 5 sesiones",        dur: 45, precioCents: 9500000 },
    { nombre: "Sesión post-cirugía",    dur: 75, precioCents: 4500000 },
  ],
};

const SAMPLE_NO_LOGO: PublicCardData = { ...SAMPLE };

const SAMPLE_WITH_LOGO: PublicCardData = {
  ...SAMPLE,
  // 1×1 transparent PNG so the <img> renders without a network fetch.
  logoUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
};

const SAMPLE_EDITING: PublicCardData = {
  ...SAMPLE,
  bio: null,
};

export default function CardDevPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main
      style={{
        padding: "48px 32px 96px",
        maxWidth: 1280,
        margin: "0 auto",
        background: "var(--bg)",
        minHeight: "100vh",
        color: "var(--ink)",
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 500,
            fontSize: "var(--fs-3xl)",
            letterSpacing: "var(--track-tight-1)",
            margin: 0,
          }}
        >
          PublicCard (dev)
        </h1>
        <p style={{ color: "var(--ink-3)", marginTop: 8 }}>
          Editorial mood baseline. F5 ships the other three moods on top of this
          chassis. <code>variant=full</code> drives the booking link CTA;{" "}
          <code>variant=preview</code> renders the link-footer mono.
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 32,
          alignItems: "start",
        }}
      >
        <section>
          <h2 style={{ fontSize: "var(--fs-md)", color: "var(--ink-3)", margin: "0 0 12px" }}>
            variant=preview · sin logo
          </h2>
          <PublicCard data={SAMPLE_NO_LOGO} variant="preview" appUrl="folio-app-ten.vercel.app" />
        </section>

        <section>
          <h2 style={{ fontSize: "var(--fs-md)", color: "var(--ink-3)", margin: "0 0 12px" }}>
            variant=full · con logo
          </h2>
          <PublicCard data={SAMPLE_WITH_LOGO} variant="full" appUrl="folio-app-ten.vercel.app" />
        </section>

        <section>
          <h2 style={{ fontSize: "var(--fs-md)", color: "var(--ink-3)", margin: "0 0 12px" }}>
            variant=editing · placeholders
          </h2>
          <PublicCard data={SAMPLE_EDITING} variant="editing" appUrl="folio-app-ten.vercel.app" />
        </section>
      </div>
    </main>
  );
}
