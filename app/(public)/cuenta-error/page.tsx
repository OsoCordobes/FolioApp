/**
 * Folio · pantalla de cuenta inconsistente.
 *
 * Salida del ping-pong /hoy ↔ /onboarding. El wizard usa un service client
 * para resolver si el onboarding está completo, así que ve cosas que el propio
 * usuario NO puede leer bajo RLS: cuando decía "completo" y mandaba a /hoy, el
 * layout de (app) resolvía `not_found` con el client del usuario y devolvía a
 * /onboarding, que volvía a decir "completo"… El usuario quedaba rebotando
 * entre dos pantallas para siempre, sin ningún mensaje.
 *
 * Antes que dejarlo en el loop, lo traemos acá: le decimos qué pasa, le damos
 * el mail de soporte con el dato que necesitamos para arreglarlo, y las dos
 * salidas que sí funcionan (reintentar y cerrar sesión).
 *
 * Es una ruta PÚBLICA a propósito (está en PUBLIC_PATHS): el usuario tiene
 * sesión pero su contexto de app no resuelve, así que no puede pasar por
 * ningún gate que dependa de ese contexto.
 */

import Link from "next/link";

import { signOut } from "@/app/(public)/login/actions";
import { supportMailto } from "@/lib/support";

export const metadata = {
  title: "No pudimos cargar tu cuenta",
};

export default function CuentaErrorPage() {
  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: "72px 24px" }}>
      <div className="au-sent">
        <div className="au-sent-glyph">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
        </div>
        <h2>No pudimos cargar tu cuenta.</h2>
        <p>
          Tu sesión está activa, pero los datos de tu consultorio no terminan de
          resolver. Es un problema nuestro, no tuyo, y no perdiste nada: la
          información de tus pacientes está intacta.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginTop: 24,
        }}
      >
        <Link href="/hoy" className="fi-btn fi-btn-primary au-submit">
          Reintentar
        </Link>
        <form action={signOut}>
          <button type="submit" className="au-link au-link--block">
            Cerrar sesión y volver a entrar
          </button>
        </form>
      </div>

      <p
        style={{
          fontSize: 12,
          color: "var(--ink-2)",
          marginTop: 24,
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        Si vuelve a pasar,{" "}
        <a href={supportMailto("Cuenta que no carga")} className="au-link">
          escribinos a soporte
        </a>{" "}
        contándonos con qué email entraste — con eso lo resolvemos.
      </p>
    </main>
  );
}
