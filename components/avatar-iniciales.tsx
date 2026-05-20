/**
 * Folio · AvatarIniciales
 *
 * Avatar circular con iniciales del profesional. Se usa en:
 *   - Sidebar (small, 32px)
 *   - Card preview (medium, 56px)
 *   - /book/<slug> hero (xl, 160px)
 *   - Configuracion preview (large, 96px)
 *
 * Diseño premium:
 *   - Gradient lineal 135° del acento → acento aclarado 20%
 *   - Contraste auto: el color del texto se calcula del acento para asegurar WCAG AA
 *   - Tipografía: peso 500, tracking ligero
 *   - Sombra interior sutil para profundidad
 *   - Border de 1px del color acento con opacity baja
 *
 * Si `avatarUrl` está dado, prioriza la foto sobre las iniciales (futuro,
 * cuando integremos upload a Storage).
 */

import { getInitials, contrastingTextColor, adjustHexLightness } from "@/lib/format/initials";

export type AvatarSize = "sm" | "md" | "lg" | "xl";

interface AvatarInicialesProps {
  /** Nombre completo o "Nombre Apellido". Vacío/null → "?". */
  fullName: string | null | undefined;
  /** Color hex del acento de la org. Ej. "#c89b3c". */
  acentoHex?: string;
  /** Tamaño. Default "md". */
  size?: AvatarSize;
  /** URL de foto opcional. Si está, prioriza sobre iniciales. */
  avatarUrl?: string | null;
  /** Clase CSS extra para overrides puntuales. */
  className?: string;
}

const SIZE_PX: Record<AvatarSize, number> = {
  sm: 32,
  md: 56,
  lg: 96,
  xl: 160,
};

const FONT_PX: Record<AvatarSize, number> = {
  sm: 13,
  md: 22,
  lg: 36,
  xl: 60,
};

const DEFAULT_ACENTO = "#c89b3c";

export function AvatarIniciales({
  fullName,
  acentoHex,
  size = "md",
  avatarUrl,
  className,
}: AvatarInicialesProps) {
  const dim = SIZE_PX[size];
  const fontSize = FONT_PX[size];
  const acento = isValidHex(acentoHex) ? acentoHex! : DEFAULT_ACENTO;
  const lighter = adjustHexLightness(acento, 18);
  const textColor = contrastingTextColor(acento);

  const styleBase: React.CSSProperties = {
    width: dim,
    height: dim,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
    position: "relative",
    background: `linear-gradient(135deg, ${acento} 0%, ${lighter} 100%)`,
    border: `1px solid ${withAlpha(acento, 0.2)}`,
    boxShadow: `inset 0 1px 0 ${withAlpha("#ffffff", 0.18)}, 0 1px 2px ${withAlpha("#000000", 0.06)}`,
    color: textColor,
    fontSize,
    fontWeight: 500,
    letterSpacing: size === "xl" ? "-0.02em" : "0",
    lineHeight: 1,
    userSelect: "none",
  };

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={fullName ?? ""}
        width={dim}
        height={dim}
        className={className}
        style={{
          ...styleBase,
          background: "var(--surface-2, #f5f3ee)",
          objectFit: "cover",
        }}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={fullName ?? "Avatar"}
      className={className}
      style={styleBase}
    >
      {getInitials(fullName)}
    </span>
  );
}

// ─── Helpers locales ────────────────────────────────────────────────────────

function isValidHex(s: string | undefined): s is string {
  return !!s && /^#[0-9a-fA-F]{6}$/.test(s);
}

function withAlpha(hex: string, alpha: number): string {
  const cleaned = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return hex;
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `#${cleaned}${a}`;
}
