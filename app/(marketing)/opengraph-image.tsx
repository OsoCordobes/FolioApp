import { ImageResponse } from "next/og";

/**
 * Folio · Landing — imagen OpenGraph 1200×630 (Fase C · SEO).
 *
 * Asset de marca generado en build/request — los hex acá son intencionales
 * (no es CSS del design system): fondo #F5F2EB, acento #8A6722, tinta #1B1812.
 *
 * Fraunces (display) se fetchea de Google Fonts en runtime. Si la red está
 * bloqueada (build hermético, sandbox) el fetch falla → degradamos a serif
 * del sistema; la imagen DEBE generarse igual.
 */

export const alt =
  "Folio — Agenda, historia clínica y cobros para profesionales de la salud";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const FRAUNCES_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&display=swap";

/**
 * Resuelve el TTF de Fraunces 600 vía el endpoint css2 (sin UA moderno,
 * Google sirve TTF — formato que ImageResponse/satori acepta). Devuelve
 * null ante cualquier falla para que el caller degrade a serif del sistema.
 */
async function loadFraunces(): Promise<ArrayBuffer | null> {
  try {
    const cssRes = await fetch(FRAUNCES_CSS_URL);
    if (!cssRes.ok) return null;
    const css = await cssRes.text();
    const match = css.match(/src:\s*url\((https:[^)]+\.ttf)\)/);
    if (!match) return null;
    const fontRes = await fetch(match[1]);
    if (!fontRes.ok) return null;
    return await fontRes.arrayBuffer();
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  const fraunces = await loadFraunces();
  const displayFamily = fraunces ? "Fraunces" : "Georgia, 'Times New Roman', serif";

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
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 9999,
              backgroundColor: "#8A6722",
            }}
          />
          <div
            style={{
              fontFamily: displayFamily,
              fontSize: 44,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            Folio
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div
            style={{
              fontFamily: displayFamily,
              fontSize: 76,
              fontWeight: 600,
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
              maxWidth: 980,
            }}
          >
            Tu consultorio, en orden. Vos, atendiendo.
          </div>
          <div
            style={{
              fontSize: 32,
              lineHeight: 1.3,
              color: "#8A6722",
              maxWidth: 900,
            }}
          >
            Agenda, historia clínica y cobros para profesionales de la salud
          </div>
        </div>

        <div
          style={{
            display: "flex",
            width: 120,
            height: 6,
            borderRadius: 9999,
            backgroundColor: "#8A6722",
          }}
        />
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
