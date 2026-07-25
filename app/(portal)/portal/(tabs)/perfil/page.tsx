/**
 * Folio · /portal/perfil — "Mis datos": auto-gestión de contacto + descarga de
 * datos del paciente (Fase 3 · P8 · F2 identidad).
 *
 * Muestra las fichas del paciente (una por consultorio linkeado) con su contacto y
 * domicilio editables. El nombre y el documento se muestran en SÓLO LECTURA: cambiar
 * la identidad es un pedido que el consultorio revisa, no un auto-servicio (allow-list
 * server-side en lib/db/portal-perfil.ts + trigger-guard M86).
 *
 * "Descargar mis datos" (derecho de acceso, Ley 25.326 art. 14): apunta a
 * /api/portal/export, que reusa los whitelists del portal (scope por cuenta_id,
 * SOAP estructuralmente excluido) y deja audit trail por org. Vive acá porque
 * esta pestaña ES "Mis datos".
 *
 * El gating de sesión lo hace el middleware; re-resolvemos acá como defensa en
 * profundidad.
 */

import { redirect } from "next/navigation";

import { getPortalPerfiles } from "@/lib/db/portal-perfil";
import { getPacienteSession } from "@/lib/db/paciente-session";

import { PerfilList } from "./perfil-list";

export const dynamic = "force-dynamic";

export default async function PortalPerfilPage() {
  const session = await getPacienteSession();
  if (!session.ok) {
    redirect("/portal/login");
  }

  const perfilesRes = await getPortalPerfiles();
  const perfiles = perfilesRes.ok ? perfilesRes.data : [];
  const loadError = perfilesRes.ok ? null : perfilesRes.error.message;

  return (
    <main className="pt-main">
      <header className="pt-page-head">
        <h1 className="pt-page-title">Tus datos de contacto</h1>
        <p className="pt-page-sub">
          Actualizá tu teléfono, email y domicilio. Para corregir tu nombre o
          documento, avisá en el consultorio.
        </p>
      </header>

      <section className="pt-section">
        {loadError ? (
          <p className="au-notice pt-msg-err" role="alert">{loadError}</p>
        ) : (
          <PerfilList perfiles={perfiles} />
        )}
      </section>

      <section className="pt-section pt-section-divided">
        <h2 className="pt-section-title">Descargar mis datos</h2>
        <p className="pt-card-desc">
          Descargá una copia de tus datos personales (identidad, turnos y
          consentimientos) de todos los consultorios vinculados a tu cuenta, en
          un archivo portable (JSON). Es tu derecho de acceso bajo la Ley 25.326.
        </p>
        {/* Descarga directa: la ruta valida la sesión de portal y responde
            attachment. download hint para nombrar el archivo del lado cliente. */}
        <a
          href="/api/portal/export"
          className="fi-btn fi-btn-secondary"
          download
          rel="nofollow"
        >
          Descargar mis datos
        </a>
        <p className="pt-footnote pt-footnote-page">
          La historia clínica narrativa (evolución/SOAP) la conserva tu
          profesional tratante y no se incluye en la descarga. Si necesitás una
          copia certificada, pedila a tu profesional tratante.
        </p>
      </section>
    </main>
  );
}
