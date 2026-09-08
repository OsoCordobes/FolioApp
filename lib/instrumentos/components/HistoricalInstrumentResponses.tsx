import type { ToolHistorialEntry } from "@/lib/especialidades/types";
import { instrumentPopulationEligibility } from "../population-policy";

/** Original records only: no scoring, band conversion or new risk inference. */
export function HistoricalInstrumentResponses({
  historial,
  fechaNacimiento,
}: {
  historial: ToolHistorialEntry[];
  fechaNacimiento?: string | null;
}) {
  const records = historial
    .filter(
      (entry) =>
        !instrumentPopulationEligibility({
          fechaNacimiento,
          fechaAtencion: entry.fecha,
        }).allowed,
    )
    .flatMap((entry) => {
      if (!entry.toolData || typeof entry.toolData !== "object") return [];
      const raw = entry.toolData as Record<string, unknown>;
      const crisis = raw.crisisPlan as Record<string, unknown> | undefined;
      const registro = raw.registro as Record<string, unknown> | undefined;
      const original = Object.fromEntries(
        Object.entries({
          PHQ9: raw.phq9,
          GAD7: raw.gad7,
          CSSRS: crisis?.cssrs,
          NDI: raw.ndi,
          ODI: raw.odi,
          Borg: raw.borg,
          riesgoRegistrado: registro?.riesgo,
          bandaRegistrada: raw.banda,
          flagsRegistrados: raw.flags,
        }).filter(([, value]) => value !== undefined),
      );
      return Object.keys(original).length
        ? [{ fecha: entry.fecha, original }]
        : [];
    });
  if (!records.length) return null;
  return (
    <details className="pc-card">
      <summary>
        Registros originales de escalas · sin interpretación nueva
      </summary>
      <p>
        Se conservan las respuestas y advertencias históricas. La restricción de
        población no significa ausencia de riesgo.
      </p>
      {records.map((entry, i) => (
        <div key={`${entry.fecha}-${i}`}>
          <b>{entry.fecha}</b>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {JSON.stringify(entry.original, null, 2)}
          </pre>
        </div>
      ))}
    </details>
  );
}
