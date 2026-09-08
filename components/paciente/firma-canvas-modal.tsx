"use client";

/**
 * Evaluación profesional por acto, seguida de evidencia individual por participante.
 * La edad o el nombre de la plantilla no deciden el firmante. Un registro pendiente
 * conserva el razonamiento sin atribuir una firma. El servidor vuelve a validar
 * evaluación, representación, vigencia y permisos al registrar cada consentimiento.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { createConsentAssessmentAction } from "@/app/(app)/pacientes/consentimiento-evaluacion-actions";
import { validateDecision, type DecisionMode } from "@/lib/consentimientos/decision";
import { uploadFirmaConsentimientoAction } from "@/app/(app)/pacientes/actions";
import {
  parseConsentMarkdown,
  tipoConsentimientoLabel,
  type ConsentBlock,
  type ConsentInline,
  type PlantillaVigente,
  type TutorOption,
} from "@/lib/consentimientos/helpers";
import { useModalA11y } from "@/lib/use-modal-a11y";

interface FirmaCanvasModalProps {
  pacienteId: string;
  pacienteNombre: string;
  plantillas: PlantillaVigente[];
  tutores: TutorOption[];
  onClose: () => void;
  /** Se llama con el consentimiento creado — la card refresca su lista. */
  onCreated: () => void;
}

type Punto = { x: number; y: number };

const CANVAS_ALTO = 220;
const TRAZO_ANCHO = 2.2;

