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
 * La descarga "mis datos" (Ley 25.326) vive en /portal/perfil ("Mis datos"),
 * donde el paciente gestiona su información — acá sólo queda la lectura.
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
    <main className="pt-main">
      <header className="pt-page-head">
        <h1 className="pt-page-title">Tu resumen</h1>
        <p className="pt-page-sub">
          Tus atenciones pasadas y los consentimientos que firmaste.
        </p>
      </header>

      <section className="pt-section">
        {loadError ? (
          <p className="au-notice pt-msg-err" role="alert">{loadError}</p>
        ) : (
          <ResumenView resumen={resumen} />
        )}
      </section>

      <p className="pt-footnote pt-footnote-page">
        La historia clínica narrativa (evolución/SOAP) la conserva tu profesional
        tratante y no se muestra acá. Si necesitás una copia certificada, pedila a
        tu profesional tratante. Podés descargar tus datos personales desde{" "}
        <a href="/portal/perfil">Mis datos</a>.
      </p>
    </main>
  );
}
