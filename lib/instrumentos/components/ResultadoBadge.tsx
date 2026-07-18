"use client";

/**
 * Folio · biblioteca de instrumentos · ResultadoBadge (C3).
 *
 * Chip de resultado de un instrumento — mismo look que el CHIP_BANDA de
 * psicología/cardiología (`.fi-pill` + tokens de estado brass/cream), pero
 * GENÉRICO: sirve para cualquier InstrumentoDef porque colorea por el TONO de
 * la banda (toneDeBanda), no por un enum de un instrumento puntual.
 *
 * Muestra `{total} · {etiqueta}` (o solo la etiqueta si no hay total, p. ej.
 * cuando se pasa una banda sin puntaje). El title lleva la aclaración de que es
 * tamizaje orientativo, nunca diagnóstico.
 *
 * Sin hex nuevo: los cuatro tonos usan los tokens de estado existentes
 * (--green / --slate / --amber / --red y sus *-soft).
 */

import type { CSSProperties } from "react";

import type { InstrumentoDef } from "../types";
import {
  etiquetaDeBanda,
  toneDeBanda,
  type ToneBanda,
} from "./planilla-core";

/** Estilo del chip por tono — solo tokens de estado de folio.css. */
const ESTILO_TONO: Record<ToneBanda, CSSProperties> = {
  good: { color: "var(--green)", background: "var(--green-soft)", borderColor: "transparent" },
  neutral: { color: "var(--slate)", background: "var(--slate-soft)", borderColor: "transparent" },
  warn: { color: "var(--amber)", background: "var(--amber-soft)", borderColor: "transparent" },
  bad: { color: "var(--red)", background: "var(--red-soft)", borderColor: "transparent" },
};

export interface ResultadoBadgeProps {
  /** Id de la banda de severidad (ej. "moderada", "alto", "sin_riesgo"). */
  banda: string;
  /**
   * Def del instrumento — aporta la etiqueta es-AR y desempata el tono por
   * posición para bandas fuera de las palabras-clave conocidas. Opcional: sin
   * def, la etiqueta cae al `label` explícito (o al id) y el tono al keyword.
   */
  def?: InstrumentoDef;
  /** Puntaje total; si se omite, el chip muestra solo la etiqueta. */
  total?: number | null;
  /** Etiqueta a mostrar; default = la del catálogo (etiquetaDeBanda). */
  label?: string;
  /** Tooltip extra (se antepone a la aclaración de tamizaje). */
  title?: string;
}

/**
 * Chip de banda de un resultado de instrumento. Reusa `.fi-pill` (mismo markup
 * que los chips de las tools de especialidad) y colorea por tono derivado de la
 * banda. No renderiza nada sensible: solo enum de banda + puntaje agregado.
 */
export function ResultadoBadge({
  banda,
  def,
  total,
  label,
  title,
}: ResultadoBadgeProps) {
  const tono = toneDeBanda(banda, def);
  const etiqueta = label ?? etiquetaDeBanda(banda, def);
  const texto =
    total != null ? `${total} · ${etiqueta}` : etiqueta;
  const tip =
    (title ? `${title} — ` : "") +
    "Tamizaje orientativo, no diagnóstico.";

  return (
    <span className="fi-pill" style={ESTILO_TONO[tono]} title={tip}>
      {texto}
    </span>
  );
}
