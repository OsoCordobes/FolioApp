/**
 * Folio · BookLanding · landing pública médico-first para /book/[slug].
 *
 * Server Component. Enmarca la reserva (BookingWizard, client) en una landing
 * con la marca del CONSULTORIO al frente y Folio como sello de confianza sutil
 * + "Hecho con Folio" al pie (patrón Calendly/Stripe). El acento del
 * consultorio se inyecta como --accent/--accent-2/--accent-soft sobre
 * .bl-root, así CTAs, íconos y motivos se tiñen con su color sin romper el tema.
 *
 * El wizard NO cambia de comportamiento: se reubica dentro de #reservar. La
 * lógica de reserva (consent, captcha, rate-limits, auto-confirm) vive intacta
 * en components/booking/booking-wizard.tsx + app/(public)/book/[slug]/actions.ts.
 *
 * Secciones: header · hero · sobre · equipo · servicios · seguridad ·
 * ubicación · reserva · powered-by. El equipo y (en orgs solo) el hero muestran
 * foto/bio/matrícula por profesional — member.perfil_publico (M62).
 */

import type { ReactNode } from "react";

import { AvatarIniciales } from "@/components/avatar-iniciales";
import { Motif } from "@/components/book-landing/motifs";
import { StickyBookCta } from "@/components/book-landing/sticky-book-cta";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { FolioMark } from "@/components/folio-mark";
import type { ProfesionalPerfilPublico } from "@/lib/db/members";
import { resolveBookLandingContent } from "@/lib/book-landing/content";
import { formatArs } from "@/lib/format/currency";
import { adjustHexLightness } from "@/lib/format/initials";

const DEFAULT_ACENTO = "#8A6722";

export interface BookLandingOrg {
  slug: string;
  nombre: string;
  ciudad: string | null;
  provincia: string | null;
  rubro: string | null;
  /** organization.especialidad (M50). NULL → contenido neutral por rubro. */
  especialidad: string | null;
  acentoHex: string;
  logoUrl: string | null;
  cardMood: "calido" | "clinico" | "editorial" | "boutique";
  bio: string | null;
  telefonoPublico: string | null;
  direccionCompleta: string | null;
  instagramHandle: string | null;
  /** organization.auto_confirmar_reservas (M43) → nota del hero. */
  autoConfirmar: boolean;
}

interface ServicioPublic {
  id: string;
  nombre: string;
  duracion_min: number;
  precio_cents: number;
  tipo_canonico: string;
  color: string | null;
}

function isValidHex(s: string | null | undefined): s is string {
  return !!s && /^#[0-9a-fA-F]{6}$/.test(s);
}

