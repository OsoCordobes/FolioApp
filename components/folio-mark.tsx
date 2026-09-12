/**
 * Folio · Hoja clara
 *
 * Una hoja y una F de trazos abiertos, legibles desde 16 px. El pliegue
 * conserva la referencia a la historia clínica sin capas superpuestas.
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
  fg,
  foldShade,
}: FolioMarkProps) {
  const c = color ?? "var(--accent)";
  const foreground = fg ?? (color ? "#FFFFFF" : "var(--on-accent, #FFFFFF)");
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Folio">
      <path d="M12 4H29L42 17V36Q42 44 34 44H12Q5 44 5 37V11Q5 4 12 4Z" fill={c} />
      <path d="M29 4V12Q29 17 34 17H42Z" fill={foldShade ?? foreground} opacity={foldShade ? 1 : .25} />
      <path d="M14 15H28V21H20V26H27V32H20V38H14Z" fill={foreground} />
    </svg>
  );
}
