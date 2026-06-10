"use client";

/**
 * Folio · especialidades · quiropraxia · Tool del slot clínico (Fase B).
 *
 * Adaptador que envuelve el SpineMap manteniendo la UX pre-Fase B:
 *   - Estado inicial: el `value` (toolData del borrador) si parsea con el
 *     schema; sino la derivación acumulada del historial (deriveSpineState —
 *     misma lógica que usaba lib/db/paciente-ficha.ts para vertebrasEstado).
 *   - Edición local con click sobre vértebras (igual que TabPlan antes).
 *   - Cada cambio notifica `onChange` con el toolData completo
 *     `{ v: 1, vertebras: [...] }` listo para persistir cifrado.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { SpecialtyToolProps } from "@/lib/especialidades/types";
import {
  deriveSpineState,
  quiropraxiaToolDataSchema,
  type EstadoVertebra,
  type QuiropraxiaToolData,
} from "@/lib/especialidades/quiropraxia/schema";
import { SpineMap } from "@/lib/especialidades/quiropraxia/spine-map";

function statesFromToolData(toolData: QuiropraxiaToolData): Record<string, EstadoVertebra> {
  const states: Record<string, EstadoVertebra> = {};
  for (const v of toolData.vertebras) {
    if (v.estado !== "normal") states[v.id] = v.estado;
  }
  return states;
}

function toolDataFromStates(states: Record<string, EstadoVertebra>): QuiropraxiaToolData {
  return {
    v: 1,
    vertebras: Object.entries(states).map(([id, estado]) => ({ id, estado })),
  };
}

export function QuiropraxiaTool({ value, onChange, readOnly, historial }: SpecialtyToolProps) {
  const derived = useMemo(() => deriveSpineState(historial), [historial]);

  const [states, setStates] = useState<Record<string, EstadoVertebra>>(() => {
    const parsed = quiropraxiaToolDataSchema.safeParse(value);
    return parsed.success ? statesFromToolData(parsed.data) : derived.vertebrasEstado;
  });

  // Notificar el toolData nuevo al slot en cada edición (skip del mount: el
  // estado inicial no es un cambio del usuario).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    onChange(toolDataFromStates(states));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states]);

  const handleSetStates = (
    updater: (prev: Record<string, EstadoVertebra>) => Record<string, EstadoVertebra>,
  ) => {
    if (readOnly) return;
    setStates(updater);
  };

  return (
    <SpineMap states={states} setStates={handleSetStates} ultimoAjuste={derived.ultimoAjuste} />
  );
}
