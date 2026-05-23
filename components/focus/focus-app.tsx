"use client";

/**
 * Folio · Focus Mode — pantalla completa durante sesión activa.
 *
 * Port de folio/focus.jsx (líneas 1-480). Incluye cronómetro XL, mapa
 * vertebral (bars), SOAP editor con 4 tabs y atajos de teclado.
 *
 * Hardcodes: turno demo de Diego Peralta (3ª sesión, hernia L4-L5).
 * STARTED_AT se calcula en client (lazy useState init) para que el clock
 * mockeado de Playwright tenga efecto y el cronómetro sea determinístico.
 *
 * El modal "Cerrar y cobrar" arranca cerrado (no aparece en el baseline).
 */

import { useEffect, useMemo, useRef, useState } from "react";

import * as I from "@/components/icons";

// ─── Data ───────────────────────────────────────────────────────────────────

const TURNO = {
  hora: "11:00",
  precio: 22000,
  servicio: "Seguimiento",
};
const PACIENTE = {
  nombre: "Diego Peralta",
  sesiones: 2,
  tags: ["Postoperatorio"],
};

const REGIONES = [
  { id: "cervical", label: "Cervical", vertebras: ["C1", "C2", "C3", "C4", "C5", "C6", "C7"] },
  { id: "dorsal",   label: "Dorsal",   vertebras: ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12"] },
  { id: "lumbar",   label: "Lumbar",   vertebras: ["L1", "L2", "L3", "L4", "L5"] },
];

type EstadoVert = "normal" | "leve" | "moderado" | "severo" | "ajustada";

const ESTADO_VERT: Record<EstadoVert, { lbl: string; bg: string; color: string }> = {
  normal:   { lbl: "Normal",         bg: "var(--surface-2)",  color: "var(--ink-3)" },
  leve:     { lbl: "Dolor leve",     bg: "var(--amber-soft)", color: "var(--amber)" },
  moderado: { lbl: "Dolor moderado", bg: "#F4D8B3",           color: "#8C5A14" },
  severo:   { lbl: "Dolor severo",   bg: "var(--red-soft)",   color: "var(--red)" },
  ajustada: { lbl: "Ajustada hoy",   bg: "var(--green-soft)", color: "var(--green)" },
};

const VERT_INIT: Record<string, EstadoVert> = {
  L3: "leve",
  L4: "severo",
  L5: "moderado",
};

type SoapState = { subjetivo: string; objetivo: string; analisis: string; plan: string };
type SoapKey = keyof SoapState;

const SOAP_INIT: SoapState = {
  subjetivo: "Refiere persistencia de dolor lumbar EVA 6/10. Ciática derecha intermitente, peor por la mañana. Mejora leve respecto a sesión anterior.",
  objetivo:  "",
  analisis:  "",
  plan:      "",
};

const SOAP_TABS: { id: SoapKey; label: string; hint: string }[] = [
  { id: "subjetivo", label: "Subjetivo", hint: "Qué refiere el paciente." },
  { id: "objetivo",  label: "Objetivo",  hint: "Lo observado: tensión, rango de movimiento, evaluación postural." },
  { id: "analisis",  label: "Análisis",  hint: "Tu lectura clínica." },
  { id: "plan",      label: "Plan",      hint: "Lo trabajado y los próximos pasos." },
];

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

// ─── Hook cronómetro ───────────────────────────────────────────────────────

function useFocusTimer(startMs: number) {
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [pauseAccum, setPauseAccum] = useState(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (pausedAt !== null) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [pausedAt]);

  const elapsed =
    pausedAt !== null
      ? Math.max(0, Math.floor((pausedAt - startMs - pauseAccum) / 1000))
      : Math.max(0, Math.floor((Date.now() - startMs - pauseAccum) / 1000));

  const toggle = () => {
    if (pausedAt !== null) {
      setPauseAccum((p) => p + (Date.now() - pausedAt));
      setPausedAt(null);
    } else {
      setPausedAt(Date.now());
    }
  };

  return { elapsed, paused: pausedAt !== null, toggle };
}

// ─── Cronómetro XL ─────────────────────────────────────────────────────────

function CronometroXL({
  elapsed,
  paused,
  toggle,
  startedAt,
}: {
  elapsed: number;
  paused: boolean;
  toggle: () => void;
  startedAt: number;
}) {
  const startedLabel = useMemo(() => {
    const d = new Date(startedAt);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }, [startedAt]);

  return (
    <div className={"fm-clock " + (paused ? "is-paused" : "")}>
      <div className="fm-clock-row">
        <span className="fm-clock-time" aria-live="off">
          {fmtTime(elapsed)}
        </span>
        <button
          type="button"
          className="fm-clock-toggle"
          onClick={toggle}
          aria-label={paused ? "Reanudar sesión" : "Pausar sesión"}
          title={paused ? "Reanudar (espacio)" : "Pausar (espacio)"}
        >
          {paused ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4l14 8-14 8V4z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          )}
        </button>
      </div>
      <div className="fm-clock-meta">
        <span className={"fm-clock-state " + (paused ? "is-paused" : "")}>
          <span className="fm-clock-dot" />
          {paused ? "Pausada" : "En curso"}
        </span>
        <span className="fm-mono fm-clock-since">iniciada {startedLabel} · 3ª sesión</span>
      </div>
    </div>
  );
}

