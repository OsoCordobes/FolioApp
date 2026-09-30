"use client";

import { useEffect, useRef, useState } from "react";
import { applyPatientIntakeIncorporation, cancelPatientIntakeIncorporation, getPatientIntakeIncorporationSnapshot, getPatientIntakeLinkState, issuePatientIntakeLink, patientIntakeIncorporationStatus, patientIntakeLinkOperationStatus, revokePatientIntakeLink, reviewPatientIntake } from "@/lib/patient-intake/staff";
import { beginLinkOperation, fenceConflictedOperation, isPendingLinkOperation, mayApplyLinkStatus, newLinkOperation, pendingLinkOperation, rememberedFence, rememberedLink, resolveLinkOperation, scopedResult, StaffAuthorityGate, withActionDeadline, type LinkOperation, type LinkSnapshot } from "@/lib/patient-intake/staff-recovery";
import { adoptIncorporationScope, beginIncorporation, conflictDraft, recoverDraftSelection, isPendingIncorporation, pendingIncorporation, reconcileIncorporation, toggleIncorporationSelection, type IncorporationComparison, type IncorporationOperation, type IncorporationDraft } from "@/lib/patient-intake/incorporation-recovery";
import type { IncorporationKey, PublicIncorporationResult } from "@/lib/patient-intake/incorporation";
import type { FolioError } from "@/lib/db/errors";
import styles from "./patient-intake-control.module.css";

type Proposal = { receiptId: string; receivedAt: string; questionnaireVersion: "admin.v1"; origin: "aportado por el paciente"; answers: Record<string, unknown> };
type StaffSnapshot = LinkSnapshot & { scope: string };
type OperationStatus = { status: "issued"; generation: string; invitationId: string; expiresAt: string }
  | { status: "revoked"; generation: string; revoked: boolean }
  | { status: "superseded" | "not_recorded"; generation: string };
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

/** Integration must explicitly opt in after the editor CAS package is accepted. */
export function PatientIntakeControl({ turnoId, incorporationEnabled = false }: { turnoId: string; incorporationEnabled?: boolean }) {
  return <PatientIntakeControlView key={turnoId} turnoId={turnoId} incorporationEnabled={incorporationEnabled} />;
}

