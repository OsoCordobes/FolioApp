/**
 * Folio · shell del PORTAL DEL PACIENTE (Fase 3 · P3).
 *
 * Route group aislado de (app) [staff] y (public) [marketing/booking]. El portal
 * es su propio público: pacientes que inician sesión por magic-link para ver sus
 * turnos, consentimientos y (P5+) su resumen clínico curado.
 *
 * El gating de sesión lo hace el middleware (redirige /portal/* a /portal/login
 * si no hay sesión, y a /hoy si el usuario es staff sin cuenta de portal). Cada
 * page hija resuelve su propia sesión con `getPacienteSession()` como defensa en
 * profundidad. Sin sidebar de staff — el chrome del portal es liviano.
 */

export default function PortalShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="pt-app">{children}</div>;
}
