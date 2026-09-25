"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { searchClinicalArchive } from "@/app/archivo-clinico/actions";
import type { ClinicalArchivePage } from "@/lib/patient/clinical-archive";
import { writeVerifiedPackageArchive, PackageArchiveFailure } from "@/lib/patient/export-package-archive";
import { BrowserPackageFailure, discardSavedPackageOperation, packageArchiveTransport, prepareBrowserPackage,
  type BrowserPackageBinding } from "@/lib/patient/export-package-browser";
import { PACKAGE_CAPACITY_MESSAGE } from "@/lib/patient/export-package-capacity";
import styles from "./archive.module.css";

type SafePicker = Window & { showSaveFilePicker?: (options: {
  suggestedName: string; types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle> };

function within<T>(task: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([task, new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new BrowserPackageFailure("unconfirmed")), milliseconds);
  })]).finally(() => clearTimeout(timer));
}

function packageMessage(error: unknown) {
  if (error instanceof BrowserPackageFailure) {
    if (error.code === "auth" || error.code === "denied") return "Tu acceso cambió. No se confirmó esta entrega; revisá el archivo elegido si la descarga ya había empezado.";
    if (error.code === "rate") return `Hay demasiadas solicitudes. Esperá ${Math.max(1, error.retryAfter)} segundos y retomá la misma entrega.`;
    if (error.code === "changed") return "Las fuentes o el estado de la entrega cambiaron. Revisá la operación antes de preparar otra entrega.";
    if (error.code === "missing") return "No se encontró esta operación con tu acceso actual. No se inició otra automáticamente.";
    if (error.code === "capacity") return PACKAGE_CAPACITY_MESSAGE;
  }
  if (error instanceof PackageArchiveFailure) {
    if (error.code === "source_changed") return "El inventario cambió durante la descarga. El archivo no se confirmó; prepará una entrega nueva cuando verifiques el acceso.";
    if (error.code === "archive_limit") return "La entrega supera el límite de este formato. Coordiná otra vía de entrega.";
    return error.abortConfirmed
      ? "La descarga se interrumpió y el archivo no se confirmó. El navegador podría haber creado un archivo vacío; revisá la carpeta elegida."
      : "La descarga se interrumpió y no podemos confirmar el estado del archivo elegido. Revisá la carpeta antes de continuar.";
  }
  return "No pudimos confirmar esta operación. Retomá la misma entrega; no se inició otra automáticamente.";
}

