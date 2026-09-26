"use client";

import { useEffect, useRef, useState } from "react";
import { issuePatientIntakeLink, revokePatientIntakeLink, reviewPatientIntake } from "@/lib/patient-intake/staff";
import { beginStaffMutation, finishStaffMutation, pendingStaffMutation, withActionDeadline, type PendingStaffMutation } from "@/lib/patient-intake/staff-recovery";
import styles from "./patient-intake-control.module.css";

type Proposal = { receiptId: string; receivedAt: string; questionnaireVersion: "admin.v1"; origin: "aportado por el paciente"; answers: Record<string, unknown> };
const labels: Record<string, string> = {
  nombre: "Nombre", apellido: "Apellido", tipoDocumento: "Tipo de documento", numeroDocumento: "Número de documento",
  fechaNacimiento: "Fecha de nacimiento", email: "Correo electrónico", telefono: "Teléfono",
  "cobertura.nombre": "Cobertura", "cobertura.plan": "Plan", "cobertura.numeroAfiliado": "Número de afiliado",
};

function rows(answers: Record<string, unknown>): [string, string][] {
  const values: [string, string][] = [];
  for (const [key, value] of Object.entries(answers)) {
    if (key === "cobertura" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [subkey, subvalue] of Object.entries(value)) if (typeof subvalue === "string") values.push([labels[`cobertura.${subkey}`] ?? subkey, subvalue]);
    } else if (typeof value === "string") values.push([labels[key] ?? key, value]);
  }
  return values;
}

