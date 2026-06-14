/**
 * Folio · especialidades · quiropraxia · constantes del SpineMap.
 *
 * Estas son configuración visual (posiciones SVG de 24 vértebras + paleta
 * de estados clínicos). NO es data del paciente — vive con el component.
 * (Movido de components/paciente/spine-config.ts en Fase B.)
 */

import type { EstadoVertebra } from "@/lib/especialidades/quiropraxia/schema";

export interface SpineVertebra {
  id: string;
  region: "cervical" | "dorsal" | "lumbar";
  x: number;
  y: number;
  w: number;
  h: number;
  tilt: number;
}

export const ESTADO_VERT: Record<EstadoVertebra, { lbl: string; color: string; ring: string }> = {
  normal:   { lbl: "Normal",         color: "var(--ink-4)", ring: "var(--line)" },
  leve:     { lbl: "Dolor leve",     color: "var(--amber)", ring: "var(--amber)" },
  moderado: { lbl: "Dolor moderado", color: "#8C5A14",      ring: "#8C5A14" },
  severo:   { lbl: "Dolor severo",   color: "var(--red)",   ring: "var(--red)" },
  ajustada: { lbl: "Ajustada",       color: "var(--green)", ring: "var(--green)" },
};

export const SPINE_VERTEBRAS: SpineVertebra[] = [
  { id: "C1", region: "cervical", x: 122, y:  60, w: 26, h: 8,  tilt: -4 },
  { id: "C2", region: "cervical", x: 128, y:  78, w: 28, h: 8,  tilt: -2 },
  { id: "C3", region: "cervical", x: 132, y:  96, w: 30, h: 8,  tilt:  0 },
  { id: "C4", region: "cervical", x: 134, y: 114, w: 30, h: 8,  tilt:  2 },
  { id: "C5", region: "cervical", x: 132, y: 132, w: 30, h: 9,  tilt:  3 },
  { id: "C6", region: "cervical", x: 128, y: 150, w: 32, h: 9,  tilt:  4 },
  { id: "C7", region: "cervical", x: 122, y: 170, w: 34, h: 10, tilt:  5 },
  { id: "T1",  region: "dorsal", x: 114, y: 195, w: 38, h: 11, tilt:  4 },
  { id: "T2",  region: "dorsal", x: 106, y: 220, w: 40, h: 11, tilt:  3 },
  { id: "T3",  region: "dorsal", x:  98, y: 246, w: 42, h: 12, tilt:  2 },
  { id: "T4",  region: "dorsal", x:  92, y: 273, w: 44, h: 12, tilt:  0 },
  { id: "T5",  region: "dorsal", x:  88, y: 300, w: 44, h: 13, tilt: -1 },
  { id: "T6",  region: "dorsal", x:  88, y: 327, w: 46, h: 13, tilt: -2 },
  { id: "T7",  region: "dorsal", x:  92, y: 354, w: 46, h: 14, tilt: -3 },
  { id: "T8",  region: "dorsal", x:  98, y: 380, w: 48, h: 14, tilt: -3 },
  { id: "T9",  region: "dorsal", x: 106, y: 405, w: 50, h: 14, tilt: -3 },
  { id: "T10", region: "dorsal", x: 114, y: 430, w: 52, h: 15, tilt: -3 },
  { id: "T11", region: "dorsal", x: 122, y: 454, w: 54, h: 15, tilt: -2 },
  { id: "T12", region: "dorsal", x: 130, y: 478, w: 56, h: 16, tilt: -1 },
  { id: "L1", region: "lumbar",  x: 138, y: 502, w: 60, h: 17, tilt:  0 },
  { id: "L2", region: "lumbar",  x: 144, y: 524, w: 62, h: 18, tilt:  2 },
  { id: "L3", region: "lumbar",  x: 146, y: 546, w: 64, h: 18, tilt:  3 },
  { id: "L4", region: "lumbar",  x: 142, y: 568, w: 64, h: 19, tilt:  4 },
  { id: "L5", region: "lumbar",  x: 134, y: 588, w: 62, h: 19, tilt:  5 },
];

// ─── Vista posterior (Workstream 6) ──────────────────────────────────────────
//
// Columna vertical centrada y simétrica (NO la curva lateral): la hoja de
// trabajo quiropráctica clásica con las etiquetas al costado de una columna de
// celdas. 27 entradas top→bottom: C0 (occipucio), C1..C7, T1..T12, L1..L5,
// S (sacro), P (cóccix/pelvis). Mismo tipo SpineVertebra que la lateral; `tilt`
// queda en 0 (columna recta) y `x` es constante (centrada).

export interface PosteriorVertebra {
  id: string;
  region: "cervical" | "dorsal" | "lumbar" | "sacro";
  /** Etiqueta humana al costado (ej. "Occipucio", "Sacro", "Cóccix"). */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Generación determinística de la columna centrada. viewBox 220×620 (igual que
// la lateral) para que ambos SVG compartan dimensiones y el toggle no salte.
const POSTERIOR_X = 110;          // centro horizontal del viewBox 220
const POSTERIOR_TOP = 40;         // y de la primera celda (C0)
const POSTERIOR_STEP = 21;        // separación vertical entre celdas
const POSTERIOR_W = 46;           // ancho de cada celda
const POSTERIOR_H = 14;           // alto de cada celda

const POSTERIOR_DEFS: Array<{ id: string; region: PosteriorVertebra["region"]; label: string }> = [
  { id: "C0", region: "cervical", label: "Occipucio" },
  ...Array.from({ length: 7 }, (_, i) => ({
    id: `C${i + 1}`,
    region: "cervical" as const,
    label: `C${i + 1}`,
  })),
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `T${i + 1}`,
    region: "dorsal" as const,
    label: `T${i + 1}`,
  })),
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `L${i + 1}`,
    region: "lumbar" as const,
    label: `L${i + 1}`,
  })),
  { id: "S", region: "sacro", label: "Sacro" },
  { id: "P", region: "sacro", label: "Cóccix" },
];

export const POSTERIOR_VERTEBRAS: PosteriorVertebra[] = POSTERIOR_DEFS.map((d, i) => ({
  id: d.id,
  region: d.region,
  label: d.label,
  x: POSTERIOR_X,
  y: POSTERIOR_TOP + i * POSTERIOR_STEP,
  w: POSTERIOR_W,
  h: POSTERIOR_H,
}));

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function fmtFecha(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}
