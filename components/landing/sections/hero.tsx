/**
 * Folio · Landing · Hero (Fase B1 · server component)
 *
 * Above the fold: eyebrow + h1 + sub + CTAs + microcopy a la izquierda;
 * a la derecha un mockup CSS estático en capas (agenda del día estilo
 * Folio: card frontal nítida sobre card trasera desenfocada + chip de
 * recordatorio WhatsApp). Sin JS: la entrada inicial es un @keyframes
 * (--dur-cinematic) y el parallax de capas es scroll-driven con
 * animation-timeline: view() (fallback estático). Clases .fl-hero-* /
 * .fl-mock-* en components/landing/_fragment-b1.css.
 */

import Link from "next/link";

import { WhatsApp } from "@/components/icons";

export function Hero() {
  return (
    <section data-fl-section="hero" className="fl-section fl-hero">
      <div className="fl-hero-copy">
        <p className="fl-eyebrow">Para profesionales de la salud en Argentina</p>
        <h1 className="fl-hero-title">Tu consultorio, en orden. Vos, atendiendo.</h1>
        <p className="fl-hero-sub">
          Folio ordena tus turnos, cifra tu historia clínica y te muestra tus números —
          mientras tus pacientes reservan solos y reciben recordatorios por WhatsApp.
        </p>
        <div className="fl-hero-ctas">
          <Link className="fi-btn fi-btn-primary fl-btn-lg" href="/onboarding" data-fl-cta="hero">
            Empezá gratis · 7 días sin tarjeta
          </Link>
          <a className="fi-btn fi-btn-secondary fl-btn-lg" href="#producto">
            Ver cómo funciona
          </a>
        </div>
        <p className="fl-hero-note">Sin tarjeta de crédito. Cancelás cuando quieras.</p>
      </div>

      {/* Mockup decorativo — oculto a lectores de pantalla */}
      <div className="fl-hero-visual" aria-hidden="true">
        <div className="fl-mock">
          <article className="fl-mock-card fl-mock-back">
            <div className="fl-mock-row">
              <span className="fl-mock-time">17:30</span>
              <span className="fl-mock-body">
                <span className="fl-mock-name">Julián Paredes</span>
                <span className="fl-mock-service">Quiropraxia · control</span>
              </span>
              <span className="fl-mock-badge is-slate">
                <span className="fl-mock-dot" />
                Reservó online
              </span>
            </div>
          </article>

          <article className="fl-mock-card fl-mock-front">
            <header className="fl-mock-head">
              <span className="fl-mock-day">Hoy · mar 10 jun</span>
              <span className="fl-mock-count">6 turnos</span>
            </header>
            <div className="fl-mock-row">
              <span className="fl-mock-time">10:00</span>
              <span className="fl-mock-body">
                <span className="fl-mock-name">María González</span>
                <span className="fl-mock-service">Kinesiología · consulta</span>
              </span>
              <span className="fl-mock-badge">
                <span className="fl-mock-dot" />
                Confirmado
              </span>
            </div>
            <div className="fl-mock-row is-muted">
              <span className="fl-mock-time">11:30</span>
              <span className="fl-mock-body">
                <span className="fl-mock-name">Carlos Vega</span>
                <span className="fl-mock-service">Quiropraxia · 1ª consulta</span>
              </span>
              <span className="fl-mock-badge is-amber">
                <span className="fl-mock-dot" />
                Recordado
              </span>
            </div>
          </article>

          <span className="fl-mock-chip">
            <span className="fl-mock-chip-icon">
              <WhatsApp size={14} />
            </span>
            Recordatorio enviado a María
          </span>
        </div>
      </div>
    </section>
  );
}
