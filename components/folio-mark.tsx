/**
 * Folio · brand mark (stack + F)
 *
 * Logo "stack of papers + F" — la marca oficial. Inline SVG porque el
 * sidebar tiene que resolverse sin depender del archivo de brand exploration.
 * Port directo del prototipo (sidebar.jsx · FolioMark).
 *
 * El id del clipPath usa useId() (SSR-safe, soportado en server components
 * en React 19): dos marks del mismo `size` en la misma página ya no
 * colisionan ids. role="img" + aria-label: el SVG se anuncia como imagen.
 */

import { useId } from "react";

interface FolioMarkProps {
  size?: number;
  color?: string;
  fg?: string;
  foldShade?: string;
}

export function FolioMark({
  size = 28,
  color,
  fg = "#FBF9F4",
  foldShade,
}: FolioMarkProps) {
  const c = color ?? "var(--accent)";
  const fs = foldShade ?? "var(--accent-2)";
  const cid = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Folio">
      <defs>
        <clipPath id={cid}>
          <path d="M 6 22 L 64 22 L 84 42 L 84 96 L 6 96 Z" />
        </clipPath>
      </defs>
      <rect x="24" y="8" width="70" height="74" rx="8" fill={c} opacity="0.26" />
      <rect x="15" y="15" width="70" height="74" rx="8" fill={c} opacity="0.50" />
      <rect x="6" y="22" width="78" height="74" rx="8" fill={c} clipPath={`url(#${cid})`} />
      <path d="M 64 22 L 84 42 L 64 42 Z" fill={fs} />
      <text
        x="42"
        y="77"
        textAnchor="middle"
        fontFamily="Geist, sans-serif"
        fontWeight="700"
        fontSize="54"
        letterSpacing="-2.5"
        fill={fg}
      >
        F
      </text>
    </svg>
  );
}
