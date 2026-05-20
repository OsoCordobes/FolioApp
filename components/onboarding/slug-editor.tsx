"use client";

/**
 * Folio · SlugEditor
 *
 * Input inline para que el user vea y edite su link público.
 * Layout: prefix fijo (app.folio.com/book/) + input editable.
 *
 * Validación:
 *   - Formato: cliente-side, instantáneo (validateSlugFormat).
 *   - Disponibilidad: Server Action checkSlugAvailability, debounce 400ms.
 *
 * Estados visuales:
 *   - idle (sin cambios): neutro.
 *   - typing: spinner sutil.
 *   - format-invalid: rojo + mensaje específico.
 *   - checking: spinner.
 *   - available: ✓ verde.
 *   - taken: ✗ rojo + sugerencias clicables.
 *
 * El componente NO persiste — comunica el slug elegido via onChange. El padre
 * (Step 3 del onboarding o /configuracion) decide cuándo guardar.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { checkSlugAvailability } from "@/lib/onboarding/slug-actions";
import {
  slugify,
  suggestSlugAlternatives,
  validateSlugFormat,
} from "@/lib/onboarding/slug";

type CheckState =
  | { kind: "idle" }
  | { kind: "typing" }
  | { kind: "format-invalid"; message: string }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken"; suggestions: string[] };

interface SlugEditorProps {
  /** Slug actual. Si no hay, mostramos placeholder según baseSuggestion. */
  value: string;
  /** Callback cuando el slug cambia (y es válido). El padre decide guardar. */
  onChange: (slug: string) => void;
  /** Slug provisional sugerido (ej. de nombre-apellido) para auto-llenar. */
  baseSuggestion?: string;
  /** OrgId actual — para excluir de la verificación de disponibilidad. */
  currentOrgId?: string;
  /** URL base mostrada como prefix (ej. "folio-app-ten.vercel.app"). */
  prefix?: string;
  /** Disabled state. */
  disabled?: boolean;
}

export function SlugEditor({
  value,
  onChange,
  baseSuggestion = "",
  currentOrgId,
  prefix = "folio-app-ten.vercel.app",
  disabled = false,
}: SlugEditorProps) {
  const [local, setLocal] = useState(value);
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedRef = useRef<string>("");

  // Sync external value into local input
  useEffect(() => {
    setLocal(value);
  }, [value]);

  const runCheck = useCallback(
    async (slug: string) => {
      if (lastCheckedRef.current === slug) return;
      lastCheckedRef.current = slug;
      setCheck({ kind: "checking" });
      try {
        const res = await checkSlugAvailability(slug, currentOrgId);
        // Si el slug ya cambió mientras hacíamos la request, no aplicamos el resultado
        if (lastCheckedRef.current !== slug) return;
        if (!res.ok) {
          setCheck({ kind: "format-invalid", message: res.error });
          return;
        }
        if (res.available) {
          setCheck({ kind: "available" });
          onChange(slug);
        } else {
          setCheck({ kind: "taken", suggestions: res.suggestions });
        }
      } catch {
        setCheck({ kind: "format-invalid", message: "Error verificando disponibilidad." });
      }
    },
    [currentOrgId, onChange],
  );

  const onLocalChange = (raw: string) => {
    // Slugify aggressively while typing — solo dejamos lo válido.
    const cleaned = slugify(raw);
    setLocal(cleaned);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Validación de formato instantánea
    const formatErr = validateSlugFormat(cleaned);
    if (formatErr) {
      setCheck({ kind: "format-invalid", message: formatErr });
      return;
    }

    setCheck({ kind: "typing" });
    debounceRef.current = setTimeout(() => {
      void runCheck(cleaned);
    }, 400);
  };

  const applySuggestion = (s: string) => {
    setLocal(s);
    setCheck({ kind: "checking" });
    void runCheck(s);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const placeholder = baseSuggestion || "tu-link";

  return (
    <div className="slug-editor" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--ink-3)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        Tu link público
      </label>

      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          border: `1px solid ${stateBorderColor(check)}`,
          borderRadius: 8,
          background: disabled ? "var(--surface-2)" : "var(--surface)",
          transition: "border-color var(--motion-fast) var(--motion-ease-out)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            padding: "10px 12px",
            fontSize: 13,
            color: "var(--ink-3)",
            background: "var(--surface-2)",
            borderRight: "1px solid var(--line-soft)",
            fontFamily: "var(--font-mono, monospace)",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
          }}
        >
          {prefix}/book/
        </span>
        <input
          type="text"
          value={local}
          onChange={(e) => onLocalChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "10px 12px",
            border: "none",
            outline: "none",
            fontSize: 14,
            fontFamily: "var(--font-mono, monospace)",
            background: "transparent",
            color: "var(--ink)",
          }}
        />
        <StatusIndicator state={check} />
      </div>

      <StatusLine state={check} onPickSuggestion={applySuggestion} />
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function StatusIndicator({ state }: { state: CheckState }) {
  const containerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 12px",
    minWidth: 36,
  };

  switch (state.kind) {
    case "checking":
    case "typing":
      return (
        <span style={containerStyle} aria-label="Verificando">
          <Spinner />
        </span>
      );
    case "available":
      return (
        <span style={{ ...containerStyle, color: "var(--green, #2E6A3B)" }} aria-label="Disponible">
          <IconCheck />
        </span>
      );
    case "taken":
    case "format-invalid":
      return (
        <span style={{ ...containerStyle, color: "var(--red, #9B3A2A)" }} aria-label="No disponible">
          <IconCross />
        </span>
      );
    default:
      return <span style={containerStyle} aria-hidden />;
  }
}

