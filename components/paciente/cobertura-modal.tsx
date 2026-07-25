"use client";

/**
 * Folio · CoberturaModal · edición de la cobertura del paciente (F7a, M89).
 *
 * La fila "Obra social" del tab Información mostraba "—" hardcodeado (D2).
 * Este modal persiste obra social/prepaga + plan + nº de afiliado vía
 * savePacienteCoberturaAction → updatePacienteCobertura (paciente_identidad).
 *
 * El input de obra social usa un <datalist> con las ~20 más comunes de AR
 * (lib/pacientes/cobertura.ts) pero acepta texto libre (mutuales/provinciales).
 * Dejar todo vacío (o tipear "Particular") = paciente particular → NULL en DB.
 *
 * PII: el nº de afiliado viaja en claro dentro del Server Action y se cifra
 * server-side (mismo tratamiento que el DNI del alta).
 *
 * Clona la estructura de PlanTratamientoModal: role="dialog" + useModalA11y
 * (focus trap + Escape + restore focus) + el look Field/inputStyle inline.
 */

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { savePacienteCoberturaAction } from "@/app/(app)/pacientes/actions";
import { OBRAS_SOCIALES_AR } from "@/lib/pacientes/cobertura";
import { useModalA11y } from "@/lib/use-modal-a11y";

interface CoberturaPrefill {
  coberturaNombre: string | null;
  coberturaPlan: string | null;
  coberturaNroAfiliado: string | null;
}

interface CoberturaModalProps {
  pacienteId: string;
  prefill: CoberturaPrefill;
  onClose: () => void;
}

export function CoberturaModal({ pacienteId, prefill, onClose }: CoberturaModalProps) {
  const router = useRouter();
  const [nombre, setNombre] = useState(prefill.coberturaNombre ?? "");
  const [plan, setPlan] = useState(prefill.coberturaPlan ?? "");
  const [nroAfiliado, setNroAfiliado] = useState(prefill.coberturaNroAfiliado ?? "");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // A11y de modal compartida: focus trap + Escape (deshabilitado en submit) +
  // foco inicial + restore focus al cerrar. Ver lib/use-modal-a11y.ts.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(dialogRef, { onClose, closeDisabled: pending });

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setErr(null);
    startTransition(async () => {
      const result = await savePacienteCoberturaAction({
        pacienteId,
        coberturaNombre: nombre.trim(),
        coberturaPlan: plan.trim(),
        coberturaNroAfiliado: nroAfiliado.trim(),
      });
      if (!result.ok) {
        setErr(result.error.message);
        return;
      }
      onClose();
      // Refrescar la ficha para que la fila "Obra social" muestre lo guardado.
      router.refresh();
    });
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cobertura-edit-title"
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
          maxWidth: 460,
          width: "100%",
          padding: "20px 22px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.18)",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
        }}
      >
        <header style={{ marginBottom: 16 }}>
          <span className="fi-eyebrow">cobertura</span>
          <h2 id="cobertura-edit-title" style={{ margin: "4px 0 0", fontSize: 20 }}>
            Editar cobertura
          </h2>
          <p style={{ margin: "4px 0 0", color: "var(--ink-3)", fontSize: 13 }}>
            Obra social o prepaga del paciente. Dejá todo vacío si es particular.
          </p>
        </header>

        <Field
          label="Obra social / prepaga"
          hint="Empezá a escribir y elegí de la lista, o tipeá la tuya."
        >
          <input
            type="text"
            list="cobertura-os-datalist"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            style={inputStyle}
            maxLength={120}
            placeholder="OSDE, Swiss Medical, PAMI…"
            autoFocus
          />
        </Field>
        <datalist id="cobertura-os-datalist">
          {OBRAS_SOCIALES_AR.map((os) => (
            <option key={os} value={os} />
          ))}
        </datalist>

        <Field label="Plan (opcional)" hint="Ej.: 210, SMG30.">
          <input
            type="text"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            style={inputStyle}
            maxLength={40}
          />
        </Field>

        <Field label="Nº de afiliado (opcional)" hint="Se cifra en la DB, como el DNI.">
          <input
            type="text"
            value={nroAfiliado}
            onChange={(e) => setNroAfiliado(e.target.value)}
            style={inputStyle}
            maxLength={40}
          />
        </Field>

        {err ? (
          <p role="alert" style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>
            {err}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button
            type="button"
            className="fi-btn fi-btn-ghost"
            onClick={onClose}
            disabled={pending}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="fi-btn fi-btn-primary"
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? "Guardando…" : "Guardar cobertura"}
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
