"use client";

/**
 * Folio · EnmiendaModal · corregir una sesión ya cerrada (B8).
 *
 * La ley no permite reescribir la historia clínica (Ley 26.529 art. 15), pero
 * sí exige poder **enmendarla**. La tabla `sesion_enmienda` existe desde M10 —
 * con su RLS y sus triggers append-only— y **nunca tuvo un caller**: una vez que
 * la sesión quedaba lockeada, corregir un error de transcripción era imposible
 * desde la app.
 *
 * El motivo es obligatorio y de 10 a 500 caracteres (espejo del CHECK de la
 * tabla): es lo que queda registrado como justificación de la corrección, así
 * que "error" no alcanza. La corrección en sí se cifra app-side.
 *
 * La sesión original NO se toca. Eso es el punto.
 */

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { addEnmiendaSesionAction } from "@/app/(app)/pacientes/actions";
import { useModalA11y } from "@/lib/use-modal-a11y";

const MOTIVO_MIN = 10;
const MOTIVO_MAX = 500;

export function EnmiendaModal({
  pacienteId,
  sesionId,
  fechaSesion,
  onClose,
}: {
  pacienteId: string;
  sesionId: string;
  /** Para que el profesional vea sobre qué visita está enmendando. */
  fechaSesion: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [texto, setTexto] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(dialogRef, { onClose, closeDisabled: pending });

  const motivoLimpio = motivo.trim();
  const textoLimpio = texto.trim();
  const puedeGuardar =
    motivoLimpio.length >= MOTIVO_MIN &&
    motivoLimpio.length <= MOTIVO_MAX &&
    textoLimpio.length > 0 &&
    !pending;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!puedeGuardar) return;
    setErr(null);
    startTransition(async () => {
      const result = await addEnmiendaSesionAction(pacienteId, sesionId, motivoLimpio, textoLimpio);
      if (!result.ok) {
        setErr(result.error.message);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="enmienda-title"
      tabIndex={-1}
      className="a11y-modal-root"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,14,8,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          maxWidth: 520,
          width: "100%",
          padding: "20px 22px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.18)",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
        }}
      >
        <header style={{ marginBottom: 16 }}>
          <span className="fi-eyebrow">enmienda</span>
          <h2 id="enmienda-title" style={{ margin: "4px 0 0", fontSize: 20 }}>
            Corregir la visita del {fechaSesion}
          </h2>
          <p style={{ margin: "6px 0 0", color: "var(--ink-3)", fontSize: 13, lineHeight: 1.5 }}>
            La nota original <b>no se modifica</b>: la corrección se agrega
            aparte, fechada y firmada. Es lo que pide la Ley 26.529 — la historia
            clínica no se reescribe, se enmienda.
          </p>
        </header>

        <Field
          label="Motivo de la corrección"
          hint={`Queda registrado como justificación. Entre ${MOTIVO_MIN} y ${MOTIVO_MAX} caracteres.`}
        >
          <input
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            style={inputStyle}
            maxLength={MOTIVO_MAX}
            placeholder="Error de transcripción: se anotó C4 en lugar de C5."
            required
            autoFocus
          />
          {motivoLimpio.length > 0 && motivoLimpio.length < MOTIVO_MIN ? (
            <span style={{ display: "block", fontSize: 12, color: "var(--amber)", marginTop: 4 }}>
              Faltan {MOTIVO_MIN - motivoLimpio.length} caracteres.
            </span>
          ) : null}
        </Field>

        <Field label="Corrección">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={5}
            style={{ ...inputStyle, resize: "vertical" }}
            placeholder="Lo que corresponde que diga la ficha."
            required
          />
        </Field>

        {err ? (
          <p role="alert" style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>
            {err}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="fi-btn fi-btn-ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </button>
          <button
            type="submit"
            className="fi-btn fi-btn-primary"
            disabled={!puedeGuardar}
            aria-busy={pending}
          >
            {pending ? "Guardando…" : "Guardar enmienda"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 13, color: "var(--ink-3)", marginBottom: 4 }}>
        {label}
      </span>
      {children}
      {hint ? (
        <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid var(--line)",
  borderRadius: 6,
  background: "var(--surface)",
  font: "inherit",
};
