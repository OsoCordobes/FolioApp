"use client";

export const ACCENT_OPTIONS = [
  { value: "#8A6722", label: "Dorado" },
  { value: "#3F6B49", label: "Verde" },
  { value: "#3F5E75", label: "Azul" },
  { value: "#A8513A", label: "Terracota" },
] as const;

export function AccentPalette({ value, onChange, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="perfil-accent-options" role="group" aria-label="Color de la página pública">
      {ACCENT_OPTIONS.map((option) => {
        const selected = value.toUpperCase() === option.value.toUpperCase();
        return (
          <button
            key={option.value}
            type="button"
            className={`perfil-accent-option${selected ? " is-selected" : ""}`}
            aria-pressed={selected}
            aria-label={`${option.label}${selected ? ", seleccionado" : ""}`}
            disabled={disabled}
            onClick={() => onChange(option.value)}
          >
            <span className="perfil-accent-swatch" style={{ backgroundColor: option.value }} aria-hidden="true" />
            <span>{option.label}</span>
            {selected ? <span className="perfil-accent-check" aria-hidden="true">✓</span> : null}
          </button>
        );
      })}
    </div>
  );
}