function StatusLine({
  state,
  onPickSuggestion,
}: {
  state: CheckState;
  onPickSuggestion: (s: string) => void;
}) {
  switch (state.kind) {
    case "available":
      return (
        <p style={{ margin: 0, fontSize: 12, color: "var(--green, #2E6A3B)" }}>
          Disponible — este link va a ser tu URL pública.
        </p>
      );
    case "format-invalid":
      return (
        <p style={{ margin: 0, fontSize: 12, color: "var(--red, #9B3A2A)" }}>
          {state.message}
        </p>
      );
    case "taken":
      return (
        <div style={{ margin: 0, fontSize: 12, color: "var(--red, #9B3A2A)" }}>
          Ya está tomado. Probá:
          <span style={{ marginLeft: 6 }}>
            {state.suggestions.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => onPickSuggestion(s)}
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  padding: "2px 8px",
                  fontSize: 12,
                  marginRight: i < state.suggestions.length - 1 ? 4 : 0,
                  cursor: "pointer",
                  color: "var(--ink-2)",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              >
                {s}
              </button>
            ))}
          </span>
        </div>
      );
    case "typing":
    case "checking":
      return (
        <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>
          Verificando disponibilidad…
        </p>
      );
    default:
      return (
        <p style={{ margin: 0, fontSize: 12, color: "var(--ink-4)" }}>
          Solo minúsculas, números y guiones. Este link queda fijo después.
        </p>
      );
  }
}

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: "1.5px solid var(--line)",
        borderTopColor: "var(--accent, #8A6722)",
        borderRadius: "50%",
        animation: "spin 720ms linear infinite",
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconCross() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function stateBorderColor(state: CheckState): string {
  switch (state.kind) {
    case "available":
      return "var(--green, #2E6A3B)";
    case "taken":
    case "format-invalid":
      return "var(--red, #9B3A2A)";
    case "checking":
    case "typing":
      return "var(--accent, #8A6722)";
    default:
      return "var(--line)";
  }
}

// Helper para que el caller que viene de afuera pueda generar baseSuggestion.
export { suggestSlugAlternatives };
