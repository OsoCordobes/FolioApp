"use client";

import { useState } from "react";

import { LogoUpload } from "@/components/public-card/logo-upload";
import { MoodPicker } from "@/components/public-card/mood-picker";
import {
  PublicCard,
  type CardMood,
  type PublicCardData,
} from "@/components/public-card/public-card";

const ACENTOS = [
  { id: "#8A6722", nombre: "Brass",         desc: "Cálido, sobrio" },
  { id: "#3F6B49", nombre: "Verde antiguo", desc: "Sereno, clínico" },
  { id: "#3F5E75", nombre: "Azul piedra",   desc: "Sólido, neutral" },
  { id: "#A8513A", nombre: "Terracota",     desc: "Cálido, presente" },
];

const BASE: Omit<PublicCardData, "acentoHex" | "logoUrl" | "cardMood"> = {
  nombre: "Lorenzo Martínez",
  consultorioNombre: "Atelier Kinesiología",
  rubro: "Kinesiología deportiva",
  ciudad: "Córdoba",
  bio: "Atiendo lesiones complejas y consulta tras la primera sesión. Acompaño hasta la vuelta total.",
  telefonoPublico: "+54 9 351 411-2233",
  instagramHandle: "loremartinez.kine",
  direccionCompleta: "Av. Colón 1234 · Nueva Córdoba",
  slug: "lorenzo-martinez",
  servicios: [
    { nombre: "Consulta inicial", dur: 60, precioCents: 3500000 },
    { nombre: "Seguimiento",      dur: 45, precioCents: 2200000 },
    { nombre: "Pack 5 sesiones",  dur: 45, precioCents: 9500000 },
  ],
};

export function IdentidadHarness() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [acento, setAcento] = useState<string>("#8A6722");
  const [mood, setMood] = useState<CardMood>("editorial");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(280px, 540px) 1fr",
        gap: 32,
        alignItems: "start",
      }}
    >
      <div className="onb-form">
        <section className="onb-identity-section">
          <h2 className="onb-identity-h">Logo</h2>
          <p className="onb-identity-hint">
            Opcional. Si lo subís, reemplaza el avatar de iniciales.
          </p>
          <LogoUpload
            currentLogoUrl={logoUrl}
            onUploaded={setLogoUrl}
            onRemoved={() => setLogoUrl(null)}
            uploadAction={async (formData) => {
              const file = formData.get("file");
              if (!(file instanceof File)) return { ok: false, error: "no file" };
              const buf = new Uint8Array(await file.arrayBuffer());
              const b64 = btoa(String.fromCharCode(...buf));
              return { ok: true, logoUrl: `data:image/png;base64,${b64}` };
            }}
            removeAction={async () => ({ ok: true })}
          />
        </section>

        <section className="onb-identity-section">
          <h2 className="onb-identity-h">Color de acento</h2>
          <p className="onb-identity-hint">
            En el mood Clínico el acento se atempera hacia ink-blue.
          </p>
          <div className="onb-acentos">
            {ACENTOS.map((a) => {
              const active = acento === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  className={"onb-acento " + (active ? "is-active" : "")}
                  onClick={() => setAcento(a.id)}
                >
                  <div className="onb-acento-preview">
                    <div className="onb-acento-chart">
                      {[40, 65, 88, 72, 95, 60, 80].map((h, i) => (
                        <span
                          key={i}
                          className="onb-chart-bar"
                          style={{
                            height: h + "%",
                            background: i === 4 ? a.id : `${a.id}33`,
                          }}
                        />
                      ))}
                    </div>
                    <div className="onb-acento-cta" style={{ background: a.id }}>
                      Confirmar
                    </div>
                  </div>
                  <div className="onb-acento-meta">
                    <span className="onb-acento-swatch" style={{ background: a.id }} />
                    <div>
                      <b>{a.nombre}</b>
                      <span>{a.desc}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="onb-identity-section">
          <h2 className="onb-identity-h">Estilo de tu card</h2>
          <p className="onb-identity-hint">
            Define tipografía, contraste y decoración.
          </p>
          <MoodPicker value={mood} onChange={setMood} />
        </section>
      </div>

      <aside style={{ position: "sticky", top: 32 }}>
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--ink-3)", marginBottom: 12 }}>
          Vista previa en vivo
        </div>
        <PublicCard
          data={{
            ...BASE,
            acentoHex: acento,
            logoUrl,
            cardMood: mood,
          }}
          variant="preview"
          appUrl="folio-app-ten.vercel.app"
        />
      </aside>
    </div>
  );
}
