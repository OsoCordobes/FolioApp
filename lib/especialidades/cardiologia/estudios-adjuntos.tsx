"use client";

/** Galería clínica. Las rutas de archivos revalidan sesión, MFA y alcance
 * del paciente en cada GET. La subida se valida íntegramente en el servidor.
 * Imágenes compatibles usan una vista previa; otros formatos se descargan.
 */

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import * as I from "@/components/icons";
import {
  refreshRadiografiaUrlAction,
  uploadEstudioCardioAction,
} from "@/app/(app)/pacientes/actions";

interface EstudioAdjuntoItem {
  id: string;
  fecha: string;
  descripcion: string | null;
  downloadUrl: string;
  mimeType?: string;
  sesionId: string | null;
}

interface EstudiosAdjuntosProps {
  pacienteId?: string;
  turno?: { id: string; tieneSesionGuardada: boolean } | null;
  estudiosAdjuntos?: ReadonlyArray<EstudioAdjuntoItem>;
  readOnly?: boolean;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtFecha(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

function esImagen(mime?: string): boolean {
  return mime === "image/png" || mime === "image/jpeg" || mime === "image/webp";
}

export function EstudiosAdjuntos({
  pacienteId,
  turno,
  estudiosAdjuntos,
  readOnly,
}: EstudiosAdjuntosProps) {
  const router = useRouter();
  const items = estudiosAdjuntos ?? [];
  const [file, setFile] = useState<File | null>(null);
  const [nota, setNota] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Un único intento autorizado de recuperación por miniatura.
  const attempted = useRef(new Set<string>());
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
    const result = await uploadEstudioCardioAction(fd).catch(() => ({ ok: false as const, error: { message: "Se interrumpió la subida. Intentá nuevamente." } }));
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
    if (attempted.current.has(id)) return;
    attempted.current.add(id);
    const result = await refreshRadiografiaUrlAction(id).catch(() => ({ ok: false as const, error: { message: "No pudimos abrir el archivo. Intentá nuevamente." } }));
    if (result.ok) {
      setRefreshed((prev) => ({ ...prev, [id]: result.data.downloadUrl }));
    } else {
      setError(result.error.message);
    }
  };

  return (
    <div className="pc-quiro-radios">
      <header className="pc-quiro-radios-head">
        <span className="fi-eyebrow">Archivos de estudios</span>
      </header>

      {items.length === 0 ? (
        <p className="pc-quiro-muted">
          Sin archivos de estudios. Adjuntá el ECG, Holter o ergometría escaneado
          o en PDF.
        </p>
      ) : (
        <ul className="pc-quiro-radios-list">
          {items.map((r) => {
            const url = refreshed[r.id] ?? r.downloadUrl;
            return (
              <li key={r.id} className="pc-quiro-radio-item">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pc-quiro-radio-thumb"
                >
                  {esImagen(r.mimeType) ? (
                    // Mantener la autorización por GET y evitar cachés de optimización.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={r.descripcion ?? `Estudio ${fmtFecha(r.fecha)}`}
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
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/tiff,application/dicom"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={!puedeSubir || subiendo}
            />
            <span className="pc-quiro-pill">
              <I.Plus size={13} />
              {file ? file.name.slice(0, 28) : "Elegir archivo (máx. 4 MiB)"}
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
                ? "Guardá la sesión para adjuntar el estudio"
                : "Adjuntar el estudio a la sesión"
            }
          >
            {subiendo ? "Subiendo…" : "Subir estudio"}
          </button>
          {hintSinSesion ? (
            <p className="pc-quiro-muted pc-quiro-radios-hint">
              Guardá la sesión para adjuntar archivos de estudios.
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
