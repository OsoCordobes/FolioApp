import { ImageResponse } from "next/og";
import { loadFolioOgFonts } from "@/lib/opengraph-fonts";

import { formatRubro } from "@/lib/format/identity";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/** Booking link image: the practice keeps its name and chosen accent. Fonts are bundled locally. */

export const alt = "Reservá tu turno online · Folio";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

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
  const fonts = await loadFolioOgFonts();
  const displayFamily = "Plus Jakarta Sans";

  let nombre = "Reservá tu turno";
  let sub = "Turnos online con profesionales de la salud";
  let acento = "#6255C5";

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
          fontFamily: displayFamily,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#F5F5FA",
          color: "#292641",
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
          <div style={{ fontSize: 26, color: "#69657D" }}>Hecho con Folio</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts,
    },
  );
}
