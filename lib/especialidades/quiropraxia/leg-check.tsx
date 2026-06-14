"use client";

/**
 * Folio · especialidades · quiropraxia · leg check (Workstream 6).
 *
 * Revisión de longitud de piernas: tres pills (supino / prono c/extensión /
 * prono c/flexión) que cambian el `modo` activo; se muestra la textarea del
 * modo activo, escribiendo en supinoNota | pronoExtensionNota | pronoFlexionNota.
 *
 * Controlado: value entra del borrador v2; onChange emite el legCheck nuevo.
 * readOnly deshabilita los cambios (snapshot / sin turno).
 */

import type {
  LegCheckModo,
  QuiropraxiaToolDataV2,
} from "@/lib/especialidades/quiropraxia/schema";

type LegCheckValue = QuiropraxiaToolDataV2["legCheck"];

interface LegCheckProps {
  value: LegCheckValue;
  onChange: (next: NonNullable<LegCheckValue>) => void;
  readOnly?: boolean;
}

const MODOS: Array<{ id: LegCheckModo; label: string; nota: keyof NonNullable<LegCheckValue> }> = [
  { id: "supino", label: "Supino", nota: "supinoNota" },
  { id: "prono_extension", label: "Prono c/ extensión", nota: "pronoExtensionNota" },
  { id: "prono_flexion", label: "Prono c/ flexión", nota: "pronoFlexionNota" },
];

export function LegCheck({ value, onChange, readOnly }: LegCheckProps) {
  const modo: LegCheckModo = value?.modo ?? "supino";
  const activo = MODOS.find((m) => m.id === modo) ?? MODOS[0];
  const notaActual = (value?.[activo.nota] as string | undefined) ?? "";

  const setModo = (next: LegCheckModo) => {
    if (readOnly) return;
    onChange({ ...(value ?? { modo: next }), modo: next });
  };

  const setNota = (next: string) => {
    if (readOnly) return;
    onChange({ ...(value ?? { modo }), modo, [activo.nota]: next.slice(0, 1000) });
  };

  return (
    <div className="pc-quiro-legcheck">
      <div className="pc-quiro-legcheck-pills" role="group" aria-label="Modo del leg check">
        {MODOS.map((m) => (
          <button
            key={m.id}
            type="button"
            className={"pc-quiro-pill " + (modo === m.id ? "is-active" : "")}
            onClick={() => setModo(m.id)}
            disabled={readOnly}
            aria-pressed={modo === m.id}
          >
            {m.label}
          </button>
        ))}
      </div>
      <label className="fi-wi-field">
        <span>Observación · {activo.label}</span>
        <textarea
          className="pc-soap-textarea"
          rows={3}
          maxLength={1000}
          value={notaActual}
          onChange={(e) => setNota(e.target.value)}
          readOnly={readOnly}
          placeholder="Ej. pierna corta funcional derecha; corrige con extensión…"
        />
      </label>
    </div>
  );
}
