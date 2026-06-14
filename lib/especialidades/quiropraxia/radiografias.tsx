"use client";

/**
 * Folio · especialidades · quiropraxia · galería de radiografías (Workstream 6).
 *
 * Galería con fecha de las radiografías del paciente (documento_clinico tipo
 * RADIOGRAFIA): thumbnail vía signed URL para imágenes, chip de archivo para
 * pdf/dicom, + la descripción (nota) de cada una. Un botón "Subir radiografía"
 * (file input + nota opcional) arma un FormData y llama uploadRadiografiaAction,
 * después router.refresh().
 *
 * El botón de subida queda DESHABILITADO con un hint cuando todavía no hay
 * sesión guardada para el turno (las radiografías cuelgan de una sesión).
 * readOnly oculta la subida (snapshot / versión pasada). Los signed URLs
 * expiran a los 5 min: si un thumbnail rompe, se refresca lazy vía
 * refreshRadiografiaUrlAction.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import * as I from "@/components/icons";
import {
  refreshRadiografiaUrlAction,
  uploadRadiografiaAction,
} from "@/app/(app)/pacientes/actions";

interface RadiografiaItem {
  id: string;
  fecha: string;
  descripcion: string | null;
  signedUrl: string;
  sesionId: string | null;
}

interface RadiografiasProps {
  pacienteId?: string;
  turno?: { id: string; tieneSesionGuardada: boolean } | null;
  radiografias?: ReadonlyArray<RadiografiaItem>;
  readOnly?: boolean;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtFecha(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

function esImagen(url: string): boolean {
  // El signed URL lleva el path con extensión; un check barato alcanza para
  // decidir thumbnail vs chip de archivo.
  return /\.(png|jpe?g|webp|heic|tiff?)(\?|$)/i.test(url);
}

export function Radiografias({ pacienteId, turno, radiografias, readOnly }: RadiografiasProps) {
  const router = useRouter();
  const items = radiografias ?? [];
  const [file, setFile] = useState<File | null>(null);
  const [nota, setNota] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // signed URLs refrescados lazy (override del valor del server al expirar).
  const [refreshed, setRefreshed] = useState<Record<string, string>>({});

  const puedeSubir = !readOnly && !!pacienteId && !!turno && turno.tieneSesionGuardada;
  const hintSinSesion = !readOnly && !!turno && !turno.tieneSesionGuardada;

  const handleUpload = async () => {
    if (!puedeSubir || !file || !pacienteId || !turno || subiendo) return;
    setSubiendo(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("pacienteId", pacienteId);
    fd.set("turnoId", turno.id);
    if (nota.trim() !== "") fd.set("descripcion", nota.trim());
    const result = await uploadRadiografiaAction(fd);
    setSubiendo(false);
    if (result.ok) {
      setFile(null);
      setNota("");
      router.refresh();
    } else {
      setError(result.error.message);
    }
  };

  const handleBrokenThumb = async (id: string) => {
    if (refreshed[id]) return; // ya intentado
    const result = await refreshRadiografiaUrlAction(id);
    if (result.ok) {
      setRefreshed((prev) => ({ ...prev, [id]: result.data.signedUrl }));
    }
  };

  return (
    <div className="pc-quiro-radios">
      <header className="pc-quiro-radios-head">
        <span className="fi-eyebrow">Radiografías</span>
      </header>

      {items.length === 0 ? (
        <p className="pc-quiro-muted">Sin radiografías cargadas.</p>
      ) : (
        <ul className="pc-quiro-radios-list">
          {items.map((r) => {
            const url = refreshed[r.id] ?? r.signedUrl;
            return (
              <li key={r.id} className="pc-quiro-radio-item">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pc-quiro-radio-thumb"
                >
                  {esImagen(url) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={r.descripcion ?? `Radiografía ${fmtFecha(r.fecha)}`}
                      onError={() => void handleBrokenThumb(r.id)}
                    />
                  ) : (
                    <span className="pc-quiro-radio-file">
                      <I.ExternalLink size={16} />
                      <span>Ver archivo</span>
                    </span>
                  )}
                </a>
                <div className="pc-quiro-radio-meta">
                  <b>{fmtFecha(r.fecha)}</b>
                  {r.descripcion ? <span>{r.descripcion}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly ? (
        <div className="pc-quiro-radios-upload">
          <label className="pc-quiro-file-label">
            <input
              type="file"
              accept="image/*,application/pdf,application/dicom"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={!puedeSubir || subiendo}
            />
            <span className="pc-quiro-pill">
              <I.Plus size={13} />
              {file ? file.name.slice(0, 28) : "Elegir archivo"}
            </span>
          </label>
          <input
            type="text"
            className="pc-quiro-input"
            placeholder="Nota (opcional)"
            value={nota}
            maxLength={200}
            onChange={(e) => setNota(e.target.value)}
            disabled={!puedeSubir || subiendo}
          />
          <button
            type="button"
            className="fi-btn fi-btn-secondary"
            onClick={() => void handleUpload()}
            disabled={!puedeSubir || !file || subiendo}
            title={
              hintSinSesion
                ? "Guardá la sesión para adjuntar radiografías"
                : "Adjuntar radiografía a la sesión"
            }
          >
            {subiendo ? "Subiendo…" : "Subir radiografía"}
          </button>
          {hintSinSesion ? (
            <p className="pc-quiro-muted pc-quiro-radios-hint">
              Guardá la sesión para adjuntar radiografías.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="pc-quiro-radios-error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
