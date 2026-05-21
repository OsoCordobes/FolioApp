import { notFound } from "next/navigation";

import { LogoUploadHarness } from "./harness";

/**
 * Folio · /dev/logo-upload · dev-only preview.
 *
 * Renders <LogoUpload> with mock upload/remove actions so the component's
 * states are reachable without an authenticated session. Playwright e2e
 * (tests/e2e/logo-upload.spec.ts) drives this surface to verify:
 *   - idle helper text
 *   - is-drag-over on dragOver
 *   - validation error on JPG
 *   - validation error on > 500 KB PNG
 *
 * 404 in production via notFound().
 */

export const dynamic = "force-static";
export const metadata = { title: "Folio · LogoUpload (dev)" };

export default function LogoUploadDevPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main
      style={{
        padding: "48px 40px 96px",
        maxWidth: 560,
        margin: "0 auto",
        background: "var(--bg)",
        minHeight: "100vh",
        color: "var(--ink)",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 500,
            fontSize: "var(--fs-3xl)",
            letterSpacing: "var(--track-tight-1)",
            margin: 0,
          }}
        >
          LogoUpload (dev)
        </h1>
        <p style={{ color: "var(--ink-3)", marginTop: 8 }}>
          Mock upload/remove actions (no Supabase). Drag a PNG to test the stamp-in
          beat; drag a JPG to test the shake.
        </p>
      </header>

      <LogoUploadHarness />
    </main>
  );
}
