/** Presentational public profile shared by the published page and draft preview.
 * No data fetch, reservation action, or server-only dependency belongs here. */

import Image from "next/image";
import type { ReactNode } from "react";

import { AvatarIniciales } from "@/components/avatar-iniciales";
import { Motif } from "@/components/book-landing/motifs";
import { StickyBookCta } from "@/components/book-landing/sticky-book-cta";
import { FolioMark } from "@/components/folio-mark";
import { resolveBookLandingContent } from "@/lib/book-landing/content";
import { formatArs } from "@/lib/format/currency";
import { adjustHexLightness, contrastingTextColor } from "@/lib/format/initials";

const DEFAULT_ACENTO = "#8A6722";

export interface PublicLandingOrg {
  slug?: string | null;
  tipo: "INDEPENDIENTE" | "CLINICA";
  nombre: string;
  ciudad?: string | null;
  provincia?: string | null;
  rubro?: string | null;
  /** organization.especialidad (M50). NULL → contenido neutral por rubro. */
  especialidad?: string | null;
  acentoHex?: string | null;
  logoUrl?: string | null;
  cardMood?: "calido" | "clinico" | "editorial" | "boutique";
  bio?: string | null;
  telefonoPublico?: string | null;
  direccionCompleta?: string | null;
  instagramHandle?: string | null;
  /** organization.auto_confirmar_reservas (M43) → nota del hero. */
  autoConfirmar?: boolean | null;
}

export interface PublicLandingService {
  id: string;
  nombre: string;
  duracion_min: number;
  precio_cents: number;
  tipo_canonico?: string | null;
  color?: string | null;
}

export interface PublicLandingProfessional {
  id: string;
  displayName: string;
  fotoUrl?: string | null;
  bioPublica?: string | null;
  matricula?: string | null;
}

export interface PublicLandingViewData {
  org: PublicLandingOrg;
  /** Only a consented, public Solo professional. Never infer from an owner. */
  profesional?: PublicLandingProfessional | null;
  /** Visible, accepted professionals. An empty clinic team makes no promise. */
  profesionales: PublicLandingProfessional[];
  servicios: PublicLandingService[];
}

function isValidHex(s: string | null | undefined): s is string {
  return !!s && /^#[0-9a-fA-F]{6}$/.test(s);
}

