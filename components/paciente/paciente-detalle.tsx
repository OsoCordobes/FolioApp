"use client";

/**
 * Folio · /pacientes/[id] · ficha completa con tabs.
 *
 * Port de folio/paciente.jsx (líneas 283-648). El tab por defecto es "plan"
 * (el slot clínico renderiza la herramienta de la especialidad de la org vía
 * lib/especialidades/registry — Fase B) para que el baseline pixel-perfect
 * matchee. Cada tab tiene su propio sub-componente.
 *
 * El auto-save indicator del SOAP usa el clock del browser (mockeado en tests
 * con page.clock.install para determinismo).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import * as I from "@/components/icons";
import {
  listDocumentosPacienteAction,
  refreshRadiografiaUrlAction,
  saveSesionFichaAction,
  saveSesionYCerrarAction,
  uploadDocumentoPacienteAction,
  type DocumentoFichaItem,
} from "@/app/(app)/pacientes/actions";
import {
  AUTOSAVE_DEBOUNCE_MS,
  anioDeFecha,
  decidirAutosave,
  esBorradorSucio,
  type BorradorFicha,
} from "@/lib/ficha/borrador";
import { TurnoCreateModal } from "@/components/hoy/turno-create-modal";
import { CoberturaModal } from "@/components/paciente/cobertura-modal";
import { ConsentimientosCard } from "@/components/paciente/consentimientos-card";
import { PacienteFichaProvider, usePacienteFicha } from "@/components/paciente/contexto";
import { IntakeAvanzadoModal } from "@/components/paciente/intake-avanzado-modal";
import { PlanTratamientoModal } from "@/components/paciente/plan-tratamiento-modal";
import {
  filtrarToolHistorial,
  getEspecialidad,
  getIntakeAvanzadoConfig,
  type EspecialidadSlug,
  type SoapGuia,
} from "@/lib/especialidades/registry";
import { toWhatsappE164 } from "@/lib/format/phone";
import { formatCobertura } from "@/lib/pacientes/cobertura";
import { NotasFichaCard } from "@/components/paciente/notas-ficha-card";
import { addNotaFichaAction } from "@/app/(app)/pacientes/actions";
import type { NotaClinicaFicha } from "@/lib/ficha/nota-clinica";
import type { IntakeAvanzadoFicha, PacienteFichaInfo, PlanData } from "@/lib/db/paciente-ficha";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fmtFecha(iso: string): string {
  if (!iso || iso === "—") return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

// Fecha/hora del turno ancla en la tz del producto (AR). Intl con timeZone
// explícita: el output es idéntico en server y cliente (sin hydration
// mismatch), a diferencia de toLocaleTimeString sin tz que usaría la del
// runtime (UTC en Vercel vs AR en el browser).
const TZ_AR = "America/Argentina/Buenos_Aires";

function fmtTurnoAncla(iso: string, opts: Intl.DateTimeFormatOptions): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("es-AR", { timeZone: TZ_AR, ...opts }).format(d);
  } catch {
    return "—";
  }
}

function iniciales(nombre: string): string {
  return nombre.split(" ").map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
}

const TURNO_HOY_HORA = "hoy";

type TabId = "informacion" | "plan" | "sesiones" | "documentos";

// ─── Sub: SOAP stacked ─────────────────────────────────────────────────────

const SOAP_SECTIONS = [
  { id: "subjetivo" as const, label: "Subjetivo", hint: "Lo que cuenta el paciente." },
  { id: "objetivo"  as const, label: "Objetivo",  hint: "Lo que observás vos." },
  { id: "analisis"  as const, label: "Análisis",  hint: "Interpretación clínica." },
  { id: "plan"      as const, label: "Plan",      hint: "Próximos pasos." },
];

type SoapState = PlanData["soap"];

function esSoapVacio(s: SoapState): boolean {
  return !s.subjetivo.trim() && !s.objetivo.trim() && !s.analisis.trim() && !s.plan.trim();
}

/** Fecha de una sesión previa, en es-AR y legible. */
function fmtSoapPrevio(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
}

/** Nota de hoy sin escribir. Congelada para que no cambie de identidad entre renders. */
const SOAP_VACIO: SoapState = Object.freeze({
  subjetivo: "",
  objetivo: "",
  analisis: "",
  plan: "",
});

