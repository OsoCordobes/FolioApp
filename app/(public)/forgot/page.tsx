/**
 * Folio · /forgot — recuperación de contraseña (informativa).
 *
 * Página pública (ya listada en middleware PUBLIC_PATHS). El flujo real de
 * recuperación vive en /login (botón "¿La olvidaste?", que dispara
 * supabase.auth.resetPasswordForEmail y redirige a /reset-password con el link
 * del email). Esta página explica el proceso y deriva a /login para no dejar
 * una ruta muerta cuando alguien navega directo a /forgot.
 */

import Link from "next/link";

export const metadata = {
  title: "Recuperar contraseña",
  description: "Cómo restablecer tu contraseña de Folio.",
};

export default function ForgotPage() {
  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: "64px 24px", lineHeight: 1.6 }}>
      <Link href="/login" style={{ display: "inline-block", marginBottom: 24, color: "var(--ink-3)" }}>
        ← Volver a iniciar sesión
      </Link>

      <h1 style={{ marginBottom: 8 }}>¿Olvidaste tu contraseña?</h1>
      <p style={{ color: "var(--ink-3)", marginBottom: 24 }}>
        No te preocupes, lo resolvemos en un minuto.
      </p>

      <section
        style={{
          padding: 20,
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)",
          marginBottom: 28,
        }}
      >
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            En la pantalla de inicio de sesión, tocá{" "}
            <b>&quot;¿La olvidaste?&quot;</b> junto al campo de contraseña.
          </li>
          <li>Ingresá el email de tu cuenta.</li>
          <li>
            Te enviamos un email con un link seguro para elegir una contraseña
            nueva. El link vence en pocos minutos por seguridad.
          </li>
          <li>Listo: volvés a entrar con tu nueva contraseña.</li>
        </ol>
      </section>

      <Link href="/login?reset=1" className="fi-btn fi-btn-primary">
        Ir a recuperar mi contraseña
      </Link>

      <p style={{ marginTop: 24, color: "var(--ink-3)", fontSize: 13 }}>
        ¿No te llega el email? Revisá la carpeta de spam o escribinos a{" "}
        <a href="mailto:soporte@folio.app">soporte@folio.app</a>.
      </p>
    </main>
  );
}
