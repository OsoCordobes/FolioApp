import { Suspense } from "react";
import { AuthForms } from "@/components/auth/login-form";
import { SideArt } from "@/components/auth/side-art";

export const metadata = {
  title: "Recuperar contraseña",
  description: "Recuperá el acceso a tu cuenta de Folio.",
};

export default function ForgotPage() {
  return (
    <div className="au-app">
      <SideArt />
      <Suspense fallback={<main className="au-main fx-auth-main" aria-busy="true" />}>
        <AuthForms initialVista="forgot" />
      </Suspense>
    </div>
  );
}
