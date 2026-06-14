"use client";

/**
 * Folio · PacienteCreateModal · alta de paciente desde el directorio.
 *
 * Variante standalone del flow walk-in (que crea paciente + turno juntos).
 * Recoge los campos COMUNES a todas las especialidades (identidad, contacto,
 * residencia, ocupación, recomendado por, motivo de consulta) y una sección
 * colapsable "Información avanzada (opcional)" cuyos campos dependen de la
 * especialidad (registry: getIntakeAvanzadoConfig). El avanzado NUNCA bloquea el
 * alta — es best-effort en el server. Tras el insert, el directorio se revalida
 * y el modal se cierra.
 */

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { createPacienteAction } from "@/app/(app)/pacientes/actions";
import {
  IntakeAvanzadoFields,
  datosToValores,
  valoresToDatos,
  type IntakeValor,
  type IntakeValores,
} from "@/components/pacientes/intake-avanzado-fields";
import {
  ESPECIALIDAD_SLUGS,
  ESPECIALIDADES_META,
  getIntakeAvanzadoConfig,
  normalizeEspecialidadSlug,
  type EspecialidadSlug,
} from "@/lib/especialidades/registry";
import { useModalA11y } from "@/lib/use-modal-a11y";

interface PacienteCreateModalProps {
  onClose: () => void;
  onCreated?: (id: string) => void;
  /** Especialidad EFECTIVA del usuario — fija qué campos avanzados se muestran. */
  especialidad?: EspecialidadSlug;
  /** true en CLINICA: muestra un selector de especialidad en el avanzado. */
  permiteElegirEspecialidad?: boolean;
}

interface FormState {
  nombre: string;
  apellido: string;
  telefono: string;
  email: string;
  fechaNacimiento: string;
  residencia: string;
  ocupacion: string;
  recomendadoPor: string;
  numeroDoc: string;
  motivoConsulta: string;
}

const EMPTY: FormState = {
  nombre: "",
  apellido: "",
  telefono: "",
  email: "",
  fechaNacimiento: "",
  residencia: "",
  ocupacion: "",
  recomendadoPor: "",
  numeroDoc: "",
  motivoConsulta: "",
};

