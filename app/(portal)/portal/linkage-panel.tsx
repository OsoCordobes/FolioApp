"use client";

/**
 * Folio · Portal · panel de vinculación de fichas (Fase 3 · P3).
 *
 * Dos cosas:
 *   1. Corre el matcher email-only UNA vez al montar (post-verify): un match por
 *      email nunca auto-linkea (necesita DNI o teléfono+email) → sólo puede
 *      encolar claims. Seguro e idempotente (el UNIQUE de M70 traga duplicados).
 *   2. Ofrece un form para aportar DNI/teléfono y alcanzar el umbral de auto-link
 *      de alta confianza (DNI, o teléfono+email en la misma ficha).
 *
 * Tras cualquier corrida refresca el segment (router.refresh) para que el
 * fan-out del server component refleje los nuevos links.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { runPortalLinkage } from "./actions";

export function LinkagePanel({ hasLinks }: { hasLinks: boolean }) {
  const router = useRouter();
  const [dni, setDni] = useState("");
  const [telefono, setTelefono] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const autoRan = useRef(false);

  // Corrida automática email-only al montar (una sola vez por montaje).
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    startTransition(async () => {
      const res = await runPortalLinkage({});
      if (res.ok && (res.data.autoLinked > 0 || res.data.claimsQueued > 0)) {
        router.refresh();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const res = await runPortalLinkage({
        dni: dni.trim() || undefined,
        telefono: telefono.trim() || undefined,
      });
      if (!res.ok) {
        setMsg(res.error.message);
        return;
      }
      const { autoLinked, claimsQueued } = res.data;
      if (autoLinked === 0 && claimsQueued === 0) {
        setMsg("No encontramos fichas nuevas para vincular con esos datos.");
      } else {
        const parts: string[] = [];
        if (autoLinked > 0) parts.push(`${autoLinked} ficha${autoLinked === 1 ? "" : "s"} vinculada${autoLinked === 1 ? "" : "s"}`);
        if (claimsQueued > 0) parts.push(`${claimsQueued} pendiente${claimsQueued === 1 ? "" : "s"} de aprobación del consultorio`);
        setMsg(parts.join(" · "));
        router.refresh();
      }
    });
  };

  return (
    <section className="pt-card" style={{ marginTop: 24 }}>
      <h3 style={{ margin: "0 0 4px" }}>
        {hasLinks ? "¿Faltan fichas?" : "Vinculá tus fichas"}
      </h3>
      <p style={{ color: "var(--ink-2)", fontSize: "var(--fs-sm)", margin: "0 0 12px" }}>
        Ingresá tu DNI y teléfono para que podamos encontrar tus fichas en los
        consultorios donde te atendés. Si no hay coincidencia exacta, el
        consultorio tendrá que aprobar la vinculación.
      </p>
      <form className="au-form" onSubmit={submit}>
        <label className="au-field">
          <span>DNI</span>
          <input
            inputMode="numeric"
            placeholder="Sin puntos"
            value={dni}
            onChange={(e) => setDni(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className="au-field">
          <span>Teléfono</span>
          <input
            inputMode="tel"
            placeholder="Con característica"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            disabled={pending}
          />
        </label>
        {msg ? <p className="au-notice" role="status" style={{ fontSize: "var(--fs-sm)", color: "var(--ink-2)" }}>{msg}</p> : null}
        <button type="submit" className="fi-btn fi-btn-primary au-submit" disabled={pending || (!dni.trim() && !telefono.trim())}>
          {pending ? "Buscando…" : "Buscar mis fichas"}
        </button>
      </form>
    </section>
  );
}
