/**
 * Folio · Landing — sección Seguridad / compliance (#seguridad) (Fase B · B2).
 *
 * Server component. Panel sobre --surface-2 con 4 bloques: Ley 25.326,
 * Ley 26.529, cifrado AES-256-GCM y aislamiento multi-tenant (RLS).
 * Los identificadores (números de ley, sigla del cifrado) van en Geist Mono
 * color --accent (.fl-security-tag).
 */

import type { CSSProperties, ReactNode } from "react";
import { History, Lock } from "@/components/icons";

/** Escudo — no existe en components/icons.tsx; inline, trazo consistente. */
const Shield = ({ size = 16 }: { size?: number }) => (
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
    <path d="M12 22s8-3.6 8-10V5.5L12 2 4 5.5V12c0 6.4 8 10 8 10z" />
    <path d="m8.8 11.8 2.2 2.2 4.2-4.5" />
  </svg>
);

/** Capas aisladas — no existe en components/icons.tsx; inline, trazo consistente. */
const Layers = ({ size = 16 }: { size?: number }) => (
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
    <path d="m12 2 9 5-9 5-9-5 9-5z" />
    <path d="m3 12 9 5 9-5" />
    <path d="m3 17 9 5 9-5" />
  </svg>
);

interface SecurityBlock {
  tag: string;
  icon: ReactNode;
  title: string;
  body: string;
}

const BLOCKS: SecurityBlock[] = [
  {
    tag: "Ley 25.326",
    icon: <Shield size={18} />,
    title: "Protección de datos personales",
    body: "Consentimiento, derecho de acceso y supresión: el tratamiento de datos que exige la ley argentina, incorporado al producto desde el diseño.",
  },
  {
    tag: "Ley 26.529",
    icon: <History size={18} />,
    title: "Derechos del paciente",
    body: "Tu historia clínica se conserva 10 años, como exige la ley, y tus pacientes pueden ejercer su derecho de acceso cuando lo necesiten.",
  },
  {
    tag: "AES-256-GCM",
    icon: <Lock size={18} />,
    title: "Cifrado antes de guardar",
    body: "Tus notas se cifran antes de llegar a la base de datos: ahí solo se almacena texto cifrado, nunca el contenido clínico en claro.",
  },
  {
    tag: "RLS",
    icon: <Layers size={18} />,
    title: "Aislamiento por consultorio",
    body: "Los datos de tu consultorio solo los ve tu consultorio — el aislamiento se aplica a nivel de base de datos, no solo en la aplicación.",
  },
];

function revealDelay(index: number): CSSProperties {
  return { "--fl-reveal-delay": `${index * 70}ms` } as CSSProperties;
}

export function Security() {
  return (
    <section id="seguridad" className="fl-section fl-security" data-fl-section="security">
      <div className="fl-security-panel">
        <h2 className="fl-security-title fl-reveal">
          Tus historias clínicas, protegidas como exige la ley
        </h2>
        <p className="fl-security-sub fl-reveal">
          Folio fue diseñado desde el día uno para la normativa argentina — no adaptado después.
        </p>
        <div className="fl-security-grid">
          {BLOCKS.map((b, i) => (
            <article key={b.tag} className="fl-security-block fl-reveal" style={revealDelay(i)}>
              <div className="fl-security-block-head">
                <span className="fl-security-icon" aria-hidden="true">
                  {b.icon}
                </span>
                <span className="fl-security-tag">{b.tag}</span>
              </div>
              <h3 className="fl-security-name">{b.title}</h3>
              <p className="fl-security-body">{b.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
