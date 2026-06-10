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

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";

import {
  activateSubscriptionAction,
  cancelSubscriptionAction,
  refreshSubscriptionAction,
  syncClinicAmountAction,
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

/** Fase C/E · desglose del plan Clínica + monto que MP debita hoy. */
export interface ClinicPricingView {
  /** Members activos (incluye OWNER). */
  seats: number;
  extraSeats: number;
  basePriceArs: number;
  seatPriceArs: number;
  /** Total según tier + seats actuales (lo que CORRESPONDE cobrar). */
  totalArs: number;
  /**
   * Monto que el preapproval de MP debita hoy (suscripcion.monto_cents).
   * null si no hay suscripción debitando (sin sub, pendiente o cancelada).
   */
  montoActualArs: number | null;
  /**
   * true si el monto del débito quedó desfasado del equipo actual y la
   * suscripción es elegible para sync (ACTIVA/MOROSA con preapproval) —
   * misma decisión pura que usa syncSubscriptionAmount.
   */
  syncPending: boolean;
}

interface Props {
  subscription: SubscriptionRow | null;
  charges: ChargeRow[];
  accessGate: AccessGate;
  planPriceArs: number;
  payerEmail: string;
  gateBanner: string | null;
  activationOk: boolean;
  orgTipo: "INDEPENDIENTE" | "CLINICA";
  clinicPricing: ClinicPricingView | null;
}

export function BillingPage({
  subscription,
  charges,
  accessGate,
  planPriceArs,
  payerEmail,
  gateBanner,
  activationOk,
  orgTipo,
  clinicPricing,
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

  const onSyncAmount = () => {
    setError(null);
    startTransition(async () => {
      const res = await syncClinicAmountAction();
      if (!res.ok) {
        setError(res.error.message);
      }
    });
  };

  // Fase E: para CLINICA el precio mostrado en la card de suscripción es el
  // monto real por-org (suscripcion.monto_cents si hay sub; si no, el total
  // estimado con el que se crearía el preapproval). INDEPENDIENTE sigue
  // mostrando el plan vigente, idéntico a siempre.
  const displayPriceArs =
    orgTipo === "CLINICA"
      ? subscription && subscription.estado !== "CANCELADA"
        ? subscription.montoCents / 100
        : clinicPricing?.totalArs ?? planPriceArs
      : planPriceArs;

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
      {activationOk && subscription?.estado !== "ACTIVA" ? <ActivationPendingBanner /> : null}
      {!accessGate.allowed && !gateBanner ? <GraceBanner reason={accessGate.reason ?? "denied"} /> : null}
      {accessGate.allowed && accessGate.graceDaysLeft != null ? (
        <GraceCountdownBanner days={accessGate.graceDaysLeft} />
      ) : null}

      <div className="cfg-section-body" style={{ marginTop: 16 }}>
        {orgTipo === "CLINICA" && clinicPricing ? (
          <ClinicPlanCard pricing={clinicPricing} pending={pending} onSyncAmount={onSyncAmount} />
        ) : null}

        <SubscriptionCard
          subscription={subscription}
          planPriceArs={displayPriceArs}
          planLabel={orgTipo === "CLINICA" ? "Plan Clínica" : "Plan Profesional"}
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

/**
 * Fase C/E · plan Clínica: desglose base + integrantes adicionales = total,
 * más el monto que MP debita HOY (suscripcion.monto_cents). Si el débito
 * quedó desfasado del equipo actual (syncPending), botón "Actualizar monto"
 * → syncClinicAmountAction (gate OWNER + CLINICA en el server).
 */
function ClinicPlanCard({
  pricing,
  pending,
  onSyncAmount,
}: {
  pricing: ClinicPricingView;
  pending: boolean;
  onSyncAmount: () => void;
}) {
  return (
    <section className="cfg-section">
      <header>
        <div>
          <h2>Plan Clínica</h2>
          <p>
            {formatArs(pricing.basePriceArs)}/mes base + {formatArs(pricing.seatPriceArs)} por
            integrante adicional.
          </p>
        </div>
      </header>
      <div className="cfg-section-body">
        <div className="cfg-row">
          <div className="cfg-row-label">
            <span>Base (incluye 1 integrante)</span>
          </div>
          <div className="cfg-row-control">
            <span className="fm-mono">{formatArs(pricing.basePriceArs)}</span>
          </div>
        </div>
        <div className="cfg-row">
          <div className="cfg-row-label">
            <span>Integrantes adicionales</span>
            <span className="cfg-row-sub">
              {pricing.seats} {pricing.seats === 1 ? "miembro activo" : "miembros activos"} en total
            </span>
          </div>
          <div className="cfg-row-control">
            <span className="fm-mono">
              {pricing.extraSeats} × {formatArs(pricing.seatPriceArs)} ={" "}
              {formatArs(pricing.extraSeats * pricing.seatPriceArs)}
            </span>
          </div>
        </div>
        <div className="cfg-row">
          <div className="cfg-row-label">
            <span>Total mensual</span>
            <span className="cfg-row-sub">Según tu equipo actual</span>
          </div>
          <div className="cfg-row-control">
            <span className="fm-mono" style={{ fontWeight: 600 }}>
              {formatArs(pricing.totalArs)}
            </span>
          </div>
        </div>
        {pricing.montoActualArs != null ? (
          pricing.syncPending ? (
            <div
              style={{
                marginTop: 12,
                padding: "10px 14px",
                background: "var(--amber-soft)",
                color: "var(--amber)",
                borderRadius: "var(--r-md)",
                fontSize: 13,
                lineHeight: 1.55,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span>
                El débito de Mercado Pago sigue en {formatArs(pricing.montoActualArs)}/mes; con tu
                equipo actual corresponde {formatArs(pricing.totalArs)}/mes.
              </span>
              <button
                type="button"
                className="fi-btn fi-btn-primary"
                onClick={onSyncAmount}
                disabled={pending}
              >
                {pending ? "Actualizando…" : "Actualizar monto"}
              </button>
            </div>
          ) : (
            <p
              style={{
                marginTop: 12,
                padding: "10px 14px",
                background: "var(--slate-soft)",
                color: "var(--slate)",
                borderRadius: "var(--r-md)",
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              Mercado Pago te debita {formatArs(pricing.montoActualArs)}/mes, en línea con tu
              equipo actual. Cuando sumás o das de baja integrantes, el monto se ajusta solo.
            </p>
          )
        ) : (
          <p
            style={{
              marginTop: 12,
              padding: "10px 14px",
              background: "var(--slate-soft)",
              color: "var(--slate)",
              borderRadius: "var(--r-md)",
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            Al activar la suscripción, Mercado Pago va a debitar {formatArs(pricing.totalArs)}/mes
            según tu equipo actual.
          </p>
        )}
      </div>
    </section>
  );
}

function SubscriptionCard({
  subscription,
  planPriceArs,
  planLabel,
  payerEmail,
  pending,
  onActivate,
  onCancel,
}: {
  subscription: SubscriptionRow | null;
  planPriceArs: number;
  planLabel: string;
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
            <p>{planLabel} · {monto}/mes. Cobro automático con Mercado Pago.</p>
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
          <p>{planLabel} · {monto}/mes.</p>
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
  // Una suscripción PAUSADA es recuperable (reactivable) → tono ámbar/warning.
  // El resto (grace vencida, cancelada, morosa vencida, denied) usa rojo.
  const isWarning = reason === "subscription_paused";
  const bg = isWarning ? "var(--amber-soft)" : "var(--red-soft)";
  const fg = isWarning ? "var(--amber)" : "var(--red)";
  return (
    <div
      style={{
        marginTop: 16,
        padding: "12px 16px",
        background: bg,
        color: fg,
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

// M7 · cuántas veces auto-refrescamos el estado tras volver de MP, y cada cuánto.
// ~30s en total (10 × 3s) — ventana razonable para que llegue el webhook
// subscription_preapproval. El webhook sigue siendo la fuente de verdad: esto
// solo "espera y vuelve a leer", no inventa una activación.
const ACTIVATION_POLL_INTERVAL_MS = 3000;
const ACTIVATION_POLL_MAX_ATTEMPTS = 10;

/**
 * M7 (docs/AUDIT.md) · el banner se mostraba SOLO por el query param
 * `?activation=ok`, que lo setea el back_url de MP — está presente aunque el
 * pago haya fallado o el webhook nunca llegue. Mostrar "va a aparecer activo en
 * unos segundos" en ese caso es una promesa que el sistema no puede cumplir.
 *
 * Fix honesto: al volver de MP auto-refrescamos el estado real
 * (`refreshSubscriptionAction` → GET al proveedor → UPDATE local) cada 3s hasta
 * ~30s. Si la suscripción se activa, el `revalidatePath` del action re-renderiza
 * el server component y este banner desaparece (la condición de montaje es
 * `estado !== "ACTIVA"`). Si tras agotar los intentos sigue sin activarse,
 * cambiamos el copy a algo honesto en vez de seguir prometiendo. El webhook
 * sigue siendo la fuente de verdad: nunca marcamos ACTIVA desde el cliente.
 */
function ActivationPendingBanner() {
  const [pending, startTransition] = useTransition();
  const [exhausted, setExhausted] = useState(false);
  const attemptsRef = useRef(0);

  const refresh = () => {
    startTransition(async () => {
      await refreshSubscriptionAction();
      // No leemos el resultado para decidir: si se activó, el revalidatePath
      // del action desmonta este banner; si no, seguimos en pending/pendiente.
    });
  };

  // Auto-poll silencioso hasta ACTIVA o hasta agotar los intentos. Cada tick
  // dispara un refresh; si el estado pasa a ACTIVA el server desmonta el banner
  // y el cleanup del effect frena el timer.
  useEffect(() => {
    if (exhausted) return;
    const id = setInterval(() => {
      attemptsRef.current += 1;
      if (attemptsRef.current >= ACTIVATION_POLL_MAX_ATTEMPTS) {
        setExhausted(true);
        clearInterval(id);
      }
      startTransition(async () => {
        await refreshSubscriptionAction();
      });
    }, ACTIVATION_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [exhausted]);

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
        {exhausted
          ? "Volviste de Mercado Pago. Si ya autorizaste el pago y no ves los cambios en unos segundos, presioná Refrescar estado. Si recién lo autorizaste, puede tardar un momento."
          : "Volviste de Mercado Pago. Estamos verificando el estado de tu pago…"}
      </span>
      <button type="button" className="fi-btn fi-btn-ghost" onClick={refresh} disabled={pending}>
        {pending ? "Verificando…" : "Refrescar estado"}
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
