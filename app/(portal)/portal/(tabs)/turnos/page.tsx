/**
 * Folio · /portal/turnos — turnos del paciente + self-service (Fase 3 · P4).
 *
 * Lista los turnos del paciente (RLS-enforced, whitelist operativo — NUNCA SOAP) y
 * le permite CANCELAR (fuera de la ventana de corte) o SOLICITAR REAGENDA (cae como
 * pedido PENDIENTE para confirmación del clínico). El gating de sesión lo hace el
 * middleware; re-resolvemos acá como defensa en profundidad. El chrome (header +
 * tabs) vive en el layout del group (tabs).
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
    <main className="pt-main">
      <header className="pt-page-head">
        <h1 className="pt-page-title">Tus turnos</h1>
        <p className="pt-page-sub">
          Cancelá o pedí reprogramar. Las reprogramaciones las confirma el
          consultorio.
        </p>
      </header>

      <section className="pt-section">
        {loadError ? (
          <p className="au-notice pt-msg-err" role="alert">{loadError}</p>
        ) : (
          <TurnosList turnos={turnos} />
        )}
      </section>
    </main>
  );
}
