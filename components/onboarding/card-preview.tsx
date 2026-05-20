"use client";

/**
 * Folio · CardPreview
 *
 * Componente compartido que renderiza el preview de la card pública del
 * profesional. Se usa en:
 *   - Onboarding Step 3-9: panel lateral mostrando cómo va quedando.
 *   - Step 9 (the moment): card grande centrada con reveal animado.
 *   - /configuracion: preview live de los cambios antes de guardar.
 *
 * Variants:
 *   - "preview" (sticky lateral, 360px ancho compacto, sin botón reservar)
 *   - "full" (Step 9 hero, ancho amplio, botón reservar visible)
 *   - "editing" (preview en /configuracion con outline punteado en zonas editables)
 *
 * Diseño premium: hero con gradient sutil del acento, avatar prominente,
 * info en bloques con íconos, servicios listados.
 */

import type { ReactNode } from "react";

import { AvatarIniciales } from "@/components/avatar-iniciales";
import { adjustHexLightness } from "@/lib/format/initials";

export type CardPreviewVariant = "preview" | "full" | "editing";

export interface CardPreviewService {
  nombre: string;
  dur: number;           // minutos
  precioCents: number;
}

export interface CardPreviewData {
  nombre?: string | null;          // "Lorenzo Martínez" — full name del profesional
  consultorioNombre?: string | null;
  rubro?: string | null;
  ciudad?: string | null;
  provincia?: string | null;
  bio?: string | null;
  telefonoPublico?: string | null;
  instagramHandle?: string | null;
  direccionCompleta?: string | null;
  acentoHex?: string | null;
  servicios?: CardPreviewService[];
  slug?: string | null;             // si está, muestra el link footer
}

interface CardPreviewProps {
  data: CardPreviewData;
  variant?: CardPreviewVariant;
  /** URL base (sin trailing slash) para construir el link público mostrado. */
  appUrl?: string;
  /** className extra del wrapper. */
  className?: string;
}

const DEFAULT_ACENTO = "#8A6722";