export function ClinicalArchive({ initialPage }: { initialPage: ClinicalArchivePage }) {
  const [page, setPage] = useState(initialPage);
  const scope = page.scope;
  const scopeKey = `${scope.userId}:${scope.organizationId}`;
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const leases = useRef<Record<string, { leaseToken: string; revision: number }>>({});
  const [packageReady, setPackageReady] = useState<Record<string, BrowserPackageBinding>>({});
  const [mayRestart, setMayRestart] = useState<string | null>(null);
  const activeScope = useRef(scopeKey);
  const generation = useRef(0);
  const mounted = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  activeScope.current = scopeKey;
  useEffect(() => {
    const generationRef = generation;
    mounted.current = true;
    generationRef.current++;
    const inFlight = controllers.current;
    busy.current = false;
    leases.current = {};
    setPackageReady({});
    setMayRestart(null);
    setPending(false);
    setMessage("");
    return () => {
      mounted.current = false;
      generationRef.current++;
      for (const controller of inFlight) controller.abort();
      inFlight.clear();
      leases.current = {};
      busy.current = false;
    };
  }, [scopeKey]);
  function beginTask() {
    const startedScope = scopeKey;
    const startedGeneration = generation.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    const active = () => mounted.current && generation.current === startedGeneration &&
      activeScope.current === startedScope && !controller.signal.aborted;
    return { signal: controller.signal, active, finish: () => {
      controllers.current.delete(controller);
      if (active()) { busy.current = false; setPending(false); }
    } };
  }
  const resultHeading = useRef<HTMLHeadingElement>(null);
  async function search(value: string, cursor: string | null = null) {
    if (busy.current) return;
    const task = beginTask();
    busy.current = true; setPending(true); setMessage("");
    try {
      const result = await searchClinicalArchive({ query: value, cursor });
      if (!task.active()) return;
      if (!result.ok) { setMessage(result.error.message); return; }
      setPage(result.data); setAppliedQuery(value);
      resultHeading.current?.focus();
    } catch { if (task.active()) setMessage("No pudimos completar la búsqueda. Tus resultados anteriores siguen aquí; volvé a intentar."); }
    finally { task.finish(); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void search(query.trim()); }
  async function download(id: string, format: "pdf" | "json") {
    if (busy.current) return;
    const task = beginTask();
    busy.current = true; setPending(true); setMessage("");
    try {
      const url = format === "pdf" ? `/api/pacientes/${id}/ficha-pdf` : `/api/patient/export?paciente=${id}`;
      const response = await fetch(url, { cache: "no-store", redirect: "manual",
        signal: AbortSignal.any([task.signal, AbortSignal.timeout(90_000)]) });
      if (!task.active()) return;
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        setMessage("Tu sesión necesita verificarse. Volvé a iniciar sesión antes de descargar la historia.");
        return;
      }
      if (!response.ok) {
        setMessage(response.status === 401 || response.status === 403
          ? "No pudimos confirmar tu permiso para descargar esta historia. Volvé a iniciar sesión o coordiná la entrega con el responsable del consultorio."
          : response.status === 413 ? "La historia excede el tamaño de esta descarga. Coordiná la entrega con soporte."
          : "No se pudo preparar la historia. No descargamos un archivo incompleto; volvé a intentar.");
        return;
      }
      const mime = format === "pdf" ? "application/pdf" : "application/json";
      if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith(mime)) throw Error("unexpected_document");
      const blob = await response.blob();
      if (!task.active()) return;
      if (!blob.size) throw Error("empty_document");
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl; link.download = `folio-historia-${id.slice(0, 8)}.${format}`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      setMessage("Archivo preparado. Revisá las descargas de tu navegador.");
    } catch { if (task.active()) setMessage("La descarga se interrumpió. Podés volver a intentarla sin modificar la historia."); }
    finally { task.finish(); }
  }
  async function preparePackage(patientId: string) {
    if (busy.current) return;
    const task = beginTask();
    const key = `${scopeKey}:${patientId}`;
    busy.current = true; setPending(true); setMessage("Verificando la entrega y sus permisos…");
    try {
      const prepared = await prepareBrowserPackage(scope, patientId, (done, total) => {
        if (!task.active()) throw new BrowserPackageFailure("auth");
        setMessage(`Preparando archivos verificados: ${done} de ${total}.`);
      }, leases.current[key], value => {
        if (!task.active()) throw new BrowserPackageFailure("auth");
        leases.current[key] = value;
      }, task.signal);
      if (!task.active()) return;
      setPackageReady(current => ({ ...current, [key]: prepared.bound }));
      setMayRestart(null);
      setMessage("Entrega preparada. Elegí «Guardar historia y archivos»; se guardará un archivo TAR.");
    } catch (error) {
      if (!task.active()) return;
      setPackageReady(current => { const next = { ...current }; delete next[key]; return next; });
      setMayRestart(error instanceof BrowserPackageFailure &&
        ["changed", "missing"].includes(error.code) ? key : null);
      setMessage(packageMessage(error));
    }
    finally { task.finish(); }
  }
  function restartPackage(patientId: string) {
    if (busy.current) return;
    try {
      discardSavedPackageOperation(scope, patientId);
      delete leases.current[`${scopeKey}:${patientId}`];
      setMayRestart(null);
      void preparePackage(patientId);
    } catch (error) { setMessage(packageMessage(error)); }
  }
  async function savePackage(patientId: string) {
    const key = `${scopeKey}:${patientId}`;
    if (busy.current || !packageReady[key]) return;
    const bound = packageReady[key];
    const browser = window as SafePicker;
    if (typeof browser.showSaveFilePicker !== "function" || !window.isSecureContext) {
      setMessage("Este navegador no ofrece guardado seguro de archivos grandes. Usá un navegador compatible o coordiná otra vía; tus PDF y JSON siguen disponibles.");
      return;
    }
    const task = beginTask();
    busy.current = true; setPending(true); setMessage("Verificando la entrega antes de guardar…");
    let writable: FileSystemWritableFileStream | undefined;
    let closeUncertain = false;
    try {
      // The picker is still called before any await, preserving user activation.
      const selected = browser.showSaveFilePicker({ suggestedName: `folio-entrega-${patientId.slice(0, 8)}.tar`,
        types: [{ description: "Paquete TAR de Folio", accept: { "application/x-tar": [".tar"] } }] });
      const handle = await selected;
      if (!task.active()) return;
      writable = await within(handle.createWritable({ keepExistingData: false }), 30_000);
      if (!task.active()) {
        try { await within(writable.abort(), 15_000); } catch { /* State is uncertain. */ }
        return;
      }
      const stream = writable;
      await writeVerifiedPackageArchive(
        packageArchiveTransport(bound, task.signal), {
          write: async chunk => {
            if (!task.active()) throw new BrowserPackageFailure("auth");
            await within(stream.write(new Uint8Array(chunk)), 30_000);
            if (!task.active()) throw new BrowserPackageFailure("auth");
          },
          close: async () => {
            if (!task.active()) throw new BrowserPackageFailure("auth");
            try {
              await within(stream.close(), 30_000);
              if (!task.active()) throw new BrowserPackageFailure("auth");
            } catch (error) { closeUncertain = true; throw error; }
          },
          abort: async () => {
            try { await within(stream.abort(), 15_000); }
            finally {
              // A timed-out close can still commit later; abort cannot certify it.
              if (closeUncertain) throw new BrowserPackageFailure("unconfirmed");
            }
          },
        }, ({ completedEntries, totalEntries }) => {
          if (!task.active()) throw new BrowserPackageFailure("auth");
          setMessage(`Guardando archivos verificados: ${completedEntries} de ${totalEntries}.`);
        });
      writable = undefined;
      if (task.active()) setMessage("Historia y archivos guardados; revisá la carpeta elegida.");
    } catch (error) {
      if (!task.active()) return;
      if ((error as { name?: string })?.name === "AbortError" && !writable) {
        setMessage("No elegiste un archivo; la entrega preparada sigue disponible.");
      } else setMessage(packageMessage(error));
    } finally { task.finish(); }
  }
  return <section className={styles.archive} aria-busy={pending}>
    <form onSubmit={submit} className={styles.search} role="search">
      <label htmlFor="archive-query">Buscar paciente: nombre y apellido completos, DNI o teléfono</label>
      <div className={styles.controls}>
        <input id="archive-query" type="search" autoComplete="off" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} />
        <button className="fi-btn fi-btn-primary" type="submit" disabled={pending}>Buscar</button>
      </div>
    </form>
    <p role="status" aria-live="polite">{message || (pending ? "Preparando…" : "")}</p>
    <p className={styles.packageHint}>La entrega completa se guarda como archivo TAR y requiere un navegador con guardado seguro de archivos grandes.</p>
    <h2 ref={resultHeading} tabIndex={-1}>{page.total} {page.total === 1 ? "paciente" : "pacientes"}{appliedQuery ? " en la búsqueda" : page.total === 1 ? " disponible" : " disponibles"}</h2>
    {page.patients.length === 0 ? <p>No encontramos pacientes con esa búsqueda. Probá con el nombre y apellido completos, el DNI o el teléfono.</p> :
      <ul className={styles.list}>{page.patients.map(patient => <li key={patient.id}>
        <span className={styles.name}>{patient.name}</span>
        <div className={styles.downloads}>
          <button className="fi-btn fi-btn-secondary" disabled={pending} onClick={() => void download(patient.id, "pdf")} aria-label={`Descargar PDF de ${patient.name}`}>Descargar PDF</button>
          <button className="fi-btn fi-btn-ghost" disabled={pending} onClick={() => void download(patient.id, "json")} aria-label={`Descargar datos clínicos de ${patient.name}`}>Datos clínicos (JSON)</button>
          <button className="fi-btn fi-btn-secondary" disabled={pending} onClick={() => void preparePackage(patient.id)}
            aria-label={`Preparar o retomar entrega completa de ${patient.name}`}>
            Preparar o retomar entrega
          </button>
          {mayRestart === `${scopeKey}:${patient.id}` ? <button className="fi-btn fi-btn-ghost" disabled={pending}
            onClick={() => restartPackage(patient.id)} aria-label={`Iniciar una nueva entrega de ${patient.name}`}>
            Iniciar nueva entrega
          </button> : null}
          {packageReady[`${scopeKey}:${patient.id}`] ? <button className="fi-btn fi-btn-primary" disabled={pending}
            onClick={() => void savePackage(patient.id)} aria-label={`Guardar historia y archivos de ${patient.name}`}>
            Guardar historia y archivos
          </button> : null}
        </div>
      </li>)}</ul>}
    <nav aria-label="Páginas del archivo clínico" className={styles.controls}>
      <button className="fi-btn fi-btn-ghost" disabled={pending} onClick={() => void search(appliedQuery)}>Primera página</button>
      {page.nextCursor ? <button className="fi-btn fi-btn-secondary" disabled={pending} onClick={() => void search(appliedQuery, page.nextCursor)}>Siguiente página</button> : null}
    </nav>
  </section>;
}
