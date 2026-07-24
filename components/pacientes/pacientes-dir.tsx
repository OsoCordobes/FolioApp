"use client";

/**
 * Folio · /pacientes — directorio de pacientes.
 *
 * Port fiel de folio/pacientes-dir.jsx (417 líneas). Single-file porque
 * todos los sub-componentes (Toolbar, TablaPacientes, BulkBar, ReactivarWidget,
 * PageHeader) son privados a esta ruta y comparten state.
 *
 * En F4 las acciones (Etiquetar, Archivar, Enviar mensaje, Agendar) se
 * conectan a Server Actions reales y la data viene de Supabase.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import * as I from "@/components/icons";
import { TurnoCreateModal } from "@/components/hoy/turno-create-modal";
import { PacienteCreateModal } from "@/components/pacientes/paciente-create-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { normalizarBusqueda } from "@/lib/format/busqueda";
import { toWhatsappE164 } from "@/lib/format/phone";
import type { PacienteDirRow } from "@/lib/db/pacientes-dir";
import type { EspecialidadSlug } from "@/lib/especialidades/meta";

// Re-export con el alias del prototipo para no tocar el resto del archivo.
type PacienteDir = PacienteDirRow;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const fmtFechaCorta = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
};

const iniciales = (n: string): string =>
  n.split(" ").map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();

const diasDesde = (iso: string | null, now: number = Date.now()): number | null => {
  if (!iso) return null;
  return Math.floor((now - new Date(iso + "T00:00:00").getTime()) / 86_400_000);
};

const ESTADO_VIS: Record<PacienteDir["estado"], { lbl: string; color: string }> = {
  activo:   { lbl: "Activo",   color: "var(--green)" },
  inactivo: { lbl: "Inactivo", color: "var(--ink-3)" },
  pausa:    { lbl: "En pausa", color: "var(--amber)" },
  alta:     { lbl: "Alta",     color: "var(--slate)" },
};

// ─── Toolbar ────────────────────────────────────────────────────────────────

interface ToolbarProps {
  q: string;
  setQ: (v: string) => void;
  filtro: string;
  setFiltro: (v: string) => void;
  counts: Record<string, number>;
  onAddPaciente: () => void;
  /** Ref del input de búsqueda — lo enfoca el atajo global "/". */
  searchRef: React.RefObject<HTMLInputElement | null>;
}

function Toolbar({ q, setQ, filtro, setFiltro, counts, onAddPaciente, searchRef }: ToolbarProps) {
  const filtros: [string, string, number][] = [
    ["todos",     "Todos",          counts.todos],
    ["activos",   "Activos",        counts.activos],
    ["nuevos",    "Nuevos",         counts.nuevos],
    ["reactivar", "Para reactivar", counts.reactivar],
    ["inactivos", "Inactivos",      counts.inactivos],
    ["alta",      "Alta",           counts.alta],
  ];
  return (
    <div className="pd-toolbar">
      <div className="pd-search">
        <I.Search size={13} />
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar nombre, teléfono, tag…"
          aria-label="Buscar paciente (atajo: /)"
        />
        <span className="fi-kbd">/</span>
      </div>
      <div className="pd-filtros">
        {filtros.map(([id, lbl, count]) => (
          <button
            key={id}
            type="button"
            className={"pd-filtro " + (filtro === id ? "is-active" : "")}
            onClick={() => setFiltro(id)}
          >
            {lbl}
            <span className="pd-filtro-count">{count}</span>
          </button>
        ))}
      </div>
      <button type="button" className="fi-btn fi-btn-primary pd-add" onClick={onAddPaciente}>
        <I.Plus size={13} /> Nuevo paciente
      </button>
    </div>
  );
}

// ─── Tabla ──────────────────────────────────────────────────────────────────

