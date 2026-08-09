"use client";

/**
 * Folio · Dashboard · KpiStrip (4 cards superiores).
 *
 * Port de `KpiStrip` en folio/dashboard.jsx (líneas 60-94).
 */

import { fmtMoney, minutesTo, relativeTo } from "@/lib/dashboard-helpers";
import { computeCobroKpi } from "@/lib/hoy/kpi-cobro";
import type { PacientesById, Turno } from "@/lib/types";

interface KpiStripProps {
  turnos: Turno[];
  pacientes: PacientesById;
  now: Date;
  /** IANA timezone de la org (cálculo wall-clock de "próximo en X min"). */
  timezone?: string;
}

const plural = (n: number, sing: string, plur: string) => `${n} ${n === 1 ? sing : plur}`;

interface KpiItem {
  lbl: string;
  val: string | number;
  sub: string;
  kind: "count" | "text" | "money";
  tone?: "green";
}

export function KpiStrip({ turnos, pacientes, now, timezone }: KpiStripProps) {
  const total = turnos.length;
  const cerrados = turnos.filter((t) => t.estado === "cerrado").length;
  // Dinero: el cálculo vive en lib/hoy/kpi-cobro.ts (puro + testeado) y sale de
  // `pago`, no del estado del turno — un turno cerrado con deuda NO es plata
  // cobrada. Antes /hoy sumaba el precio de todo turno cerrado y contradecía a
  // /finanzas para el mismo día.
  const dinero = computeCobroKpi(turnos);

  const proximo = turnos.find(
    (t) =>
      ["agendado", "confirmado", "en_sala"].includes(t.estado) &&
      minutesTo(t.hora, now, timezone) >= 0,
  );
  const proximoPaciente = proximo ? pacientes[proximo.pacienteId] : null;
  const proximoTxt = proximo && proximoPaciente
    ? `${proximoPaciente.nombre.split(" ")[0]} · ${relativeTo(proximo.hora, now, timezone)}`
    : "—";

  const kpis: KpiItem[] = [
    {
      lbl: "Turnos hoy",
      val: total,
      sub: `${plural(cerrados, "cerrado", "cerrados")} · ${plural(total - cerrados, "pendiente", "pendientes")}`,
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
      val: fmtMoney(dinero.cobradoPesos),
      // "cobrado hoy" ahora es literal: sólo pagos en estado PAGADO.
      sub: "cobrado hoy",
      kind: "money",
      tone: "green",
    },
    {
      lbl: "Por cobrar",
      val: fmtMoney(dinero.porCobrarPesos),
      // La deuda registrada al cerrar ("quedó debiendo") es plata que falta
      // entrar: se declara acá, y el sub dice cuánta parte es deuda para no
      // confundirla con los turnos que todavía no se atendieron.
      sub:
        dinero.deudaPesos > 0
          ? `incluye ${fmtMoney(dinero.deudaPesos)} de deuda`
          : "restante del día",
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
