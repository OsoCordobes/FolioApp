"use client";

/**
 * Folio · wizard del importador CSV de pacientes.
 *
 * 3 pasos: Archivo → Mapeo + preview → Resultado. El preview usa el MISMO
 * parser puro que el server (lib/import/pacientes-csv.ts, sin crypto ni DB):
 * lo que el usuario ve como "lista" es lo que el server va a validar. El
 * server re-parsea el texto crudo — el cliente nunca manda filas procesadas.
 *
 * Encoding: Excel es-AR suele exportar CSV en Windows-1252, no UTF-8. Se lee
 * el archivo como bytes y se intenta UTF-8 estricto; si falla, se re-decodifica
 * como windows-1252 — sin esto, "Pérez" llega como "P�rez".
 */

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";

import * as I from "@/components/icons";
import {
  CAMPO_LABELS,
  CAMPOS_IMPORT,
  CAMPOS_OBLIGATORIOS,
  claveDni,
  claveTelefono,
  decidirDedupe,
  MAX_CSV_CHARS,
  MAX_FILAS_IMPORT,
  normalizarFilas,
  parseCsv,
  proponerMapeo,
  type CampoImport,
  type CsvParseado,
  type ImportResumen,
  type MapeoColumnas,
} from "@/lib/import/pacientes-csv";

import { importarPacientesAction, type ImportPacientesInput } from "./actions";

type Paso = "archivo" | "mapeo" | "resultado";

const PREVIEW_FILAS = 8;