interface TablaPacientesProps {
  pacientes: PacienteDir[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  onOpen: (p: PacienteDir) => void;
  onAgendar: (p: PacienteDir) => void;
}

function TablaPacientes({ pacientes, selected, setSelected, onOpen, onAgendar, totalOrg }: TablaPacientesProps & { totalOrg: number }) {
  const allOn = pacientes.length > 0 && selected.size === pacientes.length;

  const toggleAll = () => {
    if (allOn) setSelected(new Set());
    else setSelected(new Set(pacientes.map((p) => p.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  if (pacientes.length === 0) {
    // Diferenciar "filtrado vacío" (hay pacientes pero los filtros los esconden)
    // de "directorio vacío" (org sin pacientes todavía). El segundo caso
    // necesita un CTA distinto.
    if (totalOrg === 0) {
      return (
        <div className="fi-empty">
          <h2>Todavía no tenés pacientes.</h2>
          <p>
            Creá el primero con el botón <b>Nuevo paciente</b> de arriba, o esperá a que entre uno
            por tu link público de reservas.
          </p>
          <p>
            ¿Venís de una planilla o de otro sistema? Importá tu cartera completa desde un CSV —
            Folio detecta duplicados por DNI y teléfono.
          </p>
          <div className="fi-empty-actions">
            <a href="/configuracion/importar-pacientes" className="fi-btn fi-btn-secondary">
              Importar pacientes desde CSV
            </a>
          </div>
        </div>
      );
    }
    return (
      <div className="fi-empty">
        <h2>Sin pacientes con esos criterios.</h2>
        <p>Probá quitando filtros o cambiando la búsqueda.</p>
      </div>
    );
  }

  return (
    <table className="pd-table">
      <thead>
        <tr>
          <th className="pd-th-check">
            <label className="pd-check">
              <input type="checkbox" checked={allOn} onChange={toggleAll} />
              <span className="pd-check-box" />
            </label>
          </th>
          <th>Paciente</th>
          <th>Tags</th>
          <th className="ta-r">Última</th>
          <th className="ta-r">Sesiones</th>
          <th>Próximo</th>
          <th>Estado</th>
        </tr>
      </thead>
      <tbody>
        {pacientes.map((p) => {
          const dias = diasDesde(p.ultima);
          const esRiesgo = p.estado === "inactivo" && dias !== null && dias > 60;
          const est = ESTADO_VIS[p.estado];
          const isSel = selected.has(p.id);
          return (
            <tr key={p.id} className={isSel ? "is-selected" : ""} onClick={() => onOpen(p)}>
              <td
                onClick={(e) => {
                  e.stopPropagation();
                  toggleOne(p.id);
                }}
              >
                <label className="pd-check">
                  <input type="checkbox" checked={isSel} onChange={() => {}} />
                  <span className="pd-check-box" />
                </label>
              </td>
              <td>
                <div className="pd-paciente">
                  <div className="fi-avatar pd-avatar">{iniciales(p.nombre)}</div>
                  <div className="pd-paciente-body">
                    <b>{p.nombre}</b>
                    <span className="fm-mono">{p.tel}</span>
                  </div>
                  {p.tipo === "nuevo" ? <span className="fi-pill fi-pill--new">1ª visita</span> : null}
                </div>
              </td>
              <td>
                <div className="pd-tags">
                  {p.tags.slice(0, 2).map((t) => (
                    <span
                      key={t}
                      className={"fi-pill " + (t === "VIP" ? "fi-pill--vip" : "fi-pill--mute")}
                    >
                      {t}
                    </span>
                  ))}
                  {p.tags.length > 2 ? (
                    <span className="fi-pill fi-pill--mute">+{p.tags.length - 2}</span>
                  ) : null}
                </div>
              </td>
              <td className="ta-r">
                <span className={"pd-ultima " + (esRiesgo ? "is-riesgo" : "")}>
                  {p.ultima ? fmtFechaCorta(p.ultima) : "—"}
                  {dias != null && dias >= 30 ? (
                    <span className="pd-dias muted">
                      {" "}
                      · hace {dias < 365 ? dias + "d" : Math.floor(dias / 30) + " meses"}
                    </span>
                  ) : null}
                </span>
              </td>
              <td className="ta-r">
                <span className="fm-mono">{p.sesiones}</span>
              </td>
              <td>
                {p.proximo ? (
                  <span className="pd-proximo">
                    <span className="pd-proximo-dot" />
                    {fmtFechaCorta(p.proximo)}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="pd-cta-mini"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAgendar(p);
                    }}
                  >
                    <I.Plus size={11} /> Agendar
                  </button>
                )}
              </td>
              <td>
                <span className="pd-estado" style={{ color: est.color }}>
                  <span className="pd-estado-dot" style={{ background: est.color }} />
                  {est.lbl}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── BulkBar ────────────────────────────────────────────────────────────────

// Etiquetar/Archivar masivos NO existen todavía: los botones disabled
// "Próximamente" que vivían acá eran affordances muertas (audit C3) — ambas
// acciones se hacen individualmente desde la ficha del paciente. Cuando el
// bulk real llegue, se agregan los botones con su handler de verdad.
interface BulkBarProps {
  count: number;
  onClear: () => void;
  onWa: () => void;
}

function BulkBar({ count, onClear, onWa }: BulkBarProps) {
  return (
    <div className="pd-bulk">
      <div className="pd-bulk-l">
        <button type="button" className="pd-bulk-clear" onClick={onClear} aria-label="Limpiar selección">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
        <span>
          <b>{count}</b> seleccionado{count === 1 ? "" : "s"}
        </span>
      </div>
      <div className="pd-bulk-r">
        <button type="button" className="fi-btn fi-btn-secondary" onClick={onWa}>
          <I.Phone size={12} /> Enviar mensaje WhatsApp
        </button>
      </div>
    </div>
  );
}

// ─── Reactivar widget ──────────────────────────────────────────────────────

function ReactivarWidget({
  pacientes,
  onWhatsApp,
}: {
  pacientes: PacienteDir[];
  /** Delegado al root: valida teléfonos y pide confirmación (ConfirmDialog). */
  onWhatsApp: (ids: Set<string>) => void;
}) {
  if (pacientes.length === 0) return null;
  return (
    <section className="pd-reactivar">
      <header>
        <div>
          <span className="fi-eyebrow">
            Para reactivar · {pacientes.length} {pacientes.length === 1 ? "paciente" : "pacientes"}
          </span>
          <h3>Hace más de 60 días sin contacto.</h3>
        </div>
        <button
          type="button"
          className="fi-btn fi-btn-secondary"
          onClick={() => onWhatsApp(new Set(pacientes.map((p) => p.id)))}
        >
          Enviar a todos →
        </button>
      </header>
      <div className="pd-reactivar-list">
        {pacientes.slice(0, 3).map((p) => {
          const dias = diasDesde(p.ultima) ?? 0;
          return (
            <div key={p.id} className="pd-reactivar-row">
              <div className="fi-avatar pd-avatar">{iniciales(p.nombre)}</div>
              <div className="pd-reactivar-body">
                <b>{p.nombre}</b>
                <span className="muted fm-mono">{p.tel || "Sin teléfono cargado"}</span>
              </div>
              <span className="pd-reactivar-meta fm-mono">
                última {fmtFechaCorta(p.ultima)} · hace {Math.floor(dias / 30)} meses
              </span>
              <button
                type="button"
                className="fi-btn fi-btn-secondary"
                onClick={() => onWhatsApp(new Set([p.id]))}
                disabled={!p.tel}
                title={p.tel ? "Abrir WhatsApp" : "Sin teléfono cargado"}
                aria-disabled={!p.tel}
              >
                <I.Phone size={11} /> Mensaje
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Page header ────────────────────────────────────────────────────────────

function PageHeader({ total, activos, paraReactivarCount, onExport }: { total: number; activos: number; paraReactivarCount: number; onExport: () => void }) {
  return (
    <header className="pd-head">
      <div>
        <span className="fi-eyebrow">Directorio</span>
        <h1>Pacientes</h1>
        <p className="pd-head-sub">
          {total} en total · {activos} activos · {paraReactivarCount} para reactivar
        </p>
      </div>
      <div className="pd-head-actions">
        <button type="button" className="fi-btn fi-btn-ghost" onClick={onExport} title="Descargar CSV con la lista visible">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
          Exportar
        </button>
      </div>
    </header>
  );
}

function exportPacientesToCsv(pacientes: PacienteDir[]): void {
  const headers = ["Nombre", "Telefono", "Email", "Tipo", "Sesiones", "Ultima", "Proximo", "Estado", "Tags"];
  const rows = pacientes.map((p) => [
    csvEscape(p.nombre),
    csvEscape(p.tel),
    csvEscape(p.email),
    csvEscape(p.tipo),
    String(p.sesiones),
    csvEscape(p.ultima ?? ""),
    csvEscape(p.proximo ?? ""),
    csvEscape(p.estado),
    csvEscape(p.tags.join("; ")),
  ].join(","));
  const csv = [headers.join(","), ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pacientes-folio-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value: string): string {
  if (value == null) return "";
  const needsQuote = /[",\r\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

// ─── Root ──────────────────────────────────────────────────────────────────

interface PacientesDirProps {
  pacientes: PacienteDir[];
  initialQuery?: string;
  /**
   * Workstream 5 · especialidad EFECTIVA del usuario — decide qué campos
   * avanzados muestra el alta. El modal hace fallback a quiropraxia si no llega.
   */
  especialidad?: EspecialidadSlug;
  /** true en orgs CLINICA: el alta deja elegir la especialidad del avanzado. */
  permiteElegirEspecialidad?: boolean;
}

export function PacientesDir({
  pacientes,
  initialQuery = "",
  especialidad,
  permiteElegirEspecialidad = false,
}: PacientesDirProps) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const [filtro, setFiltro] = useState("todos");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [agendarFor, setAgendarFor] = useState<PacienteDir | null>(null);
  /** Confirmación pendiente del WhatsApp masivo (reemplaza confirm/alert nativos). */
  const [waConfirm, setWaConfirm] = useState<string[] | null>(null);
  const toast = useToast();

  /**
   * WhatsApp masivo (C4): resuelve teléfonos E.164 válidos y decide UI —
   * 0 válidos → toast de error (antes: alert nativo); 1 → abre directo;
   * >1 → ConfirmDialog (antes: confirm nativo) porque abre una pestaña por
   * paciente y eso hay que anticiparlo.
   */
  const solicitarWhatsApp = (ids: Set<string>) => {
    const e164s = pacientes
      .filter((p) => ids.has(p.id))
      .map((p) => toWhatsappE164(p.tel))
      .filter((e): e is string => e !== null);
    if (e164s.length === 0) {
      toast.show({
        titulo: "Ningún paciente seleccionado tiene un teléfono válido cargado.",
        tono: "error",
      });
      return;
    }
    if (e164s.length === 1) {
      abrirWhatsApp(e164s);
      return;
    }
    setWaConfirm(e164s);
  };

  // Atajo "/" → enfoca el buscador (mismo patrón que el ⌘K del sidebar).
  // Solo cuando el foco NO está en un campo editable y no hay modal abierto:
  // dentro de un modal el "/" es texto, no atajo.
  const searchRef = useRef<HTMLInputElement | null>(null);
  const modalAbierto = createOpen || agendarFor != null;
  useEffect(() => {
    if (modalAbierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalAbierto]);

  const paraReactivar = useMemo(
    () =>
      pacientes.filter(
        (p) => p.estado === "inactivo" && (diasDesde(p.ultima) ?? 0) > 60,
      ),
    [pacientes],
  );

  const counts = useMemo(
    () => ({
      todos:     pacientes.length,
      activos:   pacientes.filter((p) => p.estado === "activo").length,
      nuevos:    pacientes.filter((p) => p.tipo === "nuevo").length,
      reactivar: paraReactivar.length,
      inactivos: pacientes.filter((p) => p.estado === "inactivo").length,
      alta:      pacientes.filter((p) => p.estado === "alta").length,
    }),
    [pacientes, paraReactivar],
  );

  const filtered = useMemo(() => {
    let list: PacienteDir[] = pacientes;
    if (filtro === "activos") list = list.filter((p) => p.estado === "activo");
    if (filtro === "nuevos") list = list.filter((p) => p.tipo === "nuevo");
    if (filtro === "reactivar") list = paraReactivar;
    if (filtro === "inactivos") list = list.filter((p) => p.estado === "inactivo");
    if (filtro === "alta") list = list.filter((p) => p.estado === "alta");
    if (q.trim()) {
      // Normalizado en AMBOS lados (query y campos): "jose" encuentra a
      // "José" — el caso más común del país. Ver lib/format/busqueda.ts.
      const qq = normalizarBusqueda(q);
      const digitos = qq.replace(/\D/g, "");
      list = list.filter(
        (p) =>
          normalizarBusqueda(p.nombre).includes(qq) ||
          (digitos.length >= 3 && p.tel.replace(/\D/g, "").includes(digitos)) ||
          p.tel.toLowerCase().includes(qq) ||
          p.tags.some((tag) => normalizarBusqueda(tag).includes(qq)),
      );
    }
    return list;
  }, [filtro, q, paraReactivar, pacientes]);

  return (
    <>
      <div className="fi-content pd-content">
        <PageHeader
          total={pacientes.length}
          activos={counts.activos}
          paraReactivarCount={paraReactivar.length}
          onExport={() => exportPacientesToCsv(filtered)}
        />

        {filtro !== "reactivar" && paraReactivar.length > 0 ? (
          <ReactivarWidget pacientes={paraReactivar} onWhatsApp={solicitarWhatsApp} />
        ) : null}

        <Toolbar
          q={q}
          setQ={setQ}
          filtro={filtro}
          setFiltro={setFiltro}
          counts={counts}
          onAddPaciente={() => setCreateOpen(true)}
          searchRef={searchRef}
        />

        <div className="pd-table-wrap">
          <TablaPacientes
            pacientes={filtered}
            totalOrg={pacientes.length}
            selected={selected}
            setSelected={setSelected}
            onOpen={(p) => {
              // SPA nav (audit C3): window.location.href recargaba la app
              // entera en la transición más frecuente del directorio.
              router.push(`/pacientes/${p.id}`);
            }}
            onAgendar={(p) => setAgendarFor(p)}
          />
        </div>
      </div>

      {selected.size > 0 ? (
        <BulkBar
          count={selected.size}
          onClear={() => setSelected(new Set())}
          onWa={() => solicitarWhatsApp(selected)}
        />
      ) : null}

      {waConfirm ? (
        <ConfirmDialog
          titulo={`¿Abrir WhatsApp para ${waConfirm.length} pacientes?`}
          mensaje="Se abre una pestaña de WhatsApp por paciente."
          confirmLabel="Abrir pestañas"
          onConfirm={() => abrirWhatsApp(waConfirm)}
          onClose={() => setWaConfirm(null)}
        />
      ) : null}

      {createOpen ? (
        <PacienteCreateModal
          especialidad={especialidad}
          permiteElegirEspecialidad={permiteElegirEspecialidad}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => {
            // Tras crear, mandar al user a la ficha del paciente nuevo para
            // que pueda completar motivo de consulta, tags, etc. (SPA nav,
            // sin full reload — audit C3.)
            router.push(`/pacientes/${id}`);
          }}
        />
      ) : null}

      {agendarFor ? (
        <TurnoCreateModal
          origen="MANUAL"
          preselectPacienteId={agendarFor.id}
          onClose={() => setAgendarFor(null)}
          onCreated={() => setAgendarFor(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Abre wa.me por cada teléfono ya normalizado a E.164 AR (54 + 9 móvil + NSN,
 * sin 0/15 — auditoría L4). La validación + confirmación viven en
 * `solicitarWhatsApp` (root): acá solo se ejecuta la apertura.
 */
function abrirWhatsApp(e164s: string[]): void {
  for (const e164 of e164s) {
    window.open(`https://wa.me/${e164}`, "_blank", "noopener");
  }
}
