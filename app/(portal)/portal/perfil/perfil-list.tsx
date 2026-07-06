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

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { PortalPerfilView } from "@/lib/db/portal-perfil";

import { actualizarContactoAction } from "./actions";

export function PerfilList({ perfiles }: { perfiles: PortalPerfilView[] }) {
  if (perfiles.length === 0) {
    return (
      <p className="pt-empty" style={{ color: "var(--ink-2)", fontSize: "var(--fs-sm)" }}>
        Todavía no hay ninguna ficha vinculada a tu cuenta. Vinculá tu ficha desde el
        portal para gestionar tus datos.
      </p>
    );
  }

  return (
    <ul className="pt-org-list" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 16 }}>
      {perfiles.map((p) => (
        <li key={p.identidadId} className="pt-card" style={{ padding: "18px 20px" }}>
          <PerfilCard perfil={p} />
        </li>
      ))}
    </ul>
  );
}

function PerfilCard({ perfil }: { perfil: PortalPerfilView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  const [email, setEmail] = useState(perfil.email ?? "");
  const [telefono, setTelefono] = useState(perfil.telefono ?? "");
  const [calle, setCalle] = useState(perfil.domicilioCalle ?? "");
  const [numero, setNumero] = useState(perfil.domicilioNumero ?? "");
  const [ciudad, setCiudad] = useState(perfil.domicilioCiudad ?? "");
  const [provincia, setProvincia] = useState(perfil.domicilioProvincia ?? "");
  const [cp, setCp] = useState(perfil.domicilioCp ?? "");

  const nombreCompleto = [perfil.nombre, perfil.apellido].filter(Boolean).join(" ") || "Tu ficha";

  const guardar = () => {
    setMsg(null);
    if (!telefono.trim()) {
      setMsg({ text: "El teléfono no puede quedar vacío.", tone: "err" });
      return;
    }
    startTransition(async () => {
      const res = await actualizarContactoAction({
        identidadId: perfil.identidadId,
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
      if (!res.ok) {
        setMsg({ text: res.error.message, tone: "err" });
        return;
      }
      setMsg({ text: "Datos actualizados.", tone: "ok" });
      router.refresh();
    });
  };

  return (
    <form
      className="au-form"
      onSubmit={(e) => {
        e.preventDefault();
        guardar();
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <strong>{perfil.organizacionNombre ?? "Consultorio"}</strong>
      </div>

      {/* Identidad · SÓLO LECTURA (no editable desde el portal). */}
      <p style={{ margin: "6px 0 14px", color: "var(--ink-2)", fontSize: "var(--fs-sm)" }}>
        {nombreCompleto}
        {perfil.documento ? ` · Doc. ${perfil.documento}` : ""}
      </p>

      <label className="au-field">
        <span>Teléfono</span>
        <input
          type="tel"
          value={telefono}
          maxLength={30}
          onChange={(e) => setTelefono(e.target.value)}
          disabled={pending}
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
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
        />
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
        <label className="au-field">
          <span>Calle</span>
          <input
            type="text"
            value={calle}
            maxLength={120}
            onChange={(e) => setCalle(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className="au-field">
          <span>Número</span>
          <input
            type="text"
            value={numero}
            maxLength={20}
            onChange={(e) => setNumero(e.target.value)}
            disabled={pending}
          />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr", gap: 8 }}>
        <label className="au-field">
          <span>Ciudad</span>
          <input
            type="text"
            value={ciudad}
            maxLength={60}
            onChange={(e) => setCiudad(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className="au-field">
          <span>Provincia</span>
          <input
            type="text"
            value={provincia}
            maxLength={60}
            onChange={(e) => setProvincia(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className="au-field">
          <span>CP</span>
          <input
            type="text"
            value={cp}
            maxLength={15}
            onChange={(e) => setCp(e.target.value)}
            disabled={pending}
          />
        </label>
      </div>

      <button type="submit" className="fi-btn fi-btn-primary au-submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar cambios"}
      </button>

      {msg ? (
        <p
          role="status"
          style={{
            margin: "10px 0 0",
            fontSize: "var(--fs-sm)",
            color: msg.tone === "err" ? "var(--red)" : "var(--green, #2E7D5B)",
          }}
        >
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}
