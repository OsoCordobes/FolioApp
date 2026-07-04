"use client";

/**
 * Folio · FirmaCanvasModal · consentimiento informado con firma en canvas
 * (Ley 26.529 art. 5-11).
 *
 * Flujo en dos pasos dentro de un único dialog (focus trap compartido):
 *   1. Elegir plantilla (tipo + versión) y leer el texto legal completo
 *      (markdown → bloques vía parseConsentMarkdown, render React puro — nunca
 *      dangerouslySetInnerHTML). Si el paciente tiene tutores legales
 *      vigentes, se elige el firmante (Ley 26.061: TRATAMIENTO_MENOR exige
 *      tutor cuando hay tutores cargados).
 *   2. Firmar en canvas (pointer events: mouse + touch + stylus) con
 *      deshacer/limpiar por trazo. Confirmar → toBlob PNG → FormData →
 *      uploadFirmaConsentimientoAction (upload server-side; el browser nunca
 *      toca Storage).
 *
 * A11y: useModalA11y (focus trap + Escape + restore focus) desde el día 1,
 * role="dialog" + aria-modal + aria-labelledby. El área legal es scrolleable
 * y enfocable (teclado). Cero hex propios: el trazo y el fondo del canvas se
 * leen de los tokens computados (--ink / --surface) con fallback a keywords.
 *
 * Los datos (plantillas + tutores) llegan por props — los busca la card antes
 * de abrir el modal. Eso mantiene este componente presentacional salvo por la
 * action final de submit.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { uploadFirmaConsentimientoAction } from "@/app/(app)/pacientes/actions";
import {
  defaultTutorId,
  parseConsentMarkdown,
  tipoConsentimientoLabel,
  tutorRequerido,
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
  const [tutorId, setTutorId] = useState<string>(
    defaultTutorId(plantillas[0]?.tipo ?? "", tutores) ?? "",
  );
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
  const requiereTutor = plantilla ? tutorRequerido(plantilla.tipo, tutores.length) : false;
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

  const continuarAFirma = () => {
    setError(null);
    if (!plantilla) {
      setError("Elegí una plantilla para continuar.");
      return;
    }
    if (requiereTutor && tutorId === "") {
      setError("Seleccioná el tutor legal que firma (tratamiento de menor).");
      return;
    }
    setPaso(2);
  };

  const volverAPlantilla = () => {
    if (pending) return;
    setError(null);
    setPaso(1);
  };

  const elegirPlantilla = (id: string) => {
    setPlantillaId(id);
    const tipo = plantillas.find((p) => p.id === id)?.tipo ?? "";
    // Recalcular firmante default al cambiar de tipo (menor → tutor principal).
    setTutorId(defaultTutorId(tipo, tutores) ?? "");
  };

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
      const formData = new FormData();
      formData.set("file", blob, "firma.png");
      formData.set("pacienteId", pacienteId);
      formData.set("plantillaId", plantilla.id);
      formData.set("tutorId", tutorId);
      const result = await uploadFirmaConsentimientoAction(formData);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onCreated();
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
      className="a11y-modal-root pc-consent-overlay"
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
            {paso === 1
              ? `El paciente (o su tutor legal) lee el texto y firma en el paso siguiente. Registro según Ley 26.529.`
              : tutorSeleccionado
                ? `Firma ${tutorSeleccionado.nombre} (tutor legal · ${vinculoLabel(tutorSeleccionado.vinculo)}) en nombre de ${pacienteNombre}.`
                : `Firma ${pacienteNombre}. La firma se guarda cifrada en el archivo del paciente.`}
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

            {tutores.length > 0 ? (
              <label className="pc-consent-firmante">
                <span className="pc-consent-label">
                  Quién firma{requiereTutor ? " (requerido: tutor legal)" : ""}
                </span>
                <select
                  value={tutorId}
                  onChange={(e) => setTutorId(e.target.value)}
                  className="pc-consent-select"
                >
                  {/* TRATAMIENTO_MENOR con tutores cargados: firma el tutor sí
                      o sí (Ley 26.061). Para un adolescente que consiente por
                      sí (CCyC art. 26) se usa la plantilla General. */}
                  {!requiereTutor ? <option value="">El paciente</option> : null}
                  {tutores.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre} · tutor legal ({vinculoLabel(t.vinculo)})
                    </option>
                  ))}
                </select>
              </label>
            ) : plantilla.tipo === "TRATAMIENTO_MENOR" ? (
              <p className="pc-consent-aviso" role="note">
                Este paciente no tiene tutores legales cargados: la firma queda
                registrada a nombre del paciente. Para menores, cargá el tutor
                en la ficha cuando esté disponible.
              </p>
            ) : null}
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
                onClick={continuarAFirma}
              >
                Continuar a la firma
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
                {pending ? "Registrando…" : "Confirmar y registrar firma"}
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
