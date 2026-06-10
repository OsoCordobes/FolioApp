/**
 * Folio · Landing — sección Features (#producto) (Fase B · B2).
 *
 * Server component. Grid asimétrico 2+3: dos cards protagonistas arriba
 * (la vista Hoy, destacada, y la historia clínica) y tres de soporte abajo.
 * Reveals scroll-driven vía `.fl-reveal` (la define B1); acá solo se setea
 * el delay por card con la custom property `--fl-reveal-delay`.
 */

import type { CSSProperties, ReactNode } from "react";
import { CalendarDay, Lock, Wallet, WhatsApp } from "@/components/icons";

/** Calendario con flechas de ida y vuelta (sync bidireccional con Google).
 *  No existe en components/icons.tsx — inline, trazo consistente (stroke 1.5,
 *  grid 24, linecap round). */
const CalendarSync = ({ size = 16 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 11.5V7a2.5 2.5 0 0 0-2.5-2.5h-13A2.5 2.5 0 0 0 3 7v12a2.5 2.5 0 0 0 2.5 2.5H11" />
    <path d="M16 2v4M8 2v4M3 10h18" />
    <path d="M14 16.5h7m0 0-2.4-2.4M21 16.5l-2.4 2.4" />
    <path d="M21 20.5h-7m0 0 2.4-2.4M14 20.5l2.4 2.4" />
  </svg>
);

interface Feature {
  icon: ReactNode;
  title: string;
  body: string;
  featured?: boolean;
}

const FEATURES: Feature[] = [
  {
    icon: <CalendarDay size={20} />,
    title: "Tu día, ordenado antes de que llegues",
    body: "La vista Hoy arma tu agenda apenas abrís Folio: los turnos, los pendientes y lo que necesita tu atención, en una sola pantalla.",
    featured: true,
  },
  {
    icon: <Lock size={20} />,
    title: "Historia clínica cifrada, siempre a mano",
    body: "Notas SOAP que se cifran antes de tocar la base de datos. Cualquier antecedente, a un par de teclas de distancia.",
  },
  {
    icon: <WhatsApp size={20} />,
    title: "Tus pacientes reservan solos. Folio les recuerda.",
    body: "Compartí tu página pública de reservas: el turno entra a tu agenda y tu paciente recibe confirmación y recordatorio por WhatsApp.",
  },
  {
    icon: <Wallet size={20} />,
    title: "Sabé cuánto ganaste, sin planillas",
    body: "Ingresos por servicio y por mes, en una mirada. Registrás el cobro al cerrar la consulta y te olvidás del Excel.",
  },
  {
    icon: <CalendarSync size={20} />,
    title: "Tu Google Calendar, sincronizado en ambos sentidos",
    body: "Lo que agendás en Folio aparece en Google Calendar, y tus eventos personales bloquean la disponibilidad. Nada se pisa.",
  },
];

function revealDelay(index: number): CSSProperties {
  return { "--fl-reveal-delay": `${index * 70}ms` } as CSSProperties;
}

export function Features() {
  return (
    <section id="producto" className="fl-section fl-features" data-fl-section="features">
      <h2 className="fl-features-title fl-reveal">Todo tu consultorio, sin fricción</h2>
      <p className="fl-features-sub fl-reveal">
        Las cinco cosas que hacés todos los días, resueltas en un solo lugar.
      </p>
      <div className="fl-features-grid">
        {FEATURES.map((f, i) => (
          <article
            key={f.title}
            className={`fl-feature-card fl-reveal${f.featured ? " fl-feature-card--featured" : ""}`}
            style={revealDelay(i)}
          >
            <span className="fl-feature-icon" aria-hidden="true">
              {f.icon}
            </span>
            <h3 className="fl-feature-name">{f.title}</h3>
            <p className="fl-feature-body">{f.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