export function FirmaCanvasModal({
  pacienteId,
  pacienteNombre,
  plantillas,
  tutores,
  onClose,
  onCreated,
}: FirmaCanvasModalProps) {
  const [paso, setPaso] = useState<1 | 2>(1);
  const [plantillaId, setPlantillaId] = useState<string>(plantillas[0]?.id ?? "");
  const [tutorId, setTutorId] = useState("");
  const [modo,setModo]=useState<DecisionMode>("PENDIENTE");
  const [fundamento,setFundamento]=useState("");
  const [participacion,setParticipacion]=useState("");
  const [riesgo,setRiesgo]=useState<"EVALUADO"|"REQUIERE_REVISION">("REQUIERE_REVISION");
  const [vigenteHasta,setVigenteHasta]=useState("");
  const [evaluacionId,setEvaluacionId]=useState("");
  const [firmaPaciente,setFirmaPaciente]=useState<Blob|null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cantidad de trazos en state para habilitar/deshabilitar botones; los
  // puntos viven en un ref (re-render por punto sería carísimo).
  const [trazosCount, setTrazosCount] = useState(0);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(dialogRef, { onClose, closeDisabled: pending });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trazosRef = useRef<Punto[][]>([]);
  const dibujandoRef = useRef(false);

  const plantilla = plantillas.find((p) => p.id === plantillaId) ?? plantillas[0] ?? null;
  const bloques = useMemo<ConsentBlock[]>(
    () => (plantilla ? parseConsentMarkdown(plantilla.textoMarkdown) : []),
    [plantilla],
  );
  const requiereTutor = modo === "ASISTIDO" || modo === "REPRESENTADO";
  const tutorSeleccionado = tutores.find((t) => t.id === tutorId) ?? null;

  // ─── Canvas: tokens computados + redraw ────────────────────────────────────

  const colorTrazo = () => {
    const c = canvasRef.current;
    const v = c ? getComputedStyle(c).getPropertyValue("--ink").trim() : "";
    return v || "black";
  };
  const colorFondo = () => {
    const c = canvasRef.current;
    const v = c ? getComputedStyle(c).getPropertyValue("--surface").trim() : "";
    return v || "white";
  };

  const pintarFondo = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    ctx.fillStyle = colorFondo();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const redibujar = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    pintarFondo(ctx, canvas);
    ctx.strokeStyle = colorTrazo();
    ctx.lineWidth = TRAZO_ANCHO;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const trazo of trazosRef.current) {
      if (trazo.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(trazo[0].x, trazo[0].y);
      for (const p of trazo.slice(1)) ctx.lineTo(p.x, p.y);
      // Un tap sin arrastre igual deja marca (punto).
      if (trazo.length === 1) ctx.lineTo(trazo[0].x + 0.1, trazo[0].y + 0.1);
      ctx.stroke();
    }
  };

  // Dimensiona el buffer del canvas al layout real al montar el paso 2.
  // useCallback con deps []: identidad estable para que React NO re-ejecute el
  // ref en cada render (asignar canvas.width borra el dibujo). `redibujar` solo
  // lee refs (trazos/canvas), así que la clausura del primer render alcanza.
  const montarCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(280, Math.round(rect.width));
    canvas.height = CANVAS_ALTO;
    redibujar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const puntoDesdeEvento = (e: React.PointerEvent<HTMLCanvasElement>): Punto | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    // Coordenadas del buffer (por si el CSS lo escala respecto del width real).
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pending) return;
    const p = puntoDesdeEvento(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dibujandoRef.current = true;
    trazosRef.current.push([p]);
    redibujar();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dibujandoRef.current) return;
    const p = puntoDesdeEvento(e);
    const trazo = trazosRef.current[trazosRef.current.length - 1];
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!p || !trazo || !ctx) return;
    const anterior = trazo[trazo.length - 1];
    trazo.push(p);
    // Dibujo incremental del segmento nuevo (sin redraw completo por punto).
    ctx.strokeStyle = colorTrazo();
    ctx.lineWidth = TRAZO_ANCHO;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(anterior.x, anterior.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const onPointerUp = () => {
    if (!dibujandoRef.current) return;
    dibujandoRef.current = false;
    setTrazosCount(trazosRef.current.length);
  };

  const deshacerTrazo = () => {
    trazosRef.current.pop();
    setTrazosCount(trazosRef.current.length);
    redibujar();
  };

  const limpiarFirma = () => {
    trazosRef.current = [];
    setTrazosCount(0);
    redibujar();
  };

  // ─── Navegación entre pasos ────────────────────────────────────────────────

  const continuarAFirma = async () => {
    if(pending||!plantilla)return;
    const decision=validateDecision({modo,fundamento,participacion,riesgo,tutorId:requiereTutor?tutorId||null:null});
    if(!decision.ok){setError(decision.message);return;}
    if(!vigenteHasta){setError("Indicá hasta cuándo corresponde esta evaluación, según el acto y su revisión.");return;}
    setPending(true);setError(null);
    try {
      const result=await createConsentAssessmentAction({pacienteId,plantillaId:plantilla.id,version:plantilla.version,textoConfirmado:plantilla.textoMarkdown,
        vigenteHasta:new Date(vigenteHasta+"T23:59:59-03:00").toISOString(),decision:decision.data});
      if(!result.ok){setError(result.error.message);return;}
      setEvaluacionId(result.data.id);setFirmaPaciente(null);limpiarFirma();
      if(modo==="PENDIENTE"){onCreated();return;}
      setPaso(2);
    }catch{setError("No pudimos registrar la evaluación. Reintentá.");}finally{setPending(false);}
  };

  const volverAPlantilla = () => {
    if (pending) return;
    setError(null);
    setFirmaPaciente(null);limpiarFirma();
    setPaso(1);
  };

  const elegirPlantilla = (id: string) => { setPlantillaId(id); setFirmaPaciente(null); setEvaluacionId(""); };

  // ─── Confirmar: canvas → PNG → Server Action ──────────────────────────────

  const confirmarFirma = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !plantilla || pending) return;
    if (trazosRef.current.length === 0) {
      setError("La firma está vacía — dibujala en el recuadro.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) {
        setError("No pudimos generar la imagen de la firma. Probá de nuevo.");
        return;
      }
      if(modo==="ASISTIDO"&&!firmaPaciente){setFirmaPaciente(blob);limpiarFirma();return;}
      const formData = new FormData();
      formData.set("file", firmaPaciente??blob, "firma.png");
      if(firmaPaciente)formData.set("fileRepresentante",blob,"firma-representante.png");
      formData.set("evaluacionId",evaluacionId);
      formData.set("pacienteId", pacienteId);
      formData.set("plantillaId", plantilla.id);
      formData.set("tutorId", tutorId);
      const result = await uploadFirmaConsentimientoAction(formData);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onCreated();
    } catch {
      setError("No pudimos confirmar el registro. Recargá la lista antes de reintentar; la evidencia puede haberse guardado.");
    } finally {
      setPending(false);
    }
  };

  if (!plantilla) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pc-consent-modal-title"
      tabIndex={-1}
      className="a11y-modal-root pc-consent-overlay ph-no-capture ph-no-capture-recording"
      data-sensitive
      onClick={pending ? undefined : onClose}
    >
      <div className="pc-consent-modal" onClick={(e) => e.stopPropagation()}>
        <header className="pc-consent-modal-head">
          <span className="fi-eyebrow">
            Consentimiento informado · paso {paso} de 2
          </span>
          <h2 id="pc-consent-modal-title">
            {paso === 1 ? "Elegir consentimiento" : `Firmar · ${plantilla.titulo}`}
          </h2>
          <p className="pc-consent-modal-sub">
            {paso===1 ? "La participación se decide para este acto; la edad o el tipo de plantilla no eligen al firmante." :
              modo==="REPRESENTADO"||(modo==="ASISTIDO"&&firmaPaciente) ? `Firma ${tutorSeleccionado?.nombre??"el representante verificado"}. Se conserva su rol separado del paciente.` :
              `Firma ${pacienteNombre}${modo==="ASISTIDO"?"; a continuación firmará el representante":""}.` }
          </p>
        </header>

        {paso === 1 ? (
          <>
            <fieldset className="pc-consent-tipos">
              <legend className="pc-consent-label">Tipo de consentimiento</legend>
              {plantillas.map((p) => (
                <label
                  key={p.id}
                  className={
                    "pc-consent-tipo" + (p.id === plantilla.id ? " is-selected" : "")
                  }
                >
                  <input
                    type="radio"
                    name="pc-consent-plantilla"
                    value={p.id}
                    checked={p.id === plantilla.id}
                    onChange={() => elegirPlantilla(p.id)}
                  />
                  <span className="pc-consent-tipo-titulo">{p.titulo}</span>
                  <span className="pc-consent-tipo-meta fm-mono">
                    {tipoConsentimientoLabel(p.tipo)} · v{p.version}
                    {p.esCustomDeOrg ? " · del consultorio" : ""}
                  </span>
                </label>
              ))}
            </fieldset>

            <div
              className="pc-consent-legal"
              tabIndex={0}
              role="document"
              aria-label={`Texto legal de ${plantilla.titulo}. Desplazate para leerlo completo.`}
            >
              {bloques.map((b, i) => (
                <BloqueLegal key={i} bloque={b} />
              ))}
            </div>

            <div className="au-form" data-sensitive>
              <label className="au-field"><span>Decisión profesional para este acto</span><select value={modo} onChange={e=>setModo(e.target.value as DecisionMode)}>
                <option value="PENDIENTE">Pendiente de revisión (sin atribuir firma)</option><option value="AUTONOMO">Decisión autónoma del paciente</option><option value="ASISTIDO">Paciente con asistencia del representante (dos firmas)</option><option value="REPRESENTADO">Representación con participación documentada del paciente</option>
              </select></label>
              <label className="au-field"><span>Comprensión, autonomía, acto y fundamento de la decisión</span><textarea value={fundamento} onChange={e=>setFundamento(e.target.value)} maxLength={2000}/></label>
              <label className="au-field"><span>Participación del paciente, o razón documentada de su imposibilidad</span><textarea value={participacion} onChange={e=>setParticipacion(e.target.value)} maxLength={2000}/></label>
              <label className="au-field"><span>Evaluación del acto y sus riesgos</span><select value={riesgo} onChange={e=>setRiesgo(e.target.value as typeof riesgo)}><option value="REQUIERE_REVISION">Requiere revisión</option><option value="EVALUADO">Evaluado por el profesional responsable</option></select></label>
              <label className="au-field"><span>Revisar nuevamente a más tardar el</span><input type="date" value={vigenteHasta} onChange={e=>setVigenteHasta(e.target.value)}/></label>
              {requiereTutor&&<label className="au-field"><span>Representación verificada para este consentimiento</span><select value={tutorId} onChange={e=>setTutorId(e.target.value)}><option value="">Elegir representante</option>{tutores.map(t=><option key={t.id} value={t.id}>{t.nombre} · {vinculoLabel(t.vinculo)}</option>)}</select></label>}
              {requiereTutor&&tutores.length===0&&<p role="alert">No hay una representación verificada y vigente. Podés guardar una evaluación pendiente y continuar registrando la atención, sin atribuir una firma.</p>}
              <p>La evaluación pendiente no es un consentimiento firmado ni impide registrar la atención. No acredita por sí sola capacidad legal ni cumplimiento normativo.</p>
            </div>
          </>
        ) : (
          <>
            <div className="pc-consent-canvas-frame">
              <canvas
                ref={montarCanvas}
                className="pc-consent-canvas"
                height={CANVAS_ALTO}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                aria-label="Área de firma. Dibujá la firma con el mouse, el dedo o un lápiz digital."
              />
              {trazosCount === 0 ? (
                <span className="pc-consent-canvas-hint" aria-hidden>
                  Firmá acá
                </span>
              ) : null}
            </div>
            <div className="pc-consent-canvas-tools">
              <button
                type="button"
                className="fi-btn fi-btn-ghost"
                onClick={deshacerTrazo}
                disabled={pending || trazosCount === 0}
              >
                Deshacer trazo
              </button>
              <button
                type="button"
                className="fi-btn fi-btn-ghost"
                onClick={limpiarFirma}
                disabled={pending || trazosCount === 0}
              >
                Limpiar
              </button>
            </div>
          </>
        )}

        {error ? (
          <p role="alert" className="pc-consent-error">
            {error}
          </p>
        ) : null}

        <footer className="pc-consent-modal-actions">
          {paso === 1 ? (
            <>
              <button type="button" className="fi-btn fi-btn-ghost" onClick={onClose}>
                Cancelar
              </button>
              <button
                type="button"
                className="fi-btn fi-btn-primary"
                onClick={()=>void continuarAFirma()}
                disabled={pending}
              >
                {pending?"Guardando…":modo==="PENDIENTE"?"Guardar evaluación pendiente":"Guardar evaluación y continuar a la firma"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="fi-btn fi-btn-ghost"
                onClick={volverAPlantilla}
                disabled={pending}
              >
                Volver al texto
              </button>
              <button
                type="button"
                className="fi-btn fi-btn-primary"
                onClick={() => {
                  void confirmarFirma();
                }}
                disabled={pending || trazosCount === 0}
                aria-busy={pending}
              >
                {pending ? "Registrando…" : modo==="ASISTIDO"&&!firmaPaciente ? "Conservar firma del paciente y continuar con representante" : "Confirmar y registrar evidencia"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

// ─── Render de bloques legales (tokens de parseConsentMarkdown) ──────────────

function Inlines({ inlines }: { inlines: ConsentInline[] }) {
  return (
    <>
      {inlines.map((seg, i) =>
        seg.bold ? <b key={i}>{seg.text}</b> : <span key={i}>{seg.text}</span>,
      )}
    </>
  );
}

function BloqueLegal({ bloque }: { bloque: ConsentBlock }) {
  switch (bloque.kind) {
    case "heading": {
      if (bloque.nivel === 1) return <h3 className="pc-consent-legal-h1">{bloque.text}</h3>;
      if (bloque.nivel === 2) return <h4 className="pc-consent-legal-h2">{bloque.text}</h4>;
      return <h5 className="pc-consent-legal-h2">{bloque.text}</h5>;
    }
    case "parrafo":
      return (
        <p>
          <Inlines inlines={bloque.inlines} />
        </p>
      );
    case "lista": {
      const items = bloque.items.map((item, i) => (
        <li key={i}>
          <Inlines inlines={item} />
        </li>
      ));
      return bloque.ordenada ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "checkbox":
      return (
        <p className="pc-consent-legal-check">
          <span className="pc-consent-legal-checkbox" aria-hidden /> {bloque.text}
        </p>
      );
    case "hr":
      return <hr className="pc-consent-legal-hr" />;
  }
}

const VINCULO_LABEL: Record<string, string> = {
  MADRE: "madre",
  PADRE: "padre",
  TUTOR_DESIGNADO: "tutor designado",
  ABUELO: "abuelo/a",
  OTRO: "otro vínculo",
};

function vinculoLabel(vinculo: string): string {
  return VINCULO_LABEL[vinculo] ?? vinculo.toLowerCase();
}
