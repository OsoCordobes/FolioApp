import { notFound } from "next/navigation";

import { IdentidadHarness } from "./harness";

/**
 * Folio · /dev/identidad-visual · dev-only preview.
 *
 * Mimics Onboarding Step 4's 3-section composition (Logo + Acento + Mood)
 * with prop-injected mock actions so Playwright + the F6 visual gate can
 * inspect the interaction without needing a real signed-in user.
 *
 * The actual Step4Personalizacion is wired to real server actions, but
 * its UI composition is verified here in isolation. The PublicCard preview
 * to the right updates live as the user changes any of the three.
 *
 * 404 in production via notFound().
 */

export const dynamic = "force-static";
export const metadata = { title: "Identidad visual (dev)" };

export default function IdentidadVisualDevPage() {
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
          Identidad visual (dev)
        </h1>
        <p style={{ color: "var(--ink-3)", marginTop: 8 }}>
          Vista previa de las tres secciones de Step 4: logo, acento, mood.
          Mock actions (no Supabase). El PublicCard a la derecha actualiza en
          vivo.
        </p>
      </header>

      <IdentidadHarness />
    </main>
  );
}
