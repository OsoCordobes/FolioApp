/**
 * Folio · brand mark (stack + F)
 *
 * Logo "stack of papers + F" — la marca oficial. Inline SVG porque el
 * sidebar tiene que resolverse sin depender del archivo de brand exploration.
 * Port directo del prototipo (sidebar.jsx · FolioMark).
 *
 * La hoja y la F son trazados independientes de fuentes y de IDs de React.
 * Así la marca mantiene su geometría en servidor, navegador e impresión.
 */

interface FolioMarkProps {
  size?: number;
  color?: string;
  fg?: string;
  foldShade?: string;
}

export function FolioMark({
  size = 28,
  color,
  fg = "#FFFFFF",
  foldShade,
}: FolioMarkProps) {
  const c = color ?? "var(--accent)";
  const fs = foldShade ?? "var(--accent-2)";
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Folio">
      <rect x="24" y="8" width="70" height="74" rx="8" fill={c} opacity="0.26" />
      <rect x="15" y="15" width="70" height="74" rx="8" fill={c} opacity="0.50" />
      <path d="M14 22H64L84 42V88Q84 96 76 96H14Q6 96 6 88V30Q6 22 14 22Z" fill={c} />
      <path d="M 64 22 L 84 42 L 64 42 Z" fill={fs} />
      <path d="M28 38H59V48H39V58H56V68H39V80H28Z" fill={fg} />
    </svg>
  );
}