export function BookLandingView({
  data,
  mode,
  booking,
  serviceAction,
}: {
  data: PublicLandingViewData;
  mode: "published" | "preview";
  booking: ReactNode;
  /** Optional action island for each service; defaults to an ordinary anchor. */
  serviceAction?: (service: PublicLandingService) => ReactNode;
}) {
  const { org, servicios, profesionales } = data;
  const acento = isValidHex(org.acentoHex) ? org.acentoHex : DEFAULT_ACENTO;
  const acento2 = adjustHexLightness(acento, -12);
  const acentoSoft = adjustHexLightness(acento, 60);

  const content = resolveBookLandingContent(org.especialidad, org.rubro);
  const lugar = [org.ciudad, org.provincia].filter(Boolean).join(", ");
  const esClinica = org.tipo === "CLINICA";
  const tieneContacto =
    !!org.direccionCompleta || !!org.telefonoPublico || !!org.instagramHandle;
  // El plan, no la cantidad de profesionales cargados, decide quién firma la
  // página. Una Clínica con un solo integrante conserva su identidad de equipo.
  const profesionalSolo = !esClinica ? data.profesional : null;
  const nombreProfesional = profesionalSolo?.displayName?.trim() && profesionalSolo.displayName !== "Profesional"
    ? profesionalSolo.displayName.trim()
    : null;
  const profesionalIdentificado = nombreProfesional ? profesionalSolo : null;
  const heroNombre = nombreProfesional ?? org.nombre;
  const heroMatricula = profesionalIdentificado?.matricula ?? null;
  const heroFotoProfesional = profesionalIdentificado?.fotoUrl ?? null;
  const heroBio = profesionalIdentificado?.bioPublica?.trim() || (!esClinica ? org.bio?.trim() : null);
  const sobreBio = org.bio?.trim() && (esClinica || org.bio.trim() !== heroBio)
    ? org.bio.trim()
    : null;

  return (
    <div
      className="bl-root"
      style={{
        ["--accent" as string]: acento,
        ["--accent-2" as string]: acento2,
        ["--accent-soft" as string]: acentoSoft,
        ["--bl-on-accent" as string]: contrastingTextColor(acento),
      }}
    >
      {/* La marca del consultorio acompaña al profesional sin competir con su retrato. */}
      <header className="bl-header">
        <div className="bl-header-brand">
          {org.logoUrl ? (
            <PublicImage
              src={org.logoUrl}
              alt={`Logo de ${org.nombre}`}
              className="bl-header-logo"
              width={32}
              height={32}
              priority
              mode={mode}
            />
          ) : (
            <AvatarIniciales fullName={org.nombre} acentoHex={acento} size="sm" />
          )}
          <span className="bl-header-name">{org.nombre}</span>
        </div>
        {mode === "published" ? (
          <a href="#reservar" className="fi-btn fi-btn-primary bl-header-cta">Reservar</a>
        ) : (
          <span className="bl-preview-label">Vista previa</span>
        )}
      </header>

      <main className="bl-main">
        {/* Hero médico-first */}
        <section className="bl-hero">
          <div className="bl-hero-text">
            <div className="bl-eyebrow">
              <Motif motif={content.motif} size={18} className="bl-eyebrow-motif" />
              <span>{content.heroEyebrow}</span>
            </div>
            <h1 className="bl-hero-title">{heroNombre}</h1>
            {nombreProfesional && org.nombre !== nombreProfesional ? (
              <p className="bl-hero-practice">En {org.nombre}</p>
            ) : null}
            {lugar ? <p className="bl-hero-sub">{lugar}</p> : null}
            {heroMatricula ? (
              <p className="bl-hero-matricula fm-mono">M.P. {heroMatricula}</p>
            ) : null}
            <p className="bl-hero-value">{heroBio || content.heroValueLine}</p>
            <div className="bl-hero-actions">
              {mode === "published" ? (
                <a href="#reservar" className="fi-btn fi-btn-primary bl-btn-lg">
                  {content.reservarCtaLabel}
                </a>
              ) : (
                <span className="fi-btn fi-btn-primary bl-btn-lg bl-preview-cta" aria-disabled="true">
                  {content.reservarCtaLabel}
                </span>
              )}
              {org.autoConfirmar != null ? (
                <span className="bl-confirm-note">
                  {org.autoConfirmar
                    ? "Confirmación al instante"
                    : "El consultorio te confirma a la brevedad"}
                </span>
              ) : null}
            </div>
            <p className="bl-trust-micro">Elegí un servicio y un horario para empezar.</p>
          </div>
          <div className={`bl-hero-figure${profesionalIdentificado ? " bl-hero-figure-person" : ""}`}>
            {profesionalIdentificado ? (
              <div className="bl-portrait">
                {heroFotoProfesional ? (
                  <PublicImage
                    src={heroFotoProfesional}
                    alt={`Retrato de ${heroNombre}`}
                    className="bl-portrait-image"
                    width={340}
                    height={400}
                    sizes="(max-width: 760px) 240px, 340px"
                    priority
                    mode={mode}
                  />
                ) : (
                  <AvatarIniciales
                    fullName={heroNombre}
                    acentoHex={acento}
                    size="xl"
                    className="bl-portrait-initials"
                  />
                )}
              </div>
            ) : org.logoUrl ? (
              <PublicImage
                src={org.logoUrl}
                alt={`Logo de ${org.nombre}`}
                className="bl-hero-logo"
                width={160}
                height={160}
                priority
                mode={mode}
              />
            ) : (
              <AvatarIniciales fullName={org.nombre} acentoHex={acento} size="xl" />
            )}
          </div>
        </section>

        {/* Barra sticky de reserva (solo mobile, aparece al pasar el hero). */}
        {mode === "published" ? <StickyBookCta label={content.reservarCtaLabel} /> : null}

        {/* La bio personal vive en el hero; la de la organización se distingue. */}
        {sobreBio ? (
          <section className="bl-about" aria-label="Sobre el consultorio">
            <h2 className="bl-section-title">Sobre el consultorio</h2>
            <p className="bl-about-text">{sobreBio}</p>
          </section>
        ) : null}

        {/* Nuestro equipo (multi-prof): foto + matrícula + bio por profesional
            (M62). Degrada con gracia — sin foto → iniciales; sin bio → se omite. */}
        {esClinica && profesionales.length > 0 ? (
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
                    {mode === "published"
                      ? (serviceAction?.(s) ?? <a href="#reservar" className="bl-service-cta">Reservar</a>)
                      : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Explicación del recorrido antes de abrir el formulario de reserva. */}
        <section className="bl-trust" aria-label="Cómo reservar tu turno">
          <h2 className="bl-section-title">Tu reserva, paso a paso</h2>
          <p className="bl-trust-lead">Revisá los detalles antes de enviar tu solicitud.</p>
          <div className="bl-trust-grid">
            <TrustItem icon={<IconCalendar />} title="Servicio y horario">
              Elegí el servicio, el día y la hora de tu consulta.
            </TrustItem>
            <TrustItem icon={<IconContact />} title="Tus datos de contacto">
              Completá tus datos para que el consultorio pueda contactarte.
            </TrustItem>
            <TrustItem icon={<IconDirect />} title="Estado de la reserva">
              Al terminar, vas a ver si tu turno quedó confirmado o espera aprobación.
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
            {booking}
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
          {mode === "published" && org.slug ? (
            <a className="bl-powered-cta" href={`/onboarding?ref=book_${org.slug}`}>
              Creá la tuya →
            </a>
          ) : null}
        </footer>
      </main>
    </div>
  );
}

// ─── Internal: trust item + íconos ──────────────────────────────────────────

function PublicImage({ mode, src, alt, className, width, height, sizes, priority }: {
  mode: "published" | "preview";
  src: string;
  alt: string;
  className: string;
  width: number;
  height: number;
  sizes?: string;
  priority?: boolean;
}) {
  if (mode === "preview") {
    // Draft uploads may be data/blob URLs. They never pass through the image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={className} width={width} height={height} loading="lazy" decoding="async" />;
  }
  return <Image src={src} alt={alt} className={className} width={width} height={height} sizes={sizes} priority={priority} />;
}

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

function IconCalendar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18" />
    </svg>
  );
}

function IconContact() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
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
