import { ImageResponse } from "next/og";
import React from "react";

import { FolioMark } from "@/components/folio-mark";
import { loadFolioOgFonts } from "@/lib/opengraph-fonts";

// Match the active Folio identity in styles/experience.css and marketing OG.
const BG = "#F5F5FA";
const SURFACE = "#FFFFFF";
const SURFACE_2 = "#F0EFF8";
const LINE = "#DAD9E7";
const INK = "#292641";
const INK_2 = "#4B485F";
const ACCENT = "#6255C5";

export interface BookOgInput {
  nombre: string;
  consultorio: string;
  especialidad: string;
  lugar: string;
  /** Retained for compatibility with stored organization data; Folio owns this image's palette. */
  acento: string;
  solo: boolean;
  /** Already validated public image bytes as a data URI; never an arbitrary URL. */
  foto: string | null;
}

export async function renderBookOg(input: BookOgInput): Promise<Response> {
  const fonts = await loadFolioOgFonts();
  const titleSize = input.nombre.length > 35 ? 50 : input.nombre.length > 22 ? 60 : 72;

  const createImage = (photo: string | null) => new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", backgroundColor: BG, color: INK, fontFamily: "Plus Jakarta Sans", padding: 40 }}>
      <div style={{ display: "flex", width: "100%", height: "100%", overflow: "hidden", border: `1px solid ${LINE}`, borderRadius: 22, backgroundColor: SURFACE }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, minWidth: 0, padding: "44px 46px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FolioMark size={34} color={ACCENT} fg={SURFACE} />
            <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-1.7px" }}>folio</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: photo ? 650 : 940 }}>
            <div style={{ display: "flex", fontSize: 18, fontWeight: 700, color: ACCENT }}>{input.especialidad}</div>
            <div style={{ display: "flex", fontSize: titleSize, fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.055em", overflowWrap: "anywhere" }}>
              {input.nombre}
            </div>
            {input.solo && input.consultorio !== input.nombre ? <div style={{ display: "flex", fontSize: 22, color: INK_2 }}>En {input.consultorio}</div> : null}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, color: INK_2 }}>
            {input.lugar ? <div style={{ display: "flex", fontSize: 20 }}>{input.lugar}</div> : null}
            <div style={{ display: "flex", fontSize: 18 }}>Reservá tu turno online</div>
          </div>
        </div>
        {photo ? <div style={{ display: "flex", width: 340, height: "100%", overflow: "hidden", backgroundColor: SURFACE_2 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="" width={340} height={550} style={{ objectFit: "cover", objectPosition: "center 25%" }} />
        </div> : null}
      </div>
    </div>,
    { width: 1200, height: 630, fonts },
  );

  if (input.foto) {
    try {
      // Satori can reject corrupt bytes after ImageResponse construction. Force
      // rendering before returning so an invalid photo falls back to the text layout.
      const bytes = await createImage(input.foto).arrayBuffer();
      return new Response(bytes, { headers: { "content-type": "image/png" } });
    } catch {
      // The text layout and Folio mark stay visible if the public photo fails.
    }
  }
  return createImage(null);
}
