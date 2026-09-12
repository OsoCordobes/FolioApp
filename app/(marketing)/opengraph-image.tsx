import { ImageResponse } from "next/og";

import { loadFolioOgFonts } from "@/lib/opengraph-fonts";

/** Clínica clara in link previews. Entirely invented appointments. */
export const alt =
  "Folio — Agenda, historia clínica y cobros para profesionales de la salud";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const visits = [
  { time: "09:00", name: "Martina Ríos", service: "Consulta de seguimiento", state: "Atendida", color: "#19725D", background: "#E5F2EC" },
  { time: "09:30", name: "Tomás Acosta", service: "Primera consulta", state: "En consulta", color: "#6255C5", background: "#EFECFC" },
  { time: "10:00", name: "Elena Vidal", service: "Control clínico", state: "En espera", color: "#886012", background: "#FBF1D9" },
];

export default async function OpengraphImage() {
  const fonts = await loadFolioOgFonts();
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#F5F5FA", color: "#292641", fontFamily: "Plus Jakarta Sans", padding: "52px 58px", gap: 45 }}>
      <div style={{ display: "flex", flexDirection: "column", width: 525, justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 43, height: 45, display: "flex", position: "relative" }}>
            <div style={{ position: "absolute", left: 8, top: 0, width: 35, height: 36, background: "#6255C540", borderRadius: 5 }} />
            <div style={{ position: "absolute", left: 4, top: 5, width: 35, height: 36, background: "#6255C580", borderRadius: 5 }} />
            <div style={{ position: "absolute", left: 0, top: 10, width: 35, height: 35, background: "#6255C5", borderRadius: 5, display: "flex", justifyContent: "center", alignItems: "center", color: "white", fontSize: 27, fontWeight: 600 }}>F</div>
          </div>
          <span style={{ fontSize: 43, fontWeight: 600, letterSpacing: "-2.5px" }}>folio</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 61, fontWeight: 600, lineHeight: 1.12, letterSpacing: "-3px" }}>
            <span>Tu consultorio.</span><span>Todo a mano.</span>
          </div>
          <div style={{ maxWidth: 455, fontSize: 26, color: "#514D69", lineHeight: 1.55 }}>Agenda, historia clínica y cobros para tu práctica.</div>
        </div>
        <div style={{ display: "flex", fontSize: 16, color: "#69657D", lineHeight: 1.6, maxWidth: 440 }}>Para profesionales y equipos de salud en Argentina.</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignSelf: "center", width: 495, border: "1px solid #DAD9E7", background: "white", borderRadius: 20, padding: "28px 25px", boxShadow: "0 10px 32px #2926410B" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, color: "#69657D", paddingBottom: 23, borderBottom: "1px solid #ECEBF2" }}><span>Un día en Folio</span><span>Consultorio de ejemplo</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 24, marginBottom: 22 }}><span style={{ fontSize: 29, fontWeight: 600, letterSpacing: "-1px" }}>Tu agenda de hoy</span><span style={{ fontSize: 15, color: "#69657D" }}>Cada paciente, con su contexto.</span></div>
        {visits.map((visit) => <div key={visit.time} style={{ display: "flex", gap: 14, alignItems: "center", padding: "22px 11px", borderRadius: 11, border: visit.state === "En consulta" ? "1px solid #E2DDF7" : "1px solid transparent", background: visit.state === "En consulta" ? "#F6F5FC" : "white" }}>
          <span style={{ width: 46, fontSize: 14, color: "#69657D" }}>{visit.time}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}><span style={{ fontSize: 18, fontWeight: 600 }}>{visit.name}</span><span style={{ fontSize: 13, color: "#69657D" }}>{visit.service}</span></div>
          <span style={{ display: "flex", fontSize: 12, color: visit.color, background: visit.background, padding: "6px 9px", borderRadius: 5 }}>{visit.state}</span>
        </div>)}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 15, paddingTop: 18, borderTop: "1px solid #ECEBF2", fontSize: 12, color: "#69657D" }}>Vista ilustrativa. Personas y datos ficticios.</div>
      </div>
    </div>,
    { ...size, fonts },
  );
}
