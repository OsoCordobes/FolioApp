import { notFound } from "next/navigation";

import {
  BrassCornerMark,
  DateBadge,
  EditorialRule,
} from "@/components/public-card/decoration";

/**
 * Folio · /dev/decoration · dev-only preview.
 *
 * Renders the three Folio Atelier decoration primitives side-by-side so
 * Playwright e2e (tests/e2e/atelier-tokens.spec.ts) can assert their DOM
 * presence and the visual gate of F1 can eyeball them. Not linked from
 * any user-facing nav.
 *
 * Production gate: returns 404 in `NODE_ENV=production` so the route
 * does not ship to public users. Middleware exposes /dev/* to anonymous
 * traffic (see middleware.ts PUBLIC_PREFIXES) — the route still must
 * 404 in prod to avoid information disclosure.
 */

export const dynamic = "force-static";
export const metadata = { title: "Folio · decoration primitives (dev)" };

export default function DecorationDevPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main
      style={{
        padding: "48px 40px 96px",
        display: "grid",
        gap: 40,
        maxWidth: 720,
        margin: "0 auto",
        background: "var(--bg)",
        minHeight: "100vh",
        color: "var(--ink)",
      }}
    >
      <header>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 500,
            fontSize: "var(--fs-3xl)",
            letterSpacing: "var(--track-tight-1)",
            margin: 0,
          }}
        >
          Folio Atelier · decoration primitives
        </h1>
        <p style={{ color: "var(--ink-3)", marginTop: 8 }}>
          Dev preview. Used by the 4 mood overrides. Color driven by{" "}
          <code>--fpc-decoration-color</code>; geometry by their <code>.fpc-*</code> class.
        </p>
      </header>

      <section>
        <h2 style={{ fontSize: "var(--fs-lg)", margin: "0 0 12px" }}>EditorialRule</h2>
        <div
          style={{
            padding: 24,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-xl)",
          }}
        >
          <EditorialRule />
          <p style={{ margin: 0, fontSize: "var(--fs-md)", color: "var(--ink-2)" }}>
            Section content sits underneath the 1 px ruler. Used in Clínico + Editorial moods above section labels.
          </p>
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-lg)", margin: "0 0 12px" }}>BrassCornerMark</h2>
        <div
          style={{
            position: "relative",
            padding: 24,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-xl)",
            width: 320,
          }}
        >
          <span style={{ position: "absolute", top: 10, right: 12 }}>
            <BrassCornerMark />
          </span>
          <p style={{ margin: 0, fontSize: "var(--fs-md)", color: "var(--ink-2)" }}>
            L-shaped hand-stamp signature. Used in Cálido mood top-right of card hero.
          </p>
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-lg)", margin: "0 0 12px" }}>DateBadge</h2>
        <div
          style={{
            padding: 24,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-xl)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <DateBadge label="EST. 2026 · CÓRDOBA" />
        </div>
      </section>
    </main>
  );
}
