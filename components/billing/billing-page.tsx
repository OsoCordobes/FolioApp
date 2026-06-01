"use client";

/**
 * Folio · /configuracion/billing UI (M19).
 *
 * Componente client que maneja:
 *   - Banner de grace expired / activation OK.
 *   - Card de activación (estado PENDIENTE_ACTIVACION o sin suscripción).
 *   - Card de suscripción activa (con cancelar).
 *   - Tabla de historial de cargos.
 *
 * Estilos: reusa clases del prototipo (`fi-btn`, `fi-eyebrow`, `cfg-*`).
 * Pixel-perfect respetando el lenguaje visual de /configuracion.
 */

import { useState, useTransition } from "react";
import Link from "next/link";

import {
  activateSubscriptionAction,
  cancelSubscriptionAction,
  refreshSubscriptionAction,
} from "@/app/(app)/configuracion/billing/actions";

interface ChargeRow {
  id: string;
  mpPaymentId: string;
  montoCents: number;
  estado: "PENDIENTE" | "APROBADO" | "RECHAZADO" | "REFUNDED";
  fechaIntento: string;
  fechaAcreditacion: string | null;
}

interface SubscriptionRow {
  id: string;
  estado: "PENDIENTE_ACTIVACION" | "ACTIVA" | "PAUSADA" | "CANCELADA" | "MOROSA";
  montoCents: number;
  payerEmail: string;
  fechaActivacion: string | null;
  proximaCobro: string | null;
  ultimoCobroTs: string | null;
  ultimoError: string | null;
}

interface AccessGate {
  allowed: boolean;
  reason: string | null;
  graceDaysLeft: number | null;
}

interface Props {
  subscription: SubscriptionRow | null;
  charges: ChargeRow[];
  accessGate: AccessGate;
  planPriceArs: number;
  payerEmail: string;
  gateBanner: string | null;
  activationOk: boolean;
}

