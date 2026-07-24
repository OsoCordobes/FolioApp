"use client";

/**
 * Folio · /calendario — vista semanal de turnos + bloqueos + pedidos.
 *
 * Datos reales (S1 T-1.5): recibe `turnos`, `bloqueos`, `pedidos`, `pacientes`
 * y metadata de la semana como props desde el Server Component padre. La
 * navegación entre semanas es via query param `?w=YYYY-MM-DD` (lunes anchor)
 * que el SC parsea y le da al fetcher.
 *
 * Ya implementados: VistaSemana/VistaMes/VistaBandeja, modal de pedido
 * (confirmar/rechazar) y modal de detalle de turno (M56). Diferidos a sprints
 * futuros (UI, no data layer): drag & drop para mover/duplicar turnos y la
 * selección por arrastre para crear bloqueos.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ProfFilterChips } from "@/components/agenda/prof-filter-chips";
import * as I from "@/components/icons";
import { PedidoModal } from "@/components/calendario/pedido-modal";
import { TurnoDetalleModal } from "@/components/calendario/turno-detalle-modal";
import { TurnoCreateModal } from "@/components/hoy/turno-create-modal";
import { inicialesProfesional, type ProfesionalLite } from "@/lib/agenda/profesional";
import {
  deriveRangoHorario,
  slotDesdeOffsetY,
  type EventoHorario,
  type RangoMin,
} from "@/lib/agenda/rango-horario";
import { useAgendaAutoRefresh } from "@/lib/use-agenda-refresh";
import type { MonthGridCell } from "@/lib/db/calendario";
import type {
  Bloqueo,
  PacientesById,
  Pedido,
  TurnoSemana,
} from "@/lib/types";

// ─── Constants ──────────────────────────────────────────────────────────────

const HORA_PX = 56;

const DIAS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Rango horario de la grilla, en horas enteras (derivado, ya no hardcode). */
interface RangoHorario {
  horaInicio: number;
  horaFin: number;
}

/**
 * Top en px de una hora "HH:MM" dentro de la grilla. Clamp defensivo a
 * [0, heightPx]: el rango derivado ya cubre todos los eventos, pero un dato
 * corrupto nunca debe empujar una card fuera del `overflow: hidden`.
 */
function timeToTop(hora: string, rango: RangoHorario): number {
  const [h, m] = hora.split(":").map(Number);
  const top = ((h - rango.horaInicio) * 60 + m) * (HORA_PX / 60);
  const heightPx = (rango.horaFin - rango.horaInicio) * HORA_PX;
  if (!Number.isFinite(top)) return 0;
  // -32px: si un dato corrupto cae fuera del rango, la card queda pegada al
  // borde pero visible (no desaparece detrás del overflow: hidden).
  return Math.max(0, Math.min(top, Math.max(0, heightPx - 32)));
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

function TurnoCardSemana({
  turno,
  lane,
  totalLanes,
  pacientes,
  rango,
  onSelect,
}: {
  turno: TurnoSemana;
  lane: number;
  totalLanes: number;
  pacientes: PacientesById;
  rango: RangoHorario;
  onSelect: (t: TurnoSemana) => void;
}) {
  const paciente = pacientes[turno.pacienteId];
  if (!paciente) return null;
  const vis = STATE_VIS[turno.estado] ?? STATE_VIS.agendado;
  const top = timeToTop(turno.hora, rango);
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

  // Click/Enter/Space abren el detalle del turno (mismo patrón a11y que
  // PedidoGhostCard, pero conservando el <div> y su layout absoluto).
  return (
    <div
      className={
        "cal-turno " +
        (isAtendiendo ? "is-atendiendo " : "") +
        (isCancelado ? "is-cancelado " : "") +
        (isNarrow ? "is-narrow" : "")
      }
      role="button"
      tabIndex={0}
      title={`${paciente.nombre} · ${turno.hora}`}
      onClick={() => onSelect(turno)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(turno);
        }
      }}
      style={{
        top,
        height,
        ...lanePos,
        background: vis.bg,
        border: `1px ${vis.borderStyle} ${vis.borderColor}`,
        color: vis.color,
        cursor: "pointer",
      }}
    >
      {/* Atribución multi-profesional: profesionalNombre solo viene seteado en
          vista "Todos" con >1 colegiado — en orgs Solo o con filtro activo es
          null y el render histórico no cambia ni un píxel. */}
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
            {turno.profesionalNombre ? (
              <span className="cal-turno-prof" title={turno.profesionalNombre}>
                {inicialesProfesional(turno.profesionalNombre)}
              </span>
            ) : null}
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
            {turno.profesionalNombre ? (
              <span className="cal-turno-prof" title={turno.profesionalNombre}>
                {inicialesProfesional(turno.profesionalNombre)}
              </span>
            ) : null}
          </div>
        </>
      )}
      {isAtendiendo ? <span className="cal-turno-pulse" /> : null}
    </div>
  );
}

