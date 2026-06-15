"use client";

/**
 * Folio · selector de especialidad para CUENTAS INTERNAS (is_internal_account).
 *
 * Herramienta de demo/QA: deja previsualizar la ficha clínica de cualquier
 * especialidad (quiropraxia / cardiología / psicología) sin crear varias
 * cuentas ni cambiar la config real del consultorio. Escribe una cookie
 * (`folio_esp_override`) que SOLO el server honra cuando la org es interna
 * (ver layout (app) + pacientes/[id]/page.tsx) y refresca la ruta.
 *
 * Clickear la especialidad REAL de la org limpia la cookie (vuelve a "real").
 * No se renderiza para cuentas normales (el sidebar lo gatea por isInternal).
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  ESPECIALIDAD_OVERRIDE_COOKIE,
  ESPECIALIDAD_SLUGS,
  ESPECIALIDADES_META,
  type EspecialidadSlug,
} from "@/lib/especialidades/meta";

interface Props {
  /** Especialidad efectiva que se está viendo (override ?? real). */
  current: EspecialidadSlug;
  /** Especialidad REAL de la org — clickearla limpia el override. */
  orgEspecialidad: EspecialidadSlug;
}

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 días

export function EspecialidadSwitcher({ current, orgEspecialidad }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sel, setSel] = useState<EspecialidadSlug>(current);

  function pick(slug: EspecialidadSlug) {
    if (slug === sel) return;
    setSel(slug);
    if (slug === orgEspecialidad) {
      // Volver a la especialidad real → borrar la cookie de override.
      document.cookie = `${ESPECIALIDAD_OVERRIDE_COOKIE}=; path=/; max-age=0; samesite=lax`;
    } else {
      document.cookie = `${ESPECIALIDAD_OVERRIDE_COOKIE}=${slug}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div
      className="fi-esp-switcher"
      title="Solo en cuentas internas: cambia qué ficha clínica ves (quiropraxia / cardiología / psicología) sin tocar la configuración real del consultorio."
    >
      <span className="fi-esp-switcher-lbl">Ficha · vista interna</span>
      <div className="fi-esp-switcher-pills" role="group" aria-label="Previsualizar ficha por especialidad">
        {ESPECIALIDAD_SLUGS.map((slug) => (
          <button
            key={slug}
            type="button"
            className={"fi-esp-pill" + (sel === slug ? " is-active" : "")}
            aria-pressed={sel === slug}
            disabled={pending}
            onClick={() => pick(slug)}
          >
            {ESPECIALIDADES_META[slug].nombre}
            {slug === orgEspecialidad ? <span className="fi-esp-pill-real" aria-hidden> ·</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
