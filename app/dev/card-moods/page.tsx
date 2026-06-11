import { notFound } from "next/navigation";

import { CardMoodsHarness } from "./harness";

/**
 * Folio · /dev/card-moods · dev-only preview.
 *
 * Renders all four moods side-by-side plus a live <MoodPicker> that swaps
 * a single sample card. Used for:
 *   - F5 visual gate (eyeball that the 4 moods are distinct at thumbnail).
 *   - Playwright e2e (tests/e2e/moods.spec.ts) drives the picker and
 *     asserts --fpc-radius / mood-specific selectors.
 *
 * 404 in production via notFound().
 */

export const dynamic = "force-static";
export const metadata = { title: "4 moods (dev)" };

export default function CardMoodsDevPage() {
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
          Folio Atelier · 4 moods
        </h1>
        <p style={{ color: "var(--ink-3)", marginTop: 8 }}>
          Cada mood es un override CSS sobre el mismo chassis. El picker debajo
          intercambia el mood en vivo sobre la misma card.
        </p>
      </header>

      <CardMoodsHarness />
    </main>
  );
}
