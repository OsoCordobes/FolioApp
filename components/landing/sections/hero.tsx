/**
 * Folio · Landing · Hero (rediseño "Un día con Folio" · escena 08:00)
 *
 * El hero ES la primera escena del día: headline display full-width arriba
 * (Fraunces gigante, "cifrada." en acento) y debajo un grid asimétrico —
 * copy + CTA único + stats mono + scroll cue a la izquierda; a la derecha
 * la agenda del día ya armada (mockup CSS en capas con chip candado de
 * cifrado y caption mono). Sin JS: entrada con @keyframes fl-rise
 * (--dur-cinematic; el h1 es el LCP y entra sin delay) y parallax de capas
 * scroll-driven con animation-timeline: view() (fallback estático).
 * Clases .fl-hero-* / .fl-mock-* al final de public/folio.css.
 */

import Link from "next/link";

import { ChevronDown, Lock, WhatsApp } from "@/components/icons";

export function Hero() {
  return (
    <section data-fl-section="hero" className="fl-section fl-hero">
      <div className="fl-hero-head">
        <p className="fl-eyebrow">Para profesionales de la salud en Argentina</p>
        <h1 className="fl-hero-title">
          <span className="fl-hero-line">El día se arma solo.</span>{" "}
          <span className="fl-hero-line">
            La historia, <span className="fl-hero-accent">cifrada.</span>
          </span>
        </h1>
      </div>

      <div className="fl-hero-body">
        <div className="fl-hero-copy">
          <p className="fl-hero-sub">
            Turnos, reservas online, recordatorios por WhatsApp y tus números — y cada
            nota clínica cifrada antes de tocar la base de datos.
          </p>
          <div className="fl-hero-ctas">
            <Link className="fi-btn fi-btn-primary fl-btn-lg" href="/onboarding" data-fl-cta="hero">
              Empezá gratis · 7 días
            </Link>
          </div>
          <p className="fl-hero-note">Sin tarjeta. Cancelás cuando quieras.</p>
          <ul className="fl-hero-stats" aria-label="Compromisos de Folio">
            <li>AES-256-GCM</li>
            <li>Ley 25.326</li>
            <li>7 días gratis</li>
            <li>Hecho en Argentina</li>
          </ul>
          <a className="fl-hero-cue" href="#dia">
            El día sigue a las 10:30
            <ChevronDown size={14} aria-hidden />
          </a>
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
                <span className="fl-mock-lock">
                  <Lock size={13} />
                  Cifrada · AES-256-GCM
                </span>
              </header>
              <div className="fl-mock-row">
                <span className="fl-mock-time">09:00</span>
                <span className="fl-mock-body">
                  <span className="fl-mock-name">Ana Suárez</span>
                  <span className="fl-mock-service">Nutrición · seguimiento</span>
                </span>
                <span className="fl-mock-badge">
                  <span className="fl-mock-dot" />
                  Confirmado
                </span>
              </div>
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
          <p className="fl-mock-caption">6 turnos, 6 fichas precargadas. Armado a las 06:14.</p>
        </div>
      </div>
    </section>
  );
}