function SoapStacked({
  soap,
  setSoap,
  saveBadge,
  eyebrow,
  guia,
}: {
  soap: SoapState;
  setSoap: (s: SoapState) => void;
  /** Indicador de guardado (lo pasa TabPlan cuando hay turno ancla). */
  saveBadge?: ReactNode;
  /** Título del header — TabPlan lo ajusta si se edita una visita pasada. */
  eyebrow?: string;
  /**
   * C9 · guía SOAP de la especialidad (prompts/checklists por sección). Andamiaje
   * VISUAL opcional arriba de cada textarea; el texto libre no cambia. Ausente =
   * SOAP genérico sin guía (comportamiento histórico de cardio/psico pre-C9).
   */
  guia?: SoapGuia;
}) {
  // El borrador se persiste con "Guardar sesión" (TabPlan) cuando el paciente
  // tiene un turno ancla (en curso / de hoy / última visita). Sin ancla no hay
  // sesión contra la cual guardar (sesion.turno_id UNIQUE) — etiqueta honesta
  // "Borrador local".
  return (
    <div className="pc-soap">
      <header className="pc-soap-head">
        <span className="fi-eyebrow">{eyebrow ?? `Nota SOAP · sesión de ${TURNO_HOY_HORA}`}</span>
        {saveBadge ?? (
          <span
            className="fm-save"
            title="No hay un turno en curso para este paciente — editás localmente. Iniciá la atención desde /hoy para poder guardar la sesión."
          >
            Borrador local
          </span>
        )}
      </header>
      {SOAP_SECTIONS.map((s) => {
        const g = guia?.[s.id];
        return (
          <div key={s.id} className="pc-soap-section">
            <div className="pc-soap-section-head">
              <b>{s.label}</b>
              <span className="pc-soap-section-hint">{s.hint}</span>
            </div>
            {/* C9 · andamiaje visual de la especialidad. Aditivo: no altera el
                textarea de texto libre; solo orienta qué registrar. */}
            {g && (g.prompt || g.checklist?.length) ? (
              <div className="pc-soap-guia">
                {g.prompt ? <p className="pc-soap-guia-prompt">{g.prompt}</p> : null}
                {g.checklist?.length ? (
                  <ul className="pc-soap-guia-list">
                    {g.checklist.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <textarea
              className="pc-soap-textarea"
              value={soap[s.id]}
              onChange={(e) => setSoap({ ...soap, [s.id]: e.target.value })}
              placeholder={`Escribí el ${s.label.toLowerCase()}…`}
              aria-label={`${s.label} — nota SOAP. ${s.hint}`}
              spellCheck={false}
              rows={Math.max(3, Math.ceil((soap[s.id]?.length ?? 0) / 60))}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─── Sub: Plan de tratamiento ──────────────────────────────────────────────

function PlanTratamiento() {
  const { paciente, plan } = usePacienteFicha();
  const [editOpen, setEditOpen] = useState(false);
  const pct = plan.total > 0 ? Math.round((plan.completadas / plan.total) * 100) : 0;
  return (
    <section className="pc-card pc-plan">
      <header className="pc-card-head">
        <span className="fi-eyebrow">Plan de tratamiento</span>
        <button
          type="button"
          className="pc-link"
          onClick={() => setEditOpen(true)}
          title="Editar objetivos, frecuencia y diagnóstico del plan"
        >
          Editar
        </button>
      </header>
      <div className="pc-plan-progress">
        <div className="pc-plan-progress-row">
          <span className="pc-plan-num">
            <b>{plan.completadas}</b>
            <small>/ {plan.total}</small>
          </span>
          <span className="pc-plan-num-lbl">sesiones</span>
          <span className="pc-plan-pct fm-mono">{pct}%</span>
        </div>
        <div className="pc-plan-bar">
          <div className="pc-plan-bar-fill" style={{ width: pct + "%" }} />
          <div className="pc-plan-bar-segs">
            {Array.from({ length: plan.total }, (_, i) => (
              <span key={i} className={"pc-plan-seg " + (i < plan.completadas ? "is-done" : "")} />
            ))}
          </div>
        </div>
      </div>
      <div className="pc-plan-meta">
        <div>
          <span className="muted">Frecuencia</span>
          <b>{plan.frecuencia}</b>
        </div>
        <div>
          <span className="muted">Próximo control</span>
          <b>{fmtFecha(plan.proximoControl)}</b>
        </div>
        <div>
          <span className="muted">Diagnóstico</span>
          <b>{plan.diagnostico}</b>
        </div>
      </div>

      {editOpen ? (
        <PlanTratamientoModal
          pacienteId={paciente.id}
          prefill={plan.planEditable}
          onClose={() => setEditOpen(false)}
        />
      ) : null}
    </section>
  );
}

// ─── Sub: Historial reciente ───────────────────────────────────────────────

function HistorialReciente() {
  const { plan } = usePacienteFicha();
  const [expanded, setExpanded] = useState(false);
  const visibles = expanded ? plan.sesiones : plan.sesiones.slice(0, 4);

  return (
    <section className="pc-card pc-historial">
      <header className="pc-card-head">
        <span className="fi-eyebrow">Historial reciente</span>
        <button type="button" className="pc-link" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Mostrar menos" : `Ver todas (${plan.sesiones.length})`}
        </button>
      </header>
      <div className="pc-historial-list">
        {visibles.map((s, i) => (
          <div key={s.fecha} className="pc-historial-row">
            <div className="pc-historial-marker">
              <span className="pc-historial-dot" />
              {i < visibles.length - 1 ? <span className="pc-historial-line" /> : null}
            </div>
            <div className="pc-historial-body">
              <div className="pc-historial-head">
                <span className="fm-mono">{fmtFecha(s.fecha)}</span>
                <span className="pc-historial-sep">·</span>
                <span>{s.servicio}</span>
                <span className="pc-historial-dur fm-mono">{s.dur} min</span>
              </div>
              <p className="pc-historial-cambio">{s.cambio}</p>
              {s.vertebras.length ? (
                <div className="pc-historial-vertebras">
                  {s.vertebras.map((v) => (
                    <span key={v} className="pc-historial-vert fm-mono">{v}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Sub: Tab Plan ─────────────────────────────────────────────────────────

function TabPlan() {
  const { paciente, plan, especialidad, organizacionNombre, notas } = usePacienteFicha();
  const def = getEspecialidad(especialidad);
  const router = useRouter();
  const turnoActivo = plan.turnoActivo;

  // Workstream 6 · la ficha quiropraxia v2 reemplaza el SOAP: la Tool ocupa todo
  // el ancho (sin la grilla 380px) y NO se rinde <SoapStacked>. Cardio/psico
  // siguen con la grilla + SOAP, exactamente igual que antes.
  const hideSoap = especialidad === "quiropraxia";

  // Props OPCIONALES nuevas (Workstream 6) — inofensivas para cardio/psico, que
  // las ignoran. La Tool quiro las usa para radiografías + carry-forward.
  const toolExtras = {
    pacienteId: paciente.id,
    turno: turnoActivo ? { id: turnoActivo.id, tieneSesionGuardada: turnoActivo.tieneSesionGuardada } : null,
    radiografias: plan.radiografias,
    // C6 · adjuntos de estudios de la Tool cardio (ECG/Holter/ergometría); quiro/psico los ignoran.
    estudiosAdjuntos: plan.estudiosAdjuntos,
    // Cardiología la usa en el score de riesgo CV (≥60 suma); quiro/psico la ignoran.
    edad: paciente.edad > 0 ? paciente.edad : undefined,
    // D2 · membrete de los imprimibles de la Tool (derivación cardio):
    // paciente + consultorio, espejo del FichaPrintHeader. Las demás Tools
    // ignoran ambos.
    pacienteNombre: paciente.nombre,
    organizacionNombre,
  };

  // Borrador local del toolData de la herramienta. Si el turno en curso ya
  // tiene sesión guardada, re-hidrata desde ahí: el writer sobreescribe las
  // columnas tool en cada guardado re-hidratable, así que "guardar solo SOAP"
  // después no debe pisar la herramienta con null. Si toolDraft vino null por
  // un tool_id de OTRA especialidad, el writer preserva esas columnas en los
  // guardados solo-SOAP (debePreservarToolData, lib/db/sesiones.ts).
  const [toolValue, setToolValue] = useState<unknown>(turnoActivo?.toolDraft ?? null);

  // ─── El SOAP editable es el de la visita ANCLA, no el de la última sesión ──
  //
  // Antes esto arrancaba en `plan.soap`, que es el SOAP de la última sesión DEL
  // PACIENTE. Como iniciar la atención no crea la fila `sesion`, en cada visita
  // nueva los cuatro campos aparecían con el texto de la visita anterior bajo el
  // título "Nota SOAP · sesión de hoy" y se persistían como hallazgos de hoy: la
  // historia clínica terminaba afirmando que hoy se auscultó un soplo que nunca
  // se auscultó.
  //
  // Peor: como el baseline también incluía ese texto heredado, bastaba tocar la
  // herramienta para que el autosave persistiera el SOAP viejo sin que el
  // profesional escribiera una sola letra en un textarea. En quiropraxia era
  // 100% invisible: hideSoap oculta el render, pero el estado viajaba igual.
  //
  // La continuidad se ofrece abajo, explícita y fechada.
  const soapInicial = turnoActivo?.soapDraft ?? SOAP_VACIO;
  const [soap, setSoap] = useState<SoapState>(soapInicial);
  // Fecha de la visita de la que se cargó el SOAP anterior, si el profesional
  // aceptó la continuidad. Null = la nota de hoy es propia.
  const [soapDesde, setSoapDesde] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Versión de la sesión con la que se hidrató el borrador. Viaja en cada
  // guardado; si otra pestaña movió la fila, el writer devuelve `conflict` en
  // vez de pisar. Se actualiza sola en el router.refresh() del guardado ok.
  const versionSesion = turnoActivo?.sesionUpdatedAt ?? undefined;
  const [conflicto, setConflicto] = useState(false);

  // D1 · baseline del borrador = lo último GUARDADO (o lo hidratado del server
  // al montar). Contra esto se computa `sucio`, que gatea el guard de
  // beforeunload y el autosave. En cada guardado ok se actualiza a LO ENVIADO
  // (no al estado actual: si se tipeó durante el request, eso sigue sucio y el
  // autosave lo levanta después).
  const [baseline, setBaseline] = useState<BorradorFicha>(() => ({
    soap: soapInicial,
    toolValue: turnoActivo?.toolDraft ?? null,
  }));
  const sucio = useMemo(
    () => esBorradorSucio({ soap, toolValue }, baseline),
    [soap, toolValue, baseline],
  );

  // La oferta de continuidad sólo aparece si: el ancla no tiene nota propia, hay
  // una visita anterior con algo escrito, el SOAP se rinde (no quiro) y el
  // profesional todavía no la trajo ni escribió nada.
  const soapPrevioOfrecido =
    !hideSoap &&
    turnoActivo?.soapPrevio &&
    !soapDesde &&
    esSoapVacio(soap) &&
    !esSoapVacio(turnoActivo.soapPrevio.soap)
      ? turnoActivo.soapPrevio
      : null;

  // Traer la nota anterior entra como BASELINE, igual que el seed de la
  // herramienta: no marca el borrador sucio ni dispara el autosave. Que el
  // profesional decida guardarla es una acción suya, no un efecto de abrir la
  // ficha.
  const cargarSoapAnterior = () => {
    const previo = turnoActivo?.soapPrevio;
    if (!previo) return;
    setSoap(previo.soap);
    setBaseline((b) => ({ ...b, soap: previo.soap }));
    setSoapDesde(previo.fecha);
  };

  // Interacción REAL del profesional (tecla/click en el SOAP o la herramienta).
  // Los seeds programáticos (onToolSeed) NO la setean: el autosave y el guard
  // de beforeunload solo se arman después de una edición genuina — abrir la
  // ficha jamás debe escribir la HC sola ni frenar el cierre de la pestaña.
  const userEditoRef = useRef(false);

  // Editar limpia un error de guardado previo: decidirAutosave frena con
  // hayError (no reintenta en loop), así que el próximo cambio re-arma el
  // autoguardado.
  const onSoapChange = (s: SoapState) => {
    userEditoRef.current = true;
    setSoap(s);
    if (saveError) setSaveError(null);
  };
  const onToolChange = (v: unknown) => {
    userEditoRef.current = true;
    setToolValue(v);
    if (saveError) setSaveError(null);
  };
  // Seed PROGRAMÁTICO de la Tool (carry-forward quiro al montar): actualiza el
  // borrador Y el baseline JUNTOS — el estado sembrado es la nueva línea de
  // base, NO un borrador sucio (no dispara autosave/beforeunload ni marca
  // interacción). "Guardar sesión" lo persiste junto con la primera edición
  // real del profesional.
  const onToolSeed = (v: unknown) => {
    setToolValue(v);
    setBaseline((b) => ({ ...b, toolValue: v }));
  };

  const handleGuardar = async (opts?: { autosave?: boolean }) => {
    if (!turnoActivo || saving) return;
    // Snapshot de lo que se envía (ver comentario del baseline).
    const enviado: BorradorFicha = { soap, toolValue };
    setSaving(true);
    setSaveError(null);
    const result = await saveSesionFichaAction({
      turnoId: turnoActivo.id,
      pacienteId: paciente.id,
      toolValue: enviado.toolValue,
      soap: enviado.soap,
      // El autosave NUNCA transiciona el turno (empezar a atender es una
      // decisión explícita: botón "Guardar sesión" / "Guardar y cerrar").
      autosave: opts?.autosave === true,
      updatedAtEsperado: versionSesion,
    });
    setSaving(false);
    if (result.ok) {
      const d = new Date();
      setSavedAt(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
      setBaseline(enviado);
      // La vuelta: refresca el Server Component → plan.toolHistorial trae la
      // sesión recién guardada (el borrador local no se resetea: useState).
      router.refresh();
    } else if (result.error.code === "conflict") {
      // Otra pestaña (o la tablet del consultorio) guardó esta misma ficha
      // mientras la editábamos. NO reintentamos ni pisamos: se le muestra la
      // salida y decide él. El borrador local queda intacto para que pueda
      // copiar lo que escribió antes de recargar.
      setConflicto(true);
      setSaveError(null);
    } else {
      setSaveError(`No se pudo guardar: ${result.error.message}`);
    }
  };

  // D1 · guard: cerrar/recargar la pestaña con borrador sucio pide
  // confirmación nativa del navegador (antes se perdía el SOAP + herramienta
  // sin aviso). Navegación client-side (tabs/links de Next) no dispara
  // beforeunload — para eso los panels quedan montados (hidden) en el root.
  // Gateado por interacción REAL: un estado sembrado programáticamente no es
  // trabajo del profesional y no debe frenar el cierre de la pestaña.
  useEffect(() => {
    if (!sucio || !userEditoRef.current) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chrome legacy exige returnValue seteado para mostrar el diálogo.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [sucio]);

  // D1 · autosave: ~10 s después de la última tecla, SOLO con la atención EN
  // CURSO (en por_iniciar guardaría horas antes del turno; en retroactivo
  // persistiría cada typo sobre la sesión histórica de una visita cerrada),
  // SOLO tras una interacción real del profesional (el seed del carry-forward
  // no cuenta) y sin error pendiente. Cada edición reinicia el timer (debounce
  // por deps). Reusa handleGuardar con autosave:true: misma action y feedback,
  // pero SIN transicionar el turno (eso queda para el guardado manual).
  useEffect(() => {
    if (
      !decidirAutosave({
        sucio,
        guardando: saving,
        hayTurno: !!turnoActivo,
        hayError: saveError != null,
        modoTurno: turnoActivo?.modo ?? null,
        huboInteraccion: userEditoRef.current,
      })
    ) {
      return;
    }
    const t = window.setTimeout(() => {
      void handleGuardar({ autosave: true });
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
    // handleGuardar se recrea por render; los deps que importan son los que
    // reinician el debounce (soap/toolValue) + los gates de la decisión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soap, toolValue, sucio, saving, turnoActivo, saveError]);

  // "Guardar y cerrar": persiste la sesión Y cierra el turno (ATENDIENDO →
  // CERRADO) en un solo paso. La action devuelve ok({ cerrado }) — un err
  // significa que el guardado falló; ok({ cerrado: false }) que se guardó pero
  // el cierre no, sin perder el trabajo.
  const handleGuardarYCerrar = async () => {
    if (!turnoActivo || saving) return;
    const enviado: BorradorFicha = { soap, toolValue };
    setSaving(true);
    setSaveError(null);
    const result = await saveSesionYCerrarAction({
      turnoId: turnoActivo.id,
      pacienteId: paciente.id,
      toolValue: enviado.toolValue,
      soap: enviado.soap,
    });
    // Un ok (cerrado o no) implica que la sesión SE GUARDÓ: el baseline se
    // actualiza para que el guard de beforeunload no frene la navegación.
    if (result.ok) setBaseline(enviado);
    if (result.ok && result.data.cerrado) {
      // Turno cerrado: el lugar natural es la agenda del día (el turno ya no
      // está en curso). No reseteamos `saving` — navegamos fuera de la ficha.
      router.push("/hoy");
      return;
    }
    setSaving(false);
    if (result.ok) {
      // Sesión guardada pero el cierre falló — copy explícito, el trabajo no se
      // pierde y el turno sigue en curso (se puede reintentar cerrar).
      setSaveError(`Sesión guardada, pero no se pudo cerrar el turno: ${result.data.cierreError ?? "intentá de nuevo."}`);
    } else {
      // El guardado mismo falló: nunca se intentó cerrar.
      setSaveError(`No se pudo guardar: ${result.error.message}`);
    }
  };

  // D1 · el badge ahora refleja el ciclo del autosave: Guardando… → Guardado ✓
  // (con hora) → Borrador sin guardar apenas se vuelve a editar. Mismas clases
  // fm-save/tokens de siempre.
  const saveBadge: ReactNode = turnoActivo ? (
    saving ? (
      <span className="fm-save fm-save--saving">
        <span className="fm-save-spinner" />
        Guardando…
      </span>
    ) : sucio ? (
      <span
        className="fm-save"
        title="Hay cambios sin guardar — se autoguardan unos segundos después de dejar de escribir, o con «Guardar sesión»."
      >
        Borrador sin guardar
      </span>
    ) : savedAt ? (
      <span className="fm-save fm-save--saved">Guardado ✓ · {savedAt}</span>
    ) : (
      <span
        className="fm-save"
        title="El borrador se autoguarda mientras escribís; también podés usar «Guardar sesión»."
      >
        Sin cambios
      </span>
    )
  ) : undefined;

  return (
    <div className="pc-plan-tab">
      <div className="pc-module-badge">
        <def.Icon size={14} />
        <span>{def.badgeLabel}</span>
      </div>

      {/* Feedback quiro (jul-2026): la ficha se edita SIEMPRE que exista una
          visita contra la cual guardar (elegirTurnoAncla: en curso ?? de hoy
          por iniciar ?? última cerrada editable). Solo sin NINGÚN ancla queda
          read-only, con CTA honesto. En por_iniciar/retroactivo un aviso dice
          contra qué visita se guarda — transparencia clínica, no bloqueo. */}
      {!turnoActivo ? (
        <div className="pc-sin-turno" role="note">
          <I.Lock size={14} aria-hidden />
          <p>
            Este paciente todavía no tiene visitas para registrar. Sacá un turno
            (botón «Sacar turno», arriba) o iniciá la atención desde{" "}
            <Link href="/hoy" className="pc-link">/hoy</Link>{" "}
            para escribir y guardar la ficha.
          </p>
        </div>
      ) : turnoActivo.modo === "por_iniciar" ? (
        <div className="pc-sin-turno pc-sin-turno--info" role="note">
          <I.Calendar size={14} aria-hidden />
          <p>
            Turno de hoy a las{" "}
            {fmtTurnoAncla(turnoActivo.inicio, { hour: "2-digit", minute: "2-digit", hour12: false })}{" "}
            hs, sin iniciar — podés escribir la ficha ya: al guardar, el turno
            pasa a «Atendiendo» automáticamente.
          </p>
        </div>
      ) : turnoActivo.modo === "retroactivo" ? (
        <div className="pc-sin-turno pc-sin-turno--info" role="note">
          <I.History size={14} aria-hidden />
          <p>
            No hay un turno en curso: estás completando la ficha de la última
            visita ({fmtTurnoAncla(turnoActivo.inicio, { day: "numeric", month: "short" })}).
            Para registrar una visita nueva, sacá un turno.
          </p>
        </div>
      ) : null}

      {/* M55 · la Tool recibe SOLO el historial de SU tool_id (legacy NULL
          cuenta como quiropraxia): en fichas mixtas (cardio + psico) cada
          herramienta ve sus propias sesiones. El resumen por sesión de
          HistorialReciente/TabSesiones sigue siendo por tool_id persistido.
          readOnly solo sin turno ANCLA (paciente sin visitas editables):
          editar un borrador que no se puede guardar sería engañoso.
          Workstream 6 · quiropraxia (hideSoap) rinde la Tool a ancho completo y
          omite el SOAP; el resto conserva la grilla 380px + SOAP. */}
      {hideSoap ? (
        <def.Tool
          value={toolValue}
          onChange={onToolChange}
          onSeed={onToolSeed}
          readOnly={!turnoActivo}
          historial={filtrarToolHistorial(plan.toolHistorial, especialidad)}
          {...toolExtras}
        />
      ) : (
        <div className="pc-plan-grid">
          <def.Tool
            value={toolValue}
            onChange={onToolChange}
            onSeed={onToolSeed}
            readOnly={!turnoActivo}
            historial={filtrarToolHistorial(plan.toolHistorial, especialidad)}
            {...toolExtras}
          />
          {/* Continuidad EXPLÍCITA. La nota de hoy arranca vacía (el SOAP
              editable es el del turno ancla); si el profesional quiere seguir
              desde la visita anterior, la trae él, con la fecha a la vista. En
              quiropraxia no se ofrece: hideSoap no rinde el editor, así que
              sembrar ahí sería volver a mover la historia clínica sin que nadie
              pueda verlo ni corregirlo. */}
          {soapPrevioOfrecido ? (
            <div className="pc-sin-turno pc-sin-turno--info" role="note">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              <p>
                La nota de hoy está en blanco.{" "}
                <button type="button" className="pc-link pc-link--accion" onClick={cargarSoapAnterior}>
                  Traer la de la visita del {fmtSoapPrevio(soapPrevioOfrecido.fecha)}
                </button>{" "}
                para actualizar lo que cambió.
              </p>
            </div>
          ) : null}
          {soapDesde ? (
            <div className="pc-sin-turno pc-sin-turno--info" role="status">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8h.01M11 12h1v4h1" />
              </svg>
              <p>
                Nota cargada desde la visita del <b>{fmtSoapPrevio(soapDesde)}</b> — actualizá lo que
                cambió antes de guardar.
              </p>
            </div>
          ) : null}
          <SoapStacked
            soap={soap}
            setSoap={onSoapChange}
            saveBadge={saveBadge}
            guia={def.soapGuia}
            eyebrow={
              turnoActivo?.modo === "retroactivo"
                ? `Nota SOAP · visita del ${fmtTurnoAncla(turnoActivo.inicio, { day: "numeric", month: "short" })}`
                : undefined
            }
          />
        </div>
      )}

      {/* Sin SoapStacked (quiro) el badge de guardado se muestra acá, alineado
          al bloque de acciones de guardado de abajo. */}
      {hideSoap && saveBadge ? (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>{saveBadge}</div>
      ) : null}

      {/* Conflicto de escritura: otra pestaña guardó esta ficha mientras la
          editábamos. No se reintenta ni se pisa — el borrador local queda
          intacto para que el profesional pueda copiar lo que escribió antes de
          recargar. Antes esto era last-write-wins ciego con "Guardado ✓". */}
      {conflicto ? (
        <div className="pc-sin-turno pc-sin-turno--warn" role="alert">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
          <p>
            Esta ficha se guardó desde otro lado mientras la editabas, así que no
            escribimos encima. Copiá lo que agregaste y{" "}
            <button
              type="button"
              className="pc-link pc-link--accion"
              onClick={() => {
                setConflicto(false);
                router.refresh();
              }}
            >
              recargá la ficha
            </button>{" "}
            para ver lo último.
          </p>
        </div>
      ) : null}

      {/* M96 · SIEMPRE visible, con turno o sin turno. Es el pedido literal del
          quiropráctico: la ficha de papel "la agarra, la lee y la modifica
          cuando quiere". Una llamada telefónica ocurre aunque el próximo turno
          sea recién mañana — y hasta ahora no tenía dónde quedar registrada. */}
      <NotasFichaCard
        notas={notas}
        onAnotar={async (texto) => {
          const r = await addNotaFichaAction(paciente.id, texto);
          if (r.ok) {
            // revalidatePath ya corrió server-side; refresh trae la nota nueva.
            router.refresh();
            return null;
          }
          return r.error.message;
        }}
      />

      {turnoActivo ? (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
          {saveError ? (
            <span role="alert" style={{ color: "var(--red)", fontSize: 12.5 }}>
              {saveError}
            </span>
          ) : null}
          <button
            type="button"
            className="fi-btn fi-btn-secondary"
            onClick={() => {
              void handleGuardar();
            }}
            disabled={saving}
            aria-busy={saving}
            title="Guarda la herramienta y el SOAP como la sesión de este turno (editable hasta el cierre)"
          >
            {saving ? "Guardando…" : "Guardar sesión"}
          </button>
          {/* "Guardar y cerrar": solo con el turno ya EN ATENCIÓN (ATENDIENDO →
              CERRADO). En EN_SALA todavía no arrancó la atención, así que solo
              se ofrece "Guardar sesión" (el cierre lo hace "Abrir ficha" → ...
              → "Cerrar turno" / esta acción una vez en curso). */}
          {turnoActivo.estado === "ATENDIENDO" ? (
            <button
              type="button"
              className="fi-btn fi-btn-primary"
              onClick={() => {
                void handleGuardarYCerrar();
              }}
              disabled={saving}
              aria-busy={saving}
              title="Guarda la sesión y cierra el turno (suma a la recaudación del día)"
            >
              {saving ? "Guardando…" : "Guardar y cerrar"}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="pc-bottom-grid">
        <PlanTratamiento />
        <HistorialReciente />
      </div>
    </div>
  );
}

// ─── Sub: Otras tabs ───────────────────────────────────────────────────────

function TabInformacion() {
  const { paciente, cumple } = usePacienteFicha();
  // F7a (M89) · edición de la cobertura desde la ficha (modal chico).
  const [coberturaOpen, setCoberturaOpen] = useState(false);
  return (
    <div className="pc-info-grid">
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Contacto</span>
          <button
          type="button"
          className="pc-link"
          disabled
          title="Próximamente — editá desde Configuración o agregá nota en Sesiones"
          aria-disabled="true"
        >
          Editar
        </button>
        </header>
        <dl className="pc-dl">
          <dt>Teléfono</dt>
          <dd className="fm-mono">{paciente.tel || "—"}</dd>
          <dt>Email</dt>
          <dd>{paciente.email || "—"}</dd>
          <dt>Cumpleaños</dt>
          <dd>{cumple}</dd>
          <dt>Ocupación</dt>
          <dd>{paciente.ocupacion || "—"}</dd>
          <dt>Recomendado por</dt>
          <dd>{paciente.recomendadoPor || "—"}</dd>
          {/* F7a (M89) · cobertura REAL: "OSDE 210 · Nº 123456" o "Particular"
              (null). Cierra el D2 del "—" placeholder — el dato ya existe en
              paciente_identidad y se edita con el modal de al lado. */}
          <dt>Obra social</dt>
          <dd>
            {paciente.coberturaLeida ? (
              <>
                {formatCobertura(
                  paciente.coberturaNombre,
                  paciente.coberturaPlan,
                  paciente.coberturaNroAfiliado,
                )}{" "}
                <button
                  type="button"
                  className="pc-link"
                  onClick={() => setCoberturaOpen(true)}
                  title="Editar la obra social / prepaga del paciente"
                >
                  Editar
                </button>
              </>
            ) : (
              // El SELECT falló: NO decimos "Particular" (sería inventar un
              // dato clínico-administrativo) ni ofrecemos editar — el modal
              // prefillaría vacío y guardaría NULL sobre la cobertura real.
              <span style={{ color: "var(--ink-3)" }}>
                No se pudo leer la cobertura. Recargá la página.
              </span>
            )}
          </dd>
        </dl>
      </section>
      {coberturaOpen && paciente.coberturaLeida ? (
        <CoberturaModal
          pacienteId={paciente.id}
          prefill={{
            coberturaNombre: paciente.coberturaNombre,
            coberturaPlan: paciente.coberturaPlan,
            coberturaNroAfiliado: paciente.coberturaNroAfiliado,
          }}
          onClose={() => setCoberturaOpen(false)}
        />
      ) : null}
      <section className="pc-card">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Motivo de consulta</span>
        </header>
        <p className="pc-card-text">{paciente.motivo || "—"}</p>
        <div className="pc-tags">
          {paciente.tags.map((t) => (
            <span key={t} className="fi-pill fi-pill--mute">{t}</span>
          ))}
        </div>
      </section>
      <section className="pc-card pc-info-notes">
        <header className="pc-card-head">
          <span className="fi-eyebrow">Notas internas</span>
        </header>
        <p className="pc-card-text muted">
          {paciente.notasImportantes || "Sin notas registradas todavía."}
        </p>
      </section>
      <InfoAvanzada />
      <ConsentimientosCard pacienteId={paciente.id} pacienteNombre={paciente.nombre} />
    </div>
  );
}

// ─── Sub: Información avanzada por especialidad (read-only + editar) ──────────

function InfoAvanzada() {
  const { paciente, especialidad, intakeAvanzado } = usePacienteFicha();
  const [editOpen, setEditOpen] = useState(false);

  // Los campos/labels salen del config de la especialidad ACTIVA. Mostramos
  // todos los campos del config con su valor (o "—" si no está) para que la
  // ficha refleje la anamnesis completa de esa especialidad.
  const campos = getIntakeAvanzadoConfig(especialidad).campos;
  const datos = intakeAvanzado?.datos ?? {};

  return (
    <section className="pc-card">
      <header className="pc-card-head">
        <span className="fi-eyebrow">Información avanzada</span>
        <button
          type="button"
          className="pc-link"
          onClick={() => setEditOpen(true)}
          title="Editar los antecedentes de esta especialidad"
        >
          Editar
        </button>
      </header>
      {campos.length === 0 ? (
        <p className="pc-card-text muted">No hay campos avanzados para esta especialidad.</p>
      ) : (
        <dl className="pc-dl">
          {campos.map((campo) => (
            <FragmentCampo key={campo.key} label={campo.label} valor={fmtIntakeValor(datos[campo.key])} />
          ))}
        </dl>
      )}

      {editOpen ? (
        <IntakeAvanzadoModal
          pacienteId={paciente.id}
          especialidad={especialidad}
          datos={intakeAvanzado?.datos ?? null}
          onClose={() => setEditOpen(false)}
        />
      ) : null}
    </section>
  );
}

/** Una fila dt/dd del intake avanzado (label + valor formateado). */
function FragmentCampo({ label, valor }: { label: string; valor: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{valor}</dd>
    </>
  );
}

/** Formatea un valor del intake para la vista read-only (es-AR). */
function fmtIntakeValor(value: unknown): string {
  if (value === true) return "Sí";
  if (value === false || value == null) return "—";
  if (typeof value === "string") return value.trim().length > 0 ? value : "—";
  return String(value);
}

/** Labels de las 4 secciones del SOAP para el detalle expandible (D2). */
const SOAP_DETALLE = [
  ["s", "Subjetivo"],
  ["o", "Objetivo"],
  ["a", "Análisis"],
  ["p", "Plan"],
] as const;

function TabSesiones() {
  const { plan, paciente } = usePacienteFicha();
  // D2 · filas expandibles: set de keys abiertas (estado local — el panel
  // queda montado con `hidden`, así que sobrevive el cambio de tab).
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="pc-sesiones">
      <div className="pc-sesiones-toolbar">
        <span className="fi-eyebrow">
          {plan.sesiones.length} sesiones · desde {fmtFecha(plan.inicio)}
        </span>
        <button
          type="button"
          className="fi-btn fi-btn-secondary"
          disabled
          title="Próximamente — las sesiones se generan al cerrar un turno desde /hoy"
          aria-disabled="true"
        >
          <I.Plus size={12} /> Nueva sesión
        </button>
      </div>
      <div className="pc-sesiones-list">
        {plan.sesiones.map((s, i) => {
          const key = s.sesionId ?? `${s.fecha}-${i}`;
          const abierta = abiertas.has(key) && s.soap != null;
          // Fix D2: el año salía hardcodeado "2026" — ahora se deriva de la
          // fecha real de la sesión.
          const anio = anioDeFecha(s.fecha);
          const soapConContenido = s.soap
            ? SOAP_DETALLE.filter(([k]) => s.soap![k].trim().length > 0)
            : [];
          return (
            <div key={key} className="pc-sesion-item">
              <div className="pc-sesion-row">
                <div className="pc-sesion-date">
                  <b className="fm-mono">{fmtFecha(s.fecha)}</b>
                  {anio ? <span className="muted">{anio}</span> : null}
                </div>
                <div className="pc-sesion-body">
                  <div className="pc-sesion-title">
                    <b>Sesión {plan.sesiones.length - i}</b>
                    <span className="muted">· {s.servicio}</span>
                    <span className="fi-pill fi-pill--mute fm-mono">{s.dur} min</span>
                  </div>
                  <p>{s.cambio}</p>
                  {s.vertebras.length ? (
                    <div className="pc-sesion-tags">
                      {s.vertebras.map((v) => (
                        <span key={v} className="fi-pill fi-pill--mute fm-mono">{v}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
                {s.soap ? (
                  <button
                    type="button"
                    className="pc-link"
                    onClick={() => toggle(key)}
                    aria-expanded={abierta}
                    title={abierta ? "Ocultar el detalle de esta sesión" : "Ver el SOAP completo de esta sesión"}
                  >
                    {abierta ? "Ocultar detalle" : "Ver detalle"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pc-link"
                    disabled
                    title="Esta visita cerró sin sesión registrada"
                    aria-disabled="true"
                  >
                    Ver detalle
                  </button>
                )}
              </div>
              {abierta && s.soap ? (
                <div className="pc-sesion-detalle">
                  {soapConContenido.length > 0 ? (
                    <div className="pc-sesion-soap">
                      {soapConContenido.map(([k, label]) => (
                        <div key={k} className="pc-sesion-soap-item">
                          <b>{label}</b>
                          <p>{s.soap![k]}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="pc-sesion-detalle-vacio">
                      Sin nota SOAP registrada para esta sesión.
                    </p>
                  )}
                  <p className="pc-sesion-detalle-resumen">
                    <b>Herramienta:</b> {s.cambio}
                  </p>
                  {s.sesionId ? (
                    <div className="pc-sesion-detalle-foot">
                      <a
                        href={`/api/pacientes/${paciente.id}/ficha-pdf?sesion=${s.sesionId}`}
                        download
                        className="fi-btn fi-btn-ghost"
                        title="Descargar el PDF membretado de esta sesión"
                      >
                        <I.FileDown size={12} /> PDF de esta sesión
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// D2 · tab Documentos real: lista transversal de documento_clinico del
// paciente (todas las categorías — las galerías de las Tools filtran por la
// suya) + subida generalizada. Labels es-AR del enum tipo_documento (M08);
// FOTO_POSTURAL no se ofrece en el select (exige consentimiento FOTOS firmado
// — flujo aparte) pero sí se muestra si ya existe.
const TIPO_DOC_LABELS: Record<string, string> = {
  RMN: "RMN",
  TAC: "TAC",
  RADIOGRAFIA: "Radiografía",
  ECOGRAFIA: "Ecografía",
  LABORATORIO: "Laboratorio",
  RECETA_EXTERNA: "Receta externa",
  INFORME_EXTERNO: "Informe externo",
  FOTO_POSTURAL: "Foto postural",
  OTRO: "Otro",
};

const TIPOS_DOC_SUBIBLES = [
  "INFORME_EXTERNO",
  "LABORATORIO",
  "RADIOGRAFIA",
  "RMN",
  "TAC",
  "ECOGRAFIA",
  "RECETA_EXTERNA",
  "OTRO",
] as const;

function TabDocumentos({ active }: { active: boolean }) {
  const { paciente, plan } = usePacienteFicha();
  const router = useRouter();
  const turnoActivo = plan.turnoActivo;

  const [items, setItems] = useState<DocumentoFichaItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pedido, setPedido] = useState(false);

  const cargar = async () => {
    const result = await listDocumentosPacienteAction(paciente.id);
    if (result.ok) {
      setItems(result.data);
      setLoadError(null);
    } else {
      setItems([]);
      setLoadError(result.error.message);
    }
  };

  // Lazy por diseño: la lista (y sus signed URLs de 5 min) se pide recién
  // cuando el tab se ABRE por primera vez — el panel vive montado con `hidden`
  // (D1) y no queremos pagar la query en cada carga de la ficha.
  useEffect(() => {
    if (!active || pedido) return;
    setPedido(true);
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pedido]);

  // Subida (mismo gating que las galerías de las Tools: el documento cuelga de
  // la sesión de la visita en curso).
  const [file, setFile] = useState<File | null>(null);
  const [tipo, setTipo] = useState<string>("INFORME_EXTERNO");
  const [nota, setNota] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [subirError, setSubirError] = useState<string | null>(null);
  const [abriendoId, setAbriendoId] = useState<string | null>(null);

  const puedeSubir = !!turnoActivo && turnoActivo.tieneSesionGuardada;

  const handleUpload = async () => {
    if (!puedeSubir || !file || !turnoActivo || subiendo) return;
    setSubiendo(true);
    setSubirError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("pacienteId", paciente.id);
    fd.set("turnoId", turnoActivo.id);
    fd.set("tipo", tipo);
    if (nota.trim() !== "") fd.set("descripcion", nota.trim());
    const result = await uploadDocumentoPacienteAction(fd);
    setSubiendo(false);
    if (result.ok) {
      setFile(null);
      setNota("");
      void cargar();
      // Las galerías de las Tools (radiografías/estudios) también ven el
      // documento nuevo.
      router.refresh();
    } else {
      setSubirError(result.error.message);
    }
  };

  const abrirDocumento = async (doc: DocumentoFichaItem) => {
    if (abriendoId) return;
    setAbriendoId(doc.id);
    try {
      // Los signed URLs expiran a los 5 min: se pide uno fresco al abrir
      // (mismo patrón refresh de las galerías de las Tools). Si el refresh
      // falla, se intenta con el URL que ya teníamos.
      const result = await refreshRadiografiaUrlAction(doc.id);
      const url = result.ok ? result.data.signedUrl : doc.signedUrl;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setAbriendoId(null);
    }
  };

  return (
    <div className="pc-docs">
      {items === null ? (
        <p className="pc-docs-cargando muted" aria-live="polite">Cargando documentos…</p>
      ) : items.length === 0 ? (
        <div className="fi-empty" style={{ marginTop: 16 }}>
          <div className="fi-empty-glyph">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="3" width="14" height="18" rx="2.5" />
              <path d="M9 8h6M9 12h6M9 16h4" />
            </svg>
          </div>
          <h2>Sin documentos adjuntos.</h2>
          <p>Subí radiografías, estudios o informes para tener todo del paciente en un lugar.</p>
        </div>
      ) : (
        <div className="pc-docs-list">
          {items.map((doc) => (
            <div key={doc.id} className="pc-doc-row">
              <span className="fi-pill fi-pill--mute pc-doc-tipo">
                {TIPO_DOC_LABELS[doc.tipo] ?? doc.tipo}
              </span>
              <div className="pc-doc-meta">
                <b className="fm-mono">{fmtFecha(doc.fecha)} {anioDeFecha(doc.fecha)}</b>
                {doc.descripcion ? <span>{doc.descripcion}</span> : null}
              </div>
              <button
                type="button"
                className="fi-btn fi-btn-ghost"
                onClick={() => void abrirDocumento(doc)}
                disabled={abriendoId === doc.id}
                aria-busy={abriendoId === doc.id}
                title="Abrir el documento en una pestaña nueva (link temporal seguro)"
              >
                <I.ExternalLink size={12} /> {abriendoId === doc.id ? "Abriendo…" : "Abrir"}
              </button>
            </div>
          ))}
        </div>
      )}
      {loadError ? (
        <p role="alert" className="pc-docs-error">{loadError}</p>
      ) : null}

      <div className="pc-docs-upload">
        <span className="fi-eyebrow">Subir documento</span>
        <div className="pc-docs-upload-row">
          <label className="pc-quiro-file-label">
            <input
              type="file"
              accept="image/*,application/pdf,application/dicom"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={!puedeSubir || subiendo}
            />
            <span className="pc-quiro-pill">
              <I.Plus size={13} />
              {file ? file.name.slice(0, 28) : "Elegir archivo"}
            </span>
          </label>
          <select
            className="pc-docs-select"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            disabled={!puedeSubir || subiendo}
            aria-label="Tipo de documento"
          >
            {TIPOS_DOC_SUBIBLES.map((t) => (
              <option key={t} value={t}>{TIPO_DOC_LABELS[t]}</option>
            ))}
          </select>
          <input
            type="text"
            className="pc-quiro-input"
            placeholder="Nota (opcional)"
            value={nota}
            maxLength={200}
            onChange={(e) => setNota(e.target.value)}
            disabled={!puedeSubir || subiendo}
          />
          <button
            type="button"
            className="fi-btn fi-btn-secondary"
            onClick={() => void handleUpload()}
            disabled={!puedeSubir || !file || subiendo}
            title={
              puedeSubir
                ? "Adjuntar el documento a la sesión de la visita en curso"
                : "Necesitás una visita con sesión guardada para adjuntar documentos"
            }
          >
            {subiendo ? "Subiendo…" : "Subir documento"}
          </button>
        </div>
        {!puedeSubir ? (
          <p className="pc-docs-hint muted">
            {turnoActivo
              ? "Guardá la sesión de la visita (tab Plan) para poder adjuntar documentos."
              : "Los documentos se adjuntan a una visita: sacá un turno o abrí la ficha desde /hoy."}
          </p>
        ) : null}
        {subirError ? (
          <p role="alert" className="pc-docs-error">{subirError}</p>
        ) : null}
      </div>
    </div>
  );
}

// ─── X7 · membrete de impresión + botón imprimir ───────────────────────────

/**
 * Encabezado que SOLO aparece al imprimir (clase `.print-only`, oculta en
 * pantalla vía @media print). Estampa consultorio · paciente · sección · fecha
 * para que la hoja impresa sea un documento auto-identificable. No hay PHI de
 * OTROS pacientes: la ruta /pacientes/[id] renderiza un único paciente.
 */
function FichaPrintHeader({
  organizacionNombre,
  pacienteNombre,
  seccion,
}: {
  organizacionNombre: string;
  pacienteNombre: string;
  seccion: string;
}) {
  const hoy = new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ_AR,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
  return (
    <header className="fi-print-header print-only" aria-hidden>
      <div className="fi-print-header-brand">
        <b>{organizacionNombre || "Folio"}</b>
        <span className="fi-print-header-meta">Impreso el {hoy}</span>
      </div>
      <p className="fi-print-header-doc">
        Ficha clínica — <b>{pacienteNombre}</b> · {seccion}
      </p>
    </header>
  );
}

/**
 * Botón "Imprimir" de la ficha. Dispara el diálogo de impresión del navegador;
 * los estilos `@media print` (folio.css) ocultan el chrome y refluyen a A4.
 * `.no-print` para que no aparezca en el propio papel.
 */
function ImprimirFichaButton() {
  return (
    <button
      type="button"
      className="fi-btn fi-btn-ghost no-print"
      onClick={() => window.print()}
      title="Imprimir o guardar como PDF la sección visible de la ficha"
    >
      <I.Printer size={13} /> Imprimir
    </button>
  );
}

// ─── Header del paciente ──────────────────────────────────────────────────

function PacienteWhatsAppButton({ telefono, nombre }: { telefono: string; nombre: string }) {
  // Normaliza a E.164 AR (54 + 9 móvil + NSN, sin 0/15) para que el deep-link
  // sirva con teléfonos en formato local (auditoría L4).
  const num = toWhatsappE164(telefono);
  if (!num) {
    return (
      <button
        type="button"
        className="fi-btn fi-btn-ghost"
        disabled
        title="Este paciente no tiene teléfono cargado"
        style={{ opacity: 0.5 }}
      >
        <I.Phone size={13} /> WhatsApp
      </button>
    );
  }
  return (
    <a
      href={`https://wa.me/${num}`}
      target="_blank"
      rel="noopener noreferrer"
      className="fi-btn fi-btn-ghost"
      title={`Abrir WhatsApp con ${nombre}`}
    >
      <I.Phone size={13} /> WhatsApp
    </a>
  );
}

function PacienteHeader() {
  const { paciente, plan, cumple } = usePacienteFicha();
  const ultimaVisita = plan.sesiones[0]?.fecha ?? null;
  const [agendarOpen, setAgendarOpen] = useState(false);
  return (
    <header className="pc-head">
      <Link href="/pacientes" className="pc-back">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Pacientes
      </Link>
      <div className="pc-id-row">
        <div className="fi-avatar pc-avatar">{iniciales(paciente.nombre)}</div>
        <div className="pc-id-body">
          <h1>{paciente.nombre}</h1>
          <div className="pc-id-meta">
            <span className="fi-pill fi-pill--mute">
              {paciente.tipo === "nuevo"
                ? "1ª visita"
                : `${paciente.sesiones}ª sesión`}
            </span>
            {paciente.tags.includes("VIP") ? (
              <span className="fi-pill fi-pill--vip">VIP</span>
            ) : null}
            <span className="muted">Cumple {cumple}</span>
            {ultimaVisita ? (
              <>
                <span className="muted">·</span>
                <span className="muted">Última visita {fmtFecha(ultimaVisita)}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="pc-actions">
          <PacienteWhatsAppButton telefono={paciente.tel} nombre={paciente.nombre} />
          <ImprimirFichaButton />
          {/* D2 · export PDF de la HC (la route existía sin ningún botón que la
              dispare). <a download> nativo: el server responde attachment con
              membrete + evolución; el audit del export queda en audit_log. */}
          <a
            href={`/api/pacientes/${paciente.id}/ficha-pdf`}
            download
            className="fi-btn fi-btn-ghost no-print"
            title="Descargar la historia clínica en PDF membretado (para compartir con un colega)"
          >
            <I.FileDown size={13} /> Exportar PDF
          </a>
          <button
            type="button"
            className="fi-btn fi-btn-secondary"
            title="Agendar un nuevo turno para este paciente"
            onClick={() => setAgendarOpen(true)}
          >
            <I.Calendar size={13} /> Sacar turno
          </button>
        </div>
      </div>

      {agendarOpen ? (
        <TurnoCreateModal
          origen="MANUAL"
          preselectPacienteId={paciente.id}
          onClose={() => setAgendarOpen(false)}
          onCreated={() => {
            setAgendarOpen(false);
            // El nuevo turno aparece en /hoy si es hoy, sino en /calendario.
            // Acá no necesitamos refrescar la ficha — el plan/sesiones se
            // actualizan cuando el turno se cierra (cron + transición).
          }}
        />
      ) : null}
    </header>
  );
}

// ─── Root ──────────────────────────────────────────────────────────────────

interface PacienteDetalleProps {
  paciente: PacienteFichaInfo;
  plan: PlanData;
  cumple: string;
  /** Especialidad de la org (M50) — el server component la saca del contexto activo. */
  especialidad: EspecialidadSlug;
  /** Workstream 5 · intake avanzado de la especialidad activa (M60) o null. */
  intakeAvanzado: IntakeAvanzadoFicha | null;
  /** X7 · nombre del consultorio/clínica para el membrete de impresión. */
  organizacionNombre: string;
  /** M96 · notas de la ficha (sin turno). */
  notas: NotaClinicaFicha[];
}

export function PacienteDetalle({
  paciente,
  plan,
  cumple,
  especialidad,
  intakeAvanzado,
  organizacionNombre,
  notas,
}: PacienteDetalleProps) {
  return (
    <PacienteFichaProvider
      value={{ paciente, plan, cumple, especialidad, intakeAvanzado, organizacionNombre, notas }}
    >
      <PacienteDetalleInner />
    </PacienteFichaProvider>
  );
}

function PacienteDetalleInner() {
  const { plan, paciente, organizacionNombre } = usePacienteFicha();
  const [tab, setTab] = useState<TabId>("plan");

  const tabs: [TabId, string, boolean?][] = [
    ["informacion", "Información"],
    ["plan", "Plan", true],
    ["sesiones", `Sesiones (${plan.sesiones.length})`],
    ["documentos", "Documentos"],
  ];

  // Patrón WAI-ARIA Tabs: flechas mueven el foco entre tabs con activación
  // automática (roving tabindex — solo la tab activa es tab-reachable).
  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, id: TabId) => {
    const ids = tabs.map(([tid]) => tid);
    const idx = ids.indexOf(id);
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % ids.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + ids.length) % ids.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = ids.length - 1;
    if (nextIdx == null) return;
    e.preventDefault();
    const nextId = ids[nextIdx];
    setTab(nextId);
    document.getElementById(`pc-tab-${nextId}`)?.focus();
  };

  const panelProps = (id: TabId) => ({
    role: "tabpanel" as const,
    id: `pc-panel-${id}`,
    "aria-labelledby": `pc-tab-${id}`,
    tabIndex: 0,
  });

  const tabLabel = tabs.find(([id]) => id === tab)?.[1] ?? "Ficha";

  return (
    <div className="fi-content pc-content" data-printable>
      {/* X7 · encabezado membretado sólo-impresión. En pantalla está oculto
          (`.print-only`); en papel identifica consultorio · paciente · fecha
          para que una hoja suelta no sea PHI anónima. */}
      <FichaPrintHeader
        organizacionNombre={organizacionNombre}
        pacienteNombre={paciente.nombre}
        seccion={tabLabel}
      />
      <PacienteHeader />

      <nav className="pc-tabs" role="tablist" aria-label="Secciones de la ficha">
        {tabs.map(([id, lbl, isModule]) => (
          <button
            key={id}
            id={`pc-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`pc-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={"pc-tab " + (tab === id ? "is-active" : "")}
            onClick={() => setTab(id)}
            onKeyDown={(e) => onTabKeyDown(e, id)}
          >
            {lbl}
            {isModule && tab !== id ? <span className="pc-tab-dot" aria-hidden /> : null}
          </button>
        ))}
      </nav>

      {/* D1 · los panels quedan SIEMPRE montados y se ocultan con `hidden` en
          vez de montarse/desmontarse: el borrador del tab Plan (SOAP +
          herramienta a medio escribir) sobrevive el cambio de tab sin subir
          estado al provider — la alternativa de menor re-arquitectura.
          `hidden` = display:none nativo (no imprime, no recibe foco, no pinta);
          el costo de mantener montados los otros 3 tabs es mínimo (Documentos
          además difiere su fetch hasta la primera apertura). */}
      <div {...panelProps("informacion")} hidden={tab !== "informacion"}>
        <TabInformacion />
      </div>
      <div {...panelProps("plan")} hidden={tab !== "plan"}>
        <TabPlan />
      </div>
      <div {...panelProps("sesiones")} hidden={tab !== "sesiones"}>
        <TabSesiones />
      </div>
      <div {...panelProps("documentos")} hidden={tab !== "documentos"}>
        <TabDocumentos active={tab === "documentos"} />
      </div>
    </div>
  );
}
