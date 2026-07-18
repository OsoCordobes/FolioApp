/**
 * Folio · Portal · resumen clínico curado — vista (Fase 3 · P5).
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
      <p className="pt-empty" style={{ color: "var(--ink-2)", fontSize: "var(--fs-sm)" }}>
        Todavía no tenés atenciones ni consentimientos registrados.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 28 }}>
      <section>
        <h2 style={{ fontSize: "var(--fs-lg)", margin: "0 0 12px" }}>Atenciones pasadas</h2>
        {turnosPasados.length === 0 ? (
          <p className="pt-empty" style={{ color: "var(--ink-3)", fontSize: "var(--fs-sm)" }}>
            No tenés atenciones pasadas registradas.
          </p>
        ) : (
          <ul className="pt-org-list" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {turnosPasados.map((t) => (
              <TurnoRow key={t.id} turno={t} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: "var(--fs-lg)", margin: "0 0 12px" }}>Consentimientos firmados</h2>
        {consentimientos.length === 0 ? (
          <p className="pt-empty" style={{ color: "var(--ink-3)", fontSize: "var(--fs-sm)" }}>
            No tenés consentimientos firmados.
          </p>
        ) : (
          <ul className="pt-org-list" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
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
  return (
    <li className="pt-card" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <strong style={{ textTransform: "capitalize" }}>{fmt(FMT_TURNO, turno.inicio)}</strong>
        <span
          style={{
            fontSize: "var(--fs-xs, .78rem)",
            color: turno.estado === "NO_ASISTIO" ? "var(--amber, #B5761F)" : "var(--ink-3)",
            whiteSpace: "nowrap",
          }}
        >
          {ESTADO_LABEL[turno.estado] ?? turno.estado}
        </span>
      </div>
      <p style={{ margin: "4px 0 0", color: "var(--ink-2)", fontSize: "var(--fs-sm)" }}>
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
    <li className="pt-card" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <strong>{consentimiento.plantillaTitulo ?? consentimiento.tipoLabel}</strong>
        <span
          style={{
            fontSize: "var(--fs-xs, .78rem)",
            color: revocado ? "var(--red)" : "var(--green, #2E7D5B)",
            whiteSpace: "nowrap",
          }}
        >
          {revocado ? "Revocado" : "Vigente"}
        </span>
      </div>
      <p style={{ margin: "4px 0 0", color: "var(--ink-2)", fontSize: "var(--fs-sm)" }}>
        {consentimiento.organizacionNombre ?? "Consultorio"}
        {" · "}
        {consentimiento.tipoLabel}
        {consentimiento.plantillaVersion != null ? ` · v${consentimiento.plantillaVersion}` : ""}
      </p>
      <p style={{ margin: "6px 0 0", color: "var(--ink-3)", fontSize: "var(--fs-xs, .78rem)" }}>
        Firmado el {fmt(FMT_FECHA, consentimiento.firmadoEn)}
        {revocado && consentimiento.revocadoEn
          ? ` · Revocado el ${fmt(FMT_FECHA, consentimiento.revocadoEn)}`
          : ""}
      </p>
    </li>
  );
}
