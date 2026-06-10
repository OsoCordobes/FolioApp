import type { MetadataRoute } from "next";

/**
 * Folio · Robots (Fase C · SEO).
 *
 * Bloquea la app autenticada (PHI detrás de auth igualmente, pero sin valor
 * de indexación) y APIs. `/onboarding` queda permitida (es el signup público)
 * y `/book/` también (páginas públicas de reserva de cada profesional).
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://folio-app-ten.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dev/",
          "/hoy",
          "/pacientes",
          "/calendario",
          "/finanzas",
          "/configuracion",
          "/focus",
          "/admin",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
