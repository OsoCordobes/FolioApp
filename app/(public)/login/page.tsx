/**
 * Folio · /login
 *
 * Pantalla pública de entrada con Server Actions de Supabase (F3). El
 * AuthForms es Client Component que usa useSearchParams (para leer
 * ?redirect=) — requiere Suspense en App Router.
 */

import { Suspense } from "react";

import { SideArt } from "@/components/auth/side-art";
import { AuthForms } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <div className="au-app">
      <SideArt />
      <Suspense fallback={<main className="au-main" />}>
        <AuthForms initialVista="login" />
      </Suspense>
    </div>
  );
}
