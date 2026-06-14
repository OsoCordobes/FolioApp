"use client";

/**
 * Folio · especialidades · quiropraxia · evaluación inicial (Workstream 6).
 *
 * Reemplaza el título SOAP para quiropraxia (eyebrow "Evaluación inicial").
 * Secciones apiladas, todas atadas al borrador v2 y readOnly-aware:
 *   - Postura (PosturaCanvas + su nota)
 *   - Palpación estática (textarea)
 *   - Palpación dinámica (textarea)
 *   - Leg check (LegCheck)
 *   - Técnica de ajuste (textarea)
 *   - Termografía (textarea)
 *   - Radiografías (Radiografias)
 *   - Notas libres (textarea)
 *
 * Controlado: deriva todo de `data` y emite cada edición con onChange(next).
 */

import type { QuiropraxiaToolDataV2 } from "@/lib/especialidades/quiropraxia/schema";
import { LegCheck } from "@/lib/especialidades/quiropraxia/leg-check";
import { PosturaCanvas } from "@/lib/especialidades/quiropraxia/postura-canvas";
import { Radiografias } from "@/lib/especialidades/quiropraxia/radiografias";

interface EvaluacionInicialProps {
  data: QuiropraxiaToolDataV2;
  onChange: (next: QuiropraxiaToolDataV2) => void;
  readOnly?: boolean;
  // Para la galería de radiografías (la Tool las pasa desde el slot).
  pacienteId?: string;
  turno?: { id: string; tieneSesionGuardada: boolean } | null;
  radiografias?: ReadonlyArray<{
    id: string;
    fecha: string;
    descripcion: string | null;
    signedUrl: string;
    sesionId: string | null;
  }>;
}

export function EvaluacionInicial({
  data,
  onChange,
  readOnly,
  pacienteId,
  turno,
  radiografias,
}: EvaluacionInicialProps) {
  const setCampo = (patch: Partial<QuiropraxiaToolDataV2>) => {
    if (readOnly) return;
    onChange({ ...data, ...patch });
  };

  return (
    <div className="pc-quiro-eval">
      <header className="pc-quiro-eval-head">
        <span className="fi-eyebrow">Evaluación inicial</span>
      </header>

      <section className="pc-quiro-eval-section">
        <span className="pc-quiro-eval-label">Postura</span>
        <PosturaCanvas
          value={data.postura}
          onChange={(postura) => setCampo({ postura })}
          readOnly={readOnly}
        />
      </section>

      <section className="pc-quiro-eval-section">
        <label className="fi-wi-field">
          <span>Palpación estática</span>
          <textarea
            className="pc-soap-textarea"
            rows={3}
            maxLength={2000}
            value={data.palpacionEstatica ?? ""}
            onChange={(e) => setCampo({ palpacionEstatica: e.target.value })}
            readOnly={readOnly}
          />
        </label>
      </section>

      <section className="pc-quiro-eval-section">
        <label className="fi-wi-field">
          <span>Palpación dinámica</span>
          <textarea
            className="pc-soap-textarea"
            rows={3}
            maxLength={2000}
            value={data.palpacionDinamica ?? ""}
            onChange={(e) => setCampo({ palpacionDinamica: e.target.value })}
            readOnly={readOnly}
          />
        </label>
      </section>

      <section className="pc-quiro-eval-section">
        <span className="pc-quiro-eval-label">Leg check</span>
        <LegCheck
          value={data.legCheck}
          onChange={(legCheck) => setCampo({ legCheck })}
          readOnly={readOnly}
        />
      </section>

      <section className="pc-quiro-eval-section">
        <label className="fi-wi-field">
          <span>Técnica de ajuste</span>
          <textarea
            className="pc-soap-textarea"
            rows={3}
            maxLength={2000}
            value={data.tecnicaAjuste ?? ""}
            onChange={(e) => setCampo({ tecnicaAjuste: e.target.value })}
            readOnly={readOnly}
          />
        </label>
      </section>

      <section className="pc-quiro-eval-section">
        <label className="fi-wi-field">
          <span>Termografía</span>
          <textarea
            className="pc-soap-textarea"
            rows={3}
            maxLength={2000}
            value={data.termografia ?? ""}
            onChange={(e) => setCampo({ termografia: e.target.value })}
            readOnly={readOnly}
          />
        </label>
      </section>

      <section className="pc-quiro-eval-section">
        <Radiografias
          pacienteId={pacienteId}
          turno={turno}
          radiografias={radiografias}
          readOnly={readOnly}
        />
      </section>

      <section className="pc-quiro-eval-section">
        <label className="fi-wi-field">
          <span>Notas libres</span>
          <textarea
            className="pc-soap-textarea"
            rows={4}
            maxLength={5000}
            value={data.notasLibres ?? ""}
            onChange={(e) => setCampo({ notasLibres: e.target.value })}
            readOnly={readOnly}
          />
        </label>
      </section>
    </div>
  );
}
