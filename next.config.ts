import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Desactiva el badge "Building / Ready" del DevTools indicator de Next
   * en pantallas que se capturan para visual regression. El indicator
   * aparece en bottom-left durante `next dev` y rompe el diff pixel-perfect
   * en pantallas full-screen sin chrome (Focus). En producción no aparece.
   */
  devIndicators: false,
  outputFileTracingIncludes: {
    "/api/admin/migrate": ["./supabase/migrations/*.sql", "./supabase/seed/*.sql"],
  },
};

export default nextConfig;
