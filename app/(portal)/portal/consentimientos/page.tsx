/**
 * Folio · /portal/consentimientos — ver / firmar consentimientos (Fase 3 · P6).
 *
 * El paciente ve sus consentimientos firmados (RLS M71: consentimiento_select_portal)
 * y puede FIRMAR uno nuevo sobre una ficha SUYA (canvas→PNG→Storage + fila, RLS M85).
 * Incluye la plantilla TELEMEDICINA (global · M68) que necesita T4. El gating de
 * sesión lo hace el middleware; re-resolvemos acá como defensa en profundidad.
 *
 * Las fichas linkeadas (consultorios) salen del fan-out de la sesión (P3) — el
 * paciente no es member, así que el nombre de la org no sale de un embed sino de la
 * sesión. Sin fichas linkeadas no se puede firmar (no hay a qué atar el consentimiento).
 */

import { redirect } from "next/navigation";

import { getPacienteSession } from "@/lib/db/paciente-session";

import { ConsentimientosView } from "./consentimientos-view";
import type { FichaPortal } from "./firma-portal-modal";

export const dynamic = "force-dynamic";

export default async function PortalConsentimientosPage() {
  const session = await getPacienteSession();
  if (!session.ok) {
    redirect("/portal/login");
  }

  const fichas: FichaPortal[] = session.data.pacientes.map((p) => ({
    pacienteId: p.pacienteId,
    organizacionNombre: p.organizacionNombre,
  }));

  return (
    <main className="pt-main" style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px" }}>
      <header
        style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Tus consentimientos</h1>
          <p style={{ color: "var(--ink-2)", fontSize: "var(--fs-sm)", marginTop: 4 }}>
            Los consentimientos que firmaste y los que podés firmar (Ley 26.529).
          </p>
        </div>
        <a href="/portal" className="fi-btn fi-btn-ghost">
          Volver
        </a>
      </header>

      <section style={{ marginTop: 24 }}>
        <ConsentimientosView fichas={fichas} />
      </section>

      <p
        style={{
          marginTop: 28,
          color: "var(--ink-3)",
          fontSize: "var(--fs-xs, .78rem)",
          lineHeight: 1.5,
        }}
      >
        Tu firma se guarda de forma cifrada en tu ficha clínica. Podés revocar un
        consentimiento en cualquier momento (Ley 26.529 art. 11) desde tu consultorio;
        el ejemplar firmado se conserva por diez años.
      </p>
    </main>
  );
}
