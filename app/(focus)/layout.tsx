/**
 * Shell para rutas de pantalla completa (Focus Mode). Sin sidebar.
 * Renderea children directos para preservar la pantalla full.
 */

export default function FocusShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
