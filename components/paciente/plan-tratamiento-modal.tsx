"use client";

/**
 * Folio · PlanTratamientoModal · edición del plan de tratamiento (M58).
 *
 * El card "Plan de tratamiento" de la ficha tenía el botón "Editar" como stub
 * (disabled). Este modal persiste los campos editables del plan (1:1 por
 * paciente) vía savePlanTratamientoAction → upsert en plan_tratamiento.
 *
 * Genérico: solo los cinco campos compartidos por todas las especialidades
 * (sesiones objetivo, frecuencia, próximo control, diagnóstico, notas). Nada
 * específico de una especialidad vive acá (eso está en el slot clínico del
 * tab Plan, sesion.tool_data_cifrado).
 *
 * PHI: `diagnostico` y `notas` se cifran server-side en el writer; acá viajan
 * en claro dentro del Server Action (igual que el motivo de consulta del alta).
 *
 * Clona la estructura de PacienteCreateModal: role="dialog" + useModalA11y
 * (focus trap + Escape + restore focus) + el look Field/inputStyle inline.
 */

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { savePlanTratamientoAction } from "@/app/(app)/pacientes/actions";
import { useModalA11y } from "@/lib/use-modal-a11y";

interface PlanEditablePrefill {
  sesionesObjetivo: number | null;
  frecuencia: string | null;
  diagnostico: string | null;
  proximoControl: string | null;
  notas: string | null;
}

interface PlanTratamientoModalProps {
  pacienteId: string;
  prefill: PlanEditablePrefill;
  onClose: () => void;
}

interface FormState {
  sesionesObjetivo: string;
  frecuencia: string;
  proximoControl: string;
  diagnostico: string;
  notas: string;
}

export function PlanTratamientoModal({ pacienteId, prefill, onClose }: PlanTratamientoModalProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    sesionesObjetivo: prefill.sesionesObjetivo != null ? String(prefill.sesionesObjetivo) : "",
    frecuencia: prefill.frecuencia ?? "",
    proximoControl: prefill.proximoControl ?? "",
    diagnostico: prefill.diagnostico ?? "",
    notas: prefill.notas ?? "",
  });
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // A11y de modal compartida: focus trap + Escape (deshabilitado en submit) +
  // foco inicial + restore focus al cerrar. Ver lib/use-modal-a11y.ts.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(dialogRef, { onClose, closeDisabled: pending });

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setErr(null);

    // Campos vacíos → null (borra el valor en la fila). Sesiones objetivo: solo
    // un entero válido; vacío o no-numérico → null (no enviar NaN al writer).
    const sesionesTrim = form.sesionesObjetivo.trim();
    const sesionesNum = sesionesTrim === "" ? null : Number.parseInt(sesionesTrim, 10);
    const frecuenciaTrim = form.frecuencia.trim();
    const diagnosticoTrim = form.diagnostico.trim();
    const notasTrim = form.notas.trim();

    startTransition(async () => {
      const result = await savePlanTratamientoAction({
        pacienteId,
        sesionesObjetivo:
          sesionesNum != null && Number.isFinite(sesionesNum) ? sesionesNum : null,
        frecuencia: frecuenciaTrim.length > 0 ? frecuenciaTrim : null,
        proximoControl: form.proximoControl ? form.proximoControl : null,
        diagnostico: diagnosticoTrim.length > 0 ? diagnosticoTrim : null,
        notas: notasTrim.length > 0 ? notasTrim : null,
      });
      if (!result.ok) {
        setErr(result.error.message);
        return;
      }
      onClose();
      // Refrescar la ficha para que el card muestre los valores recién guardados.
      router.refresh();
    });
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-edit-title"
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
          <span className="fi-eyebrow">plan de tratamiento</span>
          <h2 id="plan-edit-title" style={{ margin: "4px 0 0", fontSize: 20 }}>
            Editar plan
          </h2>
          <p style={{ margin: "4px 0 0", color: "var(--ink-3)", fontSize: 13 }}>
            Objetivos y diagnóstico del paciente. Las sesiones completadas se
            cuentan solas a partir de los turnos cerrados.
          </p>
        </header>

        <Field label="Sesiones objetivo (opcional)" hint="Cuántas sesiones planeás en total. Entre 0 y 1000.">
          <input
            type="number"
            value={form.sesionesObjetivo}
            onChange={(e) => setForm((f) => ({ ...f, sesionesObjetivo: e.target.value }))}
            style={inputStyle}
            min={0}
            max={1000}
            step={1}
            inputMode="numeric"
            autoFocus
          />
        </Field>

        <Field label="Frecuencia (opcional)" hint="Ej.: Semanal, Quincenal, Mensual.">
          <input
            type="text"
            value={form.frecuencia}
            onChange={(e) => setForm((f) => ({ ...f, frecuencia: e.target.value }))}
            style={inputStyle}
            maxLength={60}
          />
        </Field>

        <Field label="Próximo control (opcional)">
          <input
            type="date"
            value={form.proximoControl}
            onChange={(e) => setForm((f) => ({ ...f, proximoControl: e.target.value }))}
            style={inputStyle}
          />
        </Field>

        <Field label="Diagnóstico (opcional)" hint="Se cifra en la DB.">
          <textarea
            value={form.diagnostico}
            onChange={(e) => setForm((f) => ({ ...f, diagnostico: e.target.value }))}
            style={{ ...inputStyle, minHeight: 64, resize: "vertical" }}
            maxLength={2000}
          />
        </Field>

        <Field label="Notas del plan (opcional)" hint="Se cifra en la DB.">
          <textarea
            value={form.notas}
            onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))}
            style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
            maxLength={5000}
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
            {pending ? "Guardando…" : "Guardar plan"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 13, color: "var(--ink-3)", marginBottom: 4 }}>
        {label}
        {required ? <span style={{ color: "var(--red)" }}> *</span> : null}
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
