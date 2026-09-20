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
  const titleSize = input.nombre.length > 35 ? 50 : input.nombre.length > 22 ? 60 : 72;
  const acento = /^#[0-9a-fA-F]{6}$/.test(input.acento) ? input.acento : BRASS;
  const initials = getInitials(input.nombre);

  const createImage = (photo: string | null) => new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", backgroundColor: BG, color: INK, fontFamily: "Plus Jakarta Sans", padding: 34 }}>
      <div style={{ display: "flex", width: "100%", height: "100%", overflow: "hidden", border: "1px solid #DDD5C0", borderRadius: 28, backgroundColor: SURFACE }}>
        <div style={{ display: "flex", width: 10, height: "100%", backgroundColor: acento }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, minWidth: 0, padding: "48px 38px 43px 50px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13, fontSize: 21, fontWeight: 600, color: INK_2 }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: acento }} />
            {input.especialidad}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 19 }}>
            <div style={{ display: "flex", fontSize: titleSize, fontWeight: 700, lineHeight: 1.04, letterSpacing: "-0.055em", maxWidth: 680, overflowWrap: "anywhere" }}>
              {input.nombre}
            </div>
            {input.lugar ? <div style={{ display: "flex", fontSize: 23, color: INK_2 }}>{input.lugar}</div> : null}
            <div style={{ display: "flex", fontSize: 21, color: INK_2 }}>Reservá tu turno online</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 15, fontSize: 17, fontWeight: 600, color: INK_2 }}>
            <div style={{ width: 42, height: 3, borderRadius: 2, backgroundColor: acento }} />
            {input.solo && input.consultorio !== input.nombre ? input.consultorio : "Hecho con Folio"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 342, height: "100%", overflow: "hidden", backgroundColor: "#EDE7D8" }}>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" width={342} height={560} style={{ objectFit: "cover", objectPosition: "center 25%" }} />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 224, height: 224, borderRadius: 28, backgroundColor: SURFACE, color: INK, fontSize: 78, fontWeight: 650, border: `2px solid ${acento}` }}>
              {initials}
            </div>
          )}
        </div>
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