export function PatientIntakeControl({ turnoId }: { turnoId: string }) {
  const [busy, setBusy] = useState(false);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [link, setLink] = useState("");
  const [qr, setQr] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<PendingStaffMutation | null>(() => pendingStaffMutation(turnoId));
  const mounted = useRef(false);
  const activeTurno = useRef(turnoId);
  activeTurno.current = turnoId;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setLink(""); setQr(""); setProposals([]); setConfirmIssue(false); setMessage(""); setBusy(false); setPending(pendingStaffMutation(turnoId)); }, [turnoId]);

  function current(id: string): boolean { return mounted.current && activeTurno.current === id; }

  async function issue() {
    if (!confirmIssue || busy || pendingStaffMutation(turnoId)) return;
    beginStaffMutation(turnoId, "issue");
    setPending("issue");
    setBusy(true); setMessage(""); setLink(""); setQr("");
    try {
      const result = await withActionDeadline(() => issuePatientIntakeLink(turnoId));
      if (!current(turnoId)) return;
      if (!result.ok) {
        if (!result.error.mutationOutcome) { finishStaffMutation(turnoId, "issue", true); setPending(null); }
        setMessage(result.error.mutationOutcome ? "No pudimos confirmar si se emitió el enlace. Detuvimos nuevas emisiones para este turno; consultá con el equipo antes de continuar." : result.error.message);
        return;
      }
      const next = `${window.location.origin}/aporte#token=${result.data.token}`;
      setLink(next);
      try {
        const { default: QRCode } = await import("qrcode");
        const tokens = getComputedStyle(document.documentElement);
        const dark = tokens.getPropertyValue("--accent").trim() || "#6255C5";
        const light = tokens.getPropertyValue("--surface").trim() || "#FFFFFF";
        if (current(turnoId)) setQr(await QRCode.toDataURL(next, { margin: 2, width: 224, errorCorrectionLevel: "M", color: { dark, light } }));
      }
      catch { if (current(turnoId)) setQr(""); }
      if (current(turnoId)) {
        finishStaffMutation(turnoId, "issue", true);
        setPending(null);
        setMessage("Enlace emitido. Vence en 24 horas. Compartilo manualmente con la persona indicada.");
      }
    } catch {
      if (current(turnoId)) setMessage("No pudimos confirmar si se emitió el enlace. Detuvimos nuevas emisiones para este turno; consultá con el equipo antes de continuar.");
    } finally {
      if (current(turnoId)) { setBusy(false); setConfirmIssue(false); setPending(pendingStaffMutation(turnoId)); }
    }
  }

  async function revoke() {
    if (busy || pendingStaffMutation(turnoId)) return;
    beginStaffMutation(turnoId, "revoke");
    setPending("revoke");
    setBusy(true); setMessage(""); setLink(""); setQr("");
    try {
      const result = await withActionDeadline(() => revokePatientIntakeLink(turnoId));
      if (!current(turnoId)) return;
      if (!result.ok) {
        if (!result.error.mutationOutcome) { finishStaffMutation(turnoId, "revoke", true); setPending(null); }
        setMessage(result.error.mutationOutcome ? "No pudimos confirmar la revocación. Detuvimos nuevos cambios de enlace para este turno; consultá con el equipo." : result.error.message);
        return;
      }
      finishStaffMutation(turnoId, "revoke", true);
      setPending(null);
      setLink(""); setQr("");
      setMessage(result.data.revoked ? "Enlace revocado. Quien ya había abierto el formulario no podrá enviarlo." : "No había un enlace activo para revocar.");
    } catch {
      if (current(turnoId)) setMessage("No pudimos confirmar la revocación. Detuvimos nuevos cambios de enlace para este turno; consultá con el equipo.");
    } finally {
      if (current(turnoId)) { setBusy(false); setPending(pendingStaffMutation(turnoId)); }
    }
  }

  async function review() {
    if (busy) return;
    setBusy(true); setMessage(""); setProposals([]);
    try {
      const result = await withActionDeadline(() => reviewPatientIntake(turnoId));
      if (!current(turnoId)) return;
      if (!result.ok) { setMessage(result.error.message); return; }
      setProposals(result.data);
      if (!result.data.length) setMessage("Todavía no hay aportes para este turno.");
    } catch { if (current(turnoId)) setMessage("No pudimos consultar los aportes. Reintentá más tarde."); }
    finally { if (current(turnoId)) setBusy(false); }
  }

  return <section className={styles.control} aria-label="Datos aportados por el paciente">
    <div className={styles.heading}><h3>Datos para el turno</h3><p>El paciente puede aportar datos administrativos. Su atención no depende de completar el formulario.</p></div>
    {confirmIssue && !pending ? <div className={styles.confirm} role="group" aria-label="Confirmar emisión del enlace"><p>Emitir un enlace nuevo invalida cualquier enlace anterior para este turno. Si una emisión previa quedó sin respuesta, consultá con el equipo antes de continuar.</p><div className={styles.actions}><button type="button" onClick={issue} disabled={busy} className="fi-btn fi-btn-primary">Confirmar emisión</button><button type="button" onClick={() => setConfirmIssue(false)} disabled={busy} className="fi-btn fi-btn-ghost">Volver</button></div></div> : null}
    {!confirmIssue || pending ? <div className={styles.actions}><button type="button" onClick={() => setConfirmIssue(true)} disabled={busy || Boolean(pending)} className="fi-btn fi-btn-primary">{link ? "Reemplazar enlace" : "Emitir enlace"}</button><button type="button" onClick={revoke} disabled={busy || Boolean(pending)} className="fi-btn fi-btn-ghost">Revocar enlace</button><button type="button" onClick={review} disabled={busy} className="fi-btn fi-btn-ghost">Consultar aportes</button></div> : null}
    {message ? <p role="status" className={styles.message}>{message}</p> : null}
    {pending ? <p className={styles.warning} role="alert">{pending === "issue" ? "Hay una emisión pendiente o sin confirmación." : "Hay una revocación pendiente o sin confirmación."} Este control no puede confirmar qué ocurrió. No emitas ni revoques otro enlace desde aquí; consultá con el equipo. Podés seguir atendiendo al paciente sin el formulario.</p> : null}
    {link ? <div className={styles.linkBox}>
      <p>Enlace de un solo turno · compartí únicamente con la persona indicada</p>
      <div className={styles.actions}><button type="button" onClick={() => void navigator.clipboard.writeText(link).then(() => setMessage("Enlace copiado.")).catch(() => setMessage("No pudimos copiarlo; seleccioná el enlace manualmente."))} className="fi-btn fi-btn-ghost">Copiar enlace</button></div>
      <input aria-label="Enlace para el formulario" readOnly value={link} onFocus={e => e.target.select()} />
      {qr ? <>
        {/* The QR is a local data URL containing a private token; no image optimizer request. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="Código QR local del enlace para este turno" width={224} height={224} className={styles.qr} />
      </> : <p>No pudimos mostrar el QR; podés copiar el enlace.</p>}
    </div> : null}
    {proposals.length ? <div className={styles.proposals}><h4>Aportes recibidos</h4><p>Origen: aportado por el paciente. Estos valores son propuestas y todavía no se incorporaron a la ficha.</p>{proposals.map(item => <article key={item.receiptId} className={styles.proposal}><small>{new Date(item.receivedAt).toLocaleString("es-AR")}</small><dl>{rows(item.answers).map(([label, value], i) => <div key={`${label}-${i}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></article>)}</div> : null}
  </section>;
}
