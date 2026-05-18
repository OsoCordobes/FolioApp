/**
 * Shell autenticada (placeholder de auth — F3 agrega gating real).
 *
 * Render: sidebar fija + main scrollable, dentro de `.fi-app` (grid-2
 * 248px + 1fr) del prototipo. Las rutas hijas son responsables del
 * contenido del main (header de página, KPIs, listas, etc.).
 */

import { Sidebar } from "@/components/sidebar";

export default function AppShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="fi-app">
      <Sidebar />
      <main className="fi-main">{children}</main>
    </div>
  );
}
