"use client";

/**
 * Folio · ContactoModal · edición de los datos de contacto del paciente (B8).
 *
 * El botón "Editar" del card Contacto estaba `disabled` con un tooltip que
 * mandaba a "Configuración" — donde tampoco se podían editar. Un paciente que
 * cambia de teléfono o se muda no tenía forma de corregirse sin tocar la base a
 * mano.
 *
 * PII: nombre, apellido, teléfono y email viajan en claro dentro del Server
 * Action y se cifran server-side, igual que en el alta. Lo que NO es opcional
 * es el recálculo de los blind indexes (`nombre_hash`, `telefono_hash`): sin
 * eso el paciente desaparece del buscador aunque siga existiendo. Eso lo
 * garantiza `buildContactoUpdatePayload`, que tiene su propio test.
 *
 * El documento (DNI) no se edita acá a propósito: es el identificador con el
 * que se deduplica en el alta, y cambiarlo desde la ficha pide otra
 * conversación (¿es la misma persona?).
 *
 * Clona la estructura de CoberturaModal: role="dialog" + useModalA11y (focus
 * trap + Escape + restore focus) + Field/inputStyle inline.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { updateContactoPacienteAction } from "@/app/(app)/pacientes/actions";
import type { AdminEditorSnapshot } from "@/lib/db/pacientes";
import { useModalA11y } from "@/lib/use-modal-a11y";

interface ContactoPrefill {
  nombre: string;
  apellido: string;
  telefono: string;
  email: string;
  ocupacion: string;
}

export function ContactoModal({
  pacienteId,
  adminEditor,
  prefill,
  onClose,
}: {
  pacienteId: string;
  adminEditor: AdminEditorSnapshot;
  prefill: ContactoPrefill;
  onClose: () => void;
}) {
  const router = useRouter();
  // Revision belongs to this draft. A refreshed prop must never upgrade it silently.
  const [snapshot] = useState(adminEditor);
  const [draftPatientId] = useState(pacienteId);
  const [blocked, setBlocked] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [copied, setCopied] = useState(false);
  const live = useRef(false);
  const currentScope = useRef(`${pacienteId}:${adminEditor.identidadId}:${adminEditor.editorScope}`);
  currentScope.current = `${pacienteId}:${adminEditor.identidadId}:${adminEditor.editorScope}`;
  const draftScope = `${draftPatientId}:${snapshot.identidadId}:${snapshot.editorScope}`;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [nombre, setNombre] = useState(prefill.nombre);
  const [apellido, setApellido] = useState(prefill.apellido);
  const [telefono, setTelefono] = useState(prefill.telefono);
  const [email, setEmail] = useState(prefill.email);
  const [ocupacion, setOcupacion] = useState(prefill.ocupacion);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(dialogRef, { onClose, closeDisabled: pending });

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (pending || blocked || revoked || draftScope !== currentScope.current) return;
    setErr(null);
    startTransition(async () => {
      try {
      const result = await updateContactoPacienteAction({
        pacienteId,
        ...snapshot,
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        telefono: telefono.trim(),
        email: email.trim(),
        ocupacion: ocupacion.trim(),
      });
      if (!live.current || currentScope.current !== draftScope) return;
      if (!result.ok) {
        if (["auth_required", "mfa_required", "no_org", "forbidden", "not_found"].includes(result.error.code)) {
          setRevoked(true);
          setNombre("");
          setApellido("");
          setTelefono("");
          setEmail("");
          setOcupacion("");
        } else if (result.error.code !== "validation") setBlocked(true);
        setErr(result.error.message);
        return;
      }
      onClose();
      router.refresh();
      } catch {
        if (!live.current || currentScope.current !== draftScope) return;
        setBlocked(true);
        setErr("No pudimos confirmar el guardado. Conservá tu borrador y revisá los datos actuales antes de volver a editar.");
      }
    });
  };

  if (revoked || draftScope !== currentScope.current) return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Edición no disponible" tabIndex={-1} className="a11y-modal-root">
      <p role="alert">La edición ya no está disponible. Volvé a abrir la ficha con tu sesión actual.</p>
      <button type="button" className="fi-btn fi-btn-secondary" onClick={onClose}>Cerrar</button>
    </div>
  );

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ nombre, apellido, telefono, email, ocupacion }, null, 2));
      if (live.current && currentScope.current === draftScope) setCopied(true);
    } catch {
      if (live.current && currentScope.current === draftScope) setErr("No pudimos copiar el borrador. Conservá los datos antes de recargar.");
    }
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="contacto-edit-title"
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
      onClick={() => { if (!pending) onClose(); }}
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
          <span className="fi-eyebrow">contacto</span>
          <h2 id="contacto-edit-title" style={{ margin: "4px 0 0", fontSize: 20 }}>
            Editar datos de contacto
          </h2>
          <p style={{ margin: "4px 0 0", color: "var(--ink-3)", fontSize: 13 }}>
            El documento no se edita acá: es con lo que se evita cargar dos veces
            al mismo paciente.
          </p>
        </header>

        <Field label="Nombre">
          <input
            type="text"
            value={nombre}
            onChange={(e) => { setNombre(e.target.value); setCopied(false); }}
            style={inputStyle}
            disabled={pending}
            maxLength={120}
            required
          />
        </Field>

        <Field label="Apellido">
          <input
            type="text"
            value={apellido}
            onChange={(e) => { setApellido(e.target.value); setCopied(false); }}
            style={inputStyle}
            disabled={pending}
            maxLength={120}
            required
          />
        </Field>

        <Field label="Teléfono" hint="Con característica. Es por donde salen los recordatorios.">
          <input
            type="tel"
            value={telefono}
            onChange={(e) => { setTelefono(e.target.value); setCopied(false); }}
            style={inputStyle}
            disabled={pending}
            maxLength={30}
            required
          />
        </Field>

        <Field label="Email (opcional)">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setCopied(false); }}
            style={inputStyle}
            disabled={pending}
            maxLength={320}
          />
        </Field>

        <Field label="Ocupación (opcional)">
          <input
            type="text"
            value={ocupacion}
            onChange={(e) => { setOcupacion(e.target.value); setCopied(false); }}
            style={inputStyle}
            disabled={pending}
            maxLength={120}
          />
        </Field>

        {blocked ? (
          <div>
            <button type="button" className="fi-btn fi-btn-secondary" disabled={pending} onClick={() => void copyDraft()}>Copiar borrador</button>
            <button type="button" className="fi-btn fi-btn-ghost" disabled={pending || !copied} onClick={() => window.location.reload()}>Recargar datos para revisar</button>
          </div>
        ) : null}
        {err ? (
          <p role="alert" style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>
            {err}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="fi-btn fi-btn-ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </button>
          <button type="submit" className="fi-btn fi-btn-primary" disabled={pending || blocked} aria-busy={pending}>
            {pending ? "Guardando…" : "Guardar contacto"}
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