export function CardPreview({
  data,
  variant = "preview",
  appUrl = "",
  className = "",
}: CardPreviewProps) {
  const acento = isValidHex(data.acentoHex) ? data.acentoHex! : DEFAULT_ACENTO;
  const acentoSoft = adjustHexLightness(acento, 60);
  const fullName = data.nombre?.trim() || data.consultorioNombre?.trim() || "Tu nombre";
  const consultorio = data.consultorioNombre?.trim() || "Tu consultorio";
  const showLink = data.slug && appUrl;
  const linkText = showLink ? `${stripScheme(appUrl)}/book/${data.slug}` : null;

  const isFull = variant === "full";
  const isEditing = variant === "editing";

  return (
    <div
      className={`card-preview card-preview-${variant} ${className}`}
      data-acento={acento}
      style={{
        // Base layout
        background: "var(--surface)",
        border: `1px solid var(--line)`,
        borderRadius: isFull ? 20 : 16,
        overflow: "hidden",
        boxShadow: isFull ? "var(--shadow-hero)" : "var(--shadow-1)",
        // Variants
        width: isFull ? "100%" : undefined,
        maxWidth: isFull ? 520 : "100%",
        position: "relative",
      }}
    >
      {/* Hero con gradient sutil del acento */}
      <div
        style={{
          padding: isFull ? "32px 28px 24px" : "20px 20px 16px",
          background: `linear-gradient(180deg, ${withAlpha(acento, isFull ? 0.10 : 0.06)} 0%, transparent 100%)`,
          borderBottom: `1px solid ${withAlpha(acento, 0.08)}`,
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <AvatarIniciales
            fullName={fullName}
            acentoHex={acento}
            size={isFull ? "xl" : "lg"}
          />
          <div style={{ flex: 1, minWidth: 0, paddingTop: isFull ? 8 : 4 }}>
            <h2
              style={{
                fontSize: isFull ? 24 : 18,
                fontWeight: 600,
                lineHeight: 1.2,
                color: "var(--ink)",
                margin: 0,
                letterSpacing: "-0.01em",
                wordBreak: "break-word",
              }}
            >
              {fullName}
            </h2>
            <p
              style={{
                margin: "4px 0 0 0",
                fontSize: isFull ? 14 : 13,
                color: "var(--ink-3)",
                lineHeight: 1.3,
              }}
            >
              {data.rubro || consultorio}
              {data.ciudad ? <span> · {data.ciudad}</span> : null}
            </p>
          </div>
        </div>

        {data.bio ? (
          <p
            style={{
              marginTop: isFull ? 20 : 14,
              marginBottom: 0,
              fontSize: isFull ? 15 : 13,
              lineHeight: 1.5,
              color: "var(--ink-2)",
              borderLeft: isEditing ? `2px dashed ${acentoSoft}` : undefined,
              paddingLeft: isEditing ? 10 : 0,
            }}
          >
            {data.bio}
          </p>
        ) : isEditing ? (
          <PreviewPlaceholder color={acentoSoft} text="Agregá una bio del consultorio" />
        ) : null}
      </div>

      {/* Bloque de contacto */}
      {(data.direccionCompleta || data.telefonoPublico || data.instagramHandle) ? (
        <div
          style={{
            padding: isFull ? "20px 28px" : "14px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            fontSize: 13,
            color: "var(--ink-2)",
            borderBottom: "1px solid var(--line-soft)",
          }}
        >
          {data.direccionCompleta ? (
            <ContactRow icon={<IconPin />} text={data.direccionCompleta} />
          ) : null}
          {data.telefonoPublico ? (
            <ContactRow
              icon={<IconPhone />}
              text={data.telefonoPublico}
              href={`tel:${data.telefonoPublico.replace(/[^\d+]/g, "")}`}
            />
          ) : null}
          {data.instagramHandle ? (
            <ContactRow
              icon={<IconInstagram />}
              text={`@${data.instagramHandle.replace(/^@/, "")}`}
              href={`https://instagram.com/${data.instagramHandle.replace(/^@/, "")}`}
            />
          ) : null}
        </div>
      ) : null}

      {/* Servicios */}
      {data.servicios && data.servicios.length > 0 ? (
        <div style={{ padding: isFull ? "20px 28px" : "14px 20px" }}>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--ink-3)",
              marginBottom: 12,
              fontWeight: 600,
            }}
          >
            Servicios
          </div>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {data.servicios.slice(0, isFull ? 5 : 3).map((s, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 8,
                  fontSize: isFull ? 14 : 13,
                  color: "var(--ink)",
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>{s.nombre}</span>
                  <span style={{ color: "var(--ink-3)", marginLeft: 8 }}>
                    · {s.dur} min
                  </span>
                </span>
                <span
                  style={{
                    color: "var(--ink)",
                    fontWeight: 500,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatArs(s.precioCents / 100)}
                </span>
              </li>
            ))}
          </ul>
          {data.servicios.length > (isFull ? 5 : 3) ? (
            <p
              style={{
                marginTop: 10,
                marginBottom: 0,
                fontSize: 12,
                color: "var(--ink-3)",
              }}
            >
              + {data.servicios.length - (isFull ? 5 : 3)} más
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Footer: CTA + link */}
      {isFull && data.slug ? (
        <div
          style={{
            padding: "20px 28px 28px",
            borderTop: "1px solid var(--line-soft)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <button
            type="button"
            style={{
              background: acento,
              color: "#FBF9F4",
              border: "none",
              borderRadius: 10,
              padding: "14px 20px",
              fontSize: 15,
              fontWeight: 500,
              cursor: "pointer",
              width: "100%",
              transition: "transform var(--motion-fast) var(--motion-ease-out)",
            }}
          >
            Reservar turno
          </button>
        </div>
      ) : null}

      {/* Link footer en variant preview */}
      {!isFull && linkText ? (
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--line-soft)",
            background: "var(--surface-2)",
            fontSize: 11,
            color: "var(--ink-3)",
            wordBreak: "break-all",
            fontFamily: "var(--font-mono, monospace)",
          }}
        >
          {linkText}
        </div>
      ) : null}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function ContactRow({
  icon,
  text,
  href,
}: {
  icon: ReactNode;
  text: string;
  href?: string;
}) {
  const content = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ display: "inline-flex", color: "var(--ink-3)", flexShrink: 0 }}>{icon}</span>
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
        {content}
      </a>
    );
  }
  return <span>{content}</span>;
}

function PreviewPlaceholder({ color, text }: { color: string; text: string }) {
  return (
    <p
      style={{
        marginTop: 14,
        marginBottom: 0,
        fontSize: 12,
        color: "var(--ink-4)",
        fontStyle: "italic",
        padding: "8px 10px",
        borderRadius: 6,
        background: `${color}33`,
        border: `1px dashed ${color}`,
      }}
    >
      {text}
    </p>
  );
}

function IconPin() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  );
}

function IconPhone() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>
    </svg>
  );
}

function IconInstagram() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
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

function withAlpha(hex: string, alpha: number): string {
  const cleaned = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return hex;
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `#${cleaned}${a}`;
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
