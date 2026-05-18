/**
 * Shell pública: login, onboarding, booking público (F7).
 *
 * No tiene sidebar. Cada ruta hija provee su propio chrome
 * (centrar, fondo, header, etc.) según el prototipo.
 */

export default function PublicShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
