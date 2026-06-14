"use client";

/**
 * Folio · campos dinámicos del intake avanzado (Workstream 5).
 *
 * Renderiza los campos de getIntakeAvanzadoConfig(especialidad).campos según su
 * tipo (text → input, textarea → textarea, boolean → checkbox, select → select).
 * Lo comparten el alta (PacienteCreateModal) y el modal de edición de la ficha
 * (IntakeAvanzadoModal): la fuente de verdad de qué campos existen es el registry.
 *
 * El estado vive en el padre: `valores` (key → string|boolean) + `onChange`.
 * Solo strings y booleanos — los selects guardan el value (string) elegido.
 *
 * Helpers exportados (datosToValores / valoresToDatos) traducen entre el shape
 * del form y el `datos` que viaja a la action (omite vacíos). Sin estos, cada
 * modal duplicaría la lógica de "no mandes strings vacíos ni false".
 */

import type { IntakeCampo, EspecialidadSlug } from "@/lib/especialidades/registry";
import { getIntakeAvanzadoConfig } from "@/lib/especialidades/registry";

/** Valor de un campo en el form: string (text/textarea/select) o boolean. */
export type IntakeValor = string | boolean;
export type IntakeValores = Record<string, IntakeValor>;

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid var(--line)",
  borderRadius: 6,
  background: "var(--surface)",
  font: "inherit",
};

/**
 * Estado inicial del form para una especialidad: todos los campos en su valor
 * "vacío" (booleano → false; resto → ""), mergeando lo que venga de `datos`
 * (prefill de la ficha). Solo se toman las keys que el registry conoce.
 */
export function datosToValores(
  especialidad: EspecialidadSlug,
  datos?: Record<string, unknown> | null,
): IntakeValores {
  const out: IntakeValores = {};
  for (const campo of getIntakeAvanzadoConfig(especialidad).campos) {
    const raw = datos ? datos[campo.key] : undefined;
    if (campo.tipo === "boolean") {
      out[campo.key] = raw === true;
    } else {
      out[campo.key] = typeof raw === "string" ? raw : "";
    }
  }
  return out;
}

/**
 * Traduce los valores del form al `datos` que viaja a la action: omite strings
 * vacíos y booleanos false (no aportan; mantienen el JSON chico). El writer
 * igual revalida contra el schema de la especialidad server-side.
 */
export function valoresToDatos(valores: IntakeValores): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(valores)) {
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed.length > 0) out[key] = trimmed;
    } else if (val === true) {
      out[key] = true;
    }
  }
  return out;
}

export function IntakeAvanzadoFields({
  especialidad,
  valores,
  onChange,
  disabled,
}: {
  especialidad: EspecialidadSlug;
  valores: IntakeValores;
  onChange: (key: string, value: IntakeValor) => void;
  disabled?: boolean;
}) {
  const campos = getIntakeAvanzadoConfig(especialidad).campos;
  if (campos.length === 0) return null;
  return (
    <>
      {campos.map((campo) => (
        <IntakeFieldRow
          key={campo.key}
          campo={campo}
          value={valores[campo.key]}
          onChange={(v) => onChange(campo.key, v)}
          disabled={disabled}
        />
      ))}
    </>
  );
}

function IntakeFieldRow({
  campo,
  value,
  onChange,
  disabled,
}: {
  campo: IntakeCampo;
  value: IntakeValor | undefined;
  onChange: (value: IntakeValor) => void;
  disabled?: boolean;
}) {
  // Boolean → checkbox inline (el label va al lado del control).
  if (campo.tipo === "boolean") {
    return (
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          fontSize: 14,
          color: "var(--ink-2)",
        }}
      >
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        {campo.label}
      </label>
    );
  }

  const strValue = typeof value === "string" ? value : "";

  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 13, color: "var(--ink-3)", marginBottom: 4 }}>
        {campo.label}
      </span>
      {campo.tipo === "textarea" ? (
        <textarea
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, minHeight: 64, resize: "vertical" }}
          maxLength={2000}
          disabled={disabled}
        />
      ) : campo.tipo === "select" ? (
        <select
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
          disabled={disabled}
        >
          <option value="">Sin especificar</option>
          {(campo.opciones ?? []).map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
          maxLength={120}
          disabled={disabled}
        />
      )}
    </label>
  );
}
