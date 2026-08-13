"use client";

/**
 * Folio · aviso cuando un ingreso terminó en la landing.
 *
 * Si GoTrue no puede entregar el retorno de OAuth al callback —el caso típico
 * es un `redirect_to` que no está en la allow-list del proyecto— manda al Site
 * URL, que es esta página. Hasta ahora eso se veía como "toqué Continuar con
 * Google, elegí mi cuenta, y volví al inicio": el marketing renderizaba
 * normalmente y no había ni un mensaje ni una entrada en ningún log.
 *
 * Pasó en producción durante días. Este componente hace que no pueda volver a
 * pasar en silencio: cuenta qué ocurrió, deja un camino de vuelta al login, y
 * —lo importante— lo reporta a Sentry, porque un login que muere en el último
 * salto es una caída, no una molestia.
 *
 * La decisión de qué hay en la URL es de lib/auth/landing-retorno.ts, que es
 * puro y está testeado. Acá sólo se pinta.
 */

import { captureMessage } from "@sentry/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";

import { detectarRetornoAuth, urlSinParamsDeAuth, type RetornoAuth } from "@/lib/auth/landing-retorno";
import { mensajeOauth } from "@/lib/auth/oauth-messages";

export function AuthRetornoAviso() {
  const [retorno, setRetorno] = useState<RetornoAuth | null>(null);

  useEffect(() => {
    // En el efecto y no en el render del server: el `#error=...` del implicit
    // flow vive en el hash, que el server nunca ve.
    const detectado = detectarRetornoAuth(window.location.search, window.location.hash);
    if (!detectado) return;
    setRetorno(detectado);

    captureMessage(
      detectado.kind === "code_perdido"
        ? "[auth] retorno de OAuth depositado en la landing — el callback no se ejecutó (revisar allow-list de redirect URLs)"
        : `[auth] retorno de OAuth con error en la landing: ${detectado.codigo}`,
      { level: "error", tags: { component: "landing", op: "auth-retorno" } },
    );

    // Sacar el code/error de la barra de direcciones: es material de un solo
    // uso que no tiene por qué quedar en el historial ni viajar en el Referer.
    // El aviso ya está en el estado, así que no desaparece al limpiar.
    window.history.replaceState(null, "", urlSinParamsDeAuth(window.location.href));
  }, []);

  if (!retorno) return null;

  const mensaje =
    retorno.kind === "code_perdido"
      ? "Tu ingreso se completó del lado de Google pero volvió acá en vez de entrar a tu cuenta. Es una configuración nuestra, no algo que hayas hecho mal — ya nos llegó el aviso."
      : mensajeOauth(retorno.codigo);

  return (
    <div
      role="alert"
      style={{
        maxWidth: 720,
        margin: "0 auto 8px",
        padding: "14px 18px",
        border: "1px solid var(--amber)",
        borderRadius: "var(--r-md)",
        background: "var(--amber-soft)",
        color: "var(--ink)",
        fontSize: 14,
        lineHeight: 1.55,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        justifyContent: "space-between",
      }}
    >
      <span>{mensaje}</span>
      <Link href="/login" className="fi-btn fi-btn-primary" style={{ flex: "0 0 auto" }}>
        Volver a intentar
      </Link>
    </div>
  );
}
