/**
 * Folio · /portal/turnos — turnos del paciente + self-service (Fase 3 · P4).
 *
 * Lista los turnos del paciente (RLS-enforced, whitelist operativo — NUNCA SOAP) y
 * le permite CANCELAR (fuera de la ventana de corte) o SOLICITAR REAGENDA (cae como
 * pedido PENDIENTE para confirmación del clínico). El gating de sesión lo hace el
 * middleware; re-resolvemos acá como defensa en profundidad.
 */

import { redirect } from "next/navigation";

import { listTurnosPortal } from "@/lib/db/portal-turnos";
import { getPacienteSession } from "@/lib/db/paciente-session";

import { TurnosList } from "./turnos-list";

export const dynamic = "force-dynamic";

export default async function PortalTurnosPage() {
  const session = await getPacienteSession();
  if (!session.ok) {
    redirect("/portal/login");
  }

  const turnosRes = await listTurnosPortal();
  const turnos = turnosRes.ok ? turnosRes.data : [];
  const loadError = turnosRes.ok ? null : turnosRes.error.message;

  return (
    <main className="pt-main" style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Tus turnos</h1>
          <p style={{ color: "var(--ink-2)", fontSize: "var(--fs-sm)", marginTop: 4 }}>
            Cancelá o pedí reprogramar. Las reprogramaciones las confirma el consultorio.
          </p>
        </div>
        <a href="/portal" className="fi-btn fi-btn-ghost">Volver</a>
      </header>

      <section style={{ marginTop: 24 }}>
        {loadError ? (
          <p className="au-notice" role="alert" style={{ color: "var(--red)" }}>{loadError}</p>
        ) : (
          <TurnosList turnos={turnos} />
        )}
      </section>
    </main>
  );
}
