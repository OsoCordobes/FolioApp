"use client";

/**
 * Folio · IntakeAvanzadoModal · edición del intake avanzado de la ficha (M60).
 *
 * El tab "Información" muestra la sección avanzada de la especialidad ACTIVA
 * read-only; este modal la edita. Renderiza los mismos campos dinámicos que el
 * alta (IntakeAvanzadoFields, según getIntakeAvanzadoConfig), prefilleados, y al
 * guardar llama a savePacienteIntakeAvanzadoAction (upsert por
 * paciente+especialidad). PHI: los datos viajan en claro dentro del Server Action
 * y se cifran server-side en el writer.
 *
 * Clona la estructura de PlanTratamientoModal: role="dialog" + useModalA11y
 * (focus trap + Escape + restore focus) + el look Field/inputStyle inline.
 */

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { savePacienteIntakeAvanzadoAction } from "@/app/(app)/pacientes/actions";
import {
  IntakeAvanzadoFields,
  datosToValores,
  valoresToDatos,
  type IntakeValor,
  type IntakeValores,
} from "@/components/pacientes/intake-avanzado-fields";
import {
  ESPECIALIDADES_META,
  getIntakeAvanzadoConfig,
  type EspecialidadSlug,
} from "@/lib/especialidades/registry";
import { useModalA11y } from "@/lib/use-modal-a11y";

interface IntakeAvanzadoModalProps {
  pacienteId: string;
  especialidad: EspecialidadSlug;
  /** Valores actuales del intake (descifrados) para prefillear. */
  datos: Record<string, unknown> | null;
  onClose: () => void;
}

export function IntakeAvanzadoModal({
  pacienteId,
  especialidad,
  datos,
  onClose,
}: IntakeAvanzadoModalProps) {
  const router = useRouter();
  const [valores, setValores] = useState<IntakeValores>(() =>
    datosToValores(especialidad, datos),
  );
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // A11y de modal compartida: focus trap + Escape (deshabilitado en submit) +
  // foco inicial + restore focus al cerrar. Ver lib/use-modal-a11y.ts.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(dialogRef, { onClose, closeDisabled: pending });

  const tieneCampos = getIntakeAvanzadoConfig(especialidad).campos.length > 0;
  const nombreEsp = ESPECIALIDADES_META[especialidad].nombre;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setErr(null);

    // Campos vacíos / false se omiten — el upsert pisa la fila con los valores
    // cargados (vaciar todo deja un JSON {} válido).
    const datosOut = valoresToDatos(valores);

    startTransition(async () => {
      const result = await savePacienteIntakeAvanzadoAction({
        pacienteId,
        especialidad,
        datos: datosOut,
      });
      if (!result.ok) {
        setErr(result.error.message);
        return;
      }
      onClose();
      // Refrescar la ficha para que la sección muestre los valores recién guardados.
      router.refresh();
    });
  };

  const onChange = (key: string, value: IntakeValor) =>
    setValores((prev) => ({ ...prev, [key]: value }));

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="intake-edit-title"
      tabIndex={-1}
      className="a11y-modal-root"
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
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
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
      >
        <header style={{ marginBottom: 16 }}>
          <span className="fi-eyebrow">información avanzada</span>
          <h2 id="intake-edit-title" style={{ margin: "4px 0 0", fontSize: 20 }}>
            Editar información de {nombreEsp.toLowerCase()}
          </h2>
          <p style={{ margin: "4px 0 0", color: "var(--ink-3)", fontSize: 13 }}>
            Antecedentes del paciente para esta especialidad. Se cifran en la DB.
          </p>
        </header>

        {tieneCampos ? (
          <IntakeAvanzadoFields
            especialidad={especialidad}
            valores={valores}
            onChange={onChange}
            disabled={pending}
          />
        ) : (
          <p style={{ fontSize: 13, color: "var(--ink-3)" }}>
            No hay campos avanzados para esta especialidad.
          </p>
        )}

        {err ? (
          <p role="alert" style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>
            {err}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button
            type="button"
            className="fi-btn fi-btn-ghost"
            onClick={onClose}
            disabled={pending}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="fi-btn fi-btn-primary"
            disabled={pending || !tieneCampos}
            aria-busy={pending}
          >
            {pending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </div>
  );
}
