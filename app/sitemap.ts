import type { MetadataRoute } from "next";

/**
 * Folio · Sitemap (Fase C · SEO).
 *
 * Solo rutas públicas indexables. Las páginas de reserva (`/book/[slug]`)
 * son dinámicas por profesional y no se enumeran acá; robots.ts las permite.
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://folio-app-ten.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: `${BASE_URL}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/login`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/onboarding`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/privacidad`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${BASE_URL}/terminos`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${BASE_URL}/cookies`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];
}
