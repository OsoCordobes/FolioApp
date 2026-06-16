import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DirectorioPage } from "@/components/directorio/directorio-page";
import { listDirectorioOrgs } from "@/lib/db/directorio";
import { ESPECIALIDAD_SLUGS, getEspecialidadMeta, isEspecialidadSlug } from "@/lib/especialidades/meta";

/**
 * Folio · /profesionales/[especialidad] — hub por especialidad (SEO).
 *
 * Página rankeable por categoría ("cardiología", etc.). SSG de los slugs
 * conocidos (generateStaticParams) + ISR. Rankea aun con pocos/ningún listado
 * (el empty-state convierte). Slug desconocido → 404.
 */

export const revalidate = 300;

export function generateStaticParams(): Array<{ especialidad: string }> {
  return ESPECIALIDAD_SLUGS.map((especialidad) => ({ especialidad }));
}

interface PageProps {
  params: Promise<{ especialidad: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { especialidad } = await params;
  if (!isEspecialidadSlug(especialidad)) return { title: "Profesionales · Folio" };
  const nombre = getEspecialidadMeta(especialidad).nombre;
  return {
    title: `${nombre} · Profesionales en Folio`,
    description: `Profesionales de ${nombre.toLowerCase()} con reserva de turnos online en Folio.`,
  };
}

export default async function EspecialidadHubPage({ params }: PageProps) {
  const { especialidad } = await params;
  if (!isEspecialidadSlug(especialidad)) notFound();

  const nombre = getEspecialidadMeta(especialidad).nombre;
  const orgs = await listDirectorioOrgs({ especialidad });

  return (
    <DirectorioPage
      orgs={orgs}
      title={nombre}
      subtitle={`Profesionales de ${nombre.toLowerCase()} con turnos online.`}
      activeEspecialidad={especialidad}
      emptyRef={`dir_${especialidad}`}
    />
  );
}
