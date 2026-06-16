import { ImageResponse } from "next/og";

import { formatRubro } from "@/lib/format/identity";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Folio · /book/[slug] — imagen OpenGraph 1200×630 por consultorio.
 *
 * Mejora el preview cuando el médico comparte su link por WhatsApp/Instagram:
 * el consultorio es la estrella (nombre + especialidad/ciudad + su acento),
 * Folio aparece sutil al pie. Mismo chassis brass/cream que la OG de marketing.
 *
 * Los hex base acá son intencionales (asset de marca, no CSS del design
 * system): fondo #F5F2EB, tinta #1B1812, acento default #8A6722 (se reemplaza
 * por organization.acento_hex). Fraunces se fetchea de Google Fonts; si la red
 * está bloqueada degrada a serif del sistema (la imagen DEBE generarse igual).
 */

export const alt = "Reservá tu turno online · Folio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

const FRAUNCES_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&display=swap";

let frauncesPromise: Promise<ArrayBuffer | null> | null = null;

function loadFraunces(): Promise<ArrayBuffer | null> {
  frauncesPromise ??= (async () => {
    try {
      const cssRes = await fetch(FRAUNCES_CSS_URL, { cache: "force-cache" });
      if (!cssRes.ok) return null;
      const css = await cssRes.text();
      const match = css.match(/src:\s*url\((https:[^)]+\.ttf)\)/);
      if (!match) return null;
      const fontRes = await fetch(match[1], { cache: "force-cache" });
      if (!fontRes.ok) return null;
      return await fontRes.arrayBuffer();
    } catch {
      return null;
    }
  })();
  return frauncesPromise;
}

const ESP_NOMBRE: Record<string, string> = {
  quiropraxia: "Quiropraxia",
  cardiologia: "Cardiología",
  psicologia: "Psicología",
};

function isValidHex(s: string | null | undefined): s is string {
  return !!s && /^#[0-9a-fA-F]{6}$/.test(s);
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const fraunces = await loadFraunces();
  const displayFamily = fraunces ? "Fraunces" : "Georgia, 'Times New Roman', serif";

  let nombre = "Reservá tu turno";
  let sub = "Turnos online con profesionales de la salud";
  let acento = "#8A6722";

  try {
    const service = createSupabaseServiceClient();
    const { data: org } = await service
      .from("organization")
      .select("nombre, ciudad, provincia, especialidad, rubro, acento_hex, opt_out_public_listing")
      .eq("slug", slug)
      .is("deleted_at", null)
      .maybeSingle();
    if (org && !org.opt_out_public_listing) {
      nombre = (org.nombre as string) || nombre;
      acento = isValidHex(org.acento_hex) ? org.acento_hex : acento;
      const esp =
        org.especialidad && ESP_NOMBRE[org.especialidad as string]
          ? ESP_NOMBRE[org.especialidad as string]
          : formatRubro(org.rubro as string | null);
      const lugar = [org.ciudad, org.provincia].filter(Boolean).join(", ");
      sub = [esp, lugar].filter(Boolean).join(" · ") || "Turnos online";
    }
  } catch {
    // Org inaccesible → OG genérica de Folio (no rompemos la imagen).
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#F5F2EB",
          color: "#1B1812",
          padding: "72px 80px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 14, height: 14, borderRadius: 9999, backgroundColor: acento }} />
          <div style={{ fontSize: 30, letterSpacing: "0.04em", color: acento }}>
            Reservá tu turno online
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontFamily: displayFamily,
              fontSize: 80,
              fontWeight: 600,
              lineHeight: 1.06,
              letterSpacing: "-0.02em",
              maxWidth: 1000,
            }}
          >
            {nombre}
          </div>
          <div style={{ fontSize: 34, lineHeight: 1.3, color: acento, maxWidth: 940 }}>
            {sub}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", width: 120, height: 6, borderRadius: 9999, backgroundColor: acento }} />
          <div style={{ fontSize: 26, color: "#79735F" }}>Hecho con Folio</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: fraunces
        ? [{ name: "Fraunces", data: fraunces, weight: 600 as const, style: "normal" as const }]
        : undefined,
    },
  );
}
