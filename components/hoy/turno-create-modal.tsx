"use client";

/**
 * Folio · TurnoCreateModal · UI para agendar un turno desde /hoy (walk-in) o
 * /calendario (modal manual).
 *
 * Flujo:
 *   1. On open → carga metadata (servicios + pacientes recientes + profesionalId)
 *      via loadCreateTurnoMeta server action.
 *   2. Usuario elige paciente existente (typeahead por nombre) o switcha a
 *      "Crear nuevo" (form inline: nombre / apellido / teléfono / email).
 *   3. Usuario elige servicio (dropdown), datetime (HTML datetime-local).
 *      Duración auto-fill del servicio, editable.
 *   4. Submit → createTurnoAction.
 *
 * Origen del turno: WALK_IN cuando se abre desde la FAB de /hoy con un default
 * de "ahora", MANUAL en cualquier otro caso.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

// Escape para cerrar (UX estándar de modales). Solo cuando no estamos en medio
// del submit.

import {
  createTurnoAction,
  loadCreateTurnoMeta,
  type CreateTurnoMeta,
  type PacientePickerRow,
  type ServicioPickerRow,
} from "@/app/(app)/hoy/actions";

interface TurnoCreateModalProps {
  defaultInicio?: string; // ISO with offset
  origen?: "MANUAL" | "WALK_IN";
  /** Si está set, abrimos en modo "existente" con el paciente preseleccionado. */
  preselectPacienteId?: string;
  onClose: () => void;
  onCreated: (turnoId: string) => void;
}

interface NuevoPacienteState {
  nombre: string;
  apellido: string;
  telefono: string;
  email: string;
}

const EMPTY_NUEVO: NuevoPacienteState = { nombre: "", apellido: "", telefono: "", email: "" };

