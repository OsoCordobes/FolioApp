import { notFound } from "next/navigation";

import { ShellMobileHarness } from "./harness";

/**
 * Folio · /dev/shell-mobile · dev-only preview (C1+C4).
 *
 * Renderiza los componentes nuevos del shell mobile SIN sesión: MobileNav
 * (bottom-nav + sheet "Más"), ToastProvider con toasts disparables y
 * ConfirmDialog en sus dos variantes. Sirve para el gate visual a 375px
 * (curl/DOM + browser manual) sin autenticarse contra la DB real.
 * 404 en producción via notFound() — mismo patrón que /dev/card.
 */

export const metadata = { title: "Shell mobile (dev)" };

export default function DevShellMobilePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <ShellMobileHarness />;
}
