"use client";
import { useRef, useState, type FormEvent } from "react";
import { searchClinicalArchive } from "@/app/archivo-clinico/actions";
import type { ClinicalArchivePage } from "@/lib/patient/clinical-archive";
import styles from "./archive.module.css";

export function ClinicalArchive({ initialPage }: { initialPage: ClinicalArchivePage }) {
  const [page, setPage] = useState(initialPage);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  async function search(value: string, cursor: string | null = null) {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage("");
    try {
      const result = await searchClinicalArchive({ query: value, cursor });
      if (!result.ok) { setMessage(result.error.message); return; }
      setPage(result.data); setAppliedQuery(value);
      resultHeading.current?.focus();
    } catch { setMessage("No pudimos completar la búsqueda. Tus resultados anteriores siguen aquí; volvé a intentar."); }
    finally { busy.current = false; setPending(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void search(query.trim()); }
  async function download(id: string, format: "pdf" | "json") {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage("");
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 90000);
    try {
      const url = format === "pdf" ? `/api/pacientes/${id}/ficha-pdf` : `/api/patient/export?paciente=${id}`;
      const response = await fetch(url, { cache: "no-store", redirect: "manual", signal: controller.signal });
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
      if (!blob.size) throw Error("empty_document");
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl; link.download = `folio-historia-${id.slice(0, 8)}.${format}`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      setMessage("Archivo preparado. Revisá las descargas de tu navegador.");
    } catch { setMessage("La descarga se interrumpió. Podés volver a intentarla sin modificar la historia."); }
    finally { clearTimeout(deadline); busy.current = false; setPending(false); }
  }
  return <section className={styles.archive} aria-busy={pending}>
    <form onSubmit={submit} className={styles.search} role="search">
      <label htmlFor="archive-query">Buscar paciente: nombre y apellido completos, DNI o teléfono</label>
      <div className={styles.controls}>
        <input id="archive-query" type="search" autoComplete="off" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} />
        <button className="fi-btn fi-btn-primary" type="submit" disabled={pending}>Buscar</button>
      </div>
    </form>
    <p role="status" aria-live="polite">{pending ? "Preparando…" : message}</p>
    <h2 ref={resultHeading} tabIndex={-1}>{page.total} {page.total === 1 ? "paciente" : "pacientes"}{appliedQuery ? " en la búsqueda" : page.total === 1 ? " disponible" : " disponibles"}</h2>
    {page.patients.length === 0 ? <p>No encontramos pacientes con esa búsqueda. Probá con el nombre y apellido completos, el DNI o el teléfono.</p> :
      <ul className={styles.list}>{page.patients.map(patient => <li key={patient.id}>
        <span className={styles.name}>{patient.name}</span>
        <div className={styles.downloads}>
          <button className="fi-btn fi-btn-secondary" disabled={pending} onClick={() => void download(patient.id, "pdf")} aria-label={`Descargar PDF de ${patient.name}`}>Descargar PDF</button>
          <button className="fi-btn fi-btn-ghost" disabled={pending} onClick={() => void download(patient.id, "json")} aria-label={`Descargar datos clínicos de ${patient.name}`}>Datos clínicos (JSON)</button>
        </div>
      </li>)}</ul>}
    <nav aria-label="Páginas del archivo clínico" className={styles.controls}>
      <button className="fi-btn fi-btn-ghost" disabled={pending} onClick={() => void search(appliedQuery)}>Primera página</button>
      {page.nextCursor ? <button className="fi-btn fi-btn-secondary" disabled={pending} onClick={() => void search(appliedQuery, page.nextCursor)}>Siguiente página</button> : null}
    </nav>
  </section>;
}
