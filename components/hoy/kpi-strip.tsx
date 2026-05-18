"use client";

/**
 * Folio · Dashboard · KpiStrip (4 cards superiores).
 *
 * Port de `KpiStrip` en folio/dashboard.jsx (líneas 60-94).
 */

import { fmtMoney, minutesTo, relativeTo } from "@/lib/dashboard-helpers";
import type { PacientesById, Turno } from "@/lib/types";

interface KpiStripProps {
  turnos: Turno[];
  pacientes: PacientesById;
}

interface KpiItem {
  lbl: string;
  val: string | number;
  sub: string;
  kind: "count" | "text" | "money";
  tone?: "green";
}

export function KpiStrip({ turnos, pacientes }: KpiStripProps) {
  const total = turnos.length;
  const cerrados = turnos.filter((t) => t.estado === "cerrado").length;
  const recaudado = turnos
    .filter((t) => t.estado === "cerrado")
    .reduce((s, t) => s + t.precio, 0);
  const esperado = turnos
    .filter((t) => !["cerrado", "cancelado", "no_asistio"].includes(t.estado))
    .reduce((s, t) => s + t.precio, 0);

  const proximo = turnos.find(
    (t) =>
      ["agendado", "confirmado", "en_sala"].includes(t.estado) &&
      minutesTo(t.hora) >= 0,
  );
  const proximoTxt = proximo
    ? `${pacientes[proximo.pacienteId].nombre.split(" ")[0]} · ${relativeTo(proximo.hora)}`
    : "—";

  const kpis: KpiItem[] = [
    {
      lbl: "Turnos hoy",
      val: total,
      sub: `${cerrados} cerrados · ${total - cerrados} pendientes`,
      kind: "count",
    },
    {
      lbl: "Próximo paciente",
      val: proximoTxt,
      sub: proximo ? `${proximo.hora} · ${proximo.servicio.toLowerCase()}` : "sin pendientes",
      kind: "text",
    },
    {
      lbl: "Recaudado",
      val: fmtMoney(recaudado),
      sub: "cobrado hoy",
      kind: "money",
      tone: "green",
    },
    {
      lbl: "Por cobrar",
      val: fmtMoney(esperado),
      sub: "restante del día",
      kind: "money",
    },
  ];

  return (
    <div className="fi-kpis">
      {kpis.map((k, i) => (
        <div key={i} className={"fi-kpi " + (k.tone ? "is-" + k.tone : "")}>
          <span className="fi-kpi-lbl">{k.lbl}</span>
          <span className={"fi-kpi-val" + (k.kind === "text" ? " is-text" : "")}>
            {k.kind === "money" ? <small>$</small> : null}
            {k.kind === "money" ? String(k.val).replace("$", "") : k.val}
          </span>
          <span className="fi-kpi-sub">{k.sub}</span>
        </div>
      ))}
    </div>
  );
}
