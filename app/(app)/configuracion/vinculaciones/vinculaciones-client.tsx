"use client";

/**
 * Folio · VinculacionesClient (Fase 3 · P9) — aprobar/rechazar claims de portal.
 *
 * Lista las solicitudes de vinculación PENDIENTES y deja al clínico aprobarlas
 * (materializa el link paciente↔cuenta) o rechazarlas. Cada acción llama a
 * resolverClaimAction (server), que delega en el RPC resolver_paciente_claim (M87,
 * el gate anti-impersonación). La UI es optimista sólo en el sentido de sacar la
 * fila resuelta de la lista tras el ok; ante error muestra el mensaje y mantiene la
 * fila.
 *
 * Estilo: folio.css hand-written, tokens brass/cream (fi-card, fi-btn-*, --ink-*,
 * --green/--red). Sin Tailwind/shadcn.
 */

import { useState, useTransition } from "react";

import type { PacienteClaimView } from "@/lib/db/paciente-claims";
import { useConfirm } from "@/lib/use-confirm";

import { resolverClaimAction } from "./actions";

type ClaimView = PacienteClaimView;

interface Props {
  initialClaims: ClaimView[];
}

export function VinculacionesClient({ initialClaims }: Props) {
  const [claims, setClaims] = useState<ClaimView[]>(initialClaims);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();
  const { confirmar, dialogo } = useConfirm();

  const resolve = async (claim: ClaimView, aprobar: boolean) => {
    // Confirmación explícita: aprobar da acceso del portal a la ficha clínica.
    const verbo = aprobar ? "vincular" : "rechazar";
    const nombre = claim.pacienteNombre ?? "esta ficha";
    const ok = await confirmar(
      aprobar
        ? {
            titulo: `¿Vincular la ficha de ${nombre}?`,
            mensaje: `${claim.cuentaEmail} va a poder ver desde su portal los turnos y consentimientos de esta ficha. Confirmá solo si estás seguro de que es la misma persona.`,
            confirmLabel: "Vincular",
          }
        : {
            titulo: "¿Rechazar la solicitud?",
            mensaje: `${claim.cuentaEmail} no accede a la ficha de ${nombre}. Puede volver a solicitarlo más adelante.`,
            confirmLabel: "Rechazar",
            variant: "danger",
          },
    );
    if (!ok) return;
    setPendingId(claim.claimId);
    setErrorById((prev) => {
      const next = { ...prev };
      delete next[claim.claimId];
      return next;
    });
    startTransition(async () => {
      const result = await resolverClaimAction({ claimId: claim.claimId, aprobar });
      setPendingId(null);
      if (!result.ok) {
        setErrorById((prev) => ({
          ...prev,
          [claim.claimId]: result.error.message ?? `No pude ${verbo} la solicitud.`,
        }));
        return;
      }
      // Sacar la fila resuelta de la lista.
      setClaims((prev) => prev.filter((c) => c.claimId !== claim.claimId));
    });
  };

  if (claims.length === 0) {
    return (
      <div className="fi-card" style={{ padding: 24, marginTop: 24 }}>
        <p style={{ color: "var(--ink-3)", margin: 0 }}>
          No hay solicitudes de vinculación pendientes. Cuando un paciente cree su
          cuenta en el portal y el match no sea automático, la solicitud aparecerá acá.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16, marginTop: 24 }}>
      {claims.map((claim) => {
        const busy = pendingId === claim.claimId;
        const rowErr = errorById[claim.claimId];
        return (
          <section key={claim.claimId} className="fi-card" style={{ padding: 20 }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 16,
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div style={{ minWidth: 240 }}>
                <h2 style={{ margin: 0, fontSize: 16 }}>
                  {claim.pacienteNombre ?? "Ficha protegida"}
                </h2>
                <p style={{ color: "var(--ink-3)", fontSize: 13, margin: "4px 0 0" }}>
                  Documento: <span className="fm-mono">{claim.pacienteDocMasked}</span>
                </p>
              </div>

              <div style={{ minWidth: 240 }}>
                <p style={{ color: "var(--ink-3)", fontSize: 12, margin: 0 }}>
                  Cuenta que solicita
                </p>
                <p className="fm-mono" style={{ margin: "2px 0 6px", color: "var(--ink-2)" }}>
                  {claim.cuentaEmail}
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <VerifBadge ok={claim.cuentaEmailVerificado} label="Email verificado" />
                  <VerifBadge ok={claim.cuentaTelefonoVerificado} label="Teléfono verificado" />
                </div>
              </div>
            </div>

            <p style={{ color: "var(--ink-3)", fontSize: 12, margin: "14px 0 0" }}>
              Solicitada el {new Date(claim.creadoEn).toLocaleDateString("es-AR")}
            </p>

            <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
              <button
                type="button"
                className="fi-btn fi-btn-primary"
                onClick={() => resolve(claim, true)}
                disabled={busy}
              >
                {busy ? "Procesando…" : "Vincular"}
              </button>
              <button
                type="button"
                className="fi-btn fi-btn-ghost"
                style={{ color: "var(--red)" }}
                onClick={() => resolve(claim, false)}
                disabled={busy}
              >
                Rechazar
              </button>
            </div>

            {rowErr ? (
              <p className="au-err" style={{ marginTop: 12 }}>
                {rowErr}
              </p>
            ) : null}
          </section>
        );
      })}
      {dialogo}
    </div>
  );
}

function VerifBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className="fi-chip"
      style={{
        fontSize: 12,
        color: ok ? "var(--green)" : "var(--ink-3)",
        borderColor: ok ? "var(--green-soft)" : "var(--line)",
      }}
    >
      {ok ? "✓ " : "· "}
      {label}
    </span>
  );
}
