import { redirect } from "next/navigation";

/**
 * Root index: redirige a /hoy. En F3, cuando exista auth, esta lógica
 * se mueve a middleware y redirige a /login si no hay sesión.
 */
export default function Index() {
  redirect("/hoy");
}
