"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { newSubmissionAttempt, reconcileAttempt, type SubmissionAttempt } from "@/lib/patient-intake/submission-attempt";
import { postIntakeJson } from "@/lib/patient-intake/browser-http";
import styles from "./patient-form.module.css";

declare global { interface Window { __folioIntakeToken?: string } }

type Phase = "opening" | "ready" | "unavailable";
type Form = { nombre: string; apellido: string; tipoDocumento: string; numeroDocumento: string; fechaNacimiento: string; email: string; telefono: string; coberturaNombre: string; coberturaPlan: string; numeroAfiliado: string };
const initial: Form = { nombre: "", apellido: "", tipoDocumento: "", numeroDocumento: "", fechaNacimiento: "", email: "", telefono: "", coberturaNombre: "", coberturaPlan: "", numeroAfiliado: "" };
const labels: { key: keyof Form; label: string; autoComplete?: string; type?: string; maxLength?: number }[] = [
  { key: "nombre", label: "Nombre", autoComplete: "given-name", maxLength: 100 },
  { key: "apellido", label: "Apellido", autoComplete: "family-name", maxLength: 100 },
  { key: "numeroDocumento", label: "Número de documento", maxLength: 32 },
  { key: "fechaNacimiento", label: "Fecha de nacimiento", type: "date" },
  { key: "email", label: "Correo electrónico", type: "email", autoComplete: "email", maxLength: 254 },
  { key: "telefono", label: "Teléfono", type: "tel", autoComplete: "tel", maxLength: 30 },
];

function answers(form: Form): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of ["nombre", "apellido", "tipoDocumento", "numeroDocumento", "fechaNacimiento", "email", "telefono"] as const) {
    const value = form[key].normalize("NFC").trim();
    if (value) output[key] = value;
  }
  const coverage: Record<string, string> = {};
  if (form.coberturaNombre.trim()) coverage.nombre = form.coberturaNombre.normalize("NFC").trim();
  if (form.coberturaPlan.trim()) coverage.plan = form.coberturaPlan.normalize("NFC").trim();
  if (form.numeroAfiliado.trim()) coverage.numeroAfiliado = form.numeroAfiliado.normalize("NFC").trim();
  if (Object.keys(coverage).length) output.cobertura = coverage;
  return output;
}

