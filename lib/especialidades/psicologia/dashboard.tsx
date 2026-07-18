"use client";

/**
 * Folio · especialidades · psicología · dashboard de outcomes (C8).
 *
 * Panel de RESULTADOS longitudinales del paciente para la Tool de psicología:
 *   1. Curva de escalas de salud mental en el tiempo — PHQ-9 / GAD-7 / DASS-21 /
 *      PCL-5 agregadas desde instrumento_respuesta (C2), graficadas con el
 *      <SerieEvolucion> genérico de C3. El snapshot de score viene EN CLARO del
 *      servidor (no descifra PHI); acá solo se pintan puntajes agregados + fechas.
 *   2. Estado de los objetivos terapéuticos — conteo por estado (en curso /
 *      logrados / pausados) de la última sesión del historial con objetivos.
 *
 * Fuentes de datos:
 *   - Las series de instrumento_respuesta se piden con listOutcomeSeriesAction
 *     (server action, org-scoped + RLS): la Tool no las recibe por props (el slot
 *     clínico solo pasa el historial del toolData). Se cargan al montar cuando hay
 *     pacienteId; sin pacienteId (preview de cuenta interna) el dashboard cae a la
 *     serie derivada del historial (PHQ-9/GAD-7 embebidos en las sesiones).
 *   - El estado de objetivos sale del historial del toolData (pura, sin fetch).
 *
 * Sin PHI en el cliente: solo puntajes agregados, bandas y conteos por enum.
 * Estilos: clases de folio.css (pc-card / fi-eyebrow / pc-legend-*) + tokens
 * brass/cream (sin hex off-theme, sin Tailwind).
 */

import { useEffect, useState } from "react";

import { listOutcomeSeriesAction, type OutcomeSeriePunto } from "@/app/(app)/pacientes/actions";
import { SerieEvolucion, type PuntoSerie } from "@/lib/instrumentos/components";
import type { ToolHistorialEntry } from "@/lib/especialidades/types";
import {
  deriveEstadoObjetivos,
  deriveOutcomeSeries,
  deriveScoreSeries,
  OUTCOME_METRICAS,
  type EstadoObjetivos,
} from "@/lib/especialidades/psicologia/schema";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MESES[m - 1]} ${String(y).slice(2)}`;
}

/** Serie del historial (PHQ-9/GAD-7 embebidos) adaptada al punto genérico. */
function serieDeHistorial(historial: ToolHistorialEntry[]): PuntoSerie[] {
  return deriveScoreSeries(historial).map((p) => ({
    fecha: p.fecha,
    valores: { phq9: p.phq9, gad7: p.gad7 },
  }));
}

// ─── Estado de objetivos ─────────────────────────────────────────────────────

const CONTEO_STYLE = {
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center" as const,
  gap: 2,
  flex: 1,
  padding: "10px 8px",
  borderRadius: "var(--r-sm)",
  background: "var(--surface-2)",
};

function ObjetivosResumen({ estado }: { estado: EstadoObjetivos }) {
  const celdas: Array<{ n: number; label: string; color: string }> = [
    { n: estado.enCurso, label: "En curso", color: "var(--slate)" },
    { n: estado.logrados, label: "Logrados", color: "var(--green)" },
    { n: estado.pausados, label: "Pausados", color: "var(--amber)" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {celdas.map((c) => (
          <div key={c.label} style={CONTEO_STYLE}>
            <b style={{ fontSize: 20, lineHeight: 1, color: c.color }}>{c.n}</b>
            <span className="muted" style={{ fontSize: 10.5 }}>
              {c.label}
            </span>
          </div>
        ))}
      </div>
      <span className="muted" style={{ fontSize: 10.5 }}>
        {estado.total} {estado.total === 1 ? "objetivo" : "objetivos"} · registrados en la
        sesión del {fmtFecha(estado.fecha)}
      </span>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface OutcomesDashboardProps {
  /** Historial de sesiones psico (toolData) — para objetivos + fallback de escalas. */
  historial: ToolHistorialEntry[];
  /** Id del paciente — habilita la carga de instrumento_respuesta. Sin él, fallback. */
  pacienteId?: string;
}

/**
 * Dashboard de outcomes de la Tool de psicología. Carga las series de
 * instrumento_respuesta cuando hay pacienteId; si no, cae a la serie derivada del
 * historial del toolData. El estado de objetivos siempre sale del historial.
 */
export function OutcomesDashboard({ historial, pacienteId }: OutcomesDashboardProps) {
  const [respuestas, setRespuestas] = useState<OutcomeSeriePunto[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pacienteId) {
      setRespuestas(null);
      return;
    }
    let vivo = true;
    setCargando(true);
    setError(null);
    listOutcomeSeriesAction(pacienteId).then((result) => {
      if (!vivo) return;
      setCargando(false);
      if (result.ok) setRespuestas(result.data);
      else setError(result.error.message);
    });
    return () => {
      vivo = false;
    };
  }, [pacienteId]);

  // Serie de instrumento_respuesta si se cargó; si no, fallback al historial
  // (PHQ-9/GAD-7 embebidos en las sesiones — solo esas dos métricas tendrán dato).
  const serie: PuntoSerie[] =
    respuestas !== null ? deriveOutcomeSeries(respuestas) : serieDeHistorial(historial);

  const estadoObjetivos = deriveEstadoObjetivos(historial);

  return (
    <section className="pc-card" style={{ minWidth: 0 }}>
      <header className="pc-card-head">
        <span className="fi-eyebrow">Evolución de resultados</span>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
          Puntajes de escalas de tamizaje a lo largo del tratamiento. Orientativo,
          no diagnóstico.
        </span>
        {error ? (
          <p role="alert" style={{ margin: 0, fontSize: 11.5, color: "var(--red)" }}>
            No se pudo cargar la serie de escalas: {error}. Se muestran las escalas
            registradas en las sesiones.
          </p>
        ) : null}
        <SerieEvolucion
          serie={serie}
          metricas={OUTCOME_METRICAS}
          pisoCero
          ariaLabel={`Evolución de escalas de salud mental en ${serie.length} ${serie.length === 1 ? "registro" : "registros"}`}
          vacio={
            cargando
              ? "Cargando la evolución de las escalas…"
              : "Sin escalas registradas todavía. La curva aparece al aplicar PHQ-9, GAD-7, DASS-21 o PCL-5."
          }
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="fi-eyebrow">Objetivos terapéuticos</span>
        {estadoObjetivos ? (
          <ObjetivosResumen estado={estadoObjetivos} />
        ) : (
          <p className="pc-card-text muted" style={{ fontSize: 12.5 }}>
            Sin objetivos registrados todavía. El estado de los objetivos aparece
            acá al guardarlos en una sesión.
          </p>
        )}
      </div>
    </section>
  );
}
