/**
 * Folio · tokens de diseño para PDFs server-side (@react-pdf/renderer).
 *
 * Espeja los tokens brass/cream de `public/folio.css` (`:root`, tema claro) en
 * valores concretos que react-pdf entiende (no soporta `var(--…)` ni CSS
 * cascade: cada StyleSheet necesita hex/px literales). Un PDF impreso vive
 * siempre sobre papel claro, así que se toma SIEMPRE la paleta light — nunca la
 * variante `[data-theme="dark"]`.
 *
 * COMPARTIDO: este módulo es la fuente única de estilo para todos los documentos
 * PDF de Folio. C10 (export de ficha/sesión) lo crea; R3 (PDF de receta) lo
 * consume tal cual — así ficha y receta comparten membrete, tipografía y
 * paleta sin divergir. Agregá tokens nuevos de forma ADITIVA (no cambies los
 * valores existentes: romperían el look de la receta).
 *
 * Puro: sin React, sin DB, sin PHI. Sólo constantes. `Font.register` de fuentes
 * embebidas (si alguna vez se agregan) va en el documento, no acá — este módulo
 * queda importable desde tests sin tocar el filesystem.
 */

/**
 * Paleta brass/cream (tema claro de folio.css). Los nombres espejan los tokens
 * CSS para que el mapeo sea obvio (`ink` = `--ink`, `accent` = `--accent`, …).
 */
export const PDF_COLORS = {
  /** --surface (#FBF9F4): fondo de la página (papel crema). */
  surface: "#FBF9F4",
  /** --surface-2 (#EDE7D8): fondo de bloques/bandas suaves. */
  surface2: "#EDE7D8",
  /** --surface-3 (#E5DCBE): fondo de chips/acentos suaves. */
  surface3: "#E5DCBE",
  /** --line (#DDD5C0): borde/regla divisoria. */
  line: "#DDD5C0",
  /** --line-soft (#E8E2D1): regla divisoria más tenue. */
  lineSoft: "#E8E2D1",
  /** --ink (#1B1812): texto principal. */
  ink: "#1B1812",
  /** --ink-2 (#44402F): texto secundario. */
  ink2: "#44402F",
  /** --ink-3 (#79735F): texto terciario / labels. */
  ink3: "#79735F",
  /** --ink-4 (#A39C84): texto muy tenue / watermark. */
  ink4: "#A39C84",
  /** --accent (#8A6722): brass, títulos y membrete. */
  accent: "#8A6722",
  /** --accent-2 (#6E5119): brass oscuro. */
  accent2: "#6E5119",
  /** --accent-soft (#F0E6CC): fondo de bandas de acento. */
  accentSoft: "#F0E6CC",
  /** Blanco puro para tarjetas sobre el crema (contraste sutil). */
  paper: "#FFFFFF",
} as const;

/**
 * Escala de espaciado (px), espejo de `--space-*` de folio.css. react-pdf usa
 * puntos, pero 1pt ≈ 1px a la resolución por defecto de A4 — se usan los mismos
 * números para que el ritmo vertical coincida con la UI.
 */
export const PDF_SPACE = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s5: 20,
  s6: 24,
  s8: 32,
} as const;

/**
 * Radios de esquina (px), espejo de `--r-*`. react-pdf soporta `borderRadius`.
 */
export const PDF_RADIUS = {
  sm: 5,
  md: 8,
  lg: 12,
  xl: 16,
} as const;

/**
 * Tamaños de fuente (pt) para la jerarquía tipográfica del documento. Escala
 * conservadora, legible impresa en A4. La familia es la Helvetica embebida en
 * el core de PDF (react-pdf la trae sin `Font.register`) — no depende de
 * fuentes del sistema ni de assets externos (CSP-safe en Vercel).
 */
export const PDF_TYPE = {
  /** Familia base — Helvetica está siempre disponible en react-pdf. */
  family: "Helvetica" as const,
  familyBold: "Helvetica-Bold" as const,
  /** Título del documento (nombre del paciente). */
  h1: 18,
  /** Subtítulo / nombre de sección. */
  h2: 12,
  /** Encabezado de campo (label). */
  label: 8,
  /** Cuerpo de texto. */
  body: 10,
  /** Metadata / pie de página. */
  small: 8,
  /** Watermark diagonal. */
  watermark: 56,
} as const;

/** Márgenes de página A4 (pt). Deja aire para el membrete y el pie. */
export const PDF_PAGE = {
  paddingTop: 40,
  paddingBottom: 48,
  paddingHorizontal: 44,
} as const;
