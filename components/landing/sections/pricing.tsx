/**
 * Folio · Landing — sección Precios (#precios) (Fase B · B2).
 *
 * Server component. Los montos NO están hardcodeados: derivan de la misma
 * fuente que el cobro real —
 *   - Solo:    `MP_PLAN_PRICE_CENTS` (lib/mercadopago/client.ts; importable
 *     server-side sin side effects: solo resuelve env con default).
 *   - Clínica: `resolveClinicBasePriceCents()` / `resolveClinicSeatPriceCents()`
 *     (lib/billing/pricing.ts).
 * Si cambia el precio por env, el landing acompaña solo.
 */

import type { CSSProperties } from "react";
import { MP_PLAN_PRICE_CENTS } from "@/lib/mercadopago/client";
import {
  resolveClinicBasePriceCents,
  resolveClinicSeatPriceCents,
} from "@/lib/billing/pricing";
import { Check } from "@/components/icons";

const arsFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

function formatArsFromCents(cents: number): string {
  return arsFormatter.format(cents / 100);
}

const SOLO_BULLETS = [
  "Agenda y turnos ilimitados",
  "Historia clínica cifrada",
  "Página pública de reservas + recordatorios por WhatsApp",
  "Finanzas del consultorio",
  "Sincronización con Google Calendar",
];

const CLINIC_BULLETS = [
  "Todo lo del plan Solo",
  "Equipo con roles: profesionales, asistentes y coordinación",
  "Agenda compartida del consultorio",
  "Permisos por rol sobre pacientes e historias",
];

function revealDelay(index: number): CSSProperties {
  return { "--fl-reveal-delay": `${index * 90}ms` } as CSSProperties;
}

export function Pricing() {
  const soloPrice = formatArsFromCents(MP_PLAN_PRICE_CENTS);
  const clinicBase = formatArsFromCents(resolveClinicBasePriceCents());
  const clinicSeat = formatArsFromCents(resolveClinicSeatPriceCents());

  return (
    <section id="precios" className="fl-section fl-pricing" data-fl-section="pricing">
      <h2 className="fl-pricing-title fl-reveal">Un precio claro, en pesos</h2>
      <p className="fl-pricing-sub fl-reveal">Empezá gratis. Pagá solo si te convence.</p>

      <div className="fl-pricing-grid">
        <article className="fl-price-card fl-price-card--featured fl-reveal" style={revealDelay(0)}>
          <header className="fl-price-head">
            <h3 className="fl-price-plan">Solo</h3>
            <span className="fl-price-badge">Para empezar</span>
          </header>
          <p className="fl-price-amount">
            <span className="fl-price-figure">{soloPrice}</span>
            <span className="fl-price-per">/mes</span>
          </p>
          <p className="fl-price-note">Un profesional, el consultorio completo.</p>
          <ul className="fl-price-list">
            {SOLO_BULLETS.map((b) => (
              <li key={b} className="fl-price-item">
                <span className="fl-price-check" aria-hidden="true">
                  <Check size={14} />
                </span>
                {b}
              </li>
            ))}
          </ul>
          <div className="fl-price-cta">
            <a className="fi-btn fi-btn-primary" href="/onboarding" data-fl-cta="pricing_solo">
              Empezar gratis
            </a>
          </div>
        </article>

        <article className="fl-price-card fl-reveal" style={revealDelay(1)}>
          <header className="fl-price-head">
            <h3 className="fl-price-plan">Clínica</h3>
          </header>
          <p className="fl-price-amount">
            <span className="fl-price-figure">{clinicBase}</span>
            <span className="fl-price-per">/mes</span>
          </p>
          <p className="fl-price-note">+ {clinicSeat} por profesional adicional.</p>
          <ul className="fl-price-list">
            {CLINIC_BULLETS.map((b) => (
              <li key={b} className="fl-price-item">
                <span className="fl-price-check" aria-hidden="true">
                  <Check size={14} />
                </span>
                {b}
              </li>
            ))}
          </ul>
          <div className="fl-price-cta">
            <a className="fi-btn fi-btn-secondary" href="/onboarding" data-fl-cta="pricing_clinic">
              Empezar gratis
            </a>
          </div>
        </article>
      </div>

      <p className="fl-pricing-banner fl-reveal">
        <span className="fl-pricing-banner-days">7 días</span> de prueba, sin tarjeta. Pagás con
        MercadoPago, en pesos.
      </p>
    </section>
  );
}
