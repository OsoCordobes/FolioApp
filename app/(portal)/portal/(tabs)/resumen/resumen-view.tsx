/**
 * Folio · Portal · resumen clínico curado — vista (Fase 3 · P5 · F2 identidad).
 *
 * Componente PRESENTACIONAL (sin estado, sin server actions): sólo formatea el
 * whitelist que arma getResumenPortal. NUNCA recibe SOAP/tool_data/riesgo — el
 * shape de PortalResumenView ya es el whitelist. Se deja como componente de cliente
 * para poder formatear fechas con la zona AR sin re-hidratar desde el server; no
 * hace ningún fetch ni muta nada.
 */

"use client";

import type {
  PortalConsentimientoView,
  PortalResumenView,
  PortalTurnoPasadoView,
} from "@/lib/db/portal-resumen";

const FMT_TURNO = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Cordoba",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const FMT_FECHA = new Intl.DateTimeFormat("es-AR", {
  timeZone: "America/Argentina/Cordoba",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Etiqueta legible del estado del turno (no exponemos el enum crudo). */
const ESTADO_LABEL: Record<string, string> = {
  EN_SALA: "En sala",
  ATENDIENDO: "Atendido",
  CERRADO: "Atendido",
  NO_ASISTIO: "No asististe",
  AGENDADO: "Sin registrar",
  CONFIRMADO: "Sin registrar",
};

function fmt(fmt: Intl.DateTimeFormat, iso: string): string {
  try {
    return fmt.format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ResumenView({ resumen }: { resumen: PortalResumenView }) {
  const { turnosPasados, consentimientos } = resumen;
  const vacio = turnosPasados.length === 0 && consentimientos.length === 0;

  if (vacio) {
    return (
      <div className="pt-empty pt-empty-hero">
        <p className="pt-empty-title">Todavía no hay nada para mostrar</p>
        <p className="pt-empty-sub">
          Después de tu primera atención vas a ver acá tu historial y tus
          consentimientos firmados.
        </p>
      </div>
    );
  }

  return (
    <div className="pt-stack">
      <section>
        <h2 className="pt-section-title">Atenciones pasadas</h2>
        {turnosPasados.length === 0 ? (
          <p className="pt-empty">No tenés atenciones pasadas registradas.</p>
        ) : (
          <ul className="pt-org-list">
            {turnosPasados.map((t) => (
              <TurnoRow key={t.id} turno={t} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="pt-section-title">Consentimientos firmados</h2>
        {consentimientos.length === 0 ? (
          <p className="pt-empty">No tenés consentimientos firmados.</p>
        ) : (
          <ul className="pt-org-list">
            {consentimientos.map((c) => (
              <ConsentimientoRow key={c.id} consentimiento={c} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TurnoRow({ turno }: { turno: PortalTurnoPasadoView }) {
  const tone = turno.estado === "NO_ASISTIO" ? "amber" : "slate";
  return (
    <li className="pt-card">
      <div className="pt-card-row">
        <strong className="pt-card-title pt-cap">{fmt(FMT_TURNO, turno.inicio)}</strong>
        <span className={`pt-chip pt-chip--${tone}`}>
          {ESTADO_LABEL[turno.estado] ?? turno.estado}
        </span>
      </div>
      <p className="pt-card-meta">
        {turno.organizacionNombre ?? "Consultorio"}
        {turno.modalidad === "telemedicina" ? " · Videoconsulta" : ""}
        {" · "}
        {turno.duracionMin} min
      </p>
    </li>
  );
}

function ConsentimientoRow({ consentimiento }: { consentimiento: PortalConsentimientoView }) {
  const revocado = consentimiento.revocadoEn != null;
  return (
    <li className="pt-card">
      <div className="pt-card-row">
        <strong className="pt-card-title">
          {consentimiento.plantillaTitulo ?? consentimiento.tipoLabel}
        </strong>
        <span className={`pt-chip ${revocado ? "pt-chip--red" : "pt-chip--green"}`}>
          {revocado ? "Revocado" : "Vigente"}
        </span>
      </div>
      <p className="pt-card-meta">
        {consentimiento.organizacionNombre ?? "Consultorio"}
        {" · "}
        {consentimiento.tipoLabel}
        {consentimiento.plantillaVersion != null ? ` · v${consentimiento.plantillaVersion}` : ""}
      </p>
      <p className="pt-footnote">
        Firmado el {fmt(FMT_FECHA, consentimiento.firmadoEn)}
        {revocado && consentimiento.revocadoEn
          ? ` · Revocado el ${fmt(FMT_FECHA, consentimiento.revocadoEn)}`
          : ""}
      </p>
    </li>
  );
}
