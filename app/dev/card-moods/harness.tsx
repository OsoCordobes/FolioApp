"use client";

import { useState } from "react";

import { MoodPicker } from "@/components/public-card/mood-picker";
import { MOOD_IDS, MOOD_LABELS, MOOD_TAGLINES } from "@/components/public-card/moods";
import {
  PublicCard,
  type CardMood,
  type PublicCardData,
} from "@/components/public-card/public-card";

const SAMPLE: PublicCardData = {
  nombre: "Lorenzo Martínez",
  consultorioNombre: "Atelier Kinesiología",
  rubro: "Kinesiología deportiva",
  ciudad: "Córdoba",
  bio: "Atiendo lesiones complejas y consulta tras la primera sesión. Acompaño hasta la vuelta total.",
  telefonoPublico: "+54 9 351 411-2233",
  instagramHandle: "loremartinez.kine",
  direccionCompleta: "Av. Colón 1234 · Nueva Córdoba",
  acentoHex: "#8A6722",
  slug: "lorenzo-martinez",
  servicios: [
    { nombre: "Consulta inicial", dur: 60, precioCents: 3500000 },
    { nombre: "Seguimiento",      dur: 45, precioCents: 2200000 },
    { nombre: "Pack 5 sesiones",  dur: 45, precioCents: 9500000 },
  ],
};

export function CardMoodsHarness() {
  const [mood, setMood] = useState<CardMood>("editorial");

  return (
    <div style={{ display: "grid", gap: 48 }}>
      {/* Side-by-side: all 4 moods, same data, no picker. */}
      <section>
        <h2
          style={{
            fontSize: "var(--fs-md)",
            color: "var(--ink-3)",
            margin: "0 0 12px",
          }}
        >
          Las 4 moods · misma data, distinto override
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 24,
            alignItems: "start",
          }}
        >
          {MOOD_IDS.map((id) => (
            <article key={id}>
              <header style={{ marginBottom: 8 }}>
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontWeight: 500,
                    fontSize: "var(--fs-lg)",
                  }}
                >
                  {MOOD_LABELS[id]}
                </div>
                <div style={{ fontSize: "var(--fs-sm)", color: "var(--ink-3)" }}>
                  {MOOD_TAGLINES[id]}
                </div>
              </header>
              <PublicCard
                data={{ ...SAMPLE, cardMood: id }}
                variant="preview"
                appUrl="folio-app-ten.vercel.app"
              />
            </article>
          ))}
        </div>
      </section>

      {/* Live picker swapping the same card. */}
      <section>
        <h2
          style={{
            fontSize: "var(--fs-md)",
            color: "var(--ink-3)",
            margin: "0 0 12px",
          }}
        >
          Picker en vivo · mood actual: <strong style={{ color: "var(--ink)" }}>{MOOD_LABELS[mood]}</strong>
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(260px, 360px) 1fr",
            gap: 32,
            alignItems: "start",
          }}
        >
          <MoodPicker value={mood} onChange={setMood} />
          <PublicCard
            data={{ ...SAMPLE, cardMood: mood }}
            variant="full"
            appUrl="folio-app-ten.vercel.app"
          />
        </div>
      </section>
    </div>
  );
}
