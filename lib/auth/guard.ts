/**
 * Folio · route capability guards (M49 / clinic mode)
 *
 * Ocultar un item del sidebar NO protege la ruta: cualquiera puede tipear la
 * URL. Estos helpers convierten la sesión activa en capacidades y permiten que
 * un Server Component corte el acceso con `notFound()` cuando el rol no
 * corresponde. La RLS sigue protegiendo los datos; esto evita además renderizar
 * un panel vacío/confuso a quien no debería verlo.
 */

import { capabilitiesFor, type Capabilities, type Role } from "@/lib/auth/capabilities";

export interface SessionRoleLike {
  role: Role;
  esColegiado: boolean;
}

/** Capacidades de la sesión activa. */
export function capabilitiesForSession(session: SessionRoleLike): Capabilities {
  return capabilitiesFor(session.role, session.esColegiado);
}