export function BookLanding({
  org,
  servicios,
  profesionales = [],
}: {
  org: BookLandingOrg;
  servicios: ServicioPublic[];
  profesionales?: ProfesionalPerfilPublico[];
}) {
  const acento = isValidHex(org.acentoHex) ? org.acentoHex : DEFAULT_ACENTO;
  const acento2 = adjustHexLightness(acento, -12);
  const acentoSoft = adjustHexLightness(acento, 60);

  const content = resolveBookLandingContent(org.especialidad, org.rubro);
  const lugar = [org.ciudad, org.provincia].filter(Boolean).join(", ");
  const multiProf = profesionales.length > 1;
  const tieneContacto =
    !!org.direccionCompleta || !!org.telefonoPublico || !!org.instagramHandle;
  const sobreTitulo = multiProf ? "Sobre el consultorio" : "Sobre mí";

  // Solo (1 colegiado): su foto/matrícula enriquecen el hero. La figura del
  // hero prioriza el logo del consultorio si lo subió; si no, la foto del
  // profesional solo; si no, iniciales.
  const profesionalSolo = !multiProf && profesionales.length === 1 ? profesionales[0] : null;
  const heroMatricula = profesionalSolo?.matricula ?? null;
  const heroFotoProfesional = !org.logoUrl ? (profesionalSolo?.fotoUrl ?? null) : null;
  // Reduce el perfil rico a {id, displayName} para el selector del wizard
  // (su contrato no cambia: foto/bio/matrícula son solo para la landing).
  const profesionalesLite = profesionales.map((p) => ({
    id: p.id,
    displayName: p.displayName,
  }));

  return (
    <div
      className="bl-root"
      style={{
        ["--accent" as string]: acento,
        ["--accent-2" as string]: acento2,
        ["--accent-soft" as string]: acentoSoft,
      }}
    >
      {/* Header glass — marca del consultorio. Folio NO aparece acá. */}
      <header className="bl-header">
        <div className="bl-header-brand">
          {org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={org.logoUrl}
              alt={`Logo de ${org.nombre}`}
              className="bl-header-logo"
              width={32}
              height={32}
              loading="eager"
              decoding="async"
            />
          ) : (
            <AvatarIniciales fullName={org.nombre} acentoHex={acento} size="sm" />
          )}
          <span className="bl-header-name">{org.nombre}</span>
        </div>
        <a href="#reservar" className="fi-btn fi-btn-primary bl-header-cta">
          Reservar
        </a>
      </header>

      <main className="bl-main">
        {/* Hero médico-first */}
        <section className="bl-hero">
          <div className="bl-hero-text">
            <div className="bl-eyebrow">
              <Motif motif={content.motif} size={18} className="bl-eyebrow-motif" />
              <span>{content.heroEyebrow}</span>
            </div>
            <h1 className="bl-hero-title">{org.nombre}</h1>
            {lugar ? <p className="bl-hero-sub">{lugar}</p> : null}
            {heroMatricula ? (
              <p className="bl-hero-matricula fm-mono">M.P. {heroMatricula}</p>
            ) : null}
            <p className="bl-hero-value">{content.heroValueLine}</p>
            <div className="bl-hero-actions">
              <a href="#reservar" className="fi-btn fi-btn-primary bl-btn-lg">
                {content.reservarCtaLabel}
              </a>
              <span className="bl-confirm-note">
                {org.autoConfirmar
                  ? "Confirmación al instante"
                  : "Te confirmamos por WhatsApp"}
              </span>
            </div>
            <p className="bl-trust-micro fm-mono">Datos cifrados · AES-256 · Ley 25.326</p>
          </div>
          <div className="bl-hero-figure">
            {org.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={org.logoUrl}
                alt={`Logo de ${org.nombre}`}
                className="bl-hero-logo"
                width={160}
                height={160}
                loading="eager"
                decoding="async"
              />
            ) : heroFotoProfesional && profesionalSolo ? (
              // Solo sin logo: foto del profesional como avatar redondo grande.
              <AvatarIniciales
                fullName={profesionalSolo.displayName}
                avatarUrl={heroFotoProfesional}
                acentoHex={acento}
                size="xl"
              />
            ) : (
              <AvatarIniciales fullName={org.nombre} acentoHex={acento} size="xl" />
            )}
          </div>
        </section>

        {/* Barra sticky de reserva (solo mobile, aparece al pasar el hero). */}
        <StickyBookCta label={content.reservarCtaLabel} />

        {/* Sobre el consultorio / Sobre mí */}
        {org.bio ? (
          <section className="bl-about" aria-label={sobreTitulo}>
            <h2 className="bl-section-title">{sobreTitulo}</h2>
            <p className="bl-about-text">{org.bio}</p>
          </section>
        ) : null}

        {/* Nuestro equipo (multi-prof): foto + matrícula + bio por profesional
            (M62). Degrada con gracia — sin foto → iniciales; sin bio → se omite. */}
        {multiProf ? (
          <section
            className="bl-team"
            aria-label="Profesionales que atienden en este consultorio"
          >
            <h2 className="bl-section-title">Nuestro equipo</h2>
            <div className="bl-team-grid">
              {profesionales.map((p) => (
                <div key={p.id} className="bl-team-card">
                  <AvatarIniciales
                    fullName={p.displayName}
                    avatarUrl={p.fotoUrl}
                    acentoHex={acento}
                    size="md"
                  />
                  <div className="bl-team-info">
                    <p className="bl-team-name">{p.displayName}</p>
                    {p.matricula ? (
                      <p className="bl-team-matricula fm-mono">M.P. {p.matricula}</p>
                    ) : null}
                    {p.bioPublica ? <p className="bl-team-bio">{p.bioPublica}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Servicios — vitrina (con precio); reservar ancla al wizard. */}
        {servicios.length > 0 ? (
          <section className="bl-services" aria-label="Servicios">
            <h2 className="bl-section-title">Servicios</h2>
            <div className="bl-services-grid">
              {servicios.map((s) => (
                <div key={s.id} className="bl-service-card">
                  <div className="bl-service-info">
                    <span className="bl-service-name">{s.nombre}</span>
                    <span className="bl-service-dur">{s.duracion_min} min</span>
                  </div>
                  <div className="bl-service-foot">
                    <span className="bl-service-price fm-mono">
                      {formatArs(s.precio_cents / 100)}
                    </span>
                    <a href="#reservar" className="bl-service-cta">
                      Reservar
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Seguridad / confianza — Folio como trust signal tasteful. */}
        <section className="bl-trust" aria-label="Seguridad de tus datos">
          <h2 className="bl-section-title">Tus datos, protegidos</h2>
          <p className="bl-trust-lead">{content.trustFraming}</p>
          <div className="bl-trust-grid">
            <TrustItem icon={<IconShield />} title="Cifrado AES-256">
              Cada dato se cifra antes de tocar la base.
            </TrustItem>
            <TrustItem icon={<IconCertificate />} title="Ley 25.326">
              Protección de datos personales en Argentina.
            </TrustItem>
            <TrustItem icon={<IconDirect />} title="Directo al consultorio">
              Tu turno llega derecho a tu profesional.
            </TrustItem>
          </div>
        </section>

        {/* Ubicación / contacto */}
        {tieneContacto ? (
          <section className="bl-location" aria-label="Ubicación y contacto">
            <h2 className="bl-section-title">Dónde encontrarnos</h2>
            <ul className="bl-location-list">
              {org.direccionCompleta ? (
                <li className="bl-location-row">
                  <IconPin />
                  <span>{org.direccionCompleta}</span>
                </li>
              ) : null}
              {org.telefonoPublico ? (
                <li className="bl-location-row">
                  <IconPhone />
                  <a
                    href={`https://wa.me/${org.telefonoPublico.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {org.telefonoPublico}
                  </a>
                </li>
              ) : null}
              {org.instagramHandle ? (
                <li className="bl-location-row">
                  <IconInstagram />
                  <a
                    href={`https://instagram.com/${org.instagramHandle.replace(/^@/, "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    @{org.instagramHandle.replace(/^@/, "")}
                  </a>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}

        {/* Reserva enfocada — el wizard intacto, reubicado. */}
        <section id="reservar" className="bl-book" aria-label="Reservá tu turno">
          <h2 className="bl-book-title">Reservá tu turno</h2>
          <div className="bl-book-frame">
            <BookingWizard
              org={{
                slug: org.slug,
                nombre: org.nombre,
                ciudad: org.ciudad,
                provincia: org.provincia,
                rubro: org.rubro,
                acentoHex: org.acentoHex,
                logoUrl: org.logoUrl,
                cardMood: org.cardMood,
                bio: org.bio,
                telefonoPublico: org.telefonoPublico,
                direccionCompleta: org.direccionCompleta,
                instagramHandle: org.instagramHandle,
              }}
              servicios={servicios}
              profesionales={profesionalesLite}
            />
          </div>
        </section>

        {/* Powered by Folio — sello sutil + adquisición suave. */}
        <footer className="bl-powered">
          <span className="bl-powered-mark">
            <FolioMark size={20} />
          </span>
          <span className="bl-powered-text">
            Hecho con <b>Folio</b>
          </span>
          <a className="bl-powered-cta" href={`/onboarding?ref=book_${org.slug}`}>
            Creá la tuya →
          </a>
        </footer>
      </main>
    </div>
  );
}

// ─── Internal: trust item + íconos ──────────────────────────────────────────

function TrustItem({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="bl-trust-item">
      <span className="bl-trust-icon">{icon}</span>
      <div>
        <p className="bl-trust-item-title">{title}</p>
        <p className="bl-trust-item-text">{children}</p>
      </div>
    </div>
  );
}

function IconShield() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9.5 12l1.8 1.8L15 10" />
    </svg>
  );
}

function IconCertificate() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="9" r="5" />
      <path d="M9 13l-1.5 7L12 18l4.5 2L15 13" />
    </svg>
  );
}

function IconDirect() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

function IconPin() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function IconInstagram() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}
