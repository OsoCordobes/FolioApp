"use client";

/**
 * Folio · Portal · FirmaPortalModal — firma de consentimiento por el PACIENTE
 * (Fase 3 · P6, Ley 26.529 art. 5-11).
 *
 * Variante portal del FirmaCanvasModal del staff: el firmante es SIEMPRE el titular
 * de la cuenta (no hay selección de tutor — un tutor firma desde el consultorio). El
 * flujo tiene hasta tres pasos según cuántas fichas linkeadas tenga la cuenta:
 *   0. (sólo si hay >1 ficha) Elegir en QUÉ consultorio firmar.
 *   1. Elegir la plantilla (tipo + versión) y leer el texto legal completo
 *      (parseConsentMarkdown → bloques React puros, nunca dangerouslySetInnerHTML).
 *   2. Firmar en canvas (pointer events) → toBlob PNG → FormData →
 *      uploadFirmaConsentimientoPortalAction (upload server-side; el browser nunca
 *      arma el path ni toca Storage directamente con un path del cliente).
 *
 * A11y: useModalA11y (focus trap + Escape + restore) + role="dialog". Cero hex
 * propios (trazo/fondo leídos de los tokens --ink/--surface computados).
 */

import { useCallback, useMemo, useRef, useState } from "react";

import {
  parseConsentMarkdown,
  tipoConsentimientoLabel,
  type ConsentBlock,
  type ConsentInline,
  type PlantillaVigente,
} from "@/lib/consentimientos/helpers";
import { useModalA11y } from "@/lib/use-modal-a11y";

import { uploadFirmaConsentimientoPortalAction } from "./actions";

/** Una ficha linkeada (consultorio) sobre la que el paciente puede firmar. */
export interface FichaPortal {
  pacienteId: string;
  organizacionNombre: string | null;
}

interface FirmaPortalModalProps {
  fichas: FichaPortal[];
  plantillas: PlantillaVigente[];
  onClose: () => void;
  /** Se llama cuando el consentimiento se creó — la lista se refresca. */
  onCreated: () => void;
}

type Punto = { x: number; y: number };

const CANVAS_ALTO = 220;
const TRAZO_ANCHO = 2.2;

export function FirmaPortalModal({
  fichas,
  plantillas,
  onClose,
  onCreated,
}: FirmaPortalModalProps) {
  const multiFicha = fichas.length > 1;
  // Paso 0 sólo existe con >1 ficha; si hay una sola, arrancamos en el paso 1.
  const [paso, setPaso] = useState<0 | 1 | 2>(multiFicha ? 0 : 1);
  const [pacienteId, setPacienteId] = useState<string>(fichas[0]?.pacienteId ?? "");
  const [plantillaId, setPlantillaId] = useState<string>(plantillas[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trazosCount, setTrazosCount] = useState(0);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(dialogRef, { onClose, closeDisabled: pending });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trazosRef = useRef<Punto[][]>([]);
  const dibujandoRef = useRef(false);

  const ficha = fichas.find((f) => f.pacienteId === pacienteId) ?? fichas[0] ?? null;
  const plantilla = plantillas.find((p) => p.id === plantillaId) ?? plantillas[0] ?? null;
  const bloques = useMemo<ConsentBlock[]>(
    () => (plantilla ? parseConsentMarkdown(plantilla.textoMarkdown) : []),
    [plantilla],
  );

  // ─── Canvas: tokens computados + redraw (espejo del modal staff) ────────────

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
      if (trazo.length === 1) ctx.lineTo(trazo[0].x + 0.1, trazo[0].y + 0.1);
      ctx.stroke();
    }
  };

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

  const continuarDeFicha = () => {
    setError(null);
    if (!ficha) {
      setError("Elegí un consultorio para continuar.");
      return;
    }
    setPaso(1);
  };

  const continuarAFirma = () => {
    setError(null);
    if (!plantilla) {
      setError("Elegí un consentimiento para continuar.");
      return;
    }
    setPaso(2);
  };

  const volverAtras = () => {
    if (pending) return;
    setError(null);
    if (paso === 2) {
      setPaso(1);
      return;
    }
    if (paso === 1 && multiFicha) {
      setPaso(0);
    }
  };

  // ─── Confirmar: canvas → PNG → Server Action ──────────────────────────────

  const confirmarFirma = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !plantilla || !ficha || pending) return;
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
      formData.set("pacienteId", ficha.pacienteId);
      formData.set("plantillaId", plantilla.id);
      const result = await uploadFirmaConsentimientoPortalAction(formData);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onCreated();
    } finally {
      setPending(false);
    }
  };

  if (!plantilla || !ficha) return null;

  const tituloPaso =
    paso === 0
      ? "Elegí tu consultorio"
      : paso === 1
        ? "Elegí el consentimiento"
        : `Firmar · ${plantilla.titulo}`;
  const totalPasos = multiFicha ? 3 : 2;
  const pasoVisible = multiFicha ? paso + 1 : paso;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pt-consent-modal-title"
      tabIndex={-1}
      className="a11y-modal-root pc-consent-overlay"
      onClick={pending ? undefined : onClose}
    >
      <div className="pc-consent-modal" onClick={(e) => e.stopPropagation()}>
        <header className="pc-consent-modal-head">
          <span className="fi-eyebrow">
            Consentimiento informado · paso {pasoVisible} de {totalPasos}
          </span>
          <h2 id="pt-consent-modal-title">{tituloPaso}</h2>
          <p className="pc-consent-modal-sub">
            {paso === 2
              ? "Firmá en el recuadro. La firma se guarda cifrada en tu ficha (Ley 26.529)."
              : "Leé el texto y firmá en el paso siguiente. Registro según Ley 26.529."}
          </p>
        </header>

        {paso === 0 ? (
          <fieldset className="pc-consent-tipos">
            <legend className="pc-consent-label">Consultorio</legend>
            {fichas.map((f) => (
              <label
                key={f.pacienteId}
                className={
                  "pc-consent-tipo" + (f.pacienteId === ficha.pacienteId ? " is-selected" : "")
                }
              >
                <input
                  type="radio"
                  name="pt-consent-ficha"
                  value={f.pacienteId}
                  checked={f.pacienteId === ficha.pacienteId}
                  onChange={() => setPacienteId(f.pacienteId)}
                />
                <span className="pc-consent-tipo-titulo">
                  {f.organizacionNombre ?? "Consultorio"}
                </span>
              </label>
            ))}
          </fieldset>
        ) : paso === 1 ? (
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
                    name="pt-consent-plantilla"
                    value={p.id}
                    checked={p.id === plantilla.id}
                    onChange={() => setPlantillaId(p.id)}
                  />
                  <span className="pc-consent-tipo-titulo">{p.titulo}</span>
                  <span className="pc-consent-tipo-meta fm-mono">
                    {tipoConsentimientoLabel(p.tipo)} · v{p.version}
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
          {paso === 2 ? (
            <>
              <button
                type="button"
                className="fi-btn fi-btn-ghost"
                onClick={volverAtras}
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
          ) : (
            <>
              <button
                type="button"
                className="fi-btn fi-btn-ghost"
                onClick={paso === 1 && multiFicha ? volverAtras : onClose}
              >
                {paso === 1 && multiFicha ? "Volver" : "Cancelar"}
              </button>
              <button
                type="button"
                className="fi-btn fi-btn-primary"
                onClick={paso === 0 ? continuarDeFicha : continuarAFirma}
              >
                {paso === 0 ? "Continuar" : "Continuar a la firma"}
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
