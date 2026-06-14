import { notFound } from "next/navigation";

import { QuiroFichaHarness } from "./harness";

/**
 * Folio · /dev/quiro-ficha · dev-only preview.
 *
 * Vista previa aislada de la ficha de quiropraxia v2 (mapa vertebral anatómico
 * a un costado + evaluación inicial, incluido el análisis postural dibujable).
 * 404 en producción vía notFound().
 */

export const dynamic = "force-static";
export const metadata = { title: "Quiropraxia ficha (dev)" };

export default function QuiroFichaDevPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main
      style={{
        padding: "32px 28px 96px",
        maxWidth: 1080,
        margin: "0 auto",
        background: "var(--bg)",
        minHeight: "100vh",
        color: "var(--ink)",
      }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 20px" }}>
        Quiropraxia · ficha v2 (dev)
      </h1>
      <QuiroFichaHarness />
    </main>
  );
}
