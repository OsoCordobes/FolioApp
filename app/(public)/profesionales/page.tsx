import type { Metadata } from "next";

import { DirectorioPage } from "@/components/directorio/directorio-page";
import { listDirectorioOrgs } from "@/lib/db/directorio";

/**
 * Folio · /profesionales — índice del directorio público (Fase 3).
 *
 * Lista los consultorios que optaron IN (listar_en_directorio, M64). Destino de
 * descubrimiento de Folio + canal de adquisición (el empty-state convierte a
 * onboarding). ISR: se regenera cada 5 min. Indexable (es contenido público de
 * marca); la indexabilidad por-médico de /book/[slug] sí está gateada al opt-in.
 */

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Profesionales de la salud · Folio",
  description:
    "Encontrá profesionales de la salud y reservá tu turno online: quiropraxia, cardiología, psicología y más.",
};

export default async function ProfesionalesIndexPage() {
  const orgs = await listDirectorioOrgs();
  return (
    <DirectorioPage
      orgs={orgs}
      title="Profesionales de la salud"
      subtitle="Encontrá tu profesional y reservá tu turno online."
      emptyRef="dir"
    />
  );
}
