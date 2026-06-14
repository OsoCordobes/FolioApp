"use client";

/**
 * Folio · especialidades · quiropraxia · Tool del slot clínico (v2, Workstream 6).
 *
 * Orquestador de la ficha quiropráctica reestructurada. Estado:
 *   - `selectedVisit`: null = borrador editable de la visita actual; un índice
 *     del historial = snapshot read-only de esa sesión.
 *
 * Parseo: `value` (toolData del borrador) → un draft v2 vía
 * parseQuiropraxiaToolData (migra v1 si hace falta). Cada edición notifica
 * `onChange` con el toolData v2 completo, listo para cifrar.
 *
 * CARRY-FORWARD (gate preciso): se siembra el borrador editable desde la última
 * visita (historial[0].toolData migrado a v2) SOLO cuando TODO se cumple:
 *   1. value vacío/null Y turno && !turno.tieneSesionGuardada (turno
 *      GENUINAMENTE fresco — no un vaciado deliberado / cross-tool / decrypt
 *      fallido sobre una sesión ya guardada),
 *   2. historial[0] existe.
 * El draft sembrado se emite UNA vez vía onChange para que "Guardar sesión" lo
 * persista.
 *
 * Snapshot: con selectedVisit != null se rinde TODA la superficie read-only
 * desde ese toolData (migrado si es v1) + un banner "viendo visita del {fecha}"
 * y "Volver". Las radiografías del snapshot se filtran a fecha <= fecha del
 * snapshot, read-only. El prop `readOnly` entrante (caso sin turno, W2) también
 * se respeta.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { SpecialtyToolProps } from "@/lib/especialidades/types";
import {
  migrateV1ToV2,
  parseQuiropraxiaToolData,
  quiropraxiaToolDataV2Schema,
  type QuiropraxiaToolDataV2,
} from "@/lib/especialidades/quiropraxia/schema";
import { EvaluacionInicial } from "@/lib/especialidades/quiropraxia/evaluacion-inicial";
import { SpineMap } from "@/lib/especialidades/quiropraxia/spine-map";
import { VisitControl } from "@/lib/especialidades/quiropraxia/visit-control";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtFecha(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

const DRAFT_VACIO: QuiropraxiaToolDataV2 = { v: 2, vista: "posterior" };

/** Normaliza cualquier toolData persistido a un draft v2 editable. */
function toV2(value: unknown): QuiropraxiaToolDataV2 {
  const parsed = parseQuiropraxiaToolData(value);
  if (parsed.kind === "v2") return parsed.data;
  if (parsed.kind === "v1") return migrateV1ToV2(parsed.data);
  return { ...DRAFT_VACIO };
}

export function QuiropraxiaTool({
  value,
  onChange,
  readOnly,
  historial,
  pacienteId,
  turno,
  radiografias,
}: SpecialtyToolProps) {
  // Draft v2 derivado del value (migra v1). Es la fuente de verdad de la edición.
  const draft = useMemo<QuiropraxiaToolDataV2>(() => toV2(value), [value]);

  const [selectedVisit, setSelectedVisit] = useState<number | null>(null);

  // CARRY-FORWARD: una sola vez, en un turno genuinamente fresco, sembrar el
  // borrador con la última visita migrada a v2 y emitirlo para que se persista.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    const valueVacio =
      value == null || (typeof value === "object" && Object.keys(value as object).length === 0);
    const turnoFresco = !!turno && !turno.tieneSesionGuardada;
    const ultima = historial[0];
    if (valueVacio && turnoFresco && ultima) {
      const sembrado = migrateV1ToV2(ultima.toolData);
      // Solo emitir si aporta algo (vértebras de la visita anterior). Un draft
      // vacío sembrado no agrega valor y dispararía un onChange inútil.
      const aportaAlgo = (sembrado.vertebras?.length ?? 0) > 0;
      if (aportaAlgo) {
        seeded.current = true;
        onChange(sembrado);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, turno, historial]);

  // Snapshot: toolData de la visita seleccionada, migrado a v2 + read-only.
  const snapshot = selectedVisit != null ? historial[selectedVisit] : null;
  const snapshotData = useMemo<QuiropraxiaToolDataV2 | null>(
    () => (snapshot ? toV2(snapshot.toolData) : null),
    [snapshot],
  );

  // En snapshot todo es read-only; sin turno (W2) también.
  const verData = snapshotData ?? draft;
  const verReadOnly = readOnly || snapshot != null;

  const handleChange = (next: QuiropraxiaToolDataV2) => {
    if (verReadOnly) return;
    // Re-validar contra el schema mantiene el shape limpio (default vista, etc.)
    // antes de emitir; un parse fallido (no debería) cae al next crudo.
    const parsed = quiropraxiaToolDataV2Schema.safeParse(next);
    onChange(parsed.success ? parsed.data : next);
  };

  // Radiografías visibles: en snapshot solo las <= fecha del snapshot (read-only).
  const radiosVisibles = useMemo(() => {
    if (snapshot == null) return radiografias ?? [];
    const corte = snapshot.fecha;
    return (radiografias ?? []).filter((r) => r.fecha <= corte);
  }, [snapshot, radiografias]);

  return (
    <div className="pc-quiro-tool">
      {snapshot ? (
        <div className="pc-quiro-snapshot-banner" role="status">
          <span>Viendo visita del {fmtFecha(snapshot.fecha)} · solo lectura</span>
          <button
            type="button"
            className="pc-quiro-pill"
            onClick={() => setSelectedVisit(null)}
          >
            Volver a la visita actual
          </button>
        </div>
      ) : null}

      <SpineMap data={verData} onChange={handleChange} readOnly={verReadOnly} />

      <EvaluacionInicial
        data={verData}
        onChange={handleChange}
        readOnly={verReadOnly}
        pacienteId={pacienteId}
        turno={snapshot ? null : turno}
        radiografias={radiosVisibles}
      />

      <VisitControl
        historial={historial}
        selectedIndex={selectedVisit}
        onSelect={setSelectedVisit}
      />
    </div>
  );
}
