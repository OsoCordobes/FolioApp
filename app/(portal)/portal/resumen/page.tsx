/**
 * Folio · /portal/resumen — resumen clínico curado del paciente (Fase 3 · P5).
 *
 * Muestra un RESUMEN de la atención del paciente: sus turnos PASADOS y sus
 * consentimientos firmados. Es un WHITELIST explícito servido por getResumenPortal
 * (RLS M71 + selección de columnas operativas/legales) — NUNCA SOAP, tool_data,
 * notas ni flags de riesgo. El paciente no tiene grant a `sesion` (M71), así que la
 * sobre-exposición es imposible por construcción; esta pantalla sólo formatea el
 * whitelist.
 *
 * El gating de sesión lo hace el middleware; re-resolvemos acá como defensa en
 * profundidad (un caller directo que evada el middleware igual queda sin datos).
 */

import { redirect } from "next/navigation";

import { getPacienteSession } from "@/lib/db/paciente-session";
import { getResumenPortal } from "@/lib/db/portal-resumen";

import { ResumenView } from "./resumen-view";

export const dynamic = "force-dynamic";

export default async function PortalResumenPage() {
  const session = await getPacienteSession();
  if (!session.ok) {
    redirect("/portal/login");
  }

  const resumenRes = await getResumenPortal();
  const resumen = resumenRes.ok
    ? resumenRes.data
    : { turnosPasados: [], consentimientos: [] };
  const loadError = resumenRes.ok ? null : resumenRes.error.message;

  return (
    <main className="pt-main" style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Tu resumen</h1>
          <p style={{ color: "var(--ink-2)", fontSize: "var(--fs-sm)", marginTop: 4 }}>
            Tus atenciones pasadas y los consentimientos que firmaste.
          </p>
        </div>
        <a href="/portal" className="fi-btn fi-btn-ghost">Volver</a>
      </header>

      <section style={{ marginTop: 24 }}>
        {loadError ? (
          <p className="au-notice" role="alert" style={{ color: "var(--red)" }}>{loadError}</p>
        ) : (
          <ResumenView resumen={resumen} />
        )}
      </section>

      <section
        style={{
          marginTop: 28,
          paddingTop: 20,
          borderTop: "1px solid var(--surface-border, rgba(0,0,0,.08))",
        }}
      >
        <h2 style={{ fontSize: "var(--fs-lg)", margin: "0 0 6px" }}>Tus datos</h2>
        <p style={{ margin: "0 0 12px", color: "var(--ink-2)", fontSize: "var(--fs-sm)", lineHeight: 1.5 }}>
          Descargá una copia de tus datos personales (identidad, turnos y
          consentimientos) de todos los consultorios vinculados a tu cuenta, en un
          archivo portable (JSON). Es tu derecho de acceso bajo la Ley 25.326.
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
      </section>

      <p style={{ marginTop: 24, color: "var(--ink-3)", fontSize: "var(--fs-xs, .78rem)", lineHeight: 1.5 }}>
        La historia clínica narrativa (evolución/SOAP) la conserva tu profesional
        tratante y no se muestra acá ni se incluye en la descarga. Si necesitás una
        copia certificada, pedila a tu profesional tratante.
      </p>
    </main>
  );
}
