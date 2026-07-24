/**
 * Folio · /configuracion/importar-pacientes (Server Component).
 *
 * Importador CSV de pacientes — barrera #1 para consultorios que migran desde
 * planillas (Excel / Google Sheets). El wizard vive en el Client Component;
 * el parseo canónico + cifrado + dedupe corren server-side en actions.ts.
 *
 * Role-gate UX temprano: solo roles que pueden crear la ficha clínica
 * (OWNER / PROFESIONAL / DIRECTOR — espejo de canCreatePacienteClinical).
 * El gate real es la RLS de `paciente` + el re-chequeo del server action.
 */

import { redirect } from "next/navigation";

import { capabilitiesFor } from "@/lib/auth/capabilities";
import { getActiveContext } from "@/lib/db/active-context";

import { ImportarPacientesClient } from "./importar-client";

export const dynamic = "force-dynamic";

export default async function ImportarPacientesPage() {
  const ctx = await getActiveContext();
  if (!ctx.ok) {
    throw new Error(`No se pudo cargar /configuracion/importar-pacientes: ${ctx.error.message}`);
  }

  const caps = capabilitiesFor(ctx.data.session.role, ctx.data.session.esColegiado);
  if (!caps.canCreatePacienteClinical) {
    redirect("/configuracion");
  }

  return (
    <main className="fi-content" style={{ maxWidth: 860 }}>
      <header className="fi-page-head">
        <div>
          <span className="fi-eyebrow">Configuración · Pacientes</span>
          <h1>Importar pacientes</h1>
          <p className="fi-page-sub">
            Subí un CSV exportado de Excel o Google Sheets, mapeá las columnas y Folio crea
            los pacientes cifrados, sin duplicar los que ya tenés (por DNI o teléfono).
          </p>
        </div>
      </header>

      <ImportarPacientesClient />
    </main>
  );
}
