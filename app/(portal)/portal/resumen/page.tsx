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

      <p style={{ marginTop: 28, color: "var(--ink-3)", fontSize: "var(--fs-xs, .78rem)", lineHeight: 1.5 }}>
        La historia clínica narrativa (evolución/SOAP) la conserva tu profesional
        tratante y no se muestra acá. Si necesitás una copia de tus datos, pedila
        desde tu profesional o exportá tu información desde el portal.
      </p>
    </main>
  );
}
