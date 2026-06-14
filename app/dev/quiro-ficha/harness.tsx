"use client";

/**
 * Folio · /dev/quiro-ficha · harness client (dev-only).
 *
 * Renderiza el QuiropraxiaTool v2 (mapa vertebral anatómico + evaluación
 * inicial con el análisis postural dibujable) con data de muestra y estado
 * local, para iterar visualmente sin auth. La página padre hace notFound() en
 * producción.
 */

import { useState } from "react";

import { QuiropraxiaTool } from "@/lib/especialidades/quiropraxia/tool";
import type { QuiropraxiaToolDataV2 } from "@/lib/especialidades/quiropraxia/schema";

export function QuiroFichaHarness() {
  const [data, setData] = useState<QuiropraxiaToolDataV2>({
    v: 2,
    vista: "posterior",
    vertebras: [
      { id: "C4", tecnicaAjuste: "diversificada" },
      { id: "T7", listado: "PRS" },
      { id: "L5", tecnicaAjuste: "drop", listado: "PLI" },
    ],
  });

  return (
    <QuiropraxiaTool
      value={data}
      onChange={(next) => setData(next as QuiropraxiaToolDataV2)}
      historial={[]}
      pacienteId="00000000-0000-0000-0000-000000000000"
      turno={null}
      radiografias={[]}
    />
  );
}
