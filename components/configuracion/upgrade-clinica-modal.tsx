"use client";

/**
 * Folio · UpgradeClinicaModal · confirmación del upgrade self-serve a Clínica.
 *
 * Mismo patrón de modal hand-rolled de la app (overlay con tokens, useModalA11y
 * para focus-trap + Escape, guard de submit, botones fi-btn). Muestra el
 * impacto de precio (actual → nuevo, base + seats actuales) y qué habilita
 * Clínica, y deja claro que NO hay cargo retroactivo: el monto nuevo aplica al
 * próximo cobro.
 *
 * El cambio se persiste vía upgradeOrgTipoAction (server action con guard OWNER
 * + audit trail M66). Al confirmar OK, el caller refresca la config.
 */

import { useRef, useState, useTransition } from "react";

import { upgradeOrgTipoAction } from "@/app/(app)/configuracion/actions";
import { formatArsFromCents } from "@/lib/format/currency";
import { useModalA11y } from "@/lib/use-modal-a11y";

interface UpgradeClinicaModalProps {
  /** Precio mensual actual (centavos ARS) — plan Solo vigente. */
  montoAntesCents: number;
  /** Precio mensual como Clínica (centavos ARS) con los seats actuales. */
  montoDespuesCents: number;
  /** Members activos actuales (incluye al titular) — para el desglose de seats. */
  membersActivos: number;
  onClose: () => void;
  /** Upgrade OK — el caller cierra y refresca (router.refresh). */
  onDone: () => void;
}

export function UpgradeClinicaModal({
  montoAntesCents,
  montoDespuesCents,
  membersActivos,
  onClose,
  onDone,
}: UpgradeClinicaModalProps) {
  const [submitting, startTransition] = useTransition();
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(dialogRef, { onClose, closeDisabled: submitting });

  const seatsAdicionales = Math.max(0, membersActivos - 1);

  const handleConfirm = () => {
    setSubmitErr(null);
    startTransition(async () => {
      const result = await upgradeOrgTipoAction();
      if (!result.ok) {
        setSubmitErr(result.error.message);
        return;
      }
      onDone();
    });
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-clinica-title"
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
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          maxWidth: 540,
          width: "100%",
          padding: "20px 22px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.18)",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={{ marginBottom: 16 }}>
          <span className="fi-eyebrow">cambio de plan</span>
          <h2 id="upgrade-clinica-title" style={{ margin: "4px 0 0", fontSize: 20 }}>
            Pasar a plan Clínica
          </h2>
        </header>

        {/* Impacto de precio: actual → nuevo. */}
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "12px 14px",
            marginBottom: 14,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "grid", gap: 2 }}>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Ahora</span>
            <span style={{ fontWeight: 500 }}>{formatArsFromCents(montoAntesCents)} / mes</span>
          </div>
          <span aria-hidden="true" style={{ color: "var(--ink-3)", fontSize: 18 }}>
            →
          </span>
          <div style={{ display: "grid", gap: 2 }}>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Plan Clínica</span>
            <span style={{ fontWeight: 600, color: "var(--accent)" }}>
              {formatArsFromCents(montoDespuesCents)} / mes
            </span>
          </div>
        </div>

        <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 4px", lineHeight: 1.55 }}>
          {seatsAdicionales === 0
            ? "Incluye la base que cubre al titular. Cada integrante adicional (médico/a o secretaría) suma ARS 25.000/mes."
            : `Base que cubre al titular + ${seatsAdicionales} ${
                seatsAdicionales === 1 ? "integrante activo" : "integrantes activos"
              } (ARS 25.000/mes cada uno).`}
        </p>
        <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 12px", lineHeight: 1.55 }}>
          <b>Aplica al próximo cobro, sin cargos retroactivos.</b> Tu débito de este mes no cambia.
        </p>

        {/* Qué habilita Clínica. */}
        <div
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "12px 14px",
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
            Con Clínica sumás:
          </span>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
            <li style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
              Equipo multi-profesional: invitá médicos, secretaría y dirección a la misma organización.
            </li>
            <li style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
              Roles y permisos por integrante (quién ve qué, quién gestiona).
            </li>
            <li style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
              Facturación por seat: pagás por integrante activo, se ajusta al sumar o dar de baja.
            </li>
          </ul>
        </div>

        {submitErr ? (
          <p role="alert" style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>
            {submitErr}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="fi-btn fi-btn-ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </button>
          <button
            type="button"
            className="fi-btn fi-btn-primary"
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting ? "Cambiando…" : "Confirmar y pasar a Clínica"}
          </button>
        </div>
      </div>
    </div>
  );
}
