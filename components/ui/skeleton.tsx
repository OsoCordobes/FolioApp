/**
 * Folio · Skeleton primitive (PR X6).
 *
 * Bloque de carga genérico con shimmer sutil sobre `--surface-*`. Se usa en
 * los `loading.tsx` (Suspense) de /hoy, /finanzas y /pacientes para dar
 * feedback inmediato mientras el Server Component resuelve datos.
 *
 * Las reglas visuales (`.fi-skeleton`, shimmer, respeto a
 * prefers-reduced-motion) viven en `public/folio.css`. Este componente solo
 * compone la estructura — no introduce estilos inline off-theme.
 *
 * Es puramente presentacional: `aria-hidden` + `role="presentation"` para que
 * el shimmer no ensucie el árbol de accesibilidad; el usuario de lector de
 * pantalla no anuncia "cargando…" desde acá (Next ya maneja el estado de
 * navegación). No renderiza PHI ni texto real.
 */

import type { CSSProperties } from "react";

type SkeletonProps = {
  /** Ancho CSS (p.ej. "60%", "8rem", 120). Default: 100%. */
  width?: string | number;
  /** Alto CSS (p.ej. "1rem", 14). Default: token de línea de texto. */
  height?: string | number;
  /** Radio de borde: bloque redondeado (default) o círculo (avatar). */
  variant?: "block" | "text" | "circle";
  className?: string;
  style?: CSSProperties;
};

export function Skeleton({
  width,
  height,
  variant = "block",
  className,
  style,
}: SkeletonProps) {
  const cls = ["fi-skeleton", `fi-skeleton-${variant}`, className]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={cls}
      aria-hidden="true"
      role="presentation"
      style={{
        ...(width != null ? { width: typeof width === "number" ? `${width}px` : width } : null),
        ...(height != null ? { height: typeof height === "number" ? `${height}px` : height } : null),
        ...style,
      }}
    />
  );
}

/**
 * Contenedor de una pantalla en carga. Marca la región como `busy` para
 * lectores de pantalla sin anunciar cada bloque individual, y evita el
 * doble-anuncio: los `Skeleton` hijos son `aria-hidden`.
 */
export function SkeletonScreen({
  children,
  label = "Cargando",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <div className="fi-content" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}
