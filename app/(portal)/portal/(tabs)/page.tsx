/**
 * Folio · /portal — home del portal del paciente (Fase 3 · P3 · F2 identidad).
 *
 * Resuelve la sesión del portal (`getPacienteSession`, cliente anon RLS-enforced)
 * y muestra el hero de bienvenida + el fan-out de fichas linkeadas (con
 * "Reservar turno" → /book/{slug} si la org es reservable) + el panel de
 * vinculación. El chrome (header sticky + tabs) vive en el layout del group.
 *
 * Defensa en profundidad: el middleware ya gatea /portal, pero re-resolvemos la
 * sesión acá (un caller directo que evada el middleware igual queda sin datos).
 */

import { redirect } from "next/navigation";

import { getPacienteSession } from "@/lib/db/paciente-session";

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
    <main className="pt-main">
      <section className="pt-hero">
        <p className="pt-hero-eyebrow">Portal del paciente</p>
        <h1 className="pt-hero-title">Hola</h1>
        <p className="pt-hero-sub">
          Desde acá podés ver tus turnos, tu resumen clínico y tus
          consentimientos, y mantener tus datos al día.
        </p>
        <p className="pt-hero-account">{email}</p>
      </section>

      <section className="pt-section">
        <h2 className="pt-section-title">Tus consultorios</h2>
        {hasLinks ? (
          <ul className="pt-org-list">
            {pacientes.map((p) => (
              <li key={p.pacienteId} className="pt-card pt-card-row">
                <div className="pt-card-main">
                  <strong className="pt-card-title">
                    {p.organizacionNombre ?? "Consultorio"}
                  </strong>
                  <span className="pt-card-meta">Ficha vinculada a tu cuenta</span>
                </div>
                {p.bookingSlug ? (
                  <a
                    href={`/book/${p.bookingSlug}`}
                    className="fi-btn fi-btn-secondary"
                  >
                    Reservar turno
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="pt-empty pt-empty-hero">
            <p className="pt-empty-title">Todavía no vinculamos ninguna ficha</p>
            <p className="pt-empty-sub">
              Usá el panel de abajo para encontrar tus fichas en los consultorios
              donde te atendés.
            </p>
          </div>
        )}
      </section>

      <LinkagePanel hasLinks={hasLinks} />
    </main>
  );
}
