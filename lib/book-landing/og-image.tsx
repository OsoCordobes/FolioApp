import { ImageResponse } from "next/og";
import React from "react";

import { getInitials } from "@/lib/format/initials";
import { loadFolioOgFonts } from "@/lib/opengraph-fonts";

const BG = "#F5F2EB";
const SURFACE = "#FBF9F4";
const INK = "#1B1812";
const INK_2 = "#44402F";
const BRASS = "#8A6722";

export interface BookOgInput {
  nombre: string;
  consultorio: string;
  especialidad: string;
  lugar: string;
  acento: string;
  solo: boolean;
  /** Already validated public image bytes as a data URI; never an arbitrary URL. */
  foto: string | null;
}

export async function renderBookOg(input: BookOgInput): Promise<Response> {
  const fonts = await loadFolioOgFonts();
  const titleSize = input.nombre.length > 35 ? 52 : input.nombre.length > 22 ? 62 : 76;
  const acento = /^#[0-9a-fA-F]{6}$/.test(input.acento) ? input.acento : BRASS;
  const initials = getInitials(input.nombre);

  const createImage = (photo: string | null) => new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", backgroundColor: BG, color: INK, fontFamily: "Plus Jakarta Sans", padding: "58px 64px", gap: 48 }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 23, color: INK_2 }}>
          <div style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: acento }} />
          {input.especialidad}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 19 }}>
          <div style={{ display: "flex", fontSize: titleSize, fontWeight: 600, lineHeight: 1.06, letterSpacing: "-0.035em", maxWidth: 730, overflowWrap: "anywhere" }}>
            {input.nombre}
          </div>
          {input.lugar ? <div style={{ display: "flex", fontSize: 26, color: INK_2 }}>{input.lugar}</div> : null}
          <div style={{ display: "flex", fontSize: 23, color: INK_2 }}>Reservá tu turno online</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 19, color: INK_2 }}>
          <div style={{ width: 52, height: 4, borderRadius: 2, backgroundColor: acento }} />
          {input.solo && input.consultorio !== input.nombre ? input.consultorio : "Hecho con Folio"}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 340, height: 514, backgroundColor: SURFACE, borderRadius: 24, overflow: "hidden", border: "1px solid #DDD5C0" }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" width={340} height={514} style={{ objectFit: "cover", objectPosition: "center 25%" }} />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 220, height: 220, borderRadius: 110, backgroundColor: "#EDE7D8", color: INK, fontSize: 80, fontWeight: 500, border: `2px solid ${acento}` }}>
            {initials}
          </div>
        )}
      </div>
    </div>,
    { width: 1200, height: 630, fonts },
  );

  if (input.foto) {
    try {
      // Satori can reject corrupt bytes after ImageResponse construction. Force
      // rendering before returning so an invalid photo falls back to initials.
      const bytes = await createImage(input.foto).arrayBuffer();
      return new Response(bytes, { headers: { "content-type": "image/png" } });
    } catch {
      // The identity stays visible even when a public photo cannot be decoded.
    }
  }
  return createImage(null);
}
