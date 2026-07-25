"use client";

/**
 * Folio · panel intermedio de la confirmación 1-click (F7b).
 *
 * Mitigación de prefetch: los clientes de correo (Google, Outlook) hacen GET
 * a ciegas de los links del email — el GET solo renderiza ESTE panel con los
 * datos y UN botón; la transición corre recién en el submit (server action =
 * POST, que los prefetchers no ejecutan).
 *
 * Un solo botón según la acción firmada en el token: "Confirmar turno"
 * (primario) o "Cancelar el turno" (danger). Tras la action renderiza la
 * vista de resultado in-place (sin redirect: el resultado refleja lo que la
 * action HIZO, no un query param falsificable).
 */

import { useState, useTransition } from "react";

import { ejecutarConfirmacion1Click, type ResultadoAccion1Click } from "./actions";
import {
  ConfirmacionResultadoView,
  DatosTurnoBlock,
  type DatosTurnoPublicos,
} from "./resultado-view";

export function ConfirmPanel({
  token,
  accion,
  datos,
}: {
  token: string;
  accion: "confirmar" | "cancelar";
  datos: DatosTurnoPublicos;
}) {
  const [resultado, setResultado] = useState<ResultadoAccion1Click | null>(null);
  const [pending, startTransition] = useTransition();

  if (resultado !== null) {
    return <ConfirmacionResultadoView resultado={resultado} datos={datos} />;
  }

  const esConfirmar = accion === "confirmar";

  const ejecutar = () => {
    startTransition(async () => {
      try {
        const r = await ejecutarConfirmacion1Click(token);
        setResultado(r.resultado);
      } catch {
        setResultado("error");
      }
    });
  };

  return (
    <section className="fi-confirm-card">
      <h1 className="fi-confirm-title">
        {esConfirmar ? "Confirmá tu turno" : "Cancelar tu turno"}
      </h1>
      <DatosTurnoBlock datos={datos} />
      <p className="fi-confirm-msg">
        {esConfirmar
          ? "Tocá el botón para avisar al consultorio que venís."
          : "Si no podés ir, tocá el botón y el consultorio libera el horario."}
      </p>
      <div className="fi-confirm-actions">
        <button
          type="button"
          className={esConfirmar ? "fi-btn fi-btn-primary fi-confirm-btn" : "fi-btn fi-btn-danger fi-confirm-btn"}
          disabled={pending}
          onClick={ejecutar}
        >
          {pending
            ? esConfirmar
              ? "Confirmando…"
              : "Cancelando…"
            : esConfirmar
              ? "Confirmar turno"
              : "Cancelar el turno"}
        </button>
      </div>
      {esConfirmar ? (
        <p className="fi-confirm-note">
          ¿No podés ir? Usá el link «No puedo ir» del email o contactá al consultorio.
        </p>
      ) : (
        <p className="fi-confirm-note">
          Si era un error, cerrá esta página — no se cancela nada sin tocar el botón.
        </p>
      )}
    </section>
  );
}
