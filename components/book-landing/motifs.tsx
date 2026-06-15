/**
 * Folio · motivos gráficos por especialidad para la landing /book/[slug].
 *
 * SVG inline decorativo (aria-hidden). stroke = currentColor → el contenedor
 * setea color: var(--accent) y el motivo se tiñe con el acento del consultorio.
 * "none" no renderiza nada (orgs sin especialidad conocida).
 */

import type { BookLandingMotif } from "@/lib/book-landing/content";

export function Motif({
  motif,
  size = 18,
  className,
}: {
  motif: BookLandingMotif;
  size?: number;
  className?: string;
}) {
  if (motif === "none") return null;

  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };

  if (motif === "heart") {
    // Trazo de pulso / ECG.
    return (
      <svg {...common}>
        <path d="M2 12h4l2-5 3 11 3-9 2 3h6" />
      </svg>
    );
  }

  if (motif === "mind") {
    // Cabeza de perfil con una espiral interior (psicología).
    return (
      <svg {...common}>
        <path d="M16 4.5A6 6 0 0 0 5 8c0 1.3-.7 2-1.4 2.8-.5.5-.3 1.3.4 1.6l1 .4v2.7a2 2 0 0 0 2 2h1.2V21" />
        <path d="M9.2 9.4a2.4 2.4 0 0 1 4.6.9c0 1.6-1.8 2-1.8 3.4" />
      </svg>
    );
  }

  // spine — columna estilizada.
  return (
    <svg {...common}>
      <path d="M12 3v18" />
      <path d="M9 6.5h6M8.5 10.5h7M8.5 14h7M9 17.5h6" />
    </svg>
  );
}
