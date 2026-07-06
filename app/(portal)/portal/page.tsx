/**
 * Folio · /portal — landing del portal del paciente (Fase 3 · P3).
 *
 * Resuelve la sesión del portal (`getPacienteSession`, cliente anon RLS-enforced)
 * y muestra el fan-out de fichas linkeadas + el panel de vinculación. El resumen
 * clínico curado (turnos, consentimientos) llega en P5/P6 — acá el scope es
 * auth + linkage: probar que el login por magic-link entra, que la sesión
 * resuelve la cuenta, y que el matcher vincula/encola.
 *
 * Defensa en profundidad: el middleware ya gatea /portal, pero re-resolvemos la
 * sesión acá (un caller directo que evada el middleware igual queda sin datos).
 */

import { redirect } from "next/navigation";

import { getPacienteSession } from "@/lib/db/paciente-session";
import { signOut } from "@/app/(public)/login/actions";

import { LinkagePanel } from "./linkage-panel";

export const dynamic = "force-dynamic";

export default async function PortalHomePage() {
  const session = await getPacienteSession();
  if (!session.ok) {
    // Sin sesión de portal → al login del portal (el middleware normalmente ya
    // desvía, pero esto cierra el caso de acceso directo sin cuenta de portal).
    redirect("/portal/login");
  }

  const { email, pacientes } = session.data;
  const hasLinks = pacientes.length > 0;

  return (
    <main className="pt-main" style={{ maxWidth: 640, margin: "0 auto", padding: "48px 20px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Tu portal</h1>
          <p style={{ color: "var(--ink-2)", fontSize: "var(--fs-sm)", marginTop: 4 }}>{email}</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="fi-btn fi-btn-ghost">Salir</button>
        </form>
      </header>

      {hasLinks ? (
        <nav style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href="/portal/turnos" className="fi-btn fi-btn-secondary">Ver mis turnos</a>
          <a href="/portal/resumen" className="fi-btn fi-btn-secondary">Ver mi resumen</a>
        </nav>
      ) : null}

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: "var(--fs-lg)", margin: "0 0 12px" }}>Tus consultorios</h2>
        {hasLinks ? (
          <ul className="pt-org-list" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {pacientes.map((p) => (
              <li key={p.pacienteId} className="pt-card" style={{ padding: "14px 16px" }}>
                <strong>{p.organizacionNombre ?? "Consultorio"}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pt-empty" style={{ color: "var(--ink-2)", fontSize: "var(--fs-sm)" }}>
            Todavía no vinculamos ninguna ficha a tu cuenta. Usá el panel de abajo
            para encontrarlas.
          </p>
        )}
      </section>

      <LinkagePanel hasLinks={hasLinks} />
    </main>
  );
}
