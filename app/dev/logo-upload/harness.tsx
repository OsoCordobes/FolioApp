"use client";

import { useState } from "react";

import { LogoUpload } from "@/components/public-card/logo-upload";

/**
 * Folio · LogoUpload dev harness.
 *
 * Wires the component with in-memory mock upload + remove actions. The
 * "uploaded" image is the original File converted to a data URL — there
 * is no server round-trip. Errors from the validator are still surfaced
 * normally (PNG-only, 500 KB cap).
 */

export function LogoUploadHarness() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <LogoUpload
        currentLogoUrl={logoUrl}
        onUploaded={(url) => {
          setLogoUrl(url);
          setLog((prev) => [...prev, `uploaded → ${url.slice(0, 60)}…`]);
        }}
        onRemoved={() => {
          setLogoUrl(null);
          setLog((prev) => [...prev, "removed"]);
        }}
        uploadAction={async (formData) => {
          const file = formData.get("file");
          if (!(file instanceof File)) return { ok: false, error: "no file" };
          // Convert to data URL inline; pretend it was uploaded to Storage.
          const buf = new Uint8Array(await file.arrayBuffer());
          const b64 = btoa(String.fromCharCode(...buf));
          const url = `data:image/png;base64,${b64}`;
          return { ok: true, logoUrl: url };
        }}
        removeAction={async () => ({ ok: true })}
      />

      <section
        aria-label="Log de eventos"
        style={{
          padding: 16,
          background: "var(--surface-2)",
          borderRadius: "var(--r-md)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--ink-3)",
        }}
      >
        <div style={{ marginBottom: 8, color: "var(--ink-2)" }}>Eventos:</div>
        {log.length === 0 ? (
          <div>(sin eventos todavía)</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {log.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