export function BillingPage({
  subscription,
  charges,
  accessGate,
  planPriceArs,
  payerEmail,
  gateBanner,
  activationOk,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onActivate = () => {
    setError(null);
    startTransition(async () => {
      const res = await activateSubscriptionAction();
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      // Redirigir al init_point de MP. window.location porque es URL externa.
      window.location.href = res.data.initPoint;
    });
  };

  const onCancel = () => {
    setError(null);
    startTransition(async () => {
      const res = await cancelSubscriptionAction();
      if (!res.ok) {
        setError(res.error.message);
      }
    });
  };

  const onRefresh = () => {
    setError(null);
    startTransition(async () => {
      const res = await refreshSubscriptionAction();
      if (!res.ok) {
        setError(res.error.message);
      }
    });
  };

  return (
    <div className="cfg">
      <header className="cfg-head">
        <div>
          <span className="fi-eyebrow">facturación</span>
          <h1>Suscripción Folio</h1>
          {error ? (
            <p role="alert" style={{ color: "var(--red)", marginTop: 4, fontSize: 13 }}>{error}</p>
          ) : null}
        </div>
        <Link href="/configuracion" className="fi-btn fi-btn-ghost">
          Volver a Configuración
        </Link>
      </header>

      {gateBanner ? <GraceBanner reason={gateBanner} /> : null}
      {activationOk && subscription?.estado !== "ACTIVA" ? <ActivationPendingBanner onRefresh={onRefresh} /> : null}
      {!accessGate.allowed && !gateBanner ? <GraceBanner reason={accessGate.reason ?? "denied"} /> : null}
      {accessGate.allowed && accessGate.graceDaysLeft != null ? (
        <GraceCountdownBanner days={accessGate.graceDaysLeft} />
      ) : null}

      <div className="cfg-section-body" style={{ marginTop: 16 }}>
        <SubscriptionCard
          subscription={subscription}
          planPriceArs={planPriceArs}
          payerEmail={payerEmail}
          pending={pending}
          onActivate={onActivate}
          onCancel={onCancel}
        />

        <ChargesTable charges={charges} />
      </div>
    </div>
  );
}

// ─── Subcomponentes ────────────────────────────────────────────────────────

function SubscriptionCard({
  subscription,
  planPriceArs,
  payerEmail,
  pending,
  onActivate,
  onCancel,
}: {
  subscription: SubscriptionRow | null;
  planPriceArs: number;
  payerEmail: string;
  pending: boolean;
  onActivate: () => void;
  onCancel: () => void;
}) {
  const monto = formatArs(planPriceArs);
  const [confirming, setConfirming] = useState(false);

  if (!subscription || subscription.estado === "CANCELADA") {
    return (
      <section className="cfg-section">
        <header>
          <div>
            <h2>Activar suscripción</h2>
            <p>Plan Profesional · {monto}/mes. Cobro automático con Mercado Pago.</p>
          </div>
        </header>
        <div className="cfg-section-body">
          <div className="cfg-plan-card">
            <div className="cfg-plan-card-l">
              <span className="fi-eyebrow">Folio MVP</span>
              <h3>{monto} / mes</h3>
              <p>
                Pagás con tarjeta a través de Mercado Pago. Te cobramos automáticamente cada mes.
                Podés cancelar cuando quieras.
              </p>
              <p style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 8 }}>
                El cobro queda asociado a <b>{payerEmail}</b>.
              </p>
            </div>
            <div className="cfg-plan-card-r">
              <button
                type="button"
                className="fi-btn fi-btn-primary"
                onClick={onActivate}
                disabled={pending}
              >
                {pending ? "Conectando con Mercado Pago…" : "Activar suscripción"}
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (subscription.estado === "PENDIENTE_ACTIVACION") {
    return (
      <section className="cfg-section">
        <header>
          <div>
            <h2>Suscripción pendiente</h2>
            <p>Ya creamos el cobro en Mercado Pago. Falta que termines de autorizarlo.</p>
          </div>
        </header>
        <div className="cfg-section-body">
          <div className="cfg-plan-card">
            <div className="cfg-plan-card-l">
              <span className="fi-eyebrow">Pendiente</span>
              <h3>{monto} / mes</h3>
              <p>
                Si cerraste la ventana de Mercado Pago sin autorizar, volvé a activar y completá el
                pago.
              </p>
            </div>
            <div className="cfg-plan-card-r">
              <button
                type="button"
                className="fi-btn fi-btn-primary"
                onClick={onActivate}
                disabled={pending}
              >
                {pending ? "Reintentando…" : "Volver a activar"}
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // ACTIVA / MOROSA / PAUSADA
  const proxima = subscription.proximaCobro ? formatDate(subscription.proximaCobro) : "—";
  const activacion = subscription.fechaActivacion ? formatDate(subscription.fechaActivacion) : "—";
  const statusLabel: Record<SubscriptionRow["estado"], string> = {
    ACTIVA: "Activa",
    MOROSA: "Cobro pendiente — reintentando",
    PAUSADA: "Pausada",
    PENDIENTE_ACTIVACION: "Pendiente",
    CANCELADA: "Cancelada",
  };

  return (
    <section className="cfg-section">
      <header>
        <div>
          <h2>Suscripción {statusLabel[subscription.estado].toLowerCase()}</h2>
          <p>Plan Profesional · {monto}/mes.</p>
        </div>
      </header>
      <div className="cfg-section-body">
        <div className="cfg-row">
          <div className="cfg-row-label">
            <span>Estado</span>
          </div>
          <div className="cfg-row-control">
            <StatusBadge estado={subscription.estado} />
          </div>
        </div>
        <div className="cfg-row">
          <div className="cfg-row-label">
            <span>Próximo cobro</span>
          </div>
          <div className="cfg-row-control">
            <span className="fm-mono">{proxima}</span>
          </div>
        </div>
        <div className="cfg-row">
          <div className="cfg-row-label">
            <span>Activa desde</span>
          </div>
          <div className="cfg-row-control">
            <span className="fm-mono">{activacion}</span>
          </div>
        </div>
        <div className="cfg-row">
          <div className="cfg-row-label">
            <span>Email de pago</span>
          </div>
          <div className="cfg-row-control">
            <span className="fm-mono">{subscription.payerEmail}</span>
          </div>
        </div>
        {subscription.ultimoError ? (
          <div className="cfg-row">
            <div className="cfg-row-label">
              <span>Último error</span>
            </div>
            <div className="cfg-row-control">
              <span style={{ color: "var(--red)" }}>{subscription.ultimoError}</span>
            </div>
          </div>
        ) : null}
        <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
          {confirming ? (
            <>
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
                ¿Cancelar? Seguís con acceso hasta el final del período pagado.
              </span>
              <button
                type="button"
                className="fi-btn fi-btn-danger"
                onClick={onCancel}
                disabled={pending}
              >
                {pending ? "Cancelando…" : "Sí, cancelar"}
              </button>
              <button
                type="button"
                className="fi-btn fi-btn-ghost"
                onClick={() => setConfirming(false)}
                disabled={pending}
              >
                Volver
              </button>
            </>
          ) : (
            <button
              type="button"
              className="fi-btn fi-btn-danger"
              onClick={() => setConfirming(true)}
              disabled={pending}
            >
              Cancelar suscripción
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function ChargesTable({ charges }: { charges: ChargeRow[] }) {
  if (charges.length === 0) {
    return (
      <section className="cfg-section">
        <header>
          <div>
            <h2>Historial de cobros</h2>
            <p>Todavía no hay cobros. El primer débito ocurre el día que MP haga el primer cargo.</p>
          </div>
        </header>
      </section>
    );
  }
  return (
    <section className="cfg-section">
      <header>
        <div>
          <h2>Historial de cobros</h2>
          <p>Últimos {charges.length} movimientos.</p>
        </div>
      </header>
      <div className="cfg-section-body">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <caption className="sr-only">Historial de cobros de la suscripción</caption>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
              <th scope="col" style={{ padding: "8px 4px" }}>Fecha</th>
              <th scope="col" style={{ padding: "8px 4px" }}>Monto</th>
              <th scope="col" style={{ padding: "8px 4px" }}>Estado</th>
              <th scope="col" style={{ padding: "8px 4px" }}>ID MP</th>
            </tr>
          </thead>
          <tbody>
            {charges.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                <td style={{ padding: "8px 4px" }}>{formatDate(c.fechaIntento)}</td>
                <td style={{ padding: "8px 4px" }}>{formatArs(c.montoCents / 100)}</td>
                <td style={{ padding: "8px 4px" }}>
                  <ChargeBadge estado={c.estado} />
                </td>
                <td style={{ padding: "8px 4px" }} className="fm-mono">
                  {c.mpPaymentId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Shared badge tone system — brass-harmonized Folio tokens (audit 2026-06).
// Replaces per-badge hardcoded Tailwind fallbacks: --gray-soft/--muted/--blue*
// did NOT exist in folio.css, so they rendered as off-theme Tailwind hex.
type BadgeTone = "success" | "warning" | "danger" | "neutral";

const BADGE_TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  success: { bg: "var(--green-soft)", fg: "var(--green)" },
  warning: { bg: "var(--amber-soft)", fg: "var(--amber)" },
  danger: { bg: "var(--red-soft)", fg: "var(--red)" },
  neutral: { bg: "var(--surface-2)", fg: "var(--ink-2)" },
};

function Badge({ tone, label }: { tone: BadgeTone; label: string }) {
  const t = BADGE_TONES[tone];
  return (
    <span
      style={{
        padding: "3px 10px",
        borderRadius: "var(--r-sm)",
        background: t.bg,
        color: t.fg,
        fontWeight: 500,
        fontSize: 13,
      }}
    >
      {label}
    </span>
  );
}

const SUB_STATUS: Record<SubscriptionRow["estado"], { label: string; tone: BadgeTone }> = {
  ACTIVA: { label: "Activa", tone: "success" },
  PENDIENTE_ACTIVACION: { label: "Pendiente", tone: "warning" },
  PAUSADA: { label: "Pausada", tone: "neutral" },
  CANCELADA: { label: "Cancelada", tone: "danger" },
  MOROSA: { label: "En cobro", tone: "warning" },
};

const CHARGE_STATUS: Record<ChargeRow["estado"], { label: string; tone: BadgeTone }> = {
  APROBADO: { label: "Aprobado", tone: "success" },
  PENDIENTE: { label: "Pendiente", tone: "warning" },
  RECHAZADO: { label: "Rechazado", tone: "danger" },
  REFUNDED: { label: "Reintegrado", tone: "neutral" },
};

function StatusBadge({ estado }: { estado: SubscriptionRow["estado"] }) {
  const s = SUB_STATUS[estado];
  return <Badge tone={s.tone} label={s.label} />;
}

function ChargeBadge({ estado }: { estado: ChargeRow["estado"] }) {
  const s = CHARGE_STATUS[estado];
  return <Badge tone={s.tone} label={s.label} />;
}

function GraceBanner({ reason }: { reason: string }) {
  const messages: Record<string, string> = {
    grace_expired:
      "Tu período de prueba terminó. Activá la suscripción para seguir usando Folio.",
    subscription_cancelled:
      "Tu suscripción está cancelada. Volvé a activarla para seguir usando Folio.",
    subscription_morosa_expired:
      "Hubo un problema con tu cobro y se canceló la suscripción. Volvé a activarla.",
    subscription_paused:
      "Tu suscripción está pausada. Reactivala para seguir usando Folio.",
    denied:
      "Necesitás activar la suscripción para seguir usando Folio.",
  };
  const msg = messages[reason] ?? messages.denied;
  return (
    <div
      style={{
        marginTop: 16,
        padding: "12px 16px",
        background: "var(--red-soft)",
        color: "var(--red)",
        borderRadius: "var(--r-md)",
        fontSize: 14,
        fontWeight: 500,
      }}
    >
      {msg}
    </div>
  );
}

function GraceCountdownBanner({ days }: { days: number }) {
  const txt = days === 1 ? "Te queda 1 día" : `Te quedan ${days} días`;
  return (
    <div
      style={{
        marginTop: 16,
        padding: "10px 14px",
        background: "var(--amber-soft)",
        color: "var(--amber)",
        borderRadius: "var(--r-md)",
        fontSize: 13,
      }}
    >
      {txt} de prueba gratis. Activá tu suscripción para no perder acceso a tus turnos.
    </div>
  );
}

function ActivationPendingBanner({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div
      style={{
        marginTop: 16,
        padding: "12px 16px",
        background: "var(--slate-soft)",
        color: "var(--slate)",
        borderRadius: "var(--r-md)",
        fontSize: 14,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span>
        Volviste de Mercado Pago. Si tu pago se procesó, el estado va a aparecer activo en unos
        segundos.
      </span>
      <button type="button" className="fi-btn fi-btn-ghost" onClick={onRefresh}>
        Refrescar estado
      </button>
    </div>
  );
}

// ─── Format helpers ────────────────────────────────────────────────────────

function formatArs(ars: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(ars);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}
