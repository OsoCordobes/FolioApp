/**
 * Folio · /login
 *
 * Pantalla pública de entrada. Port del prototipo (`Folio · Login.html` +
 * `folio/auth.jsx`). En F1 visualmente idéntica al prototipo, con el
 * `onSubmit` no-op (preventDefault). F3 conecta a Supabase Auth.
 */

import { SideArt } from "@/components/auth/side-art";
import { AuthForms } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="au-app">
      <SideArt />
      <AuthForms initialVista="login" />
    </div>
  );
}