function PatientIntakeControlView({ turnoId, incorporationEnabled }: { turnoId: string; incorporationEnabled: boolean }) {
  const [state, setState] = useState<StaffSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"issue" | "revoke" | null>(null);
  const [pending, setPending] = useState<LinkOperation | null>(null);
  const [link, setLink] = useState("");
  const [qr, setQr] = useState("");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [message, setMessage] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [comparison, setComparison] = useState<IncorporationComparison | null>(null);
  const [selection, setSelection] = useState<IncorporationKey[]>([]);
  const [incorporation, setIncorporation] = useState<IncorporationOperation | null>(null);
  const [incorporationMessage, setIncorporationMessage] = useState("");
  const [confirmIncorporation, setConfirmIncorporation] = useState(false);
  const [draft, setDraft] = useState<IncorporationDraft | null>(null);
  const [restoredSelection, setRestoredSelection] = useState(false);
  const observedContext = useRef<string | null>(null);
  const viewGeneration = useRef(0);
  const stateRequest = useRef(0);
  const authority = useRef(new StaffAuthorityGate());
  const busyRef = useRef(false);
  const current = (ticket: number) => viewGeneration.current === ticket;

  function clearComparison(preserveDraft = false) { setComparison(null); setSelection([]); setConfirmIncorporation(false); setRestoredSelection(false); if (!preserveDraft) setDraft(null); }

  function clearAuthority(message: string, mfaRequired = false) {
    clearComparison(); setIncorporation(null); setIncorporationMessage(""); observedContext.current = null;
    authority.current.setScope(null);
    setState(null); setLink(""); setQr(""); setPending(null); setProposals([]); setConfirm(null); setMessage(message); setNeedsMfa(mfaRequired);
  }

  async function showSavedLink(snapshot: StaffSnapshot, ticket: number, request: number) {
    const saved = rememberedLink(snapshot.scope, turnoId, snapshot);
    if (!saved || !current(ticket) || stateRequest.current !== request) { if (current(ticket) && stateRequest.current === request) { setLink(""); setQr(""); } return; }
    const url = `${window.location.origin}/aporte#token=${saved.token}`;
    setLink(url);
    try {
      const { default: QRCode } = await import("qrcode");
      const tokens = getComputedStyle(document.documentElement);
      const dark = tokens.getPropertyValue("--accent").trim() || "#6255C5";
      const light = tokens.getPropertyValue("--surface").trim() || "#FFFFFF";
      const image = await QRCode.toDataURL(url, { margin: 2, width: 224, errorCorrectionLevel: "M", color: { dark, light } });
      if (current(ticket) && stateRequest.current === request) setQr(image);
    } catch { if (current(ticket) && stateRequest.current === request) setQr(""); }
  }

  async function readState(ticket: number): Promise<StaffSnapshot | null> {
    const request = ++stateRequest.current;
    let result: Awaited<ReturnType<typeof getPatientIntakeLinkState>>;
    try { result = await withActionDeadline(() => getPatientIntakeLinkState(turnoId)); }
    catch {
      if (current(ticket) && stateRequest.current === request) clearAuthority("No pudimos comprobar tu acceso al turno. Reintentá más tarde.");
      return null;
    }
    if (!current(ticket) || stateRequest.current !== request) return null;
    if (!result.ok) { clearAuthority(result.error.message, result.error.code === "mfa_required"); return null; }
    const snapshot = result.data;
    setNeedsMfa(false);
    const contextChanged = observedContext.current !== null && observedContext.current !== snapshot.contextHash;
    if (contextChanged) authority.current.setScope(null);
    if (authority.current.setScope(snapshot.scope)) { setProposals([]); clearComparison(); setIncorporationMessage(""); setMessage(""); setConfirm(null); setLink(""); setQr(""); }
    observedContext.current = snapshot.contextHash;
    adoptIncorporationScope(snapshot.scope, turnoId);
    setIncorporation(incorporationEnabled ? pendingIncorporation(snapshot.scope, turnoId) : null);
    setState(snapshot);
    const savedPending = pendingLinkOperation(snapshot.scope, turnoId);
    setPending(savedPending);
    await showSavedLink(snapshot, ticket, request);
    return snapshot;
  }

  async function applyStatus(operation: LinkOperation, status: OperationStatus, ticket: number, stamp: ReturnType<StaffAuthorityGate["capture"]>) {
    if (!current(ticket) || !mayApplyLinkStatus(authority.current, stamp, operation)) return;
    if (status.status === "not_recorded") {
      setPending(operation);
      setMessage("Todavía no hay confirmación. Podés comprobar de nuevo o reintentar sin duplicar.");
      return;
    }
    resolveLinkOperation(operation, status.status, status.status === "issued" || status.status === "revoked" ? status : undefined);
    setPending(null);
    const snapshot = await readState(ticket);
    if (!snapshot || !current(ticket) || !authority.current.allows(stamp)) return;
    if (status.status === "issued" && operation.kind === "issue") setMessage("Enlace emitido. Compartilo manualmente con la persona indicada.");
    else if (status.status === "revoked") setMessage(status.revoked ? "Enlace revocado. Quien ya había abierto el formulario no podrá enviarlo." : "Ya podés emitir un enlace nuevo de forma segura.");
    else setMessage("El enlace cambió. Revisá el estado actual y elegí qué hacer.");
  }

  async function checkOperation(operation: LinkOperation, ticket: number) {
    const stamp = authority.current.capture();
    if (stamp.scope !== operation.scope || !isPendingLinkOperation(operation)) return;
    const result = await withActionDeadline(() => patientIntakeLinkOperationStatus(turnoId, operation.scope, operation.operationId));
    if (!current(ticket) || !mayApplyLinkStatus(authority.current, stamp, operation)) return;
    if (!result.ok) {
      if (result.error.code === "mfa_required") clearAuthority(result.error.message, true);
      else setMessage(result.error.message);
      return;
    }
    await applyStatus(operation, result.data, ticket, stamp);
  }

  useEffect(() => {
    const ticket = ++viewGeneration.current;
    ++stateRequest.current;
    authority.current.setScope(null); observedContext.current = null; clearComparison(); setIncorporation(null); setIncorporationMessage(""); setState(null); setLink(""); setQr(""); setPending(null); setProposals([]); setConfirm(null); setMessage(""); setNeedsMfa(false); setBusy(false); busyRef.current = false;
    void (async () => {
      try {
        const snapshot = await readState(ticket);
        if (!snapshot || !current(ticket)) return;
        const operation = pendingLinkOperation(snapshot.scope, turnoId);
        if (operation) await checkOperation(operation, ticket);
        const saved = incorporationEnabled && pendingIncorporation(snapshot.scope, turnoId);
        if (saved && current(ticket)) await runIncorporationOperation(saved, "status", ticket);
      } catch { if (current(ticket)) setMessage("No pudimos comprobar el enlace. Reintentá más tarde."); }
    })();
    const recheck = () => {
      ++viewGeneration.current; ++stateRequest.current; authority.current.setScope(null);
      clearComparison(); setProposals([]); setLink(""); setQr(""); setState(null); setConfirm(null);
      setBusy(false); busyRef.current = false;
      if (document.visibilityState === "hidden") {
        return;
      }
      void readState(viewGeneration.current);
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    // Invalidate every async continuation owned by this render before the next turno mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { ++viewGeneration.current; ++stateRequest.current; window.removeEventListener("focus", recheck); document.removeEventListener("visibilitychange", recheck); };
    // Each turno mount owns a distinct generation, including A→B→A.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnoId, incorporationEnabled]);

  async function runOperation(operation: LinkOperation, ticket: number) {
    if (busyRef.current) return;
    const stamp = authority.current.capture();
    if (stamp.scope !== operation.scope || !isPendingLinkOperation(operation)) return;
    busyRef.current = true; setBusy(true); setMessage("");
    try {
      const result = await withActionDeadline(() => operation.kind === "issue"
        ? issuePatientIntakeLink(turnoId, operation.scope, operation.operationId, operation.expectedGeneration, operation.expectedContext, operation.tokenHash!)
        : revokePatientIntakeLink(turnoId, operation.scope, operation.operationId, operation.expectedGeneration, operation.expectedContext));
      if (!current(ticket) || !mayApplyLinkStatus(authority.current, stamp, operation)) return;
      if (result.ok) { await applyStatus(operation, result.data, ticket, stamp); return; }
      if (result.error.code === "conflict") {
        const snapshot = await readState(ticket);
        if (snapshot && snapshot.scope === operation.scope && fenceConflictedOperation(operation, snapshot)) {
          setPending(null);
          setMessage("El enlace cambió. Revisá el estado actual y elegí nuevamente qué hacer.");
        } else if (current(ticket) && authority.current.allows(stamp)) setMessage("No pudimos confirmar el resultado. Comprobalo antes de continuar.");
      } else if (result.error.code === "auth_required" || result.error.code === "forbidden" || result.error.code === "mfa_required") {
        const refreshed = await readState(ticket);
        if (refreshed && current(ticket)) setMessage(result.error.message);
      } else setMessage("No pudimos confirmar el resultado. Comprobalo antes de continuar.");
    } catch { if (current(ticket) && authority.current.allows(stamp)) setMessage("No pudimos confirmar el resultado. Comprobalo antes de continuar."); }
    finally { if (current(ticket)) { busyRef.current = false; setBusy(false); setConfirm(null); setPending(authority.current.scope ? pendingLinkOperation(authority.current.scope, turnoId) : null); } }
  }

  async function start(kind: "issue" | "revoke") {
    if (!state || busyRef.current || pendingLinkOperation(state.scope, turnoId)) return;
    if (kind === "issue" && !link && !rememberedFence(state.scope, turnoId, state)) { setMessage("Prepará primero un enlace seguro con Revocar enlace."); return; }
    const ticket = viewGeneration.current;
    const stamp = authority.current.capture();
    if (stamp.scope !== state.scope) return;
    busyRef.current = true; setBusy(true);
    try {
      const operation = await newLinkOperation(state.scope, turnoId, state, kind);
      if (!current(ticket) || !authority.current.allows(stamp)) return;
      beginLinkOperation(operation);
      setPending(operation); setLink(""); setQr(""); setConfirm(null);
      busyRef.current = false;
      await runOperation(operation, ticket);
    } catch { if (current(ticket) && authority.current.allows(stamp)) setMessage("No pudimos preparar el cambio. Reintentá más tarde."); }
    finally { if (current(ticket) && busyRef.current) { busyRef.current = false; setBusy(false); } }
  }

  async function retryPending() {
    if (!pending || busyRef.current) return;
    await runOperation(pending, viewGeneration.current);
  }

  async function checkPending() {
    if (!pending || busyRef.current) return;
    const ticket = viewGeneration.current;
    const stamp = authority.current.capture();
    busyRef.current = true; setBusy(true);
    try { await checkOperation(pending, ticket); }
    catch { if (current(ticket) && authority.current.allows(stamp) && isPendingLinkOperation(pending)) setMessage("No pudimos comprobar el resultado. Reintentá más tarde."); }
    finally { if (current(ticket)) { busyRef.current = false; setBusy(false); } }
  }

  async function copyLink() {
    if (!state || !link || busyRef.current) return;
    const ticket = viewGeneration.current;
    const stamp = authority.current.capture();
    busyRef.current = true; setBusy(true);
    try {
      const refreshed = await readState(ticket);
      const saved = refreshed && rememberedLink(refreshed.scope, turnoId, refreshed);
      if (!refreshed || refreshed.scope !== state.scope || !saved || `${window.location.origin}/aporte#token=${saved.token}` !== link || !current(ticket) || !authority.current.allows(stamp)) return;
      await navigator.clipboard.writeText(link);
      if (current(ticket) && authority.current.allows(stamp)) setMessage("Enlace copiado.");
    } catch { if (current(ticket) && authority.current.allows(stamp)) setMessage("No pudimos copiarlo; seleccioná el enlace manualmente."); }
    finally { if (current(ticket)) { busyRef.current = false; setBusy(false); } }
  }

  async function review() {
    if (!state || busyRef.current || incorporation) return;
    const ticket = viewGeneration.current;
    const stamp = authority.current.capture();
    if (stamp.scope !== state.scope) return;
    busyRef.current = true; setBusy(true); setMessage(""); setProposals([]);
    try {
      const result = await withActionDeadline(() => reviewPatientIntake(turnoId, state.scope));
      if (!current(ticket) || !authority.current.allows(stamp)) return;
      if (!result.ok) {
        if (accessLost(result.error)) clearAuthority(result.error.message, result.error.code === "mfa_required");
        else setMessage(result.error.message);
        return;
      }
      const visible = scopedResult(authority.current, stamp, result.data);
      if (!visible) return;
      setProposals(visible);
      if (!visible.length) setMessage("Todavía no hay aportes para este turno.");
    } catch { if (current(ticket) && authority.current.allows(stamp)) setMessage("No pudimos consultar los aportes. Reintentá más tarde."); }
    finally { if (current(ticket)) { busyRef.current = false; setBusy(false); } }
  }

  function accessLost(error: FolioError) {
    return ["auth_required", "forbidden", "mfa_required", "no_org", "not_found"].includes(error.code);
  }

  async function compare(receiptId: string) {
    if (!incorporationEnabled || !state || busyRef.current || pendingIncorporation(state.scope, turnoId)) return;
    const ticket = viewGeneration.current;
    const stamp = authority.current.capture();
    if (stamp.scope !== state.scope) return;
    const savedDraft = draft?.receiptId === receiptId ? draft : null;
    busyRef.current = true; setBusy(true); clearComparison(Boolean(savedDraft)); setIncorporationMessage("");
    try {
      const result = await withActionDeadline(() => getPatientIntakeIncorporationSnapshot(turnoId, state.scope, receiptId));
      if (!current(ticket) || !authority.current.allows(stamp)) return;
      if (!result.ok) {
        if (accessLost(result.error)) clearAuthority(result.error.message, result.error.code === "mfa_required");
        else setIncorporationMessage(result.error.message);
        return;
      }
      if (result.data.receiptId !== receiptId || result.data.contextHash !== observedContext.current) {
        clearComparison(); setProposals([]);
        const refreshed = await readState(ticket);
        if (refreshed && current(ticket)) setIncorporationMessage("El turno o el paciente cambiaron. Volvé a consultar los aportes.");
        return;
      }
      setComparison(result.data);
      if (savedDraft) {
        const recovered = recoverDraftSelection(savedDraft, state.scope, turnoId, result.data);
        setDraft(null);
        if (recovered !== null) { setSelection(recovered); setRestoredSelection(true); }
      }
    } catch { if (current(ticket) && authority.current.allows(stamp)) setIncorporationMessage("No pudimos comparar los datos. Reintentá más tarde."); }
    finally { if (current(ticket)) { busyRef.current = false; setBusy(false); } }
  }

  function acceptIncorporation(operation: IncorporationOperation, result: PublicIncorporationResult) {
    const resolution = reconcileIncorporation(operation, result);
    if (resolution !== "terminal") {
      setIncorporationMessage("Todavía no hay un resultado confirmado. Comprobá o cancelá esta misma operación antes de continuar.");
      return;
    }
    setIncorporation(null); clearComparison(); setProposals([]);
    if (result.status === "conflict") setDraft(conflictDraft(operation));
    setIncorporationMessage(result.status === "applied"
      ? "Datos incorporados. Aportado por el paciente, incorporado por personal; sin verificar."
      : result.status === "unchanged" ? "Los datos seleccionados ya coincidían con la ficha. No hubo cambios."
        : result.status === "cancelled" ? "Cancelación confirmada. Podés elegir otro aporte."
          : "La ficha o el turno cambiaron. Tu selección quedó pendiente; actualizá la comparación y revisala nuevamente.");
  }

  async function runIncorporationOperation(operation: IncorporationOperation, action: "apply" | "status" | "cancel", ticket = viewGeneration.current) {
    if (!incorporationEnabled || busyRef.current || !isPendingIncorporation(operation)) return;
    const stamp = authority.current.capture();
    if (stamp.scope !== operation.scope) return;
    busyRef.current = true; setBusy(true); setConfirmIncorporation(false); setIncorporationMessage("");
    try {
      const result = await withActionDeadline(() => action === "apply"
        ? applyPatientIntakeIncorporation({ ...operation, selectedKeys: [...operation.selectedKeys] })
        : action === "cancel" ? cancelPatientIntakeIncorporation(turnoId, operation.scope, operation.operationId)
          : patientIntakeIncorporationStatus(turnoId, operation.scope, operation.operationId));
      if (!current(ticket) || !authority.current.allows(stamp) || !isPendingIncorporation(operation)) return;
      if (!result.ok) {
        if (accessLost(result.error)) clearAuthority(result.error.message, result.error.code === "mfa_required");
        else setIncorporationMessage(`${result.error.message} Comprobá o cancelá esta misma operación antes de elegir otra.`);
        return;
      }
      acceptIncorporation(operation, result.data);
    } catch {
      if (current(ticket) && authority.current.allows(stamp) && isPendingIncorporation(operation)) {
        setIncorporationMessage("Se interrumpió la respuesta. La operación y tu selección se conservaron. Comprobá el resultado o cancelá la misma operación.");
      }
    } finally { if (current(ticket)) { busyRef.current = false; setBusy(false); } }
  }

  async function incorporate() {
    if (!state || !comparison || !selection.length || busyRef.current || !confirmIncorporation) return;
    if (comparison.contextHash !== observedContext.current || authority.current.scope !== state.scope) return;
    try {
      const operation = beginIncorporation(state.scope, turnoId, comparison, selection);
      setIncorporation(operation);
      await runIncorporationOperation(operation, "apply");
    } catch { setIncorporationMessage("No pudimos preparar la selección. Comprobá si hay una operación pendiente."); }
  }

  return <section className={styles.control} aria-label="Datos aportados por el paciente">
    <div className={styles.heading}><h3>Datos para el turno</h3><p>El paciente puede aportar datos administrativos. Su atención no depende de completar el formulario.</p></div>
    {confirm && !pending ? <div className={styles.confirm} role="group" aria-label={confirm === "issue" ? "Confirmar emisión del enlace" : "Confirmar revocación del enlace"}>
      <p>{confirm === "issue" ? "Emitir un enlace nuevo invalida el anterior para este turno." : "Esta acción desactiva cualquier enlace anterior y prepara uno nuevo de forma segura."}</p>
      <div className={styles.actions}><button type="button" onClick={() => void start(confirm)} disabled={busy} className="fi-btn fi-btn-primary">{confirm === "issue" ? "Confirmar emisión" : "Confirmar revocación"}</button><button type="button" onClick={() => setConfirm(null)} disabled={busy} className="fi-btn fi-btn-ghost">Volver</button></div>
    </div> : null}
    {!confirm || pending ? <div className={styles.actions}><button type="button" onClick={() => setConfirm("issue")} disabled={busy || !state || Boolean(pending) || Boolean(incorporation) || Boolean(state && !link && !rememberedFence(state.scope, turnoId, state))} className="fi-btn fi-btn-primary">{link ? "Reemplazar enlace" : "Emitir enlace"}</button><button type="button" onClick={() => setConfirm("revoke")} disabled={busy || !state || Boolean(pending) || Boolean(incorporation)} className="fi-btn fi-btn-ghost">Revocar enlace</button><button type="button" onClick={() => void review()} disabled={busy || !state || Boolean(incorporation)} className="fi-btn fi-btn-ghost">Consultar aportes</button></div> : null}
    {message ? <p role="status" className={styles.message}>{message}</p> : null}
    {needsMfa ? <a href="/seguridad/mfa?next=/calendario" className="fi-btn fi-btn-primary">Verificar mi acceso</a> : null}
    {state && !link && !pending && !rememberedFence(state.scope, turnoId, state) ? <p className={styles.warning}>{state.active ? "Hay un enlace activo que esta pantalla no puede recuperar. " : ""}Antes de emitir, usá Revocar enlace para desactivar cualquiera anterior y preparar uno nuevo de forma segura.</p> : null}
    {pending ? <div className={styles.warning} role="alert"><p>{pending.kind === "issue" ? "Hay una emisión pendiente de confirmar." : "Hay una revocación pendiente de confirmar."} Podés comprobar el resultado o reintentar sin duplicar. El formulario no condiciona la atención.</p><div className={styles.actions}><button type="button" onClick={() => void checkPending()} disabled={busy} className="fi-btn fi-btn-ghost">Comprobar resultado</button><button type="button" onClick={() => void retryPending()} disabled={busy} className="fi-btn fi-btn-ghost">Reintentar sin duplicar</button></div></div> : null}
    {link ? <div className={styles.linkBox}>
      <p>Enlace de un solo turno · compartí únicamente con la persona indicada</p>
      <div className={styles.actions}><button type="button" onClick={() => void copyLink()} className="fi-btn fi-btn-ghost">Copiar enlace</button></div>
      <input aria-label="Enlace para el formulario" readOnly value={link} onFocus={e => e.target.select()} />
      {qr ? <>
        {/* The QR is a local data URL containing a private token; no image optimizer request. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="Código QR local del enlace para este turno" width={224} height={224} className={styles.qr} />
      </> : <p>No pudimos mostrar el QR; podés copiar el enlace.</p>}
    </div> : null}
    {proposals.length ? <div className={styles.proposals}><h4>Aportes recibidos</h4><p>Origen: aportado por el paciente. Estos valores son propuestas y todavía no se incorporaron a la ficha.</p>{proposals.map(item => <article key={item.receiptId} className={styles.proposal}><small>{new Date(item.receivedAt).toLocaleString("es-AR")}</small><dl>{rows(item.answers).map(([label, value], i) => <div key={`${label}-${i}`}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{incorporationEnabled ? <button type="button" className="fi-btn fi-btn-ghost" disabled={busy || Boolean(incorporation)} onClick={() => void compare(item.receiptId)}>Comparar con la ficha</button> : null}</article>)}</div> : null}
    {incorporationMessage ? <p role="status" className={styles.message}>{incorporationMessage}</p> : null}
    {draft ? <div className={styles.warning} role="group" aria-label="Selección pendiente de revisión"><p>Tu selección: {draft.selectedKeys.map(key => labels[key]).join(", ")}. Actualizá la comparación para revisar los datos actuales antes de confirmar.</p><button type="button" className="fi-btn fi-btn-ghost" disabled={busy || !state || Boolean(incorporation)} onClick={() => void compare(draft.receiptId)}>Actualizar comparación</button></div> : null}
    {comparison ? <section className={styles.comparison} aria-label="Comparación con la ficha">
      <h4>Elegí qué incorporar</h4><p>Los campos sin seleccionar conservan el valor de la ficha. {restoredSelection ? "Recuperamos las claves disponibles de tu selección anterior. Revisá los valores actuales y confirmá nuevamente." : "Ningún dato está seleccionado de antemano."}</p>
      <p className={styles.origin}>Al incorporar, la procedencia será: aportado por el paciente, incorporado por personal; sin verificar.</p>
      <fieldset disabled={busy || Boolean(incorporation)}><legend>Datos administrativos · admin.v1</legend>
        <div className={styles.columnHead} aria-hidden="true"><span>Incorporar</span><span>Actual en la ficha</span><span>Aportado por el paciente</span></div>
        {comparison.fields.filter(field => field.key !== "numeroDocumento" || !comparison.fields.some(value => value.key === "tipoDocumento")).map(field => {
          const document = field.key === "tipoDocumento" || field.key === "numeroDocumento";
          const number = comparison.fields.find(value => value.key === "numeroDocumento");
          const type = comparison.fields.find(value => value.key === "tipoDocumento");
          const available = !document || Boolean(number && type);
          const display = (value: string | null) => value || "Sin dato";
          return <label className={styles.compareRow} key={field.key}>
            <span className={styles.selectCell}><input type="checkbox" checked={selection.includes(field.key)} disabled={!available} onChange={event => { setSelection(toggleIncorporationSelection(selection, field.key, event.target.checked)); setConfirmIncorporation(false); }} /><span>{document ? "Documento (tipo y número)" : labels[field.key]}</span></span>
            <span className={styles.valueCell}><small>Actual en la ficha</small>{document ? `${display(type?.current ?? null)} · ${display(number?.current ?? null)}` : display(field.current)}</span>
            <span className={styles.valueCell}><small>Aportado por el paciente</small>{document ? `${display(type?.proposed ?? null)} · ${display(number?.proposed ?? null)}${available ? "" : " · Aporte incompleto: no incorporable"}` : field.proposed}</span>
          </label>;
        })}
      </fieldset>
      {confirmIncorporation ? <div className={styles.confirm} role="group" aria-label="Confirmar incorporación"><p>Se incorporarán {selection.length} campos seleccionados. El resto de la ficha conserva sus datos.</p><div className={styles.actions}><button type="button" className="fi-btn fi-btn-primary" disabled={busy || !selection.length} onClick={() => void incorporate()}>Confirmar incorporación</button><button type="button" className="fi-btn fi-btn-ghost" disabled={busy} onClick={() => setConfirmIncorporation(false)}>Volver a comparar</button></div></div> : <div className={styles.actions}><button type="button" className="fi-btn fi-btn-primary" disabled={busy || Boolean(incorporation) || !selection.length} onClick={() => setConfirmIncorporation(true)}>Revisar selección</button><button type="button" className="fi-btn fi-btn-ghost" disabled={busy || Boolean(incorporation)} onClick={() => clearComparison()}>Cerrar comparación</button></div>}
    </section> : null}
    {incorporation ? <div className={styles.warning} role="group" aria-label="Incorporación pendiente"><p>Hay una incorporación pendiente de confirmar. Tu selección y la operación se conservaron; no se puede iniciar otra hasta confirmar su resultado o cancelación.</p><p>Selección: {incorporation.selectedKeys.map(key => labels[key]).join(", ")}.</p><div className={styles.actions}><button type="button" className="fi-btn fi-btn-ghost" disabled={busy || !state} onClick={() => void runIncorporationOperation(incorporation, "status")}>Comprobar incorporación</button><button type="button" className="fi-btn fi-btn-ghost" disabled={busy || !state} onClick={() => void runIncorporationOperation(incorporation, "apply")}>Reanudar misma incorporación</button><button type="button" className="fi-btn fi-btn-ghost" disabled={busy || !state} onClick={() => void runIncorporationOperation(incorporation, "cancel")}>Cancelar misma operación</button></div></div> : null}
  </section>;
}
