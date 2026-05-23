"use client";

/**
 * Folio · PacienteCreateModal · alta de paciente desde el directorio.
 *
 * Variante standalone del flow walk-in (que crea paciente + turno juntos).
 * Acá solo creamos el paciente — útil para importar contactos del consultorio
 * sin agendar nada todavía, o para preparar la ficha antes de la primera
 * sesión. Tras el insert exitoso, el directorio se revalida vía server
 * action y el modal se cierra.
 */

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { createPacienteAction } from "@/app/(app)/pacientes/actions";

interface PacienteCreateModalProps {
  onClose: () => void;
  onCreated?: (id: string) => void;
}

interface FormState {
  nombre: string;
  apellido: string;
  telefono: string;
  email: string;
  numeroDoc: string;
  motivoConsulta: string;
}

const EMPTY: FormState = {
  nombre: "",
  apellido: "",
  telefono: "",
  email: "",
  numeroDoc: "",
  motivoConsulta: "",
};

export function PacienteCreateModal({ onClose, onCreated }: PacienteCreateModalProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // Escape cierra el modal cuando no estamos en submit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const canSubmit =
    !pending &&
    form.nombre.trim().length > 0 &&
    form.apellido.trim().length > 0 &&
    form.telefono.trim().length >= 6;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setErr(null);
    startTransition(async () => {
      const result = await createPacienteAction({
        nombre: form.nombre.trim(),
        apellido: form.apellido.trim(),
        telefono: form.telefono.trim(),
        email: form.email.trim(),
        numeroDoc: form.numeroDoc.trim(),
        motivoConsulta: form.motivoConsulta.trim(),
      });
      if (!result.ok) {
        setErr(result.error.message);
        return;
      }
      if (onCreated) onCreated(result.data.id);
      onClose();
      // Refrescar /pacientes para que aparezca en la tabla.
      router.refresh();
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pac-create-title"
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
          <span className="fi-eyebrow">nuevo paciente</span>
          <h2 id="pac-create-title" style={{ margin: "4px 0 0", fontSize: 20 }}>
            Agregar al directorio
          </h2>
          <p style={{ margin: "4px 0 0", color: "var(--ink-3)", fontSize: 13 }}>
            Solo identidad y contacto. El motivo de consulta y la historia clínica los
            llenás después desde la ficha.
          </p>
        </header>

        <Field label="Nombre" required>
          <input
            type="text"
            value={form.nombre}
            onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
            style={inputStyle}
            autoFocus
            required
          />
        </Field>

        <Field label="Apellido" required>
          <input
            type="text"
            value={form.apellido}
            onChange={(e) => setForm((f) => ({ ...f, apellido: e.target.value }))}
            style={inputStyle}
            required
          />
        </Field>

        <Field label="Teléfono" required hint="Mínimo 6 dígitos. Se cifra en la DB.">
          <input
            type="tel"
            value={form.telefono}
            onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
            style={inputStyle}
            required
          />
        </Field>

        <Field label="Email (opcional)">
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            style={inputStyle}
          />
        </Field>

        <Field label="DNI (opcional)" hint="Sin puntos. Se cifra y se indexa con SHA-256 para búsqueda.">
          <input
            type="text"
            value={form.numeroDoc}
            onChange={(e) => setForm((f) => ({ ...f, numeroDoc: e.target.value }))}
            style={inputStyle}
            inputMode="numeric"
            maxLength={20}
          />
        </Field>

        <Field label="Motivo de consulta (opcional)">
          <textarea
            value={form.motivoConsulta}
            onChange={(e) => setForm((f) => ({ ...f, motivoConsulta: e.target.value }))}
            style={{ ...inputStyle, minHeight: 64, resize: "vertical" }}
            maxLength={2000}
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
            disabled={!canSubmit}
          >
            {pending ? "Creando…" : "Crear paciente"}
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