export function TurnoCreateModal({
  defaultInicio,
  origen = "MANUAL",
  preselectPacienteId,
  onClose,
  onCreated,
}: TurnoCreateModalProps) {
  const [meta, setMeta] = useState<CreateTurnoMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [mode, setMode] = useState<"existente" | "nuevo">("existente");
  const [pacienteId, setPacienteId] = useState<string | null>(preselectPacienteId ?? null);
  const [pacienteQuery, setPacienteQuery] = useState("");
  const [nuevo, setNuevo] = useState<NuevoPacienteState>(EMPTY_NUEVO);
  const [servicioId, setServicioId] = useState<string | null>(null);
  const [inicioLocal, setInicioLocal] = useState<string>(() => isoToLocalDatetime(defaultInicio));
  const [duracion, setDuracion] = useState<number>(45);
  const [submitting, startTransition] = useTransition();
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  // Hidratar metadata. La pre-selección de paciente la usamos una sola vez
  // al montar — si cambia el prop después, ignoramos (el modal se rerenderea
  // si el caller lo desmonta y monta de nuevo).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await loadCreateTurnoMeta();
      if (cancelled) return;
      if (!result.ok) {
        setLoadErr(result.error.message);
        setLoading(false);
        return;
      }
      setMeta(result.data);
      if (result.data.servicios.length > 0) {
        setServicioId(result.data.servicios[0].id);
        setDuracion(result.data.servicios[0].duracionMin);
      }
      // Si vino con preselectPacienteId: forzamos modo "existente". Sino, si no
      // hay pacientes recientes, abrir directamente el flujo "nuevo".
      if (preselectPacienteId) {
        setMode("existente");
        // Pre-llenar el query con el nombre del paciente para que aparezca
        // en el typeahead aunque no esté en los top 50.
        const pac = result.data.pacientes.find((p) => p.id === preselectPacienteId);
        if (pac) setPacienteQuery(`${pac.nombre} ${pac.apellido}`.trim());
      } else if (result.data.pacientes.length === 0) {
        setMode("nuevo");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [preselectPacienteId]);

  // Escape cierra el modal cuando no estamos en submit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  // Focus inicial: cuando termina de cargar, enfocamos el primer input
  // relevante según el modo. Mejor a11y para usuarios de teclado.
  const focusTargetRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (loading || !meta || meta.servicios.length === 0) return;
    // Pequeño microtask para que el input ya esté montado en el DOM.
    const t = setTimeout(() => focusTargetRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [loading, meta, mode]);

  // Cuando cambia servicio, reset duración al default del servicio (si el
  // usuario no la había tocado todavía, mejor; aquí lo hacemos simple y
  // sobreescribimos siempre).
  const onChangeServicio = (id: string) => {
    setServicioId(id);
    const s = meta?.servicios.find((x) => x.id === id);
    if (s) setDuracion(s.duracionMin);
  };

  const pacientesFiltrados = useMemo<PacientePickerRow[]>(() => {
    if (!meta) return [];
    const q = pacienteQuery.trim().toLowerCase();
    if (q.length === 0) return meta.pacientes.slice(0, 8);
    return meta.pacientes
      .filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          p.apellido.toLowerCase().includes(q) ||
          (p.telefono ?? "").includes(q),
      )
      .slice(0, 8);
  }, [meta, pacienteQuery]);

  const canSubmit =
    !submitting &&
    servicioId != null &&
    inicioLocal.length > 0 &&
    duracion >= 5 &&
    (mode === "existente"
      ? pacienteId != null
      : nuevo.nombre.length > 0 && nuevo.apellido.length > 0 && nuevo.telefono.length >= 6);

  const handleSubmit = () => {
    setSubmitErr(null);
    if (!servicioId || !inicioLocal) return;
    const isoInicio = localDatetimeToIso(inicioLocal);
    startTransition(async () => {
      const result = await createTurnoAction({
        servicioId,
        inicio: isoInicio,
        duracionMin: duracion,
        origen,
        ...(mode === "existente"
          ? { pacienteId: pacienteId ?? undefined }
          : { pacienteNuevo: nuevo }),
      });
      if (!result.ok) {
        setSubmitErr(result.error.message);
        return;
      }
      onCreated(result.data.turnoId);
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="turno-create-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,14,8,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          maxWidth: 520,
          width: "100%",
          padding: "20px 22px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.18)",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={{ marginBottom: 16 }}>
          <span className="fi-eyebrow">{origen === "WALK_IN" ? "walk-in" : "agendar turno"}</span>
          <h2 id="turno-create-title" style={{ margin: "4px 0 0", fontSize: 20 }}>
            Nuevo turno
          </h2>
        </header>

        {loading ? (
          <p style={{ color: "var(--ink-3)", fontSize: 14 }}>Cargando datos…</p>
        ) : loadErr ? (
          <p role="alert" style={{ color: "var(--red)", fontSize: 14 }}>
            {loadErr}
          </p>
        ) : meta == null ? null : meta.servicios.length === 0 ? (
          <div>
            <p style={{ color: "var(--ink-3)", fontSize: 14 }}>
              No tenés servicios activos en tu org. Creá uno desde Configuración → Servicios.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className="fi-btn fi-btn-ghost" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <>
            <Field label="Paciente">
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button
                  type="button"
                  className={"fi-btn " + (mode === "existente" ? "fi-btn-primary" : "fi-btn-ghost")}
                  onClick={() => setMode("existente")}
                >
                  Existente
                </button>
                <button
                  type="button"
                  className={"fi-btn " + (mode === "nuevo" ? "fi-btn-primary" : "fi-btn-ghost")}
                  onClick={() => setMode("nuevo")}
                >
                  Nuevo
                </button>
              </div>

              {mode === "existente" ? (
                <>
                  <input
                    ref={focusTargetRef}
                    type="text"
                    placeholder="Buscar por nombre, apellido o teléfono"
                    value={pacienteQuery}
                    onChange={(e) => {
                      setPacienteQuery(e.target.value);
                      setPacienteId(null);
                    }}
                    style={inputStyle}
                  />
                  {pacientesFiltrados.length === 0 ? (
                    <p style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 8 }}>
                      Sin resultados. Probá crear uno nuevo.
                    </p>
                  ) : (
                    <ul
                      style={{
                        listStyle: "none",
                        padding: 0,
                        margin: "8px 0 0",
                        display: "grid",
                        gap: 4,
                        maxHeight: 200,
                        overflowY: "auto",
                      }}
                    >
                      {pacientesFiltrados.map((p) => {
                        const selected = pacienteId === p.id;
                        return (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => setPacienteId(p.id)}
                              style={{
                                display: "block",
                                width: "100%",
                                textAlign: "left",
                                padding: "8px 10px",
                                border: "1px solid " + (selected ? "var(--accent, #8A6722)" : "var(--line)"),
                                borderRadius: 6,
                                background: selected ? "rgba(138,103,34,0.08)" : "var(--surface)",
                                cursor: "pointer",
                                font: "inherit",
                                color: "inherit",
                              }}
                            >
                              <div style={{ fontWeight: 500 }}>
                                {p.nombre} {p.apellido}
                              </div>
                              {p.telefono ? (
                                <div className="fm-mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                                  {p.telefono}
                                </div>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <input
                      ref={focusTargetRef}
                      type="text"
                      placeholder="Nombre"
                      value={nuevo.nombre}
                      onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))}
                      style={inputStyle}
                    />
                    <input
                      type="text"
                      placeholder="Apellido"
                      value={nuevo.apellido}
                      onChange={(e) => setNuevo((n) => ({ ...n, apellido: e.target.value }))}
                      style={inputStyle}
                    />
                  </div>
                  <input
                    type="tel"
                    placeholder="Teléfono"
                    value={nuevo.telefono}
                    onChange={(e) => setNuevo((n) => ({ ...n, telefono: e.target.value }))}
                    style={inputStyle}
                  />
                  <input
                    type="email"
                    placeholder="Email (opcional)"
                    value={nuevo.email}
                    onChange={(e) => setNuevo((n) => ({ ...n, email: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              )}
            </Field>

            <Field label="Servicio">
              <select
                value={servicioId ?? ""}
                onChange={(e) => onChangeServicio(e.target.value)}
                style={inputStyle}
              >
                {meta.servicios.map((s: ServicioPickerRow) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre} · {s.duracionMin} min
                  </option>
                ))}
              </select>
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 8 }}>
              <Field label="Fecha y hora">
                <input
                  type="datetime-local"
                  value={inicioLocal}
                  onChange={(e) => setInicioLocal(e.target.value)}
                  style={inputStyle}
                />
              </Field>
              <Field label="Duración (min)">
                <input
                  type="number"
                  value={duracion}
                  min={5}
                  max={480}
                  step={5}
                  onChange={(e) => setDuracion(Number(e.target.value))}
                  style={inputStyle}
                />
              </Field>
            </div>

            {submitErr ? (
              <p role="alert" style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>
                {submitErr}
              </p>
            ) : null}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className="fi-btn fi-btn-ghost" onClick={onClose} disabled={submitting}>
                Cancelar
              </button>
              <button
                type="button"
                className="fi-btn fi-btn-primary"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                {submitting ? "Creando…" : "Crear turno"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: 13, color: "var(--ink-3)", marginBottom: 4 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid var(--line)",
  borderRadius: 6,
  background: "var(--surface)",
  font: "inherit",
};

// ─── Datetime helpers ──────────────────────────────────────────────────────
//
// HTML <input type="datetime-local"> uses "YYYY-MM-DDTHH:mm" without TZ.
// We treat that value as local-time in the user's browser TZ and serialize
// to ISO-with-offset for the server action. Browser handles the local
// timezone for us when constructing the Date.

function isoToLocalDatetime(iso?: string): string {
  const base = iso ? new Date(iso) : new Date();
  // Round to next 5 min for nicer default.
  const next = new Date(base.getTime() + 5 * 60 * 1000);
  next.setSeconds(0, 0);
  const yyyy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  const hh = String(next.getHours()).padStart(2, "0");
  const mi = String(Math.round(next.getMinutes() / 5) * 5).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function localDatetimeToIso(local: string): string {
  // Date constructor treats "YYYY-MM-DDTHH:mm" as local time; toISOString()
  // produces UTC with Z suffix which is a valid ISO 8601 with offset.
  return new Date(local).toISOString();
}
