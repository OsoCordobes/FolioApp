/**
 * Folio · vista de resultado de la confirmación 1-click (F7b).
 *
 * Presentacional puro (sin directive): lo renderizan tanto el Server
 * Component de la página (estados decididos en el GET) como el panel client
 * (estado devuelto por la action). SIN datos sensibles: solo el resultado,
 * fecha/hora y el nombre del consultorio — nunca el nombre del paciente ni
 * el servicio.
 */

import * as I from "@/components/icons";

import type { ResultadoAccion1Click } from "./actions";

type Tone = "ok" | "info" | "warn";

const COPY: Record<ResultadoAccion1Click, { tone: Tone; titulo: string; mensaje: string }> = {
  confirmado: {
    tone: "ok",
    titulo: "¡Turno confirmado!",
    mensaje: "Gracias por avisar. Te esperamos.",
  },
  ya_confirmado: {
    tone: "ok",
    titulo: "Tu turno ya estaba confirmado",
    mensaje: "No hace falta nada más. Te esperamos.",
  },
  cancelado: {
    tone: "info",
    titulo: "Turno cancelado",
    mensaje:
      "Avisamos al consultorio y liberamos el horario. Si querés reprogramar, contactalos directamente.",
  },
  ya_cancelado: {
    tone: "info",
    titulo: "Este turno ya estaba cancelado",
    mensaje: "Si querés un nuevo turno, contactá al consultorio.",
  },
  turno_pasado: {
    tone: "info",
    titulo: "Este turno ya pasó",
    mensaje: "El link de confirmación vale hasta el horario del turno.",
  },
  no_disponible: {
    tone: "warn",
    titulo: "Este turno no se puede modificar desde acá",
    mensaje: "Contactá al consultorio para hacer cambios.",
  },
  link_vencido: {
    tone: "info",
    titulo: "Este link venció",
    mensaje:
      "Los links de confirmación valen hasta el horario del turno. Si necesitás hacer cambios, contactá al consultorio.",
  },
  link_invalido: {
    tone: "warn",
    titulo: "Link inválido",
    mensaje: "El link no es válido o quedó incompleto. Abrilo de nuevo desde el email del recordatorio.",
  },
  rate_limited: {
    tone: "warn",
    titulo: "Demasiados intentos",
    mensaje: "Esperá unos minutos e intentá de nuevo.",
  },
  error: {
    tone: "warn",
    titulo: "No pudimos procesar el pedido",
    mensaje: "Probá de nuevo en unos minutos o contactá al consultorio.",
  },
};

export interface DatosTurnoPublicos {
  consultorioNombre: string;
  /** "mié 29 jul" — pre-formateada es-AR en la TZ de la org. */
  fecha: string;
  /** "10:00". */
  hora: string;
}

function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === "ok") return <I.Check size={22} />;
  if (tone === "warn") return <I.Alert size={22} />;
  return <I.Calendar size={22} />;
}

/** Bloque fecha/hora + consultorio (compartido con el panel del botón). */
export function DatosTurnoBlock({ datos }: { datos: DatosTurnoPublicos }) {
  return (
    <div className="fi-confirm-datos">
      <span className="fi-confirm-datos-org">{datos.consultorioNombre}</span>
      <span className="fi-confirm-datos-cuando">
        {datos.fecha} · {datos.hora} hs
      </span>
    </div>
  );
}

export function ConfirmacionResultadoView({
  resultado,
  datos,
}: {
  resultado: ResultadoAccion1Click;
  /** Presente solo cuando el turno se pudo cargar (nunca con link inválido). */
  datos?: DatosTurnoPublicos | null;
}) {
  const copy = COPY[resultado];
  const mostrarDatos = datos && (resultado === "confirmado" || resultado === "ya_confirmado");
  return (
    <section className="fi-confirm-card" aria-live="polite">
      <span className={`fi-confirm-icon fi-confirm-icon--${copy.tone}`} aria-hidden>
        <ToneIcon tone={copy.tone} />
      </span>
      <h1 className="fi-confirm-title">{copy.titulo}</h1>
      {mostrarDatos ? <DatosTurnoBlock datos={datos} /> : null}
      <p className="fi-confirm-msg">{copy.mensaje}</p>
    </section>
  );
}