export function PacienteCreateModal({
  onClose,
  onCreated,
  especialidad: especialidadProp,
  permiteElegirEspecialidad = false,
}: PacienteCreateModalProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // Sección avanzada: colapsada por defecto (opcional). La especialidad por
  // defecto es la efectiva del usuario; en CLINICA se puede cambiar. Valores
  // desconocidos/none normalizan a quiropraxia (el form igual nunca bloquea).
  const [avanzadoOpen, setAvanzadoOpen] = useState(false);
  const [especialidad, setEspecialidad] = useState<EspecialidadSlug>(
    normalizeEspecialidadSlug(especialidadProp),
  );
  const [avanzado, setAvanzado] = useState<IntakeValores>(() =>
    datosToValores(normalizeEspecialidadSlug(especialidadProp)),
  );

  // A11y de modal compartida: focus trap + Escape (deshabilitado en submit) +
  // foco inicial + restore focus al cerrar. Ver lib/use-modal-a11y.ts.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalA11y(dialogRef, { onClose, closeDisabled: pending });

  // Cambiar de especialidad (solo CLINICA) resetea los valores avanzados al set
  // de campos de la nueva — un valor de otra especialidad no aplica acá.
  const cambiarEspecialidad = (slug: EspecialidadSlug) => {
    setEspecialidad(slug);
    setAvanzado(datosToValores(slug));
  };

  const tieneCamposAvanzados = getIntakeAvanzadoConfig(especialidad).campos.length > 0;

  // canSubmit: solo los campos COMUNES requeridos. La sección avanzada es
  // opcional y NUNCA afecta el guardado.
  const canSubmit =
    !pending &&
    form.nombre.trim().length > 0 &&
    form.apellido.trim().length > 0 &&
    form.telefono.trim().length >= 6 &&
    form.email.trim().length > 0 &&
    form.fechaNacimiento.trim().length > 0 &&
    form.residencia.trim().length > 0 &&
    form.ocupacion.trim().length > 0 &&
    form.recomendadoPor.trim().length > 0 &&
    form.motivoConsulta.trim().length > 0;

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    setErr(null);

    // El avanzado solo viaja si tiene al menos un valor no vacío; si no, se omite
    // por completo (no creamos una fila vacía). El server igual revalida.
    const datos = valoresToDatos(avanzado);
    const intakeAvanzado =
      Object.keys(datos).length > 0 ? { especialidad, datos } : undefined;

    startTransition(async () => {
      const result = await createPacienteAction({
        nombre: form.nombre.trim(),
        apellido: form.apellido.trim(),
        telefono: form.telefono.trim(),
        email: form.email.trim(),
        fechaNacimiento: form.fechaNacimiento.trim(),
        domicilioCiudad: form.residencia.trim(),
        ocupacion: form.ocupacion.trim(),
        recomendadoPor: form.recomendadoPor.trim(),
        numeroDoc: form.numeroDoc.trim(),
        motivoConsulta: form.motivoConsulta.trim(),
        intakeAvanzado,
      });
      if (!result.ok) {
        setErr(result.error.message);
        return;
      }
      if (onCreated) onCreated(result.data.id);
      onClose();
      // Refrescar /pacientes para que aparezca en la tabla.
      router.refresh();
    });
  };

  const onAvanzadoChange = (key: string, value: IntakeValor) =>
    setAvanzado((prev) => ({ ...prev, [key]: value }));

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pac-create-title"
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
          <span className="fi-eyebrow">nuevo paciente</span>
          <h2 id="pac-create-title" style={{ margin: "4px 0 0", fontSize: 20 }}>
            Agregar al directorio
          </h2>
          <p style={{ margin: "4px 0 0", color: "var(--ink-3)", fontSize: 13 }}>
            Datos generales del paciente. La información avanzada por especialidad es
            opcional y la podés completar ahora o después desde la ficha.
          </p>
        </header>

        <Field label="Nombre" required>
          <input
            type="text"
            value={form.nombre}
            onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
            style={inputStyle}
            autoFocus
            required
          />
        </Field>

        <Field label="Apellido" required>
          <input
            type="text"
            value={form.apellido}
            onChange={(e) => setForm((f) => ({ ...f, apellido: e.target.value }))}
            style={inputStyle}
            required
          />
        </Field>

        <Field label="Teléfono" required hint="Mínimo 6 dígitos. Se cifra en la DB.">
          <input
            type="tel"
            value={form.telefono}
            onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
            style={inputStyle}
            required
          />
        </Field>

        <Field label="Email" required>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            style={inputStyle}
            required
          />
        </Field>

        <Field label="Fecha de nacimiento" required>
          <input
            type="date"
            value={form.fechaNacimiento}
            onChange={(e) => setForm((f) => ({ ...f, fechaNacimiento: e.target.value }))}
            style={inputStyle}
            required
          />
        </Field>

        <Field label="Lugar de residencia" required hint="Ciudad o localidad.">
          <input
            type="text"
            value={form.residencia}
            onChange={(e) => setForm((f) => ({ ...f, residencia: e.target.value }))}
            style={inputStyle}
            maxLength={60}
            required
          />
        </Field>

        <Field label="Ocupación" required>
          <input
            type="text"
            value={form.ocupacion}
            onChange={(e) => setForm((f) => ({ ...f, ocupacion: e.target.value }))}
            style={inputStyle}
            maxLength={120}
            required
          />
        </Field>

        <Field label="Recomendado por" required hint="Quién derivó o recomendó al paciente.">
          <input
            type="text"
            value={form.recomendadoPor}
            onChange={(e) => setForm((f) => ({ ...f, recomendadoPor: e.target.value }))}
            style={inputStyle}
            maxLength={120}
            required
          />
        </Field>

        <Field label="DNI (opcional)" hint="Sin puntos. Se cifra y se indexa con SHA-256 para búsqueda.">
          <input
            type="text"
            value={form.numeroDoc}
            onChange={(e) => setForm((f) => ({ ...f, numeroDoc: e.target.value }))}
            style={inputStyle}
            inputMode="numeric"
            maxLength={20}
          />
        </Field>

        <Field label="Motivo de consulta" required>
          <textarea
            value={form.motivoConsulta}
            onChange={(e) => setForm((f) => ({ ...f, motivoConsulta: e.target.value }))}
            style={{ ...inputStyle, minHeight: 64, resize: "vertical" }}
            maxLength={2000}
            required
          />
        </Field>

        {/* ── Información avanzada (opcional) ─────────────────────────────────
            Colapsable. Los campos salen del registry según la especialidad.
            Nunca afecta canSubmit. */}
        <section style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <button
            type="button"
            className="pc-link"
            onClick={() => setAvanzadoOpen((v) => !v)}
            aria-expanded={avanzadoOpen}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {avanzadoOpen ? "▾" : "▸"} Información avanzada (opcional)
          </button>

          {avanzadoOpen ? (
            <div style={{ marginTop: 12 }}>
              {permiteElegirEspecialidad ? (
                <Field label="Especialidad" hint="Determina qué campos avanzados se cargan.">
                  <select
                    value={especialidad}
                    onChange={(e) => cambiarEspecialidad(e.target.value as EspecialidadSlug)}
                    style={inputStyle}
                  >
                    {ESPECIALIDAD_SLUGS.map((slug) => (
                      <option key={slug} value={slug}>
                        {ESPECIALIDADES_META[slug].nombre}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}

              {tieneCamposAvanzados ? (
                <IntakeAvanzadoFields
                  especialidad={especialidad}
                  valores={avanzado}
                  onChange={onAvanzadoChange}
                  disabled={pending}
                />
              ) : (
                <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>
                  No hay campos avanzados para esta especialidad.
                </p>
              )}
            </div>
          ) : null}
        </section>

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
            disabled={!canSubmit}
          >
            {pending ? "Creando…" : "Crear paciente"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 13, color: "var(--ink-3)", marginBottom: 4 }}>
        {label}
        {required ? <span style={{ color: "var(--red)" }}> *</span> : null}
      </span>
      {children}
      {hint ? (
        <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>
          {hint}
        </span>
      ) : null}
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
