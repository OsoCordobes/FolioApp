"use client";

/**
 * Folio · /calendario — vista semanal de turnos + bloqueos + pedidos.
 *
 * Datos reales (S1 T-1.5): recibe `turnos`, `bloqueos`, `pedidos`, `pacientes`
 * y metadata de la semana como props desde el Server Component padre. La
 * navegación entre semanas es via query param `?w=YYYY-MM-DD` (lunes anchor)
 * que el SC parsea y le da al fetcher.
 *
 * Diferidas a sprints futuros (UI funcional, no data layer):
 *  - Drag & drop para mover/duplicar turnos.
 *  - Selection (drag para crear bloqueo).
 *  - Popovers (Agendar, ver detalle de turno).
 *  - Modal cal-pedido-modal para confirmar/rechazar pedidos.
 *  - VistaBandeja y VistaMes (placeholder por ahora).
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import * as I from "@/components/icons";
import type {
  Bloqueo,
  PacientesById,
  Pedido,
  TurnoSemana,
} from "@/lib/types";

// ─── Constants ──────────────────────────────────────────────────────────────

const HORA_INICIO = 8;
const HORA_FIN = 19;
const HOURS = HORA_FIN - HORA_INICIO;
const HORA_PX = 56;
const HEIGHT_PX = HOURS * HORA_PX;

const DIAS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeToTop(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return ((h - HORA_INICIO) * 60 + m) * (HORA_PX / 60);
}

function durToHeight(dur: number): number {
  return (dur * HORA_PX) / 60;
}

function hmToMin(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

function abreviar(nombre: string): string {
  const parts = nombre.split(" ");
  return parts[0] + " " + (parts[1]?.[0] ? parts[1][0] + "." : "");
}

// ─── Lane layout ────────────────────────────────────────────────────────────

type Kind = "turno" | "bloqueo" | "pedido";

interface LaidOutEvent {
  _kind: Kind;
  _start: number;
  _end: number;
  _lane: number;
  _totalLanes: number;
}

interface LaidOutTurno extends LaidOutEvent {
  _kind: "turno";
  turno: TurnoSemana;
}

interface LaidOutBloqueo extends LaidOutEvent {
  _kind: "bloqueo";
  bloqueo: Bloqueo;
}

interface LaidOutPedido extends LaidOutEvent {
  _kind: "pedido";
  pedido: Pedido;
}

type LaidOutAny = LaidOutTurno | LaidOutBloqueo | LaidOutPedido;

function layoutDayEvents(turnos: TurnoSemana[], bloqueos: Bloqueo[], pedidos: Pedido[]): LaidOutAny[] {
  const events: LaidOutAny[] = [
    ...turnos.map<LaidOutTurno>((t) => ({
      _kind: "turno",
      _start: hmToMin(t.hora),
      _end: hmToMin(t.hora) + t.dur,
      _lane: 0,
      _totalLanes: 1,
      turno: t,
    })),
    ...bloqueos.map<LaidOutBloqueo>((b) => ({
      _kind: "bloqueo",
      _start: hmToMin(b.hora),
      _end: hmToMin(b.hora) + b.dur,
      _lane: 0,
      _totalLanes: 1,
      bloqueo: b,
    })),
    ...pedidos.map<LaidOutPedido>((p) => ({
      _kind: "pedido",
      _start: hmToMin(p.hora!),
      _end: hmToMin(p.hora!) + (p.dur || 45),
      _lane: 0,
      _totalLanes: 1,
      pedido: p,
    })),
  ];
  events.sort((a, b) => a._start - b._start || b._end - a._end);

  const clusters: LaidOutAny[][] = [];
  let current: LaidOutAny[] = [];
  let clusterEnd = -Infinity;
  for (const ev of events) {
    if (ev._start >= clusterEnd && current.length) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(ev);
    clusterEnd = Math.max(clusterEnd, ev._end);
  }
  if (current.length) clusters.push(current);

  for (const cluster of clusters) {
    const laneEnds: number[] = [];
    for (const ev of cluster) {
      let placed = false;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= ev._start) {
          ev._lane = i;
          laneEnds[i] = ev._end;
          placed = true;
          break;
        }
      }
      if (!placed) {
        ev._lane = laneEnds.length;
        laneEnds.push(ev._end);
      }
    }
    const total = laneEnds.length;
    for (const ev of cluster) ev._totalLanes = total;
  }
  return events;
}

function laneStyle(lane: number, total: number): { left: number | string; right?: number; width?: string } {
  if (total <= 1) return { left: 4, right: 4 };
  const outer = 4;
  const gap = 2;
  const width = `calc((100% - ${outer * 2}px - ${(total - 1) * gap}px) / ${total})`;
  const left = `calc(${outer}px + ${lane} * (${width} + ${gap}px))`;
  return { left, width };
}

// ─── State vis ──────────────────────────────────────────────────────────────

const STATE_VIS: Record<string, { bg: string; borderStyle: string; borderColor: string; color: string }> = {
  agendado:   { bg: "var(--surface)",       borderStyle: "dashed", borderColor: "var(--line)",      color: "var(--ink-3)" },
  confirmado: { bg: "var(--green-soft)",    borderStyle: "solid",  borderColor: "transparent",       color: "var(--green)" },
  en_sala:    { bg: "var(--amber-soft)",    borderStyle: "solid",  borderColor: "var(--amber)",     color: "var(--amber)" },
  atendiendo: { bg: "var(--accent-soft-2)", borderStyle: "solid",  borderColor: "var(--accent)",    color: "var(--accent-2)" },
  cerrado:    { bg: "var(--green-soft)",    borderStyle: "solid",  borderColor: "transparent",       color: "var(--green)" },
  facturado:  { bg: "var(--green-soft)",    borderStyle: "solid",  borderColor: "transparent",       color: "var(--green)" },
  no_asistio: { bg: "var(--red-soft)",      borderStyle: "solid",  borderColor: "transparent",       color: "var(--red)" },
};

const PEDIDO_CANAL_INFO: Record<string, { lbl: string; short: string }> = {
  web:       { lbl: "Web",       short: "W" },
  whatsapp:  { lbl: "WhatsApp",  short: "WA" },
  instagram: { lbl: "Instagram", short: "IG" },
  telefono:  { lbl: "Teléfono",  short: "Tel" },
};

// ─── Cards ──────────────────────────────────────────────────────────────────

function TurnoCardSemana({ turno, lane, totalLanes, pacientes }: { turno: TurnoSemana; lane: number; totalLanes: number; pacientes: PacientesById }) {
  const paciente = pacientes[turno.pacienteId];
  if (!paciente) return null;
  const vis = STATE_VIS[turno.estado] ?? STATE_VIS.agendado;
  const top = timeToTop(turno.hora);
  const height = Math.max(36, durToHeight(turno.dur) - 2);
  const isAtendiendo = turno.estado === "atendiendo";
  const isCancelado = ["no_asistio", "cancelado"].includes(turno.estado);
  const lanePos = laneStyle(lane, totalLanes);
  const isNarrow = totalLanes >= 2;
  const isGoogle = turno.origen === "google";

  const nombreFull = abreviar(paciente.nombre);
  const iniciales = paciente.nombre
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={
        "cal-turno " +
        (isAtendiendo ? "is-atendiendo " : "") +
        (isCancelado ? "is-cancelado " : "") +
        (isNarrow ? "is-narrow" : "")
      }
      style={{
        top,
        height,
        ...lanePos,
        background: vis.bg,
        border: `1px ${vis.borderStyle} ${vis.borderColor}`,
        color: vis.color,
      }}
    >
      {isNarrow ? (
        <>
          <div className="cal-turno-initials">
            {iniciales}
            {isGoogle ? (
              <span className="cal-turno-gcal" aria-label="Sincronizado de Google">
                <I.Google size={9} />
              </span>
            ) : null}
          </div>
          <div className="cal-turno-meta">
            <span className="fi-mono">{turno.hora}</span>
          </div>
        </>
      ) : (
        <>
          <div className="cal-turno-name">
            {nombreFull}
            {turno.estado === "cerrado" ? <I.Check size={11} /> : null}
          </div>
          <div className="cal-turno-meta">
            {isGoogle ? (
              <span className="cal-turno-gcal" aria-label="Sincronizado de Google">
                <I.Google size={9} />
              </span>
            ) : null}
            <span className="fi-mono">{turno.hora}</span> ·{" "}
            {turno.servicio
              .replace("Consulta inicial", "Inicial")
              .replace("Seguimiento", "Segui")
              .replace("Deportiva", "Deport.")}
          </div>
        </>
      )}
      {isAtendiendo ? <span className="cal-turno-pulse" /> : null}
    </div>
  );
}

function BloqueoCardSemana({ bloqueo, lane, totalLanes }: { bloqueo: Bloqueo; lane: number; totalLanes: number }) {
  const top = timeToTop(bloqueo.hora);
  const height = Math.max(28, durToHeight(bloqueo.dur) - 2);
  const lanePos = laneStyle(lane, totalLanes);
  const isNarrow = totalLanes >= 2;
  const isGoogle = bloqueo.origen === "google";

  return (
    <div
      className={"cal-bloqueo " + (isNarrow ? "is-narrow" : "")}
      style={{ top, height, ...lanePos }}
      title={
        isGoogle
          ? `${bloqueo.titulo} · sincronizado de Google Calendar`
          : `${bloqueo.titulo} · bloqueo manual`
      }
    >
      {isNarrow ? (
        <div className="cal-bloqueo-narrow">
          {isGoogle ? <I.Google size={13} /> : <I.Lock size={12} />}
        </div>
      ) : (
        <div className="cal-bloqueo-inner">
          {isGoogle ? <I.Google size={11} /> : <I.Lock size={11} />}
          <span className="cal-bloqueo-title">{bloqueo.titulo}</span>
        </div>
      )}
    </div>
  );
}

function PedidoGhostCard({ pedido, lane, totalLanes }: { pedido: Pedido; lane: number; totalLanes: number }) {
  const top = timeToTop(pedido.hora!);
  const height = Math.max(36, durToHeight(pedido.dur || 45) - 2);
  const lanePos = laneStyle(lane, totalLanes);
  const isNarrow = totalLanes >= 2;
  const canal = PEDIDO_CANAL_INFO[pedido.canal] ?? { short: "?", lbl: "Otro" };
  const nombreCorto = pedido.nombre.split(" ")[0];
  const iniciales = pedido.nombre
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className={"cal-pedido " + (isNarrow ? "is-narrow" : "")}
      style={{ top, height, ...lanePos }}
      title={`Pedido vía ${canal.lbl} · ${pedido.nombre} · ${pedido.hora}`}
    >
      {isNarrow ? (
        <div className="cal-pedido-narrow">
          <I.Inbox size={11} />
          <span className="cal-pedido-init">{iniciales}</span>
        </div>
      ) : (
        <>
          <div className="cal-pedido-name">
            <I.Inbox size={10} />
            <span>{nombreCorto}</span>
          </div>
          <div className="cal-pedido-meta">
            <span className="fi-mono">{pedido.hora}</span>
            <span className="cal-pedido-canal">{canal.short}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── PedidosTray ───────────────────────────────────────────────────────────

function PedidosTray({ pedidos }: { pedidos: Pedido[] }) {
  const count = pedidos.length;
  const label = count === 1 ? "1 pedido sin asignar" : `${count} pedidos sin asignar`;
  return (
    <div className="cal-tray">
      <button type="button" className="cal-tray-trigger">
        <span className="cal-tray-trigger-l">
          <span className="cal-tray-ico">
            <I.Inbox size={12} />
          </span>
          <span className="cal-tray-lbl">{label}</span>
          <span className="cal-tray-hint">sin fecha estructurada · click para asignar</span>
        </span>
        <span className="cal-tray-chev">
          <I.ChevronDown size={12} />
        </span>
      </button>
    </div>
  );
}

// ─── Headers & filters ─────────────────────────────────────────────────────

type Vista = "semana" | "mes" | "bandeja";

function CalHeader({
  vista,
  setVista,
  estados,
  setEstados,
  pedidosPendientesCount,
  mostrarPedidos,
  setMostrarPedidos,
  weekRangeLabel,
  prevWeekIso,
  nextWeekIso,
  hoyWeekStartIso,
}: {
  vista: Vista;
  setVista: (v: Vista) => void;
  estados: Set<string>;
  setEstados: (s: Set<string>) => void;
  pedidosPendientesCount: number;
  mostrarPedidos: boolean;
  setMostrarPedidos: (v: boolean) => void;
  weekRangeLabel: string;
  prevWeekIso: string;
  nextWeekIso: string;
  hoyWeekStartIso: string;
}) {
  return (
    <header className="cal-head">
      <div className="cal-head-top">
        <div>
          <span className="fi-eyebrow">Agenda</span>
          <h1>Calendario</h1>
        </div>
        <div className="cal-tabs">
          <button type="button" className={"cal-tab " + (vista === "semana" ? "is-active" : "")} onClick={() => setVista("semana")}>
            Semana
          </button>
          <button type="button" className={"cal-tab " + (vista === "mes" ? "is-active" : "")} onClick={() => setVista("mes")}>
            Mes
          </button>
          <button
            type="button"
            className={"cal-tab cal-tab-bandeja " + (vista === "bandeja" ? "is-active" : "")}
            onClick={() => setVista("bandeja")}
          >
            <I.Inbox size={12} />
            <span>Bandeja</span>
            {pedidosPendientesCount > 0 ? <span className="cal-tab-count">{pedidosPendientesCount}</span> : null}
          </button>
        </div>
      </div>
      <div className="cal-nav">
        <div className="cal-nav-l">
          <Link href={`/calendario?w=${prevWeekIso}`} className="cal-nav-btn" aria-label="Semana anterior">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <Link href={`/calendario?w=${hoyWeekStartIso}`} className="cal-nav-today" title="Semana actual">
            Hoy
          </Link>
          <Link href={`/calendario?w=${nextWeekIso}`} className="cal-nav-btn" aria-label="Semana siguiente">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>
          <span className="cal-range">{weekRangeLabel}</span>
        </div>
        <div className="cal-nav-r">
          <CalFilters estados={estados} setEstados={setEstados} pedidosPendientesCount={pedidosPendientesCount} mostrarPedidos={mostrarPedidos} setMostrarPedidos={setMostrarPedidos} />
        </div>
      </div>
    </header>
  );
}

function CalFilters({
  estados,
  setEstados,
  pedidosPendientesCount,
  mostrarPedidos,
  setMostrarPedidos,
}: {
  estados: Set<string>;
  setEstados: (s: Set<string>) => void;
  pedidosPendientesCount: number;
  mostrarPedidos: boolean;
  setMostrarPedidos: (v: boolean) => void;
}) {
  const todos = estados.size === 0;
  const toggle = (s: string) => {
    const next = new Set(estados);
    if (todos) next.add(s);
    else if (next.has(s)) next.delete(s);
    else next.add(s);
    setEstados(next);
  };
  const chips: [string, string][] = [
    ["confirmado", "Confirmados"],
    ["atendiendo", "En curso"],
    ["facturado", "Facturados"],
    ["agendado", "Sin confirmar"],
  ];

  return (
    <div className="cal-filters">
      <button type="button" className={"cal-chip " + (todos ? "is-on" : "")} onClick={() => setEstados(new Set())}>
        Todos
      </button>
      {chips.map(([k, lbl]) => (
        <button
          key={k}
          type="button"
          className={"cal-chip " + (!todos && estados.has(k) ? "is-on" : "")}
          onClick={() => toggle(k)}
        >
          {lbl}
        </button>
      ))}
      {pedidosPendientesCount > 0 ? (
        <button
          type="button"
          className={"cal-chip cal-chip-pedidos " + (mostrarPedidos ? "is-on" : "")}
          onClick={() => setMostrarPedidos(!mostrarPedidos)}
        >
          <I.Inbox size={11} />
          <span>Pedidos</span>
          <span className="cal-chip-count">{pedidosPendientesCount}</span>
        </button>
      ) : null}
    </div>
  );
}

// ─── VistaSemana ───────────────────────────────────────────────────────────

function VistaSemana({
  turnos,
  bloqueos,
  pedidos,
  pacientes,
  weekDates,
  hoyIso,
  nowHHMM,
}: {
  turnos: TurnoSemana[];
  bloqueos: Bloqueo[];
  pedidos: Pedido[];
  pacientes: PacientesById;
  weekDates: string[];
  hoyIso: string;
  nowHHMM: string;
}) {
  const pedidosSinFecha = pedidos.filter((p) => p.estado === "pendiente" && !p.fecha);

  // Auto-scroll a la "ahora" line al cargar — port directo del prototipo
  // (folio/calendario.jsx líneas 445-454). Sin esto, el viewport arranca en
  // top y el screenshot queda offset respecto al baseline.
  useEffect(() => {
    const t = setTimeout(() => {
      const elNow = document.querySelector(".cal-ahora");
      if (!elNow) return;
      const r = elNow.getBoundingClientRect();
      const targetY = window.scrollY + r.top - window.innerHeight / 3;
      if (targetY > 0) window.scrollTo({ top: targetY, behavior: "smooth" });
    }, 150);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="cal-semana">
      {pedidosSinFecha.length > 0 ? <PedidosTray pedidos={pedidosSinFecha} /> : null}

      <div className="cal-day-headers">
        <div className="cal-time-spacer" />
        {weekDates.map((iso, i) => {
          const isHoy = iso === hoyIso;
          const cerrado = i === 5 || i === 6;
          const numero = Number(iso.slice(-2));
          const dayTs = turnos.filter((t) => t.fecha === iso);
          const dayBls = bloqueos.filter((b) => b.fecha === iso);
          const minutosOcupados =
            dayTs.reduce((acc, t) => acc + (t.dur || 45), 0) +
            dayBls.reduce((acc, b) => acc + (b.dur || 60), 0);
          const pctCapacidad = cerrado ? 0 : Math.min(100, Math.round((minutosOcupados / 600) * 100));

          return (
            <div key={iso} className={"cal-day-head " + (isHoy ? "is-hoy " : "") + (cerrado ? "is-cerrado" : "")}>
              <span className="cal-day-name">{DIAS[i]}</span>
              <span className="cal-day-num">{numero}</span>
              <span className="cal-day-sub">
                {cerrado ? "cerrado" : `${dayTs.length} turnos · ${pctCapacidad}%`}
              </span>
              {!cerrado ? (
                <div className="cal-day-cap" aria-label={`${pctCapacidad}% ocupado`}>
                  <div className="cal-day-cap-fill" style={{ width: `${pctCapacidad}%` }} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="cal-grid">
        <div className="cal-time-axis" style={{ height: HEIGHT_PX }}>
          {Array.from({ length: HOURS + 1 }, (_, i) => (
            <div key={i} className="cal-time-tick" style={{ top: i * HORA_PX }}>
              <span>{String(HORA_INICIO + i).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>

        {weekDates.map((iso, i) => {
          const isHoy = iso === hoyIso;
          const cerrado = i === 5 || i === 6;
          const dayTurnos = turnos.filter((t) => t.fecha === iso);
          const dayBloqueos = bloqueos.filter((b) => b.fecha === iso);
          const dayPedidos = pedidos.filter((p) => p.fecha === iso && p.estado === "pendiente");
          const dayEvents = layoutDayEvents(dayTurnos, dayBloqueos, dayPedidos);

          // Almuerzo band 12:00-14:00 si no hay overlap
          const lunchStart = 12 * 60;
          const lunchEnd = 14 * 60;
          const hasLunchOverlap = dayEvents.some((ev) => ev._start < lunchEnd && ev._end > lunchStart);
          const showLunch = !hasLunchOverlap && !cerrado;

          return (
            <div
              key={iso}
              className={"cal-day-col " + (isHoy ? "is-hoy " : "") + (cerrado ? "is-cerrado" : "")}
              style={{ height: HEIGHT_PX }}
            >
              {Array.from({ length: HOURS }, (_, k) => (
                <div key={`g-${k}`}>
                  <div className="cal-gridline" style={{ top: k * HORA_PX }} />
                  <div className="cal-gridline cal-gridline-half" style={{ top: k * HORA_PX + HORA_PX / 2 }} />
                </div>
              ))}

              {showLunch ? (
                <div
                  className="cal-almuerzo"
                  style={{
                    top: timeToTop("12:00"),
                    height: timeToTop("14:00") - timeToTop("12:00"),
                  }}
                >
                  <span className="cal-almuerzo-lbl">almuerzo</span>
                </div>
              ) : null}

              {cerrado ? (
                <div className="cal-cerrado-overlay">
                  <span>Cerrado</span>
                </div>
              ) : null}

              {dayEvents.map((ev) => {
                if (ev._kind === "bloqueo") {
                  return (
                    <BloqueoCardSemana
                      key={`b-${ev.bloqueo.fecha}-${ev.bloqueo.hora}-${ev.bloqueo.titulo}`}
                      bloqueo={ev.bloqueo}
                      lane={ev._lane}
                      totalLanes={ev._totalLanes}
                    />
                  );
                }
                if (ev._kind === "pedido") {
                  return (
                    <PedidoGhostCard
                      key={`p-${ev.pedido.id}`}
                      pedido={ev.pedido}
                      lane={ev._lane}
                      totalLanes={ev._totalLanes}
                    />
                  );
                }
                return (
                  <TurnoCardSemana
                    key={`t-${ev.turno.id}`}
                    turno={ev.turno}
                    lane={ev._lane}
                    totalLanes={ev._totalLanes}
                    pacientes={pacientes}
                  />
                );
              })}

              {isHoy ? (
                <div className="cal-ahora" style={{ top: timeToTop(nowHHMM) }}>
                  <span className="cal-ahora-dot" />
                  <span className="cal-ahora-line" />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────

interface CalendarioProps {
  turnos: TurnoSemana[];
  bloqueos: Bloqueo[];
  pedidos: Pedido[];
  pacientes: PacientesById;
  weekDates: string[];
  weekRangeLabel: string;
  hoyIso: string;
  nowHHMM: string;
  weekStartIso: string;
  prevWeekIso: string;
  nextWeekIso: string;
  hoyWeekStartIso: string;
}

export function Calendario({
  turnos,
  bloqueos,
  pedidos,
  pacientes,
  weekDates,
  weekRangeLabel,
  hoyIso,
  nowHHMM,
  prevWeekIso,
  nextWeekIso,
  hoyWeekStartIso,
}: CalendarioProps) {
  const [vista, setVista] = useState<Vista>("semana");
  const [estados, setEstados] = useState<Set<string>>(new Set());
  const [mostrarPedidos, setMostrarPedidos] = useState(true);

  const pedidosPendientes = useMemo(() => pedidos.filter((p) => p.estado === "pendiente"), [pedidos]);
  const pedidosVisibles = mostrarPedidos ? pedidosPendientes : [];

  const turnosFiltrados = useMemo(() => {
    if (estados.size === 0) return turnos;
    return turnos.filter((t) => estados.has(t.estado));
  }, [estados, turnos]);

  return (
    <div className="fi-content cal-content">
      <CalHeader
        vista={vista}
        setVista={setVista}
        estados={estados}
        setEstados={setEstados}
        pedidosPendientesCount={pedidosPendientes.length}
        mostrarPedidos={mostrarPedidos}
        setMostrarPedidos={setMostrarPedidos}
        weekRangeLabel={weekRangeLabel}
        prevWeekIso={prevWeekIso}
        nextWeekIso={nextWeekIso}
        hoyWeekStartIso={hoyWeekStartIso}
      />

      {vista === "semana" ? (
        <VistaSemana
          turnos={turnosFiltrados}
          bloqueos={bloqueos}
          pedidos={pedidosVisibles}
          pacientes={pacientes}
          weekDates={weekDates}
          hoyIso={hoyIso}
          nowHHMM={nowHHMM}
        />
      ) : vista === "bandeja" ? (
        <VistaBandejaSimple pedidos={pedidosPendientes} />
      ) : (
        <div className="fi-empty" style={{ marginTop: 32 }}>
          <h2>Vista mensual próximamente</h2>
          <p>Mientras tanto, navegá entre semanas con las flechas.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Bandeja simple: lista cards de pedidos pendientes. La versión rica del
 * prototipo (con confirmar/reagendar/rechazar) llega cuando se cablee la
 * UI de modal cal-pedido-modal a `confirmarPedido` / `rechazarPedido`.
 */
function VistaBandejaSimple({ pedidos }: { pedidos: Pedido[] }) {
  if (pedidos.length === 0) {
    return (
      <div className="fi-empty" style={{ marginTop: 32 }}>
        <h2>Bandeja vacía</h2>
        <p>No hay pedidos pendientes de respuesta.</p>
      </div>
    );
  }
  return (
    <div className="cal-tray" style={{ marginTop: 16, padding: 12 }}>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
        {pedidos.map((p) => (
          <li
            key={p.id}
            style={{
              padding: 12,
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--surface)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <b>{p.nombre}</b>
              <span className="cal-pedido-canal">{p.canal}</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 4 }}>
              {p.fecha ? `${p.fecha} · ${p.hora ?? "—"}` : "sin fecha propuesta"}
              <span style={{ margin: "0 6px" }}>·</span>
              {p.recibidoHace}
            </div>
            {p.motivo ? (
              <p style={{ margin: "6px 0 0", fontSize: 13 }}>{p.motivo}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
