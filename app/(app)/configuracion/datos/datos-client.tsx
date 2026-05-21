"use client";

import { useState, useTransition } from "react";

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

  const onExport = () => {
    setExportErr(null);
    startTransition(async () => {
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
    });
  };

  const onRequestDelete = () => {
    setDeleteErr(null);
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Vamos a programar la eliminación de tu cuenta en 30 días. Podés cancelarla en cualquier momento dentro de ese plazo. ¿Continuamos?",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await requestAccountDeletionAction(deletionReasonInput || undefined);
      if (!result.ok) {
        setDeleteErr(result.error ?? "No pude programar la eliminación.");
        return;
      }
      setShowDeleteForm(false);
    });
  };

  const onCancelDelete = () => {
    setDeleteErr(null);
    startTransition(async () => {
      const result = await cancelAccountDeletionAction();
      if (!result.ok) {
        setDeleteErr(result.error.message ?? "No pude cancelar la solicitud.");
        return;
      }
    });
  };

  const scheduledFor = deletionRequestedAt
    ? new Date(new Date(deletionRequestedAt).getTime() + 30 * 24 * 60 * 60 * 1000)
    : null;

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
          Ley 25.326 art. 15. Descargás un JSON con tu perfil, tus orgs, tus pacientes
          (con PII descifrada), turnos y sesiones SOAP. Útil para auditoría
          personal o portabilidad a otra plataforma.
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
          Eliminar mi cuenta
        </h2>
        <p style={{ color: "var(--ink-3)", margin: "4px 0 16px" }}>
          Ley 25.326 art. 16. Programamos la eliminación de tu cuenta + todos los
          pacientes de tus consultorios (vía pseudonimización) en <strong>30 días</strong>.
          Durante ese plazo podés cancelar la solicitud y todo vuelve a la normalidad.
        </p>

        {deletionRequestedAt ? (
          <div style={{ display: "grid", gap: 12 }}>
            <p style={{ background: "var(--red-soft)", padding: "12px 14px", borderRadius: 8, margin: 0 }}>
              <strong>Eliminación programada</strong> · solicitada el{" "}
              {new Date(deletionRequestedAt).toLocaleDateString("es-AR")} · se ejecuta el{" "}
              {scheduledFor ? scheduledFor.toLocaleDateString("es-AR") : "—"}.
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
                {pending ? "Programando…" : "Programar eliminación en 30 días"}
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
            Quiero eliminar mi cuenta
          </button>
        )}
        {deleteErr ? <p className="au-err" style={{ marginTop: 12 }}>{deleteErr}</p> : null}
      </section>
    </div>
  );
}