export function ImportarPacientesClient() {
  const [paso, setPaso] = useState<Paso>("archivo");
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string>("");
  const [csv, setCsv] = useState<CsvParseado | null>(null);
  const [mapeo, setMapeo] = useState<MapeoColumnas>({});
  const [archivoError, setArchivoError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ImportResumen | null>(null);
  const [importando, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPaso("archivo");
    setFileName(null);
    setCsvText("");
    setCsv(null);
    setMapeo({});
    setArchivoError(null);
    setServerError(null);
    setResultado(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  // ── Paso 1: archivo ────────────────────────────────────────────────────────

  const onFile = async (file: File) => {
    setArchivoError(null);
    const nombre = file.name.toLowerCase();
    if (nombre.endsWith(".xlsx") || nombre.endsWith(".xls")) {
      setArchivoError(
        "Los archivos de Excel (.xlsx) no se pueden leer directamente. Guardalo como CSV desde Excel (Archivo → Guardar como → CSV) y volvé a subirlo.",
      );
      return;
    }
    if (!nombre.endsWith(".csv") && !nombre.endsWith(".txt")) {
      setArchivoError("Subí un archivo .csv (también aceptamos .txt separado por comas o punto y coma).");
      return;
    }

    const buffer = await file.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      text = new TextDecoder("windows-1252").decode(buffer);
    }
    if (text.length > MAX_CSV_CHARS) {
      setArchivoError(
        "El archivo es demasiado grande (máximo ~800 KB). Un CSV de 500 pacientes pesa mucho menos — revisá que no tenga columnas u hojas de más.",
      );
      return;
    }

    const parseado = parseCsv(text);
    if (parseado.headers.length < 2 || parseado.filas.length === 0) {
      setArchivoError(
        "No pude leer columnas y filas del archivo. Verificá que la primera fila tenga los encabezados (Nombre, Apellido, Teléfono…) y que haya al menos una fila de datos.",
      );
      return;
    }

    setFileName(file.name);
    setCsvText(text);
    setCsv(parseado);
    setMapeo(proponerMapeo(parseado.headers));
    setPaso("mapeo");
  };

  // ── Paso 2: mapeo + preview ────────────────────────────────────────────────

  const filasNormalizadas = useMemo(
    () => (csv ? normalizarFilas(csv.filas, mapeo) : []),
    [csv, mapeo],
  );

  const previewStats = useMemo(() => {
    let listas = 0;
    let conError = 0;
    let dupEnArchivo = 0;
    const vistos = { dni: new Set<string>(), telefono: new Set<string>() };
    const existentes = { dni: new Set<string>(), telefono: new Set<string>() };
    for (const f of filasNormalizadas) {
      if (!f.ok) {
        conError++;
        continue;
      }
      // Dedupe interno estimado con claves normalizadas (el server decide el
      // real contra la DB con blind indexes — misma normalización).
      const decision = decidirDedupe(
        { dni: claveDni(f.data.dni), telefono: claveTelefono(f.data.telefono) },
        existentes,
        vistos,
      );
      if (decision === "duplicado_en_archivo") dupEnArchivo++;
      else listas++;
    }
    return { listas, conError, dupEnArchivo };
  }, [filasNormalizadas]);

  const faltanObligatorios = CAMPOS_OBLIGATORIOS.filter((c) => mapeo[c] === undefined);
  const indicesUsados = Object.values(mapeo).filter((v): v is number => v !== undefined);
  const hayColumnasRepetidas = new Set(indicesUsados).size !== indicesUsados.length;
  const demasiadasFilas = (csv?.filas.length ?? 0) > MAX_FILAS_IMPORT;
  const puedeImportar =
    !importando &&
    faltanObligatorios.length === 0 &&
    !hayColumnasRepetidas &&
    !demasiadasFilas &&
    previewStats.listas > 0;

  const setCampo = (campo: CampoImport, valor: string) => {
    setMapeo((prev) => {
      const next = { ...prev };
      if (valor === "") delete next[campo];
      else next[campo] = Number(valor);
      return next;
    });
  };

  const confirmar = () => {
    if (mapeo.nombre === undefined || mapeo.apellido === undefined || mapeo.telefono === undefined) {
      return;
    }
    const input: ImportPacientesInput = {
      csvText,
      mapeo: {
        nombre: mapeo.nombre,
        apellido: mapeo.apellido,
        telefono: mapeo.telefono,
        dni: mapeo.dni,
        email: mapeo.email,
        fechaNacimiento: mapeo.fechaNacimiento,
        // F7a (M89) · cobertura (opcionales).
        obraSocial: mapeo.obraSocial,
        nroAfiliado: mapeo.nroAfiliado,
      },
    };
    setServerError(null);
    startTransition(async () => {
      const r = await importarPacientesAction(input);
      if (!r.ok) {
        setServerError(r.error.message);
        return;
      }
      setResultado(r.data);
      setPaso("resultado");
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="imp-wizard">
      <ol className="imp-steps" aria-label="Pasos de la importación">
        {(["archivo", "mapeo", "resultado"] as const).map((p, i) => (
          <li
            key={p}
            className={"imp-step " + (paso === p ? "is-active" : "")}
            aria-current={paso === p ? "step" : undefined}
          >
            <span className="imp-step-num">{i + 1}</span>
            {p === "archivo" ? "Archivo" : p === "mapeo" ? "Columnas y control" : "Resultado"}
          </li>
        ))}
      </ol>

      {paso === "archivo" ? (
        <section className="imp-card">
          <label className="imp-drop">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            <span className="imp-drop-glyph" aria-hidden="true">
              <I.Inbox size={26} />
            </span>
            <span className="imp-drop-title">Elegí tu archivo CSV</span>
            <span className="imp-drop-sub">
              Primera fila con encabezados (Nombre, Apellido, Teléfono…). Separado por coma o
              punto y coma — como lo exporta Excel o Google Sheets. Hasta {MAX_FILAS_IMPORT}{" "}
              pacientes por archivo.
            </span>
            <span className="fi-btn fi-btn-secondary imp-drop-btn">Buscar archivo…</span>
          </label>
          {archivoError ? (
            <p className="imp-alert imp-alert--err" role="alert">
              {archivoError}
            </p>
          ) : null}
          <p className="imp-hint">
            ¿Tenés un Excel (.xlsx)? Abrilo y guardalo como CSV: <b>Archivo → Guardar como →
            CSV (delimitado por comas)</b>. Los datos se cifran al importarse — el archivo no
            queda guardado en Folio.
          </p>
        </section>
      ) : null}

      {paso === "mapeo" && csv ? (
        <section className="imp-card">
          <div className="imp-file-row">
            <span className="fm-mono imp-file-name">{fileName}</span>
            <span className="muted">
              {csv.filas.length} {csv.filas.length === 1 ? "fila" : "filas"} · separador
              &nbsp;<code className="fm-mono">{csv.separador === ";" ? "punto y coma" : "coma"}</code>
            </span>
            <button type="button" className="fi-btn fi-btn-ghost" onClick={reset}>
              Cambiar archivo
            </button>
          </div>

          <h2 className="imp-h2">¿Qué columna va a cada dato?</h2>
          <p className="imp-sub">
            Propusimos el mapeo según los encabezados — revisalo. Nombre, apellido y teléfono
            son obligatorios; el resto se puede ignorar.
          </p>

          <div className="imp-map-grid">
            {CAMPOS_IMPORT.map((campo) => {
              const obligatorio = CAMPOS_OBLIGATORIOS.includes(campo);
              return (
                <label key={campo} className="imp-map-item">
                  <span className="imp-map-label">
                    {CAMPO_LABELS[campo]}
                    {obligatorio ? <span className="imp-req" aria-hidden="true"> *</span> : null}
                  </span>
                  <select
                    className="cfg-input"
                    value={mapeo[campo] ?? ""}
                    onChange={(e) => setCampo(campo, e.target.value)}
                  >
                    <option value="">{obligatorio ? "Elegí una columna…" : "Ignorar"}</option>
                    {csv.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Columna ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>

          {hayColumnasRepetidas ? (
            <p className="imp-alert imp-alert--err" role="alert">
              Hay dos campos apuntando a la misma columna — cada campo necesita una distinta.
            </p>
          ) : null}
          {demasiadasFilas ? (
            <p className="imp-alert imp-alert--err" role="alert">
              El archivo tiene {csv.filas.length} filas y el máximo por importación es{" "}
              {MAX_FILAS_IMPORT}. Dividilo en partes y subí una por vez.
            </p>
          ) : null}

          <h2 className="imp-h2">Vista previa</h2>
          <div className="imp-preview-stats" aria-live="polite">
            <span className="imp-stat imp-stat--ok">
              <I.Check size={12} /> {previewStats.listas} listas para importar
            </span>
            {previewStats.dupEnArchivo > 0 ? (
              <span className="imp-stat imp-stat--warn">
                {previewStats.dupEnArchivo} repetidas dentro del archivo
              </span>
            ) : null}
            {previewStats.conError > 0 ? (
              <span className="imp-stat imp-stat--err">
                <I.Alert size={12} /> {previewStats.conError} con errores
              </span>
            ) : null}
          </div>

          <div className="imp-preview">
            <table>
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Nombre</th>
                  <th>Apellido</th>
                  <th>DNI</th>
                  <th>Teléfono</th>
                  <th>Email</th>
                  <th>Nacimiento</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filasNormalizadas.slice(0, PREVIEW_FILAS).map((f) => (
                  <tr key={f.fila} className={f.ok ? "" : "is-err"}>
                    <td className="fm-mono">{f.fila}</td>
                    {f.ok ? (
                      <>
                        <td>{f.data.nombre}</td>
                        <td>{f.data.apellido}</td>
                        <td className="fm-mono">{f.data.dni ?? "—"}</td>
                        <td className="fm-mono">{f.data.telefono}</td>
                        <td>{f.data.email ?? "—"}</td>
                        <td className="fm-mono">{f.data.fechaNacimiento ?? "—"}</td>
                        <td>
                          <span className="imp-badge imp-badge--ok">Lista</span>
                        </td>
                      </>
                    ) : (
                      <>
                        <td colSpan={6} className="imp-motivo">
                          {f.motivo}
                        </td>
                        <td>
                          <span className="imp-badge imp-badge--err">Error</span>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {filasNormalizadas.length > PREVIEW_FILAS ? (
              <p className="imp-preview-more muted">
                …y {filasNormalizadas.length - PREVIEW_FILAS} filas más. Las filas con error se
                saltean y se listan en el resultado.
              </p>
            ) : null}
          </div>

          {serverError ? (
            <p className="imp-alert imp-alert--err" role="alert">
              {serverError}
            </p>
          ) : null}

          <div className="imp-actions">
            <button type="button" className="fi-btn fi-btn-ghost" onClick={reset} disabled={importando}>
              Cancelar
            </button>
            <button
              type="button"
              className="fi-btn fi-btn-primary"
              onClick={confirmar}
              disabled={!puedeImportar}
              title={
                faltanObligatorios.length > 0
                  ? `Falta mapear: ${faltanObligatorios.map((c) => CAMPO_LABELS[c]).join(", ")}`
                  : undefined
              }
            >
              {importando
                ? "Importando…"
                : `Importar ${previewStats.listas} ${previewStats.listas === 1 ? "paciente" : "pacientes"}`}
            </button>
          </div>
        </section>
      ) : null}

      {paso === "resultado" && resultado ? (
        <section className="imp-card">
          <div className="imp-result-grid">
            <div className="imp-result-card imp-result-card--ok">
              <span className="imp-result-num">{resultado.importados}</span>
              <span className="imp-result-lbl">
                {resultado.importados === 1 ? "paciente importado" : "pacientes importados"}
              </span>
            </div>
            <div className="imp-result-card imp-result-card--warn">
              <span className="imp-result-num">
                {resultado.duplicadosDni + resultado.duplicadosTelefono + resultado.duplicadosEnArchivo}
              </span>
              <span className="imp-result-lbl">salteados por duplicado</span>
            </div>
            <div className="imp-result-card imp-result-card--err">
              <span className="imp-result-num">{resultado.errores.length}</span>
              <span className="imp-result-lbl">filas con errores</span>
            </div>
          </div>

          {resultado.duplicadosDni + resultado.duplicadosTelefono + resultado.duplicadosEnArchivo > 0 ? (
            <p className="imp-hint">
              Duplicados: {resultado.duplicadosDni} por DNI ya existente, {resultado.duplicadosTelefono}{" "}
              por teléfono ya existente y {resultado.duplicadosEnArchivo} repetidos dentro del archivo.
              Esos pacientes ya estaban en Folio y no se tocaron.
            </p>
          ) : null}

          {resultado.errores.length > 0 ? (
            <div className="imp-err-list">
              <h2 className="imp-h2">Filas con errores</h2>
              <ul>
                {resultado.errores.map((e) => (
                  <li key={e.fila}>
                    <span className="fm-mono">Fila {e.fila}</span> — {e.motivo}
                  </li>
                ))}
              </ul>
              <p className="imp-hint">
                Corregí esas filas en tu planilla y volvé a importar solo esas — los ya
                importados se saltean como duplicados.
              </p>
            </div>
          ) : null}

          <div className="imp-actions">
            <button type="button" className="fi-btn fi-btn-ghost" onClick={reset}>
              Importar otro archivo
            </button>
            <Link href="/pacientes" className="fi-btn fi-btn-primary">
              Ver mis pacientes <I.ArrowRight size={13} />
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
