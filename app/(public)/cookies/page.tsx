/**
 * Folio · Política de Cookies.
 *
 * Versión 2026-05-21. Folio usa solo cookies estrictamente necesarias y
 * de seguridad; no usa cookies publicitarias ni de rastreo cross-site, por
 * lo cual NO requiere banner de consentimiento bajo la Disposición AAIP
 * 4/2019 ni equivalentes. Esta página existe para transparencia y para que
 * el visitante pueda decidir informadamente.
 */

import Link from "next/link";

export { COOKIES_VERSION } from "@/lib/legal/versions";
import { COOKIES_VERSION } from "@/lib/legal/versions";

export const metadata = {
  title: "Política de Cookies",
  description: "Qué cookies usa Folio, para qué, y cómo desactivarlas.",
};

export default function CookiesPage() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px", lineHeight: 1.6 }}>
      <Link href="/" style={{ display: "inline-block", marginBottom: 24, color: "var(--ink-3)" }}>
        ← Volver
      </Link>

      <h1 style={{ marginBottom: 8 }}>Política de Cookies</h1>
      <p style={{ color: "var(--ink-3)", marginBottom: 32 }}>
        Versión {COOKIES_VERSION} · Última actualización: 21 de mayo de 2026
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2>1. Qué es una cookie</h2>
        <p>
          Una cookie es un pequeño archivo de texto que un sitio web guarda
          en el navegador para recordar información entre visitas (por
          ejemplo, que usted inició sesión). Folio también puede usar
          tecnologías equivalentes como <i>localStorage</i> o{" "}
          <i>sessionStorage</i> para el mismo propósito; las llamamos cookies
          por simplicidad.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>2. Qué cookies usa Folio</h2>
        <p>
          Folio usa <b>únicamente cookies estrictamente necesarias y de
          seguridad</b>. No usamos cookies publicitarias, de marketing ni de
          rastreo entre sitios.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginTop: 16 }}>
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              <th style={{ textAlign: "left", padding: 8 }}>Nombre</th>
              <th style={{ textAlign: "left", padding: 8 }}>Propósito</th>
              <th style={{ textAlign: "left", padding: 8 }}>Duración</th>
              <th style={{ textAlign: "left", padding: 8 }}>Categoría</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: 8 }}><code>sb-*-auth-token</code></td>
              <td style={{ padding: 8 }}>Sesión autenticada (Supabase Auth)</td>
              <td style={{ padding: 8 }}>Sesión / hasta logout</td>
              <td style={{ padding: 8 }}>Estrictamente necesaria</td>
            </tr>
            <tr>
              <td style={{ padding: 8 }}><code>folio.active_org</code></td>
              <td style={{ padding: 8 }}>Recuerda la organización activa cuando el profesional pertenece a varias</td>
              <td style={{ padding: 8 }}>1 año</td>
              <td style={{ padding: 8 }}>Estrictamente necesaria</td>
            </tr>
            <tr>
              <td style={{ padding: 8 }}><code>cf_*</code> / <code>__cf_bm</code></td>
              <td style={{ padding: 8 }}>Cloudflare Turnstile (captcha antispam)</td>
              <td style={{ padding: 8 }}>Hasta 30 minutos</td>
              <td style={{ padding: 8 }}>Seguridad</td>
            </tr>
            <tr>
              <td style={{ padding: 8 }}><code>ph_*</code></td>
              <td style={{ padding: 8 }}>PostHog (analytics agregadas de producto). No se setea si su navegador envía Do-Not-Track o si usted deshabilitó analytics en Configuración → Privacidad.</td>
              <td style={{ padding: 8 }}>Hasta 1 año</td>
              <td style={{ padding: 8 }}>Analítica de producto</td>
            </tr>
            <tr>
              <td style={{ padding: 8 }}><code>sentry-*</code></td>
              <td style={{ padding: 8 }}>Sentry (error tracking). Solo se setea ante un error de la aplicación para asociar el reporte a la sesión.</td>
              <td style={{ padding: 8 }}>Sesión</td>
              <td style={{ padding: 8 }}>Seguridad / operación</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>3. ¿Por qué no hay banner de cookies?</h2>
        <p>
          Folio no muestra un banner de consentimiento de cookies porque
          todas las cookies que setea son <b>estrictamente necesarias</b>{" "}
          para prestar el Servicio o de <b>seguridad</b>. La normativa
          argentina (Ley 25.326 y guías AAIP) y los estándares
          internacionales aplicables exigen consentimiento previo únicamente
          para cookies no esenciales (publicidad, perfilado, rastreo
          cross-site), que Folio no utiliza.
        </p>
        <p>
          La cookie de analytics de producto (<code>ph_*</code>) respeta la
          señal Do-Not-Track del navegador y puede desactivarse desde{" "}
          <i>Configuración → Privacidad → Opt-out analytics</i> sin afectar
          la funcionalidad del Servicio.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>4. Cómo deshabilitar cookies</h2>
        <p>
          Puede deshabilitar cookies desde la configuración de su navegador.
          Tenga en cuenta que deshabilitar las cookies estrictamente
          necesarias impedirá el funcionamiento del Servicio (no podrá
          iniciar sesión).
        </p>
        <p>
          Links a las instrucciones por navegador:{" "}
          <a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer">
            Chrome
          </a>{" · "}
          <a href="https://support.mozilla.org/es/kb/Borrar%20cookies" target="_blank" rel="noopener noreferrer">
            Firefox
          </a>{" · "}
          <a href="https://support.apple.com/es-ar/guide/safari/sfri11471/mac" target="_blank" rel="noopener noreferrer">
            Safari
          </a>{" · "}
          <a href="https://support.microsoft.com/es-es/microsoft-edge/eliminar-las-cookies-en-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09" target="_blank" rel="noopener noreferrer">
            Edge
          </a>
          .
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>5. Cambios a esta política</h2>
        <p>
          Si Folio incorpora nuevas cookies o tecnologías equivalentes con
          impacto material en su privacidad (por ejemplo, una cookie de
          analytics no esencial), actualizará esta política y notificará a
          los profesionales por email con al menos 30 días de antelación.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>6. Contacto</h2>
        <p>
          Consultas:{" "}
          <a href="mailto:privacidad@folio.app">privacidad@folio.app</a>
        </p>
        <p>
          Ver también la{" "}
          <Link href="/privacidad">Política de Privacidad</Link> y los{" "}
          <Link href="/terminos">Términos y Condiciones</Link>.
        </p>
      </section>
    </main>
  );
}
