"use client";

import { useState, useTransition } from "react";

import { useConfirm } from "@/lib/use-confirm";

import {
  cancelAccountDeletionAction,
  exportMyDataAction,
  requestAccountDeletionAction,
} from "./actions";

interface DatosClientProps {
  email: string;
  deletionRequestedAt: string | null;
  deletionReason: string | null;
  consentSignedAt: string | null;
  consentTextVersion: string | null;
}

export function DatosClient({
  email,
  deletionRequestedAt,
  deletionReason,
  consentSignedAt,
  consentTextVersion,
}: DatosClientProps) {
  const [pending, startTransition] = useTransition();
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const [deletionReasonInput, setDeletionReasonInput] = useState("");
  const { confirmar, dialogo } = useConfirm();

  const onExport = () => {
    setExportErr(null);
    startTransition(async () => {
      try {
        const result = await exportMyDataAction();
        if (!result.ok || !result.data) {
          setExportErr(result.error ?? "No pude armar el export.");
          return;
        }
        const blob = new Blob([JSON.stringify(result.data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.filename ?? "folio-export.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        setExportErr("No se pudo completar la descarga. Reintentá.");
      }
    });
  };

  const onRequestDelete = async () => {
    setDeleteErr(null);
    const ok = await confirmar({
      titulo: "¿Solicitar la baja de tu cuenta?",
      mensaje:
        "Registraremos la solicitud para revisar la conservación y la entrega autorizada de la información. No se borrarán automáticamente tu cuenta ni las historias clínicas. Podés cancelar la solicitud desde esta pantalla.",
      confirmLabel: "Registrar solicitud",
      variant: "danger",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const result = await requestAccountDeletionAction(deletionReasonInput || undefined);
        if (!result.ok) {
          setDeleteErr(result.error ?? "No pude registrar la solicitud.");
          return;
        }
        setShowDeleteForm(false);
      } catch {
        setDeleteErr("No se pudo confirmar la solicitud. Reintentá.");
      }
    });
  };

  const onCancelDelete = () => {
    setDeleteErr(null);
    startTransition(async () => {
      try {
        const result = await cancelAccountDeletionAction();
        if (!result.ok) {
          setDeleteErr(result.error.message ?? "No pude cancelar la solicitud.");
          return;
        }
      } catch {
        setDeleteErr("No se pudo confirmar la cancelación. Reintentá.");
      }
    });
  };

  return (
    <div style={{ display: "grid", gap: 32, marginTop: 24 }}>
      <section className="fi-card" style={{ padding: 24 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Email de la cuenta</h2>
        <p className="fm-mono" style={{ color: "var(--ink-2)", margin: "4px 0 12px" }}>{email}</p>
        {consentSignedAt ? (
          <p style={{ color: "var(--ink-3)", fontSize: 13 }}>
            Aceptaste el Aviso de Privacidad (versión <code>{consentTextVersion}</code>) el{" "}
            <strong>{new Date(consentSignedAt).toLocaleDateString("es-AR")}</strong>.
          </p>
        ) : null}
      </section>

      <section className="fi-card" style={{ padding: 24 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Descargar mis datos</h2>
        <p style={{ color: "var(--ink-3)", margin: "4px 0 16px" }}>
          Ley 25.326 art. 14. Descargás un JSON con tus datos personales: perfil,
          membresías, configuración de tus organizaciones y suscripción. Los datos
          clínicos de pacientes no se incluyen (son datos personales de cada
          paciente, no del titular de la cuenta) — se consultan desde la app.
        </p>
        <button
          type="button"
          className="fi-btn fi-btn-primary"
          onClick={onExport}
          disabled={pending}
        >
          {pending ? "Preparando…" : "Descargar JSON"}
        </button>
        {exportErr ? <p className="au-err" style={{ marginTop: 12 }}>{exportErr}</p> : null}
      </section>

      <section className="fi-card" style={{ padding: 24, borderColor: "var(--red-soft)" }}>
        <h2 style={{ marginTop: 0, fontSize: 18, color: "var(--red)" }}>
          Solicitar la baja de mi cuenta
        </h2>
        <p style={{ color: "var(--ink-3)", margin: "4px 0 16px" }}>
          Registramos tu solicitud para revisión humana. Antes de una baja se debe
          resolver la conservación y la entrega autorizada de la información.
          Las historias clínicas no se eliminan automáticamente. Podés cancelar la solicitud.
        </p>

        {deletionRequestedAt ? (
          <div style={{ display: "grid", gap: 12 }}>
            <p style={{ background: "var(--red-soft)", padding: "12px 14px", borderRadius: 8, margin: 0 }}>
              <strong>Solicitud pendiente de revisión</strong> · registrada el{" "}
              {new Date(deletionRequestedAt).toLocaleDateString("es-AR")}.
              {deletionReason ? <><br />Motivo: <em>{deletionReason}</em></> : null}
            </p>
            <button
              type="button"
              className="fi-btn fi-btn-secondary"
              onClick={onCancelDelete}
              disabled={pending}
            >
              {pending ? "Cancelando…" : "Cancelar solicitud (mantengo la cuenta)"}
            </button>
          </div>
        ) : showDeleteForm ? (
          <div style={{ display: "grid", gap: 12 }}>
            <label className="onb-field">
              <span>Motivo (opcional, audit-trail)</span>
              <textarea
                rows={3}
                value={deletionReasonInput}
                onChange={(e) => setDeletionReasonInput(e.target.value)}
                placeholder="Ej. Cierro el consultorio, cambio de plataforma…"
              />
            </label>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                type="button"
                className="fi-btn fi-btn-primary"
                style={{ background: "var(--red)" }}
                onClick={onRequestDelete}
                disabled={pending}
              >
                {pending ? "Registrando…" : "Registrar solicitud de baja"}
              </button>
              <button
                type="button"
                className="fi-btn fi-btn-ghost"
                onClick={() => setShowDeleteForm(false)}
                disabled={pending}
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="fi-btn fi-btn-ghost"
            style={{ color: "var(--red)" }}
            onClick={() => setShowDeleteForm(true)}
            disabled={pending}
          >
            Quiero solicitar la baja
          </button>
        )}
        {deleteErr ? <p className="au-err" style={{ marginTop: 12 }}>{deleteErr}</p> : null}
      </section>
      {dialogo}
    </div>
  );
}