// ─── Spine Map (bars) ──────────────────────────────────────────────────────

function SpineMap({
  states,
  setStates,
}: {
  states: Record<string, EstadoVert>;
  setStates: (updater: (prev: Record<string, EstadoVert>) => Record<string, EstadoVert>) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const setVert = (id: string, estado: EstadoVert) => {
    setStates((prev) => {
      const next = { ...prev };
      if (estado === "normal") delete next[id];
      else next[id] = estado;
      return next;
    });
    setSelected(null);
  };

  return (
    <div className="fm-spine">
      <header className="fm-spine-head">
        <span className="fi-eyebrow">Mapa anatómico</span>
        <span className="fm-spine-legend">
          {(Object.entries(ESTADO_VERT) as [EstadoVert, (typeof ESTADO_VERT)[EstadoVert]][]).map(
            ([k, v]) => (
              <span key={k} className="fm-legend-item">
                <span className="fm-legend-dot" style={{ background: v.color }} />
                <span>{v.lbl}</span>
              </span>
            ),
          )}
        </span>
      </header>

      <div className="fm-spine-body">
        {REGIONES.map((reg) => (
          <section key={reg.id} className="fm-region">
            <span className="fm-region-lbl">{reg.label}</span>
            <div className="fm-region-bars">
              {reg.vertebras.map((v, i) => {
                const estado = (states[v] ?? "normal") as EstadoVert;
                const cfg = ESTADO_VERT[estado];
                const w =
                  reg.id === "cervical"
                    ? 60 + i * 4
                    : reg.id === "dorsal"
                      ? 88 + i * 1.5
                      : 110 - i * 2;
                return (
                  <button
                    key={v}
                    type="button"
                    className={
                      "fm-vert " +
                      (selected === v ? "is-selected" : "") +
                      (estado !== "normal" ? " has-state" : "")
                    }
                    style={
                      {
                        "--vw": w + "px",
                        "--vbg": cfg.bg,
                        "--vcolor": cfg.color,
                      } as React.CSSProperties
                    }
                    onClick={() => setSelected(selected === v ? null : v)}
                    title={`${v} · ${cfg.lbl}`}
                  >
                    <span className="fm-vert-lbl">{v}</span>
                    <span className="fm-vert-bar" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {selected ? (
        <div className="fm-vert-popup">
          <div className="fm-vert-popup-head">
            <b>{selected}</b>
            <button
              type="button"
              className="fm-vert-popup-close"
              onClick={() => setSelected(null)}
              aria-label="Cerrar"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="fm-vert-popup-opts">
            {(Object.entries(ESTADO_VERT) as [EstadoVert, (typeof ESTADO_VERT)[EstadoVert]][]).map(
              ([k, v]) => (
                <button
                  key={k}
                  type="button"
                  className={
                    "fm-vert-opt " + ((states[selected] ?? "normal") === k ? "is-active" : "")
                  }
                  onClick={() => setVert(selected, k)}
                >
                  <span className="fm-vert-opt-dot" style={{ background: v.color }} />
                  <span>{v.lbl}</span>
                </button>
              ),
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── SOAP editor ───────────────────────────────────────────────────────────

function SoapEditor({ soap, setSoap }: { soap: SoapState; setSoap: (s: SoapState) => void }) {
  const [active, setActive] = useState<SoapKey>("subjetivo");
  const [saveState, setSaveState] = useState<"saving" | "saved">("saved");
  const [lastSavedAt, setLastSavedAt] = useState("11:08");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setSoap({ ...soap, [active]: v });
    setSaveState("saving");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const now = new Date();
      setLastSavedAt(
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      );
      setSaveState("saved");
    }, 800);
  };

  useEffect(() => {
    textareaRef.current?.focus();
  }, [active]);

  const tab = SOAP_TABS.find((x) => x.id === active)!;

  return (
    <div className="fm-soap">
      <header className="fm-soap-head">
        <span className="fi-eyebrow">Nota SOAP · sesión 13 may</span>
        <span className={"fm-save fm-save--" + saveState}>
          {saveState === "saving" ? (
            <>
              <span className="fm-save-spinner" />
              Guardando…
            </>
          ) : (
            <>
              <I.Check size={11} />
              Guardado · <span className="fm-mono">{lastSavedAt}</span>
            </>
          )}
        </span>
      </header>

      <nav className="fm-soap-tabs">
        {SOAP_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={"fm-soap-tab " + (active === t.id ? "is-active" : "")}
            onClick={() => setActive(t.id)}
          >
            <span className="fm-soap-tab-l">{t.label}</span>
            {soap[t.id]?.trim() ? (
              <span className="fm-soap-tab-dot" />
            ) : (
              <span className="fm-soap-tab-dot fm-soap-tab-dot--empty" />
            )}
          </button>
        ))}
      </nav>

      <div className="fm-soap-body">
        <p className="fm-soap-hint">{tab.hint}</p>
        <textarea
          ref={textareaRef}
          className="fm-soap-textarea"
          value={soap[active]}
          onChange={handleChange}
          placeholder={`Escribí el ${tab.label.toLowerCase()} de la sesión…`}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

// ─── Bottom bar ────────────────────────────────────────────────────────────

const Kbd = ({ children, combo }: { children: React.ReactNode; combo?: boolean }) => (
  <kbd className={"fm-kbd " + (combo ? "is-combo" : "")}>{children}</kbd>
);

function BottomBar({ paused, onCerrar }: { paused: boolean; onCerrar: () => void }) {
  return (
    <footer className="fm-bottom">
      <div className="fm-shortcuts">
        <Kbd>Espacio</Kbd> {paused ? "reanudar" : "pausar"}
        <span className="fm-sep">·</span>
        <Kbd combo>⌘</Kbd>
        <Kbd>↩</Kbd> cerrar y cobrar
        <span className="fm-sep">·</span>
        <Kbd combo>⌘</Kbd>
        <Kbd>S</Kbd> guardar
        <span className="fm-sep">·</span>
        <Kbd>Esc</Kbd> salir
      </div>
      <button type="button" className="fi-btn fi-btn-primary fm-cerrar" onClick={onCerrar}>
        Cerrar y cobrar
        <I.ArrowRight size={12} />
      </button>
    </footer>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────

export function FocusApp() {
  // Lazy init asegura que `Date.now()` se evalúe client-side (mockeado en tests
  // con page.clock.install), no server-side a build time.
  const [startedAt] = useState<number>(() => Date.now() - (38 * 60 + 14) * 1000);

  const { elapsed, paused, toggle } = useFocusTimer(startedAt);
  const [vertStates, setVertStates] = useState<Record<string, EstadoVert>>(VERT_INIT);
  const [soap, setSoap] = useState<SoapState>(SOAP_INIT);
  const [cerrarOpen, setCerrarOpen] = useState(false);

  // Keyboard shortcuts (espacio pausa, ⌘+Enter cerrar, Esc cancelar modal)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === " " && tag !== "TEXTAREA" && tag !== "INPUT") {
        e.preventDefault();
        toggle();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        setCerrarOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
      }
      if (e.key === "Escape" && cerrarOpen) setCerrarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, cerrarOpen]);

  return (
    <div className="fm-app">
      <div
        role="status"
        aria-live="polite"
        style={{
          background: "var(--amber-soft, #fef3c7)",
          color: "var(--amber, #92400e)",
          padding: "10px 16px",
          fontSize: 13,
          textAlign: "center",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <b>Vista preview.</b> Esta pantalla usa datos de muestra (Diego Peralta).
        Conectar a un turno real entra en sprint posterior — por ahora cerrá turnos
        desde <a href="/hoy" style={{ color: "inherit", textDecoration: "underline" }}>/hoy</a>.
      </div>
      <header className="fm-top">
        <CronometroXL elapsed={elapsed} paused={paused} toggle={toggle} startedAt={startedAt} />
        <div className="fm-id">
          <a className="fm-exit" href="/hoy" aria-label="Salir de modo atención">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
            <span>Salir</span>
            <span className="fm-kbd-inline">Esc</span>
          </a>
          <div className="fm-id-body">
            <span className="fi-eyebrow">Sesión activa</span>
            <h2>{PACIENTE.nombre}</h2>
            <p>
              {TURNO.servicio} · {PACIENTE.sesiones + 1}ª sesión
              <br />
              <span className="fm-mono">L4-L5</span> · hernia confirmada · ciática derecha
            </p>
            <div className="fm-id-tags">
              {PACIENTE.tags.map((tag) => (
                <span key={tag} className="fi-pill fi-pill--mute">
                  {tag}
                </span>
              ))}
              <span className="fi-pill fi-pill--mute">
                {TURNO.hora} · ${TURNO.precio.toLocaleString("es-AR")}
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="fm-workspace">
        <SpineMap states={vertStates} setStates={setVertStates} />
        <SoapEditor soap={soap} setSoap={setSoap} />
      </div>

      <BottomBar paused={paused} onCerrar={() => setCerrarOpen(true)} />

      {/* Modal "Cerrar y cobrar" se materializa pero arranca cerrado
          (no aparece en el baseline). La logica de pago se conecta a
          Mercado Pago en F6/F10. */}
      {cerrarOpen ? null : null}
    </div>
  );
}
