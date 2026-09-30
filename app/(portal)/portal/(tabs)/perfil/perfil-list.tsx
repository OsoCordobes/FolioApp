"use client";

/**
 * Folio · Portal · edición de contacto por ficha (Fase 3 · P8).
 *
 * Una tarjeta por ficha `paciente` linkeada (una por consultorio). El nombre y el
 * documento se muestran en SÓLO LECTURA (identidad · el paciente no los edita desde
 * el portal). El teléfono/email/domicilio son editables; al guardar, la server action
 * aplica la allow-list, recomputa los hashes por org y persiste. Este componente sólo
 * maneja la interacción y refresca el segment tras cada cambio.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import type { PortalPerfilView } from "@/lib/db/portal-perfil";

import { actualizarContactoAction } from "./actions";

export function PerfilList({ perfiles }: { perfiles: PortalPerfilView[] }) {
  if (perfiles.length === 0) {
    return (
      <div className="pt-empty pt-empty-hero">
        <h2 className="pt-empty-title">Todavía no hay fichas vinculadas</h2>
        <p className="pt-empty-sub">
          Vinculá tu ficha desde el inicio del portal para gestionar tus datos.
        </p>
        <Link href="/portal" className="fi-btn fi-btn-secondary pt-empty-action">Ir al inicio del portal</Link>
      </div>
    );
  }

  return (
    <ul className="pt-org-list">
      {perfiles.map((p) => (
        <li key={`${p.pacienteId}:${p.identidadId}:${p.adminEditor?.editorScope ?? "unavailable"}`} className="pt-card">
          <PerfilCard perfil={p} />
        </li>
      ))}
    </ul>
  );
}

function PerfilCard({ perfil }: { perfil: PortalPerfilView }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(perfil.adminEditor);
  const [blocked, setBlocked] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const savedFrom = useRef<PortalPerfilView | null>(null);
  const live = useRef(false);
  const currentScope = useRef(perfil.adminEditor?.editorScope);
  currentScope.current = perfil.adminEditor?.editorScope;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  const [email, setEmail] = useState(perfil.email ?? "");
  const [telefono, setTelefono] = useState(perfil.telefono ?? "");
  const [calle, setCalle] = useState(perfil.domicilioCalle ?? "");
  const [numero, setNumero] = useState(perfil.domicilioNumero ?? "");
  const [ciudad, setCiudad] = useState(perfil.domicilioCiudad ?? "");
  const [provincia, setProvincia] = useState(perfil.domicilioProvincia ?? "");
  const [cp, setCp] = useState(perfil.domicilioCp ?? "");

  // Only a confirmed save can replace its draft from a refreshed authoritative read.
  useEffect(() => {
    if (!saved || savedFrom.current === perfil || revoked || !perfil.adminEditor || currentScope.current !== snapshot?.editorScope) return;
    setSnapshot(perfil.adminEditor);
    setEmail(perfil.email ?? ""); setTelefono(perfil.telefono ?? "");
    setCalle(perfil.domicilioCalle ?? ""); setNumero(perfil.domicilioNumero ?? "");
    setCiudad(perfil.domicilioCiudad ?? ""); setProvincia(perfil.domicilioProvincia ?? ""); setCp(perfil.domicilioCp ?? "");
    setBlocked(false); setSaved(false);
  }, [perfil, saved, revoked, snapshot]);

  const nombreCompleto = [perfil.nombre, perfil.apellido].filter(Boolean).join(" ") || "Tu ficha";

  const guardar = () => {
    if (pending || blocked || revoked || !snapshot || snapshot.editorScope !== currentScope.current) return;
    setMsg(null);
    if (!telefono.trim()) {
      setMsg({ text: "El teléfono no puede quedar vacío.", tone: "err" });
      return;
    }
    startTransition(async () => {
      try {
      const res = await actualizarContactoAction({
        ...snapshot,
        pacienteId: perfil.pacienteId,
        // Sólo contacto/domicilio: la server action + el data layer .strict()
        // rechazan cualquier otra clave; el nombre/documento nunca se envían.
        email: email.trim() || null,
        telefono: telefono.trim(),
        domicilioCalle: calle.trim() || null,
        domicilioNumero: numero.trim() || null,
        domicilioCiudad: ciudad.trim() || null,
        domicilioProvincia: provincia.trim() || null,
        domicilioCp: cp.trim() || null,
      });
      if (!live.current || currentScope.current !== snapshot.editorScope) return;
      if (!res.ok) {
        if (["auth_required", "mfa_required", "no_org", "forbidden", "not_found"].includes(res.error.code)) {
          setRevoked(true);
          setEmail(""); setTelefono(""); setCalle(""); setNumero(""); setCiudad(""); setProvincia(""); setCp("");
        } else if (res.error.code !== "validation") setBlocked(true);
        setMsg({ text: res.error.message, tone: "err" });
        return;
      }
      savedFrom.current = perfil;
      setSaved(true); setBlocked(true);
      setMsg({ text: "Datos actualizados.", tone: "ok" });
      router.refresh();
      } catch {
        if (!live.current || currentScope.current !== snapshot.editorScope) return;
        setBlocked(true);
        setMsg({ text: "No pudimos confirmar el guardado. Conservá tu borrador y revisá el perfil actual antes de volver a editar.", tone: "err" });
      }
    });
  };

  if (revoked || snapshot?.editorScope !== perfil.adminEditor?.editorScope) return (
    <p role="alert" className="pt-msg pt-msg-err">Esta edición ya no está disponible. Volvé a abrir el perfil con tu sesión actual.</p>
  );

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ email, telefono, calle, numero, ciudad, provincia, cp }, null, 2));
      if (live.current && currentScope.current === snapshot?.editorScope) setCopied(true);
    } catch {
      if (live.current && currentScope.current === snapshot?.editorScope) setMsg({ text: "No pudimos copiar el borrador. Conservá los datos antes de recargar.", tone: "err" });
    }
  };

  return (
    <form
      className="au-form"
      aria-busy={pending}
      aria-label={`Datos de contacto en ${perfil.organizacionNombre ?? "tu consultorio"}`}
      onSubmit={(e) => {
        e.preventDefault();
        guardar();
      }}
    >
      <div className="pt-card-row">
        <strong className="pt-card-title">{perfil.organizacionNombre ?? "Consultorio"}</strong>
      </div>

      {/* Identidad · SÓLO LECTURA (no editable desde el portal). */}
      <p className="pt-card-meta pt-perfil-id">
        {nombreCompleto}
        {perfil.documento ? ` · Doc. ${perfil.documento}` : ""}
      </p>

      <label className="au-field">
        <span>Teléfono</span>
        <input
          type="tel"
          value={telefono}
          maxLength={30}
          onChange={(e) => { setTelefono(e.target.value); setCopied(false); }}
          disabled={pending || saved || !snapshot}
          required
        />
      </label>

      <label className="au-field">
        <span>Email</span>
        <input
          type="email"
          value={email}
          maxLength={320}
          placeholder="tu@email.com"
          onChange={(e) => { setEmail(e.target.value); setCopied(false); }}
          disabled={pending || saved || !snapshot}
        />
      </label>

      <div className="pt-grid-2">
        <label className="au-field">
          <span>Calle</span>
          <input
            type="text"
            value={calle}
            maxLength={120}
            onChange={(e) => { setCalle(e.target.value); setCopied(false); }}
            disabled={pending || saved || !snapshot}
          />
        </label>
        <label className="au-field">
          <span>Número</span>
          <input
            type="text"
            value={numero}
            maxLength={20}
            onChange={(e) => { setNumero(e.target.value); setCopied(false); }}
            disabled={pending || saved || !snapshot}
          />
        </label>
      </div>

      <div className="pt-grid-3">
        <label className="au-field">
          <span>Ciudad</span>
          <input
            type="text"
            value={ciudad}
            maxLength={60}
            onChange={(e) => { setCiudad(e.target.value); setCopied(false); }}
            disabled={pending || saved || !snapshot}
          />
        </label>
        <label className="au-field">
          <span>Provincia</span>
          <input
            type="text"
            value={provincia}
            maxLength={60}
            onChange={(e) => { setProvincia(e.target.value); setCopied(false); }}
            disabled={pending || saved || !snapshot}
          />
        </label>
        <label className="au-field">
          <span>CP</span>
          <input
            type="text"
            value={cp}
            maxLength={15}
            onChange={(e) => { setCp(e.target.value); setCopied(false); }}
            disabled={pending || saved || !snapshot}
          />
        </label>
      </div>

      <button type="submit" className="fi-btn fi-btn-primary au-submit" disabled={pending || !snapshot || blocked}>
        {pending ? "Guardando…" : "Guardar cambios"}
      </button>

      {!snapshot ? <p role="alert" className="pt-msg pt-msg-err">No pudimos verificar los datos del perfil. Recargá la página antes de editar.</p> : null}
      {blocked && !saved ? (
        <div>
          <button type="button" className="fi-btn fi-btn-secondary" disabled={pending} onClick={() => void copyDraft()}>Copiar borrador</button>
          <button type="button" className="fi-btn fi-btn-ghost" disabled={pending || !copied} onClick={() => window.location.reload()}>Recargar datos para revisar</button>
        </div>
      ) : null}
      {msg ? (
        <p role="status" className={`pt-msg ${msg.tone === "err" ? "pt-msg-err" : "pt-msg-ok"}`}>
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}
