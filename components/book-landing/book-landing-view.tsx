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
const FOLIO_ACCENT = "#6255C5";

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

/** Presentational choice only. Publication settings belong to a later release. */
export type PublicLandingLayout = "perfil" | "consultorio";

export function BookLandingView({
  data,
  mode,
  booking,
  serviceAction,
  layout,
}: {
  data: PublicLandingViewData;
  mode: "published" | "preview";
  booking: ReactNode;
  /** Optional action island for each service; defaults to an ordinary anchor. */
  serviceAction?: (service: PublicLandingService) => ReactNode;
  layout?: PublicLandingLayout;
}) {
  const { org, servicios, profesionales } = data;
  // El color propio del consultorio sigue guardado; esta página usa la marca Folio.

  const content = resolveBookLandingContent(org.especialidad, org.rubro);
  const lugar = [org.ciudad, org.provincia].filter(Boolean).join(", ");
  const esClinica = org.tipo === "CLINICA";
  const disposition = layout ?? (esClinica ? "consultorio" : "perfil");
  const tieneEquipoParaReservar = !esClinica || profesionales.length > 0;
  const puedeReservar = servicios.length > 0 && tieneEquipoParaReservar;
  const tieneContacto = Boolean(lugar || org.direccionCompleta || org.telefonoPublico || org.instagramHandle);
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
  const bioProfesional = profesionalIdentificado?.bioPublica?.trim() || null;
  const bioConsultorio = org.bio?.trim() || null;
  const mostrarBioConsultorio = bioConsultorio && bioConsultorio !== bioProfesional ? bioConsultorio : null;
  const heroDescription = bioProfesional || bioConsultorio || (puedeReservar
    ? (esClinica ? "Conocé nuestros servicios y encontrá un horario disponible." : "Conocé los servicios y elegí un horario disponible.")
    : (esClinica ? "Conocé nuestro espacio y los servicios del consultorio." : "Conocé el consultorio y sus datos de contacto."));
  const mostrarLogoConsultorio = disposition === "consultorio" && Boolean(org.logoUrl);
  const mostrarRetrato = disposition === "perfil" && Boolean(heroFotoProfesional);
  const ContentTag = mode === "published" ? "main" : "div";

  return (
    <div
      className="bl-root"
      data-mode={mode}
      data-kind={esClinica ? "clinic" : "solo"}
      data-layout={disposition}
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
          ) : <FolioMark size={28} />}
          <span className="bl-header-name">{org.nombre}</span>
        </div>
        <nav className="bl-header-nav" aria-label="Secciones de la página">
          {bioProfesional ? <a href="#sobre">Sobre mí</a> : null}
          {mostrarBioConsultorio ? <a href={bioProfesional ? "#consultorio" : "#sobre"}>Consultorio</a> : null}
          <a href="#servicios">Servicios</a>
          {esClinica && profesionales.length > 0 ? <a href="#equipo">Equipo</a> : null}
          {tieneContacto ? <a href="#contacto">Contacto</a> : null}
        </nav>
        {mode === "published" && puedeReservar ? (
          <a href="#servicios" className="fi-btn fi-btn-primary bl-header-cta">Reservar</a>
        ) : mode === "preview" ? (
          <span className="bl-preview-label">Vista previa</span>
        ) : null}
      </header>

      <ContentTag className="bl-main">
        {/* Identity first: the clinic remains a clinic even with one professional. */}
        <section id={bioProfesional || bioConsultorio ? "sobre" : undefined} className={`bl-hero${mostrarRetrato ? " bl-hero-has-visual" : ""}`}>
          <div className="bl-hero-text">
            {mostrarLogoConsultorio && org.logoUrl ? (
              <PublicImage src={org.logoUrl} alt={`Logo de ${org.nombre}`}
                className="bl-practice-mark" width={80} height={80} priority mode={mode} />
            ) : null}
            <div className="bl-eyebrow">
              <Motif motif={content.motif} size={18} className="bl-eyebrow-motif" />
              <span>{content.heroEyebrow}</span>
            </div>
            {mode === "published"
              ? <h1 className="bl-hero-title">{heroNombre}</h1>
              : <h2 className="bl-hero-title">{heroNombre}</h2>}
            {nombreProfesional && org.nombre !== nombreProfesional ? (
              <p className="bl-hero-practice">En {org.nombre}</p>
            ) : null}
            <div className="bl-hero-facts">
              {lugar ? <span className="bl-hero-sub">{lugar}</span> : null}
              {heroMatricula ? <span className="bl-hero-matricula fm-mono">M.P. {heroMatricula}</span> : null}
            </div>
            <p className="bl-hero-value">{heroDescription}</p>
            <div className="bl-hero-actions">
              {mode === "published" && puedeReservar ? (
                <a href="#servicios" className="fi-btn fi-btn-primary bl-btn-lg">
                  {content.reservarCtaLabel}
                </a>
              ) : mode === "preview" && puedeReservar ? (
                <span className="fi-btn fi-btn-primary bl-btn-lg bl-preview-cta" aria-disabled="true">
                  {content.reservarCtaLabel}
                </span>
              ) : <span className="bl-unavailable-note">Turnos online en preparación</span>}
            </div>
            {puedeReservar && org.autoConfirmar != null ? (
              <p className="bl-confirm-note">
                {org.autoConfirmar ? "El turno se confirma al finalizar" : "El consultorio confirma tu solicitud"}
              </p>
            ) : null}
          </div>
          {mostrarRetrato && heroFotoProfesional ? (
            <div className="bl-hero-figure bl-hero-figure-person">
              <div className="bl-portrait">
                <PublicImage src={heroFotoProfesional} alt={`Retrato de ${heroNombre}`}
                  className="bl-portrait-image" width={340} height={400}
                  sizes="(max-width: 760px) 240px, 340px" priority mode={mode} />
              </div>
            </div>
          ) : null}
        </section>

        {/* Barra sticky de reserva (solo mobile, aparece al pasar el hero). */}
        {mode === "published" && puedeReservar ? <StickyBookCta label={content.reservarCtaLabel} targetId="servicios" /> : null}

        {((bioProfesional && mostrarBioConsultorio) || (esClinica && profesionales.length > 0)) ? (
          <div className="bl-details bl-story">
            {bioProfesional && mostrarBioConsultorio ? (
              <section id="consultorio" className="bl-about" aria-label="Sobre el consultorio">
                <span className="bl-section-kicker">El consultorio</span>
                <h2 className="bl-section-title">Sobre el consultorio</h2>
                <p className="bl-about-text">{mostrarBioConsultorio}</p>
              </section>
            ) : null}
            {esClinica && profesionales.length > 0 ? (
              <section id="equipo" className="bl-team" aria-label="Profesionales que atienden en este consultorio">
                <span className="bl-section-kicker">Personas</span>
                <h2 className="bl-section-title">Nuestro equipo</h2>
                <div className="bl-team-grid">
                  {profesionales.map((p) => (
                    <div key={p.id} className="bl-team-card">
                      <AvatarIniciales fullName={p.displayName} avatarUrl={p.fotoUrl} acentoHex={FOLIO_ACCENT} size="md" />
                      <div className="bl-team-info">
                        <p className="bl-team-name">{p.displayName}</p>
                        {p.matricula ? <p className="bl-team-matricula fm-mono">M.P. {p.matricula}</p> : null}
                        {p.bioPublica ? <p className="bl-team-bio">{p.bioPublica}</p> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        <section className="bl-reservation" aria-label="Servicios y reserva">
          <div className="bl-reservation-heading">
            <span className="bl-section-kicker">{puedeReservar ? "Turnos online" : "Servicios"}</span>
            <h2>{puedeReservar ? "Encontrá tu próxima consulta" : "Conocé nuestros servicios"}</h2>
            <p>{puedeReservar ? "Elegí un servicio para ver los horarios disponibles." : "La reserva online estará disponible cuando el consultorio habilite turnos."}</p>
          </div>
          <div className="bl-reservation-grid">
            <section id="servicios" className="bl-services" aria-label="Servicios">
              <h3 className="bl-section-title" tabIndex={-1}>Servicios</h3>
              {servicios.length > 0 ? (
                <div className="bl-services-grid">
                  {servicios.map((s) => (
                    <div key={s.id} className="bl-service-card">
                      <div className="bl-service-info">
                        <span className="bl-service-name">{s.nombre}</span>
                        <span className="bl-service-dur">{s.duracion_min} min</span>
                      </div>
                      <div className="bl-service-foot">
                        <span className="bl-service-price fm-mono">{formatArs(s.precio_cents / 100)}</span>
                        {mode === "published" && puedeReservar
                          ? (serviceAction?.(s) ?? <a href="#reservar" className="bl-service-cta">Reservar</a>)
                          : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="bl-services-empty">Todavía no hay servicios publicados para reservar.</p>
              )}
            </section>
            <section id="reservar" className="bl-book" aria-label={puedeReservar ? "Reservá tu turno" : "Estado de la reserva online"}>
              <div className="bl-book-head">
                <span className="bl-section-kicker">{puedeReservar ? "Reserva" : "Próximamente"}</span>
                <h3 className="bl-book-title">{puedeReservar ? "Elegí tu turno" : "Turnos online en preparación"}</h3>
              </div>
              <div className="bl-book-frame">{booking}</div>
              {puedeReservar ? <p className="bl-book-footnote">Elegí un horario, completá tus datos y revisá el estado de tu solicitud.</p> : null}
            </section>
          </div>
        </section>

        {tieneContacto ? (
          <div className="bl-details">
              <section id="contacto" className="bl-location" aria-label="Ubicación y contacto">
                <span className="bl-section-kicker">Contacto</span>
                <h2 className="bl-section-title">Dónde encontrarnos</h2>
                <ul className="bl-location-list">
                  {lugar ? <li className="bl-location-row"><IconPin /><span>{lugar}</span></li> : null}
                  {org.direccionCompleta ? <li className="bl-location-row"><IconPin /><span>{org.direccionCompleta}</span></li> : null}
                  {org.telefonoPublico ? (
                    <li className="bl-location-row"><IconPhone /><a href={`https://wa.me/${org.telefonoPublico.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">{org.telefonoPublico}</a></li>
                  ) : null}
                  {org.instagramHandle ? (
                    <li className="bl-location-row"><IconInstagram /><a href={`https://instagram.com/${org.instagramHandle.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer">@{org.instagramHandle.replace(/^@/, "")}</a></li>
                  ) : null}
                </ul>
              </section>
          </div>
        ) : null}

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
      </ContentTag>
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
