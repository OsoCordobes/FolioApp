"use client";

/**
 * Folio · <PublicCard>
 *
 * The single component that renders a professional's public card. Replaces
 * the legacy <CardPreview> (kept as a compat re-export at
 * components/onboarding/card-preview.tsx until F8 cleanup).
 *
 * Layers (per docs/specs/2026-05-21-public-card-and-onboarding-redesign.md):
 *   A foundation  — hero + bio + contact + services + CTA + link footer.
 *   B mood preset — applied via [data-card-mood="<id>"], CSS-variable overrides
 *                   on the root. Full overrides land in F5; F4 ships only the
 *                   editorial-default baseline.
 *   D logo upload — when data.logoUrl is set, renders <img> in the hero
 *                   instead of <AvatarIniciales>.
 *
 * Variants:
 *   preview  — sticky-lateral 360px, no CTA, link footer mono.
 *   full     — 560px hero, CTA "Reservar turno", no link footer.
 *   editing  — same chrome as preview but inline placeholders for missing
 *              bio / etc. (consumed in /configuracion).
 *
 * Entry choreography: musical-stagger via .fpc-enter-hero (chassis cinematic
 * 720 ms blur+y) + .fpc-enter-musical on content blocks (320 ms y, delay
 * driven by --fpc-stagger-musical-N tokens). Reduce-motion strips both,
 * preserves final state — policy enforced in folio.css.
 */

import type { ReactNode } from "react";

import { AvatarIniciales } from "@/components/avatar-iniciales";
import { adjustHexLightness } from "@/lib/format/initials";

import { BrassCornerMark, DateBadge, EditorialRule } from "./decoration";
import { applyAcentoBlend } from "./moods";

export type PublicCardVariant = "preview" | "full" | "editing";
export type CardMood = "calido" | "clinico" | "editorial" | "boutique";

export interface PublicCardService {
  nombre: string;
  dur: number;
  precioCents: number;
}

export interface PublicCardData {
  /** Display name of the professional. Falls back to consultorioNombre or placeholder. */
  nombre?: string | null;
  consultorioNombre?: string | null;
  rubro?: string | null;
  ciudad?: string | null;
  provincia?: string | null;
  bio?: string | null;
  telefonoPublico?: string | null;
  instagramHandle?: string | null;
  direccionCompleta?: string | null;
  /** Per-pro accent hex (e.g. "#8A6722"). Overrides --fpc-accent on this card. */
  acentoHex?: string | null;
  /** When set, renders as the hero logo instead of avatar-iniciales. */
  logoUrl?: string | null;
  /** Mood selector. Defaults to "editorial". */
  cardMood?: CardMood;
  servicios?: PublicCardService[];
  /** If present, public link footer + CTA href become reservation-aware. */
  slug?: string | null;
}

export interface PublicCardProps {
  data: PublicCardData;
  variant?: PublicCardVariant;
  /** Base URL (no trailing slash) used to render the link footer text. */
  appUrl?: string;
  className?: string;
}

const DEFAULT_ACENTO = "#8A6722";