function BloqueoCardSemana({
  bloqueo,
  lane,
  totalLanes,
  rango,
}: {
  bloqueo: Bloqueo;
  lane: number;
  totalLanes: number;
  rango: RangoHorario;
}) {
  const top = timeToTop(bloqueo.hora, rango);
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

function PedidoGhostCard({
  pedido,
  lane,
  totalLanes,
  rango,
  onClick,
}: {
  pedido: Pedido;
  lane: number;
  totalLanes: number;
  rango: RangoHorario;
  onClick: (p: Pedido) => void;
}) {
  const top = timeToTop(pedido.hora!, rango);
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
    <button
      type="button"
      className={"cal-pedido " + (isNarrow ? "is-narrow" : "")}
      style={{ top, height, ...lanePos, cursor: "pointer", border: "none", textAlign: "left" }}
      title={`Pedido vía ${canal.lbl} · ${pedido.nombre} · ${pedido.hora}`}
      onClick={() => onClick(pedido)}
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
    </button>
  );
}

// ─── PedidosTray ───────────────────────────────────────────────────────────

function PedidosTray({ pedidos, onOpenBandeja }: { pedidos: Pedido[]; onOpenBandeja: () => void }) {
  const count = pedidos.length;
  const label = count === 1 ? "1 pedido sin asignar" : `${count} pedidos sin asignar`;
  return (
    <div className="cal-tray">
      <button type="button" className="cal-tray-trigger" onClick={onOpenBandeja}>
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
  mesLabel,
  prevMonthIso,
  nextMonthIso,
  hoyMonthIso,
  onAgendar,
  profesionales,
  profActivo,
  profHrefFor,
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
  mesLabel: string;
  prevMonthIso: string;
  nextMonthIso: string;
  hoyMonthIso: string;
  onAgendar: () => void;
  profesionales: ProfesionalLite[];
  profActivo: string | null;
  profHrefFor: (id: string | null) => string;
}) {
  // Navegación semana/mes preserva el filtro de profesional activo.
  const profQS = profActivo ? `&prof=${profActivo}` : "";
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
          {vista === "mes" ? (
            <>
              <Link href={`/calendario?vista=mes&mes=${prevMonthIso}${profQS}`} className="cal-nav-btn" aria-label="Mes anterior">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </Link>
              <Link href={`/calendario?vista=mes&mes=${hoyMonthIso}${profQS}`} className="cal-nav-today" title="Mes actual">
                Hoy
              </Link>
              <Link href={`/calendario?vista=mes&mes=${nextMonthIso}${profQS}`} className="cal-nav-btn" aria-label="Mes siguiente">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </Link>
              <span className="cal-range cal-range-mes">{mesLabel}</span>
            </>
          ) : (
            <>
              <Link href={`/calendario?w=${prevWeekIso}${profQS}`} className="cal-nav-btn" aria-label="Semana anterior">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </Link>
              <Link href={`/calendario?w=${hoyWeekStartIso}${profQS}`} className="cal-nav-today" title="Semana actual">
                Hoy
              </Link>
              <Link href={`/calendario?w=${nextWeekIso}${profQS}`} className="cal-nav-btn" aria-label="Semana siguiente">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </Link>
              <span className="cal-range">{weekRangeLabel}</span>
            </>
          )}
        </div>
        <div className="cal-nav-r">
          {/* Selector de profesional (modo clínica): solo llega con >1 colegiado
              y rol cross-profesional; en bandeja no aplica (pedidos org-wide). */}
          {profesionales.length > 1 && vista !== "bandeja" ? (
            <ProfFilterChips profesionales={profesionales} profActivo={profActivo} hrefFor={profHrefFor} />
          ) : null}
          <CalFilters estados={estados} setEstados={setEstados} pedidosPendientesCount={pedidosPendientesCount} mostrarPedidos={mostrarPedidos} setMostrarPedidos={setMostrarPedidos} />
          <button type="button" className="fi-btn fi-btn-primary" onClick={onAgendar}>
            <I.Plus size={12} /> Agendar
          </button>
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
    ["cerrado", "Cerrados"],
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
  diasCerrados,
  capacidadDiaMin,
  rango,
  hoyIso,
  nowHHMM,
  onOpenBandeja,
  onSelectPedido,
  onSelectTurno,
  onCreateSlot,
}: {
  turnos: TurnoSemana[];
  bloqueos: Bloqueo[];
  pedidos: Pedido[];
  pacientes: PacientesById;
  weekDates: string[];
  /** Por índice (0=LUN..6=DOM): derivado de disponibilidad_profesional + eventos. */
  diasCerrados: boolean[];
  /** Minutos de disponibilidad real por día; null = fallback histórico (600). */
  capacidadDiaMin?: Array<number | null>;
  /** Rango horario derivado (disponibilidad + eventos); antes hardcode 08–19. */
  rango: RangoHorario;
  hoyIso: string;
  nowHHMM: string;
  onOpenBandeja: () => void;
  onSelectPedido: (p: Pedido) => void;
  onSelectTurno: (t: TurnoSemana) => void;
  /** Click en slot vacío o "+" del header → crear turno en fecha + "HH:MM". */
  onCreateSlot: (fecha: string, hora: string) => void;
}) {
  const pedidosSinFecha = pedidos.filter((p) => p.estado === "pendiente" && !p.fecha);
  const hours = rango.horaFin - rango.horaInicio;
  const heightPx = hours * HORA_PX;
  const nowMin = hmToMin(nowHHMM);
  // La línea de "ahora" solo se pinta si cae dentro del rango visible (antes
  // un "ahora" de 07:40 dibujaba la línea con top negativo, clipeada).
  const ahoraVisible =
    Number.isFinite(nowMin) && nowMin >= rango.horaInicio * 60 && nowMin <= rango.horaFin * 60;

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
      {pedidosSinFecha.length > 0 ? (
        <PedidosTray pedidos={pedidosSinFecha} onOpenBandeja={onOpenBandeja} />
      ) : null}

      <div className="cal-day-headers">
        <div className="cal-time-spacer" />
        {weekDates.map((iso, i) => {
          const isHoy = iso === hoyIso;
          // Data-driven (antes hardcodeado i===5||i===6): un finde con
          // disponibilidad cargada o con turnos se muestra como día normal.
          const cerrado = diasCerrados[i] ?? (i === 5 || i === 6);
          const numero = Number(iso.slice(-2));
          const dayTs = turnos.filter((t) => t.fecha === iso);
          const dayBls = bloqueos.filter((b) => b.fecha === iso);
          const minutosOcupados =
            dayTs.reduce((acc, t) => acc + (t.dur || 45), 0) +
            dayBls.reduce((acc, b) => acc + (b.dur || 60), 0);
          // Denominador: minutos reales de disponibilidad del día (del
          // profesional filtrado, o suma de todos los colegiados en "Todos").
          // Sin disponibilidad cargada → 600 min, el comportamiento histórico.
          const capacidadMin = capacidadDiaMin?.[i] ?? 600;
          const pctCapacidad = cerrado ? 0 : Math.min(100, Math.round((minutosOcupados / capacidadMin) * 100));

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
              {/* Camino por teclado del click-to-create: un "+" por día. */}
              {!cerrado ? (
                <button
                  type="button"
                  className="cal-day-add"
                  title={`Agendar turno el ${DIAS[i]} ${numero}`}
                  aria-label={`Agendar turno el ${DIAS[i]} ${numero}`}
                  onClick={() =>
                    onCreateSlot(iso, `${String(rango.horaInicio).padStart(2, "0")}:00`)
                  }
                >
                  <I.Plus size={11} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="cal-grid">
        <div className="cal-time-axis" style={{ height: heightPx }}>
          {Array.from({ length: hours + 1 }, (_, i) => (
            <div key={i} className="cal-time-tick" style={{ top: i * HORA_PX }}>
              <span>{String(rango.horaInicio + i).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>

        {weekDates.map((iso, i) => {
          const isHoy = iso === hoyIso;
          const cerrado = diasCerrados[i] ?? (i === 5 || i === 6);
          const dayTurnos = turnos.filter((t) => t.fecha === iso);
          const dayBloqueos = bloqueos.filter((b) => b.fecha === iso);
          const dayPedidos = pedidos.filter((p) => p.fecha === iso && p.estado === "pendiente");
          const dayEvents = layoutDayEvents(dayTurnos, dayBloqueos, dayPedidos);

          return (
            <div
              key={iso}
              className={
                "cal-day-col " +
                (isHoy ? "is-hoy " : "") +
                (cerrado ? "is-cerrado" : "is-agendable")
              }
              style={{ height: heightPx }}
              // Click en un slot vacío → crear turno a esa hora (redondeo 15').
              // Los clicks sobre cards (turno/bloqueo/pedido) NO caen acá: se
              // filtran por closest() porque esos handlers no hacen
              // stopPropagation y abrir dos modales sería un doble-open.
              onClick={(e) => {
                if (cerrado) return;
                const target = e.target as HTMLElement;
                if (target.closest(".cal-turno, .cal-bloqueo, .cal-pedido")) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const hora = slotDesdeOffsetY({
                  offsetY: e.clientY - rect.top,
                  horaInicio: rango.horaInicio,
                  horaFin: rango.horaFin,
                  horaPx: HORA_PX,
                });
                onCreateSlot(iso, hora);
              }}
            >
              {Array.from({ length: hours }, (_, k) => (
                <div key={`g-${k}`}>
                  <div className="cal-gridline" style={{ top: k * HORA_PX }} />
                  <div className="cal-gridline cal-gridline-half" style={{ top: k * HORA_PX + HORA_PX / 2 }} />
                </div>
              ))}

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
                      rango={rango}
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
                      rango={rango}
                      onClick={onSelectPedido}
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
                    rango={rango}
                    onSelect={onSelectTurno}
                  />
                );
              })}

              {isHoy && ahoraVisible ? (
                <div className="cal-ahora" style={{ top: timeToTop(nowHHMM, rango) }}>
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

// ─── VistaMes ────────────────────────────────────────────────────────────────

const DIAS_MES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MAX_PREVIEW = 3;

function VistaMes({
  grid,
  turnos,
  pacientes,
  hoyIso,
  onSelectTurno,
}: {
  grid: MonthGridCell[];
  turnos: TurnoSemana[];
  pacientes: PacientesById;
  hoyIso: string;
  onSelectTurno: (t: TurnoSemana) => void;
}) {
  // Agrupar turnos por fecha (YYYY-MM-DD).
  const turnosPorDia = useMemo(() => {
    const map = new Map<string, TurnoSemana[]>();
    for (const t of turnos) {
      const arr = map.get(t.fecha);
      if (arr) arr.push(t);
      else map.set(t.fecha, [t]);
    }
    // Ordenar cada día por hora.
    for (const arr of map.values()) arr.sort((a, b) => hmToMin(a.hora) - hmToMin(b.hora));
    return map;
  }, [turnos]);

  return (
    <div className="cal-mes">
      <div className="cal-mes-headers">
        {DIAS_MES.map((d) => (
          <div key={d} className="cal-mes-dow">{d}</div>
        ))}
      </div>
      <div className="cal-mes-grid">
        {grid.map((cell) => {
          const dayTurnos = turnosPorDia.get(cell.dateIso) ?? [];
          const numero = Number(cell.dateIso.slice(-2));
          const isHoy = cell.dateIso === hoyIso;
          const overflow = dayTurnos.length - MAX_PREVIEW;
          return (
            <div
              key={cell.dateIso}
              className={
                "cal-mes-cell " +
                (cell.inCurrentMonth ? "" : "is-out ") +
                (isHoy ? "is-hoy" : "")
              }
            >
              <div className="cal-mes-cell-head">
                <span className="cal-mes-num">{numero}</span>
                {dayTurnos.length > 0 ? (
                  <span className="cal-mes-count" aria-label={`${dayTurnos.length} turnos`}>
                    {dayTurnos.length}
                  </span>
                ) : null}
              </div>
              {dayTurnos.length > 0 ? (
                <ul className="cal-mes-events">
                  {dayTurnos.slice(0, MAX_PREVIEW).map((t) => {
                    const paciente = pacientes[t.pacienteId];
                    const nombre = paciente ? abreviar(paciente.nombre) : "Turno";
                    // Click abre el mismo detalle que la vista semanal. El <button>
                    // resetea estilos (font/color/border) para no alterar el
                    // render del preview mensual; solo agrega cursor + hit-area.
                    return (
                      <li key={t.id} className="cal-mes-event">
                        <button
                          type="button"
                          className="cal-mes-event-btn"
                          title={`${t.hora} · ${nombre}`}
                          onClick={() => onSelectTurno(t)}
                        >
                          <span className="fi-mono cal-mes-event-h">{t.hora}</span>
                          <span className="cal-mes-event-n">{nombre}</span>
                        </button>
                      </li>
                    );
                  })}
                  {overflow > 0 ? (
                    <li className="cal-mes-more">+{overflow} más</li>
                  ) : null}
                </ul>
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
  /** Por índice de weekDates (0=LUN..6=DOM); ver deriveDiasCerrados. */
  diasCerrados?: boolean[];
  /** Minutos de disponibilidad por día (0=LUN..6=DOM); ver deriveCapacidadSemana. */
  capacidadDiaMin?: Array<number | null>;
  /**
   * Min/max (minutos) de disponibilidad_profesional en la semana visible;
   * null/ausente = sin disponibilidad cargada. Ver deriveRangoHorario.
   */
  rangoDisponibilidadMin?: RangoMin | null;
  weekRangeLabel: string;
  hoyIso: string;
  nowHHMM: string;
  weekStartIso: string;
  prevWeekIso: string;
  nextWeekIso: string;
  hoyWeekStartIso: string;
  initialVista?: Vista;
  /** Org activa — habilita el live update (polling / realtime tras flag). */
  organizationId?: string;
  // Vista mensual (PR E)
  mesGrid: MonthGridCell[];
  mesTurnos: TurnoSemana[];
  mesPacientes: PacientesById;
  mesLabel: string;
  mesHoyIso: string;
  /** Ancla "YYYY-MM" del mes activo — para que el selector de profesional preserve el mes. */
  monthIso?: string;
  prevMonthIso: string;
  nextMonthIso: string;
  hoyMonthIso: string;
  /**
   * Modo clínica: colegiados para el selector de profesional. Lista vacía
   * (default) = sin selector — el render histórico de orgs Solo no cambia.
   */
  profesionales?: ProfesionalLite[];
  /** member.id activo en el filtro `?prof=`; null = "Todos". */
  profActivo?: string | null;
  /**
   * Colegiados activos (lista COMPLETA, a diferencia de `profesionales` que
   * llega vacía cuando el selector de agenda no aplica). Alimenta el picker
   * de profesional del PedidoModal (CLINICA-3) — un pedido sin profesional
   * necesita destino aunque el rol no tenga selector de agenda.
   */
  colegiados?: ProfesionalLite[];
  /** member.id de la sesión — default del picker del PedidoModal. */
  sessionMemberId?: string | null;
}

export function Calendario({
  turnos,
  bloqueos,
  pedidos,
  pacientes,
  weekDates,
  diasCerrados,
  capacidadDiaMin,
  rangoDisponibilidadMin = null,
  weekRangeLabel,
  hoyIso,
  nowHHMM,
  weekStartIso,
  prevWeekIso,
  nextWeekIso,
  hoyWeekStartIso,
  initialVista = "semana",
  organizationId,
  mesGrid,
  mesTurnos,
  mesPacientes,
  mesLabel,
  mesHoyIso,
  monthIso,
  prevMonthIso,
  nextMonthIso,
  hoyMonthIso,
  profesionales = [],
  profActivo = null,
  colegiados = [],
  sessionMemberId = null,
}: CalendarioProps) {
  const router = useRouter();
  const [vista, setVista] = useState<Vista>(initialVista);
  const [estados, setEstados] = useState<Set<string>>(new Set());
  const [mostrarPedidos, setMostrarPedidos] = useState(true);
  const [selectedPedido, setSelectedPedido] = useState<Pedido | null>(null);
  const [selectedTurno, setSelectedTurno] = useState<TurnoSemana | null>(null);
  const [agendarOpen, setAgendarOpen] = useState(false);
  // "Crear turno manual" desde el PedidoModal: abre el TurnoCreateModal CON el
  // pedido vinculado — al crear el turno, el server marca el pedido CONFIRMADO
  // (cierra el dead-end en que quedaba PENDIENTE para siempre).
  const [agendarDesdePedido, setAgendarDesdePedido] = useState<Pedido | null>(null);
  // Click-to-create desde la grilla: "YYYY-MM-DDTHH:MM" (hora local del slot
  // clickeado o del "+" del header) — abre el TurnoCreateModal con ese default.
  const [agendarSlot, setAgendarSlot] = useState<string | null>(null);

  // Href de cada chip del selector de profesional: preserva la vista activa
  // (semana ?w= / mes ?mes=) — SSR puro, mismo patrón que la navegación.
  const profHrefFor = (id: string | null) => {
    const profQ = id ? `&prof=${id}` : "";
    if (vista === "mes" && monthIso) return `/calendario?vista=mes&mes=${monthIso}${profQ}`;
    return `/calendario?w=${weekStartIso}${profQ}`;
  };

  // Live update: los turnos llegan por props (sin useState espejo), así que
  // un router.refresh() alcanza para que la vista se actualice sola.
  useAgendaAutoRefresh(organizationId ?? null);

  // Fallback defensivo si el SC todavía no manda la prop (mismo hardcode previo).
  const cerradosSemana = diasCerrados ?? weekDates.map((_, i) => i === 5 || i === 6);

  const pedidosPendientes = useMemo(() => pedidos.filter((p) => p.estado === "pendiente"), [pedidos]);
  const pedidosVisibles = mostrarPedidos ? pedidosPendientes : [];

  const turnosFiltrados = useMemo(() => {
    if (estados.size === 0) return turnos;
    return turnos.filter((t) => estados.has(t.estado));
  }, [estados, turnos]);

  // Rango horario de la grilla: min/max entre disponibilidad y eventos REALES
  // de la semana (sin filtros de estado/pedidos — el rango no salta al togglear
  // chips). Antes: hardcode 08–19 que clipeaba un turno de 07:30 o 19:30.
  const rangoHorario = useMemo(() => {
    const eventos: EventoHorario[] = [
      ...turnos.map((t) => ({ hora: t.hora, dur: t.dur })),
      ...bloqueos.map((b) => ({ hora: b.hora, dur: b.dur })),
      ...pedidos
        .filter((p) => p.estado === "pendiente" && p.fecha && p.hora)
        .map((p) => ({ hora: p.hora, dur: p.dur })),
    ];
    return deriveRangoHorario({ eventos, disponibilidad: rangoDisponibilidadMin });
  }, [turnos, bloqueos, pedidos, rangoDisponibilidadMin]);

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
        mesLabel={mesLabel}
        prevMonthIso={prevMonthIso}
        nextMonthIso={nextMonthIso}
        hoyMonthIso={hoyMonthIso}
        onAgendar={() => setAgendarOpen(true)}
        profesionales={profesionales}
        profActivo={profActivo}
        profHrefFor={profHrefFor}
      />

      {vista === "semana" ? (
        <VistaSemana
          turnos={turnosFiltrados}
          bloqueos={bloqueos}
          pedidos={pedidosVisibles}
          pacientes={pacientes}
          weekDates={weekDates}
          diasCerrados={cerradosSemana}
          capacidadDiaMin={capacidadDiaMin}
          rango={rangoHorario}
          hoyIso={hoyIso}
          nowHHMM={nowHHMM}
          onOpenBandeja={() => setVista("bandeja")}
          onSelectPedido={setSelectedPedido}
          onSelectTurno={setSelectedTurno}
          onCreateSlot={(fecha, hora) => setAgendarSlot(`${fecha}T${hora}`)}
        />
      ) : vista === "bandeja" ? (
        <VistaBandejaSimple
          pedidos={pedidosPendientes}
          onSelectPedido={setSelectedPedido}
        />
      ) : (
        <VistaMes
          grid={mesGrid}
          turnos={mesTurnos}
          pacientes={mesPacientes}
          hoyIso={mesHoyIso}
          onSelectTurno={setSelectedTurno}
        />
      )}

      {selectedPedido ? (
        <PedidoModal
          pedido={selectedPedido}
          colegiados={colegiados}
          sessionMemberId={sessionMemberId}
          profActivo={profActivo}
          onCrearTurnoManual={() => {
            setAgendarDesdePedido(selectedPedido);
            setSelectedPedido(null);
          }}
          onClose={() => setSelectedPedido(null)}
          onResolved={() => setSelectedPedido(null)}
        />
      ) : null}

      {/* Detalle del turno (M56): el turno puede venir de la grilla semanal
          (pacientes) o de la mensual (mesPacientes) — resolvemos el paciente
          en ambos pools. Nombre/teléfono ya vienen desencriptados server-side;
          notaReserva solo está presente para roles clínicos (gate en el fetcher). */}
      {selectedTurno ? (() => {
        const pac = pacientes[selectedTurno.pacienteId] ?? mesPacientes[selectedTurno.pacienteId];
        return (
          <TurnoDetalleModal
            pacienteNombre={pac?.nombre ?? "Paciente"}
            pacienteId={selectedTurno.pacienteId}
            fecha={selectedTurno.fecha}
            hora={selectedTurno.hora}
            dur={selectedTurno.dur}
            servicio={selectedTurno.servicio}
            estado={selectedTurno.estado}
            origen={selectedTurno.origen}
            profesionalNombre={selectedTurno.profesionalNombre ?? null}
            telefono={pac?.telefono ?? null}
            notaReserva={selectedTurno.notaReserva ?? null}
            onClose={() => setSelectedTurno(null)}
          />
        );
      })() : null}

      {/* Entry point "Agendar": reusa el modal de /hoy tal cual (origen MANUAL).
          createTurnoAction ya revalida /calendario; el refresh fuerza el
          re-render inmediato del SC para que el turno aparezca sin F5.
          defaultProfesionalId: con filtro de profesional activo, el turno cae
          en ESA agenda y no en la del usuario de sesión (CLINICA-3, F). */}
      {agendarOpen ? (
        <TurnoCreateModal
          origen="MANUAL"
          defaultProfesionalId={profActivo}
          onClose={() => setAgendarOpen(false)}
          onCreated={() => {
            setAgendarOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      {/* Click-to-create: mismo modal, con el datetime del slot clickeado como
          default EXACTO (estándar Jane/Cliniko — sin tipear fecha ni hora).
          "YYYY-MM-DDTHH:MM" se interpreta en la TZ del browser, igual que el
          inicioIso del TurnoReagendarModal en /hoy. */}
      {agendarSlot ? (
        <TurnoCreateModal
          origen="MANUAL"
          defaultInicio={agendarSlot}
          defaultProfesionalId={profActivo}
          onClose={() => setAgendarSlot(null)}
          onCreated={() => {
            setAgendarSlot(null);
            router.refresh();
          }}
        />
      ) : null}

      {/* "Crear turno manual" desde un pedido: mismo modal de agendar, pero
          con pedidoId — createTurnoAction confirma el pedido al crear el
          turno. preselectPacienteId solo si el pedido ya referencia paciente
          (los de WhatsApp suelen ser nuevos: se cargan a mano en el modal). */}
      {agendarDesdePedido ? (
        <TurnoCreateModal
          origen="MANUAL"
          defaultProfesionalId={agendarDesdePedido.profesionalId ?? profActivo}
          preselectPacienteId={agendarDesdePedido.pacienteId}
          pedidoId={agendarDesdePedido.id}
          onClose={() => setAgendarDesdePedido(null)}
          onCreated={() => {
            setAgendarDesdePedido(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Bandeja: lista cards clickeables de pedidos pendientes. Click sobre una
 * card abre el PedidoModal que dispara aceptarPedidoAction / rechazarPedidoAction.
 */
function VistaBandejaSimple({
  pedidos,
  onSelectPedido,
}: {
  pedidos: Pedido[];
  onSelectPedido: (p: Pedido) => void;
}) {
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
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onSelectPedido(p)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: 12,
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--surface)",
                cursor: "pointer",
                font: "inherit",
                color: "inherit",
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
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
