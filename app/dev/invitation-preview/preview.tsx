"use client";

import { useState } from "react";

import { InvitationAuth, InvitationDecision, type InvitationPreview } from "@/app/(public)/invitacion/[token]/invitation-client";

const token = "folio-test-invitation-local-only";
const example: InvitationPreview = { organization_id: "synthetic-clinic", organization_name: "Clínica de ejemplo", email: "synthetic@example.invalid", role: "ASISTENTE", es_colegiado: false, estado: "PENDIENTE", expired: false };

export function InvitationPreviewSurface({ state }: { state: string }) {
  const [blocked, setBlocked] = useState(false);
  const preview = state === "missing" ? null : { ...example, expired: state === "expired", estado: state === "revoked" ? "REVOCADA" as const : state === "accepted" ? "ACEPTADA" as const : "PENDIENTE" as const };
  return <div style={{ width: "100%", maxWidth: 500 }} onSubmitCapture={(event) => { event.preventDefault(); event.stopPropagation(); setBlocked(true); }} onClickCapture={(event) => {
    const button = (event.target as Element).closest("button");
    if (button && (button.type === "submit" || /aceptar invitación|cambiar de cuenta/i.test(button.textContent ?? ""))) {
      event.preventDefault(); event.stopPropagation(); setBlocked(true);
    }
  }}>
    {blocked ? <p role="status" style={{ padding: 12, background: "var(--accent-soft)", borderRadius: 8 }}>Muestra local: no se envió ninguna solicitud ni se cambió la sesión.</p> : null}
    {state === "auth" ? <InvitationAuth token={token} /> : <InvitationDecision token={token} preview={preview} sessionEmail={state === "mismatch" ? "other@example.invalid" : example.email} />}
  </div>;
}