export function PublicCard({
  data,
  variant = "preview",
  appUrl = "",
  className = "",
}: PublicCardProps) {
  const rawAcento = isValidHex(data.acentoHex) ? data.acentoHex : DEFAULT_ACENTO;
  const mood: CardMood = data.cardMood ?? "editorial";
  // Clínico mood pulls the pro acento 40% toward ink-blue for clinical
  // register; other moods pass the raw user hex through.
  const acento = applyAcentoBlend(mood, rawAcento);
  const acentoSoft = adjustHexLightness(acento, 60);

  const fullName =
    data.nombre?.trim() || data.consultorioNombre?.trim() || "Tu nombre";
  const consultorio = data.consultorioNombre?.trim() || "Tu consultorio";
  const showLink = !!data.slug && !!appUrl;
  const linkText = showLink ? `${stripScheme(appUrl)}/book/${data.slug}` : null;

  const isFull = variant === "full";
  const isEditing = variant === "editing";

  return (
    <article
      className={`fpc-card fpc-variant-${variant} ${className}`.trim()}
      data-card-mood={mood}
      data-acento={acento}
      style={{
        ["--fpc-accent" as string]: acento,
        ["--fpc-accent-soft" as string]: acentoSoft,
      }}
    >
      <header className="fpc-hero">
        {data.logoUrl ? (
          // Public-card logo: <img> on purpose. The src is a Supabase public
          // URL with a cache-bust query; next/image would not optimise it
          // further and would block server rendering on data URLs.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.logoUrl}
            alt={`Logo de ${consultorio}`}
            className="fpc-logo"
            width={isFull ? 120 : 80}
            height={isFull ? 120 : 80}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <AvatarIniciales
            fullName={fullName}
            acentoHex={acento}
            size={isFull ? "xl" : "lg"}
          />
        )}

        <div className="fpc-hero-text">
          <h2 className="fpc-name">{fullName}</h2>
          <p className="fpc-meta">
            {data.rubro || consultorio}
            {data.ciudad ? <span> · {data.ciudad}</span> : null}
          </p>
        </div>

        {mood === "calido" ? (
          <span className="fpc-corner-slot">
            <BrassCornerMark />
          </span>
        ) : null}
        {mood === "boutique" ? (
          <span className="fpc-date-slot">
            <DateBadge label="EST. 2026 · CÓRDOBA" />
          </span>
        ) : null}
      </header>

      {data.bio ? (
        <p className="fpc-bio">{data.bio}</p>
      ) : isEditing ? (
        <p className="fpc-bio is-placeholder">Agregá una bio del consultorio</p>
      ) : null}

      {data.direccionCompleta || data.telefonoPublico || data.instagramHandle ? (
        <section className="fpc-contact" aria-label="Contacto">
          {mood === "editorial" || mood === "clinico" ? <EditorialRule /> : null}
          {data.direccionCompleta ? (
            <Row icon={<IconPin />} text={data.direccionCompleta} />
          ) : null}
          {data.telefonoPublico ? (
            <Row
              icon={<IconPhone />}
              text={data.telefonoPublico}
              href={`tel:${data.telefonoPublico.replace(/[^\d+]/g, "")}`}
            />
          ) : null}
          {data.instagramHandle ? (
            <Row
              icon={<IconInstagram />}
              text={`@${data.instagramHandle.replace(/^@/, "")}`}
              href={`https://instagram.com/${data.instagramHandle.replace(/^@/, "")}`}
            />
          ) : null}
        </section>
      ) : null}

      {data.servicios && data.servicios.length > 0 ? (
        <section className="fpc-services" aria-label="Servicios">
          {mood === "editorial" || mood === "clinico" ? <EditorialRule /> : null}
          <h3 className="fpc-services-label fm-mono">Servicios</h3>
          <ul>
            {data.servicios.slice(0, isFull ? 5 : 3).map((s, i) => (
              <li key={i}>
                <span className="fpc-srv-name">{s.nombre}</span>
                <span className="fpc-srv-dur">· {s.dur} min</span>
                <span className="fpc-srv-price">
                  {formatArs(s.precioCents / 100)}
                </span>
              </li>
            ))}
          </ul>
          {data.servicios.length > (isFull ? 5 : 3) ? (
            <p className="fpc-services-more">
              + {data.servicios.length - (isFull ? 5 : 3)} más
            </p>
          ) : null}
        </section>
      ) : null}

      {isFull && data.slug ? (
        <footer className="fpc-footer">
          <button type="button" className="fpc-cta">
            Reservar turno
          </button>
        </footer>
      ) : null}

      {!isFull && linkText ? (
        <div className="fpc-link-footer fm-mono">{linkText}</div>
      ) : null}
    </article>
  );
}

// ─── Internal: helpers / icons ─────────────────────────────────────────────

function Row({
  icon,
  text,
  href,
}: {
  icon: ReactNode;
  text: string;
  href?: string;
}) {
  const inner = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ display: "inline-flex", color: "var(--ink-3)", flexShrink: 0 }}>
        {icon}
      </span>
      <span>{text}</span>
    </span>
  );
  if (href) {
    return (
      <a
        href={href}
        target={href.startsWith("http") ? "_blank" : undefined}
        rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
        style={{ color: "inherit", textDecoration: "none" }}
      >
        {inner}
      </a>
    );
  }
  return inner;
}

function IconPin() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function IconPhone() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function IconInstagram() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function formatArs(ars: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(ars);
}

function isValidHex(s: string | undefined | null): s is string {
  return !!s && /^#[0-9a-fA-F]{6}$/.test(s);
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
