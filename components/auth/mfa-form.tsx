"use client";

import { useState, useTransition } from "react";
import { enrollMfaAction, verifyMfaAction } from "@/app/(public)/seguridad/mfa/actions";
import type { MfaStatus } from "@/lib/auth/mfa-access";
import type { MfaEnrollment } from "@/lib/auth/mfa-operations";

export function MfaForm({ status, factors, next }: {
  status: MfaStatus; factors: { id: string; name: string }[]; next: string;
}) {
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [factorId, setFactorId] = useState(factors[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [name, setName] = useState("Mi autenticador");
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);
  const [pending, startTransition] = useTransition();
  const canEnroll = !status.hasVerifiedFactor || (status.allowed && status.sessionValid);
  const qr = enrollment?.qrCode.startsWith("data:image/svg+xml") ? enrollment.qrCode
    : enrollment ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrollment.qrCode)}` : "";

  function enroll() {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await enrollMfaAction(name);
        if (!result.ok) { setMessage(result.error.message); return; }
        setEnrollment(result.data); setFactorId(result.data.factorId); setCode("");
      } catch { setMessage("No pudimos iniciar la configuración. Reintentá."); }
    });
  }
  function verify(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    const entered = code; setCode("");
    startTransition(async () => {
      try {
        const result = await verifyMfaAction(factorId, entered);
        if (!result.ok) { setMessage(result.error.message); return; }
        setEnrollment(null); setComplete(true);
      } catch { setMessage("No pudimos verificar el código. Reintentá."); }
    });
  }

  if (complete) return <>
    <header className="au-form-head"><h1>Verificación completada</h1><p>Tu sesión ya tiene la protección adicional.</p></header>
    <p>Podés agregar otro autenticador como respaldo desde Seguridad. Guardalo en un dispositivo separado.</p>
    <a className="fi-btn fi-btn-primary" href={next}>Continuar</a>
    <a href="/seguridad/mfa">Administrar mis autenticadores</a>
  </>;

  return <>
    <header className="au-form-head"><h1>Verificación en dos pasos</h1>
      <p>{status.hasVerifiedFactor && !status.allowed ? "Ingresá el código de tu autenticador para continuar." : "Protegé tu cuenta con un código adicional, además de tu contraseña o enlace de acceso."}</p>
    </header>
    {status.isStaff && <p>Esta protección se aplica al acceso profesional y también al portal de pacientes cuando usás la misma cuenta.</p>}
    {status.hasVerifiedFactor && factors.length === 0 && <p>Tu cuenta tiene un factor de otro tipo. Usá la ayuda de recuperación para verificar tu identidad y configurar un autenticador compatible.</p>}
    {message && <p role="alert">{message}</p>}
    {enrollment && <div className="au-form">
      <p>Escaneá el código con tu aplicación autenticadora. Luego ingresá los seis números que te muestra.</p>
      {/* Supabase-generated SVG is displayed as an image, never executed as markup. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="Código QR para configurar el autenticador" width={220} height={220} referrerPolicy="no-referrer" />
      <details><summary>No puedo escanear el código</summary><p>Agregá una cuenta de tipo código por tiempo (TOTP) con esta clave. No la compartas.</p>
        <label className="au-field"><span>Clave de configuración</span><input value={enrollment.secret} readOnly autoComplete="off" /></label>
      </details>
    </div>}
    {(enrollment || factors.length > 0) && <form className="au-form" onSubmit={verify}>
      {!enrollment && factors.length > 1 && <label className="au-field"><span>Dispositivo</span>
        <select value={factorId} onChange={e => setFactorId(e.target.value)}>{factors.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
      </label>}
      <label className="au-field"><span>Código de seis números</span>
        <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={pending} />
      </label>
      <button type="submit" className="fi-btn fi-btn-primary" disabled={pending || code.length !== 6}>{pending ? "Verificando…" : "Verificar código"}</button>
    </form>}
    {canEnroll && !enrollment && <div className="au-form">
      {status.hasVerifiedFactor && <p>Agregá un segundo autenticador para conservar acceso si perdés el principal.</p>}
      <label className="au-field"><span>Nombre del dispositivo</span><input value={name} onChange={e => setName(e.target.value)} maxLength={60} disabled={pending} /></label>
      <button type="button" className="fi-btn fi-btn-primary" disabled={pending || !name.trim()} onClick={enroll}>{pending ? "Preparando…" : status.hasVerifiedFactor ? "Agregar autenticador de respaldo" : "Configurar autenticador"}</button>
    </div>}
    {status.allowed && !enrollment && <a href={next}>Continuar a Folio</a>}
    <a href="/seguridad/mfa/recuperar">Perdí mi autenticador o no puedo usarlo</a>
  </>;
}
