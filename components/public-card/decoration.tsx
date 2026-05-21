/**
 * Folio · PublicCard decoration primitives.
 *
 * Three pure-CSS-class-driven SVG/HTML primitives consumed by the 4 mood
 * overrides (Cálido → BrassCornerMark, Clínico/Editorial → EditorialRule,
 * Boutique → DateBadge). Color governed by `--fpc-decoration-color` on
 * the card root; size and tracking by their .fpc-* class in folio.css.
 *
 * No props beyond the date-badge label. Styling is intentionally NOT
 * configurable per-instance — the mood system owns the appearance.
 */

export function EditorialRule() {
  return <span className="fpc-rule" aria-hidden />;
}

export function BrassCornerMark() {
  return (
    <svg
      className="fpc-corner-mark"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M 18 0 L 18 7 M 18 0 L 11 0"
        stroke="var(--fpc-decoration-color)"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DateBadge({ label }: { label: string }) {
  return (
    <span className="fpc-date-badge" aria-label={`Marca de origen: ${label}`}>
      {label}
    </span>
  );
}
