/**
 * Folio · /portal/perfil — auto-gestión de contacto del paciente (Fase 3 · P8).
 *
 * Muestra las fichas del paciente (una por consultorio linkeado) con su contacto y
 * domicilio editables. El nombre y el documento se muestran en SÓLO LECTURA: cambiar
 * la identidad es un pedido que el consultorio revisa, no un auto-servicio (allow-list
 * server-side en lib/db/portal-perfil.ts + trigger-guard M86). El gating de sesión lo
 * hace el middleware; re-resolvemos acá como defensa en profundidad.
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
    <main className="pt-main" style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Tus datos de contacto</h1>
          <p style={{ color: "var(--ink-2)", fontSize: "var(--fs-sm)", marginTop: 4 }}>
            Actualizá tu teléfono, email y domicilio. Para corregir tu nombre o
            documento, avisá en el consultorio.
          </p>
        </div>
        <a href="/portal" className="fi-btn fi-btn-ghost">Volver</a>
      </header>

      <section style={{ marginTop: 24 }}>
        {loadError ? (
          <p className="au-notice" role="alert" style={{ color: "var(--red)" }}>{loadError}</p>
        ) : (
          <PerfilList perfiles={perfiles} />
        )}
      </section>
    </main>
  );
}
