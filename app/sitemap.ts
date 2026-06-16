import type { MetadataRoute } from "next";

/**
 * Folio · Sitemap (Fase C SEO + Fase 3 directorio).
 *
 * Rutas públicas indexables: las estáticas + el directorio (/profesionales y los
 * hubs por especialidad) + cada /book/[slug] cuya org OPTÓ por el directorio
 * (listar_en_directorio, M64). Las orgs NO listadas quedan noindex (ver
 * generateMetadata de /book) y FUERA del sitemap — el límite es el opt-in.
 * listDirectorioOrgs es guarded → si M64 no está aplicada, devuelve [] y el
 * sitemap solo trae las estáticas + hubs.
 */

import { getBaseUrl } from "@/lib/base-url";
import { listDirectorioOrgs } from "@/lib/db/directorio";
import { ESPECIALIDAD_SLUGS } from "@/lib/especialidades/meta";

const BASE_URL = getBaseUrl();

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE_URL}/login`, lastModified, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE_URL}/onboarding`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/privacidad`, lastModified, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE_URL}/terminos`, lastModified, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE_URL}/cookies`, lastModified, changeFrequency: "yearly", priority: 0.2 },
  ];

  const directorioEntries: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/profesionales`, lastModified, changeFrequency: "daily", priority: 0.9 },
    ...ESPECIALIDAD_SLUGS.map((slug) => ({
      url: `${BASE_URL}/profesionales/${slug}`,
      lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];

  // Solo orgs listadas (opt-in) → coherente con la indexabilidad de /book.
  const listed = await listDirectorioOrgs();
  const orgEntries: MetadataRoute.Sitemap = listed.map((o) => ({
    url: `${BASE_URL}/book/${o.slug}`,
    lastModified,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  return [...staticEntries, ...directorioEntries, ...orgEntries];
}
