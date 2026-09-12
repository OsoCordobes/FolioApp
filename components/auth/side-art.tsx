"use client";

import Link from "next/link";
import { FolioMark } from "@/components/folio-mark";

/** An illustrative working day. Static so the form keeps the user's attention. */
export function SideArt({ audience = "practice" }: { audience?: "practice" | "patient" } = {}) {
  const patient = audience === "patient";
  return (
    <aside className="fx-auth-art" aria-labelledby="fx-auth-art-heading">
      <Link className="fx-auth-brand" href="/" aria-label="Folio, volver al inicio">
        <FolioMark size={31} />
        <span>folio</span>
      </Link>
      <div className="fx-auth-art-content">
        <h2 id="fx-auth-art-heading">{patient ? <>Tu atención,<br />más cerca.</> : <>Tu consultorio.<br />Todo en su lugar.</>}</h2>
        <p>{patient ? "Ingresá al espacio que tu consultorio comparte con vos." : "La agenda y la historia de cada paciente, cerca cuando las necesitás."}</p>
        <figure className="fx-auth-day" aria-label={`${patient ? "Consulta" : "Agenda"} ilustrativa con personas y datos ficticios`}>
          {patient ? (
            <>
              <div className="fx-auth-day-top"><span>Portal del paciente</span><span>Consultorio de ejemplo</span></div>
              <div className="fx-auth-day-title"><h3>Tu próxima consulta</h3></div>
              <p className="fx-auth-day-date">Martes 15 de septiembre</p>
              <div className="fx-auth-appointment"><time>09:00</time><span className="fx-auth-person"><strong>Dra. Lucía Molina</strong><span>Consulta de seguimiento</span></span><span className="fx-auth-state">Confirmada</span></div>
            </>
          ) : (
            <>
          <div className="fx-auth-day-top"><span>Un día en Folio</span><span>Consultorio de ejemplo</span></div>
          <div className="fx-auth-day-title"><h3>Buen día, Lucía</h3><span className="fx-auth-initials">LM</span></div>
          <p className="fx-auth-day-date">Martes 15 de septiembre</p>
          <div className="fx-auth-appointment"><time>09:00</time><span className="fx-auth-person"><strong>Martina Ríos</strong><span>Consulta de seguimiento</span></span><span className="fx-auth-state is-done">Atendida</span></div>
          <div className="fx-auth-appointment is-current"><time>09:30</time><span className="fx-auth-person"><strong>Tomás Acosta</strong><span>Primera consulta</span></span><span className="fx-auth-state">En consulta</span></div>
          <div className="fx-auth-appointment"><time>10:00</time><span className="fx-auth-person"><strong>Elena Vidal</strong><span>Control clínico</span></span><span className="fx-auth-state is-waiting">En espera</span></div>
            </>
          )}
          <figcaption>Vista ilustrativa. Personas y datos ficticios.</figcaption>
        </figure>
      </div>
      <p className="fx-auth-art-foot">{patient ? "Folio acompaña el trabajo de tu consultorio." : "Para médicos y equipos de salud en Argentina."}</p>
    </aside>
  );
}

// Preserve the existing exports for callers that share motion boundaries.
export { LazyMotion, domMax } from "framer-motion";
