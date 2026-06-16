/**
 * Folio · DirectorioPage · shell de /profesionales (índice + hubs).
 *
 * Server component reutilizado por la ruta índice, el hub por especialidad y el
 * long-tail por provincia. A diferencia de /book (médico-first), el directorio
 * ES un destino de Folio → lleva marca Folio en header/footer. El empty-state
 * convierte: "¿sos profesional? sumá tu consultorio" → onboarding.
 */

import Link from "next/link";

import { DirectorioCard } from "@/components/directorio/directorio-card";
import { FolioMark } from "@/components/folio-mark";
import type { DirectorioOrg } from "@/lib/db/directorio";
import { ESPECIALIDAD_SLUGS, getEspecialidadMeta } from "@/lib/especialidades/meta";

export function DirectorioPage({
  orgs,
  title,
  subtitle,
  activeEspecialidad = null,
  emptyRef = "dir",
}: {
  orgs: DirectorioOrg[];
  title: string;
  subtitle?: string;
  activeEspecialidad?: string | null;
  /** Sufijo de ?ref= para el CTA del empty-state (atribución onboarding). */
  emptyRef?: string;
}) {
  return (
    <div className="dir-root">
      <header className="dir-header">
        <Link className="dir-brand" href="/">
          <FolioMark size={24} />
          <span>Folio</span>
        </Link>
        <Link className="dir-header-cta" href={`/onboarding?ref=${emptyRef}_header`}>
          Sumá tu consultorio
        </Link>
      </header>

      <main className="dir-main">
        <div className="dir-intro">
          <h1 className="dir-title">{title}</h1>
          {subtitle ? <p className="dir-subtitle">{subtitle}</p> : null}
        </div>

        {/* Chips de especialidad (links rankables a los hubs). */}
        <nav className="dir-facets" aria-label="Filtrar por especialidad">
          <Link
            className={`dir-chip${activeEspecialidad == null ? " is-active" : ""}`}
            href="/profesionales"
          >
            Todos
          </Link>
          {ESPECIALIDAD_SLUGS.map((slug) => (
            <Link
              key={slug}
              className={`dir-chip${activeEspecialidad === slug ? " is-active" : ""}`}
              href={`/profesionales/${slug}`}
            >
              {getEspecialidadMeta(slug).nombre}
            </Link>
          ))}
        </nav>

        {orgs.length > 0 ? (
          <div className="dir-grid">
            {orgs.map((o) => (
              <DirectorioCard key={o.slug} org={o} />
            ))}
          </div>
        ) : (
          <div className="dir-empty">
            <p className="dir-empty-title">Todavía no hay consultorios para mostrar acá.</p>
            <p className="dir-empty-sub">
              ¿Sos profesional de la salud? Sumá tu consultorio a Folio y aparecé acá.
            </p>
            <Link
              className="fi-btn fi-btn-primary dir-empty-cta"
              href={`/onboarding?ref=${emptyRef}_empty`}
            >
              Crear mi página gratis
            </Link>
          </div>
        )}
      </main>

      <footer className="dir-footer">
        <span className="dir-footer-mark">
          <FolioMark size={18} />
        </span>
        <span>Folio · turnos y ficha clínica para profesionales de la salud</span>
      </footer>
    </div>
  );
}