export function PatientForm() {
  const [phase, setPhase] = useState<Phase>("opening");
  const [marker, setMarker] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(initial);
  const [attempt, setAttempt] = useState<SubmissionAttempt | null>(null);
  const [preflighting, setPreflighting] = useState(false);
  const [message, setMessage] = useState("");
  const opened = useRef(false);
  const initialSubmissionStarted = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    const token = window.__folioIntakeToken;
    delete window.__folioIntakeToken;
    if (!token) { setPhase("unavailable"); return; }
    void postIntakeJson("exchange", { token }).then((result) => {
      if (typeof result.marker !== "string") throw new Error("missing_marker");
      setMarker(result.marker); setPhase("ready");
    }).catch(() => setPhase("unavailable"));
  }, []);

  // A provisional not_received cannot close an earlier delayed submit.
  const locked = preflighting || attempt !== null;
  const update = (key: keyof Form, value: string) => { setForm(current => ({ ...current, [key]: value })); setMessage(""); };

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!marker || locked || initialSubmissionStarted.current) return;
    const payload = answers(form);
    if (!Object.keys(payload).length) { setMessage("Completá al menos un dato antes de enviar."); return; }
    initialSubmissionStarted.current = true;
    const next = newSubmissionAttempt(payload);
    setPreflighting(true);
    try {
      const status = await postIntakeJson("status", { marker, operationId: next.operationId });
      const checked = reconcileAttempt(next, status);
      if (checked.phase !== "not_received") { initialSubmissionStarted.current = false; setMessage("No pudimos comprobar el enlace antes de enviar. Conservamos tus respuestas; consultá con el consultorio."); return; }
    } catch { initialSubmissionStarted.current = false; setMessage("No pudimos comprobar el enlace antes de enviar. Tus datos siguen en esta pantalla."); return; }
    finally { setPreflighting(false); }
    setAttempt(next); setMessage("");
    try {
      const receipt = await postIntakeJson("submit", { marker, operationId: next.operationId, answers: next.answers });
      setAttempt(reconcileAttempt(next, receipt));
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_answers") { initialSubmissionStarted.current = false; setAttempt(null); setMessage("Revisá los datos antes de enviar."); return; }
      setAttempt({ ...next, phase: "uncertain" });
      setMessage("No pudimos confirmar la recepción. Conservamos tus respuestas en esta pestaña; consultá el estado antes de hacer otro envío.");
    }
  }

  async function checkStatus() {
    if (!attempt || !marker || preflighting) return;
    try {
      const result = await postIntakeJson("status", { marker, operationId: attempt.operationId });
      const next = reconcileAttempt(attempt, result);
      setAttempt(next);
      setMessage(next.phase === "not_received"
        ? "Este envío todavía no figura recibido. Podés volver a enviar exactamente los mismos datos; no los cambies hasta que quede confirmado."
        : next.phase === "received" ? "El consultorio recibió tu aporte." : "No pudimos confirmar la recepción. Consultá con el consultorio antes de repetir.");
    } catch { setAttempt({ ...attempt, phase: "uncertain" }); setMessage("No pudimos confirmar la recepción. Consultá con el consultorio antes de repetir."); }
  }

  async function retrySame() {
    if (!attempt || attempt.phase !== "not_received" || !marker || preflighting) return;
    setPreflighting(true);
    try {
      const status = reconcileAttempt(attempt, await postIntakeJson("status", { marker, operationId: attempt.operationId }));
      if (status.phase === "received") { setAttempt(status); setMessage("El consultorio recibió tu aporte."); return; }
      if (status.phase !== "not_received") { setAttempt({ ...attempt, phase: "uncertain" }); setMessage("No pudimos comprobar el enlace antes de reenviar."); return; }
    } catch { setAttempt({ ...attempt, phase: "uncertain" }); setMessage("No pudimos comprobar el enlace antes de reenviar."); return; }
    finally { setPreflighting(false); }
    const sending = { ...attempt, phase: "sending" as const };
    setAttempt(sending); setMessage("");
    try { setAttempt(reconcileAttempt(sending, await postIntakeJson("submit", { marker, operationId: attempt.operationId, answers: attempt.answers }))); }
    catch { setAttempt({ ...sending, phase: "uncertain" }); setMessage("No pudimos confirmar la recepción. Revisá el estado antes de repetir."); }
  }

  return <main className={`${styles.page} ph-no-capture ph-no-capture-recording`} data-sensitive>
    <div className={styles.shell}>
      <div className={styles.brand} aria-label="Folio">Folio<span>.</span></div>
      <article className={styles.card}>
        <p className={styles.eyebrow}>Antes de tu turno</p>
        <h1>Compartí tus datos con el consultorio</h1>
        <p className={styles.intro}>Podés completar los datos que quieras aportar. El equipo los revisará dentro de Folio. No necesitás crear una cuenta y este formulario no condiciona tu atención.</p>
        <p className={styles.note}>Quien tenga este enlace puede enviar datos para el turno. El enlace no verifica tu identidad. No incluyas motivos de consulta ni información clínica.</p>
        {phase === "opening" ? <p role="status">Abriendo formulario…</p> : null}
        {phase === "unavailable" ? <div className={styles.alert} role="alert">El enlace no está disponible o venció. Pedí uno nuevo al consultorio. Si ya enviaste datos, consultá antes de repetir.</div> : null}
        {phase === "ready" ? <>
          {attempt?.phase === "received" ? <div className={styles.success} role="status"><strong>Aporte recibido</strong><span>El consultorio podrá revisarlo. Guardá esta pantalla si necesitás conservar la confirmación.</span></div> : null}
          {attempt?.phase !== "received" ? <form onSubmit={send} noValidate>
            <fieldset disabled={locked}>
              <legend>Datos personales</legend>
              <div className={styles.grid}>{labels.slice(0, 2).map(field => <label key={field.key}>{field.label}<input name={field.key} value={form[field.key]} onChange={e => update(field.key, e.target.value)} autoComplete={field.autoComplete} maxLength={field.maxLength} /></label>)}</div>
              <div className={styles.grid}><label>Tipo de documento<select name="tipoDocumento" value={form.tipoDocumento} onChange={e => update("tipoDocumento", e.target.value)}><option value="">Prefiero omitirlo</option>{["DNI", "LE", "LC", "CI", "PASAPORTE"].map(type => <option key={type}>{type}</option>)}</select></label>{labels.slice(2, 4).map(field => <label key={field.key}>{field.label}<input name={field.key} type={field.type} value={form[field.key]} onChange={e => update(field.key, e.target.value)} maxLength={field.maxLength} /></label>)}</div>
            </fieldset>
            <fieldset disabled={locked}><legend>Contacto</legend><div className={styles.grid}>{labels.slice(4).map(field => <label key={field.key}>{field.label}<input name={field.key} type={field.type} value={form[field.key]} onChange={e => update(field.key, e.target.value)} autoComplete={field.autoComplete} maxLength={field.maxLength} /></label>)}</div></fieldset>
            <fieldset disabled={locked}><legend>Cobertura, si corresponde</legend><div className={styles.grid}><label>Nombre de la cobertura<input name="coberturaNombre" value={form.coberturaNombre} onChange={e => update("coberturaNombre", e.target.value)} maxLength={100} /></label><label>Plan<input name="coberturaPlan" value={form.coberturaPlan} onChange={e => update("coberturaPlan", e.target.value)} maxLength={100} /></label><label>Número de afiliado<input name="numeroAfiliado" value={form.numeroAfiliado} onChange={e => update("numeroAfiliado", e.target.value)} maxLength={100} /></label></div></fieldset>
            {message ? <p className={styles.alert} role="status">{message}</p> : null}
            {attempt && attempt.phase !== "sending" ? <button type="button" className={styles.secondary} onClick={checkStatus} disabled={preflighting}>Consultar estado de este envío</button> : null}
            {attempt?.phase === "not_received" ? <button type="button" className={styles.secondary} onClick={retrySame} disabled={preflighting}>Reenviar los mismos datos</button> : null}
            {!attempt ? <button type="submit" className={styles.primary} disabled={preflighting}>{preflighting ? "Comprobando el enlace…" : "Enviar datos"}</button> : null}
            {attempt ? <p className={styles.note}>No cierres esta pestaña hasta confirmar el resultado. Tus respuestas se conservan aquí por ahora.</p> : null}
          </form> : null}
        </> : null}
      </article>
    </div>
  </main>;
}
